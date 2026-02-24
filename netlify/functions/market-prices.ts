import type { Handler } from "@netlify/functions";
import catalogData from "../../src/data/configurator/components.json";
import type { ConfigComponent, ComponentCatalog, MarketPriceOverride } from "../../src/lib/types";

interface MarketPriceResponse {
  ok: true;
  source: string;
  fetchedAt: string;
  overrides: MarketPriceOverride[];
}

const CATALOG = catalogData as ComponentCatalog;
const SOURCE_NAME = "Newegg UK";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_COMPONENTS_PER_REQUEST = 10;
const MAX_CONCURRENCY = 3;

const marketComponentMap = new Map(
  CATALOG.components
    .filter((component) => component.marketQuery && component.priceMin !== null && component.priceMax !== null)
    .map((component) => [component.id, component])
);

const marketCache = new Map<string, { expiresAt: number; override: MarketPriceOverride | null }>();

function json(statusCode: number, body: MarketPriceResponse) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function parseIds(idsRaw: string | undefined): string[] {
  if (!idsRaw) {
    return [];
  }

  const deduped = new Set(
    idsRaw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );

  return Array.from(deduped).slice(0, MAX_COMPONENTS_PER_REQUEST);
}

function normalizeTitle(value: string | undefined): string {
  return (value || "").toLowerCase();
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function extractNeweggState(html: string): { Products?: Array<Record<string, unknown>> } | null {
  const match = html.match(
    /window\.__initialState__\s*=\s*(\{.*?\})\s*<\/script><script defer="">window\.__neweggState__/s
  );

  if (!match || !match[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as { Products?: Array<Record<string, unknown>> };
  } catch {
    return null;
  }
}

function matchesFilters(component: ConfigComponent, title: string): boolean {
  const normalized = normalizeTitle(title);
  const required = component.marketRequiredTokens || [];
  const excluded = component.marketExcludeTokens || [];

  for (const token of required) {
    if (!normalized.includes(token.toLowerCase())) {
      return false;
    }
  }

  for (const token of excluded) {
    if (normalized.includes(token.toLowerCase())) {
      return false;
    }
  }

  return true;
}

async function fetchNeweggSpotPrice(component: ConfigComponent): Promise<number | null> {
  if (!component.marketQuery) {
    return null;
  }

  const url = `https://www.newegg.com/global/uk-en/p/pl?d=${encodeURIComponent(component.marketQuery)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "accept-language": "en-GB,en;q=0.9",
        "user-agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const state = extractNeweggState(html);
    if (!state || !Array.isArray(state.Products)) {
      return null;
    }

    for (const product of state.Products.slice(0, 12)) {
      const itemCell = product.ItemCell as
        | {
            FinalPrice?: unknown;
            UnitCost?: unknown;
            Description?: { Title?: string };
          }
        | undefined;

      if (!itemCell) {
        continue;
      }

      const title = itemCell.Description?.Title;
      if (!matchesFilters(component, title || "")) {
        continue;
      }

      const price = parsePrice(itemCell.FinalPrice) ?? parsePrice(itemCell.UnitCost);
      if (price !== null) {
        return price;
      }
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildOverride(
  component: ConfigComponent,
  spot: number,
  updatedAt: string
): MarketPriceOverride | null {
  if (component.priceMin === null || component.priceMax === null) {
    return null;
  }

  const baseline = (component.priceMin + component.priceMax) / 2;
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }

  const maxDeviation = component.marketMaxDeviationPercent ?? 55;
  const deviationPercent = (Math.abs(spot - baseline) / baseline) * 100;
  if (deviationPercent > maxDeviation) {
    return null;
  }

  const priceBandPercent = component.marketPriceBandPercent ?? 8;
  const min = Math.max(0, Math.round(spot * (1 - priceBandPercent / 100)));
  const max = Math.max(min, Math.round(spot * (1 + priceBandPercent / 100)));

  return {
    id: component.id,
    priceMin: min,
    priceMax: max,
    spot: Math.round(spot * 100) / 100,
    source: SOURCE_NAME,
    updatedAt
  };
}

async function resolveOverride(component: ConfigComponent, updatedAt: string): Promise<MarketPriceOverride | null> {
  const now = Date.now();
  const cached = marketCache.get(component.id);
  if (cached && cached.expiresAt > now) {
    return cached.override;
  }

  const spot = await fetchNeweggSpotPrice(component);
  const override = spot === null ? null : buildOverride(component, spot, updatedAt);

  marketCache.set(component.id, {
    expiresAt: now + CACHE_TTL_MS,
    override
  });

  return override;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        continue;
      }
      results[currentIndex] = await worker(item);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runner()));

  return results;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      },
      body: JSON.stringify({
        ok: false,
        code: "method_not_allowed",
        message: "Only GET is supported."
      })
    };
  }

  const ids = parseIds(event.queryStringParameters?.ids);
  const requestedComponents = ids
    .map((id) => marketComponentMap.get(id))
    .filter((component): component is ConfigComponent => Boolean(component));

  const fetchedAt = new Date().toISOString();

  if (requestedComponents.length === 0) {
    return json(200, {
      ok: true,
      source: SOURCE_NAME,
      fetchedAt,
      overrides: []
    });
  }

  const resolved = await mapWithConcurrency(requestedComponents, MAX_CONCURRENCY, async (component) => {
    try {
      return await resolveOverride(component, fetchedAt);
    } catch (error) {
      console.error(`Market price sync failed for ${component.id}`, error);
      return null;
    }
  });

  const overrides = resolved.filter((override): override is MarketPriceOverride => Boolean(override));

  return json(200, {
    ok: true,
    source: SOURCE_NAME,
    fetchedAt,
    overrides
  });
};
