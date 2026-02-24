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
const SOURCE_NAME = "Live price";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_COMPONENTS_PER_REQUEST = 10;
const MAX_CONCURRENCY = 3;
const PCPP_BASE_URL = "https://uk.pcpartpicker.com";

const PCPP_HEADERS = {
  "accept-language": "en-GB,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
} as const;

const SCRAPE_PAYLOAD_DEFAULTS: Record<string, string> = {
  scr_perf: "{}",
  scr: "1",
  scr_vw: "1920",
  scr_vh: "1080",
  scr_dw: "1920",
  scr_dh: "1080",
  scr_daw: "1920",
  scr_dah: "1040",
  scr_ddw: "1920",
  scr_ddh: "1080",
  scr_wd: "0",
  plg: "5",
  scr_mme: "1",
  scr_mmw: "480",
  scr_mmh: "320",
  zp_kpm: "0",
  scr_msi: "0",
  zp_p: "",
  zp_fhv: "1",
  zp_fhh: "1",
  scr_tp: "0",
  scr_te: "0",
  scr_pe: "1"
};

type MarketCategory = Exclude<ConfigComponent["category"], "profile">;

const CATEGORY_PATHS: Record<MarketCategory, string> = {
  cpu: "/products/cpu/",
  gpu: "/products/video-card/",
  motherboard: "/products/motherboard/",
  ram: "/products/memory/",
  storage: "/products/internal-hard-drive/",
  psu: "/products/power-supply/",
  case: "/products/case/",
  cooling: "/products/cpu-cooler/"
};

const QUERY_STOP_WORDS = new Set([
  "and",
  "with",
  "for",
  "the",
  "wifi",
  "rgb",
  "non",
  "value",
  "build",
  "premium",
  "mainstream"
]);

const marketComponentMap = new Map(
  CATALOG.components
    .filter(
      (component) =>
        component.category !== "profile" &&
        component.marketQuery &&
        component.priceMin !== null &&
        component.priceMax !== null
    )
    .map((component) => [component.id, component])
);

const marketCache = new Map<string, { expiresAt: number; override: MarketPriceOverride | null }>();
const categoryCache = new Map<MarketCategory, { expiresAt: number; products: PcppProduct[] }>();

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

interface PcppCategoryPayload {
  success?: boolean;
  data?: Record<string, { id?: unknown; price?: unknown; img?: unknown }>;
  html?: string;
  error?: string;
}

interface PcppProduct {
  id: string;
  title: string;
  spot: number;
  image?: string;
}

interface PcppMarketData {
  spot: number;
  image?: string;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function normalizeText(value: string): string {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie().filter((value) => value.length > 0);
    if (values.length > 0) {
      return values;
    }
  }

  const fallback = response.headers.get("set-cookie");
  if (!fallback) {
    return [];
  }

  return [fallback];
}

function buildCookieHeader(setCookies: string[]): string {
  const cookies = new Map<string, string>();
  const blockedNames = new Set([
    "expires",
    "path",
    "domain",
    "max-age",
    "secure",
    "httponly",
    "samesite",
    "priority",
    "partitioned"
  ]);

  for (const rawCookie of setCookies) {
    const firstSegment = rawCookie.split(";")[0]?.trim();
    if (!firstSegment) {
      continue;
    }

    const separatorIndex = firstSegment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = firstSegment.slice(0, separatorIndex).trim();
    if (blockedNames.has(name.toLowerCase())) {
      continue;
    }

    const value = firstSegment.slice(separatorIndex + 1).trim();
    cookies.set(name, value);
  }

  if (cookies.size === 0 && setCookies.length > 0) {
    const merged = setCookies.join(", ");
    const matcher = /(?:^|,\s*)([^=;,\s]+)=([^;]+)/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(merged)) !== null) {
      const name = match[1];
      const value = match[2];
      if (!name || !value) {
        continue;
      }
      if (blockedNames.has(name.toLowerCase())) {
        continue;
      }
      cookies.set(name, value);
    }
  }

  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractCookieValue(cookieHeader: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match?.[1];
}

function parsePcPartPickerPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (Number.isInteger(value)) {
      return value / 100;
    }
    return value;
  }

  return parsePrice(value);
}

function normalizeImageUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("/")) {
    return `${PCPP_BASE_URL}${url}`;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return undefined;
}

function extractTitlesById(html: string): Map<string, string> {
  const titles = new Map<string, string>();
  const rowMatcher =
    /<tr[^>]*data-pb-id="(\d+)"[\s\S]*?<div class="td__nameWrapper">[\s\S]*?<p>([\s\S]*?)<\/p>/g;

  let match: RegExpExecArray | null;
  while ((match = rowMatcher.exec(html)) !== null) {
    const id = match[1];
    if (!id) {
      continue;
    }
    const title = normalizeText(match[2] || "");
    if (title.length > 0) {
      titles.set(id, title);
    }
  }

  return titles;
}

function parseCategoryProducts(payload: PcppCategoryPayload): PcppProduct[] {
  if (!payload.success || !payload.data || typeof payload.html !== "string") {
    return [];
  }

  const titles = extractTitlesById(payload.html);
  const products: PcppProduct[] = [];

  for (const [id, entry] of Object.entries(payload.data)) {
    const spot = parsePcPartPickerPrice(entry.price);
    if (spot === null) {
      continue;
    }

    const title = titles.get(id);
    if (!title) {
      continue;
    }

    const image =
      typeof entry.img === "string"
        ? normalizeImageUrl(entry.img)
        : undefined;

    products.push({
      id,
      title,
      spot,
      ...(image ? { image } : {})
    });
  }

  return products;
}

function buildScrapePayload(queryId: number, href: string): Record<string, string> {
  return {
    ...SCRAPE_PAYLOAD_DEFAULTS,
    qid: String(queryId),
    scr_ms: String(Date.now()),
    href
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractCategoryState(html: string): { slug: string; token: string; tokev: string } | null {
  const categoryMatch = html.match(/category:\s*'([^']+)'/);
  const tokenMatch = html.match(/token:\s*'([^']+)'/);
  const tokevMatch = html.match(/tokev:\s*'([^']+)'/);

  if (!categoryMatch || !tokenMatch || !tokevMatch) {
    return null;
  }

  const slug = categoryMatch[1];
  const token = tokenMatch[1];
  const tokev = tokevMatch[1];
  if (!slug || !token || !tokev) {
    return null;
  }

  return {
    slug,
    token,
    tokev
  };
}

async function fetchCategoryProducts(componentCategory: MarketCategory): Promise<PcppProduct[] | null> {
  const now = Date.now();
  const cached = categoryCache.get(componentCategory);
  if (cached && cached.expiresAt > now) {
    return cached.products;
  }

  const categoryPath = CATEGORY_PATHS[componentCategory];
  const categoryUrl = `${PCPP_BASE_URL}${categoryPath}`;

  const pageResponse = await fetchWithTimeout(categoryUrl, {
    method: "GET",
    headers: {
      ...PCPP_HEADERS
    }
  });

  if (!pageResponse || !pageResponse.ok) {
    return null;
  }

  const pageHtml = await pageResponse.text();
  const categoryState = extractCategoryState(pageHtml);
  if (!categoryState) {
    return null;
  }

  const cookieHeader = buildCookieHeader(parseSetCookies(pageResponse));
  const csrfToken = extractCookieValue(cookieHeader, "xcsrftoken");

  const bodyParams = new URLSearchParams({
    category: categoryState.slug,
    xslug: "",
    token: categoryState.token,
    tokev: categoryState.tokev,
    ...buildScrapePayload(1, categoryUrl)
  });

  const apiHeaders: Record<string, string> = {
    ...PCPP_HEADERS,
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: PCPP_BASE_URL,
    referer: categoryUrl,
    "x-requested-with": "XMLHttpRequest"
  };

  if (csrfToken) {
    apiHeaders["x-csrftoken"] = csrfToken;
  }

  if (cookieHeader) {
    apiHeaders.cookie = cookieHeader;
  }

  const dataResponse = await fetchWithTimeout(`${PCPP_BASE_URL}/qapi/product/category/`, {
    method: "POST",
    headers: apiHeaders,
    body: bodyParams.toString()
  });

  if (!dataResponse || !dataResponse.ok) {
    return null;
  }

  const contentType = dataResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  let payload: PcppCategoryPayload;
  try {
    payload = (await dataResponse.json()) as PcppCategoryPayload;
  } catch {
    return null;
  }

  const products = parseCategoryProducts(payload);
  if (products.length === 0) {
    return null;
  }

  categoryCache.set(componentCategory, {
    expiresAt: now + CACHE_TTL_MS,
    products
  });

  return products;
}

function tokenizeQuery(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9+]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
}

function scoreProduct(component: ConfigComponent, title: string): number {
  const normalizedTitle = normalizeTitle(title);
  let score = 0;

  for (const token of tokenizeQuery(component.marketQuery || "")) {
    if (normalizedTitle.includes(token)) {
      score += 3;
    }
  }

  for (const token of component.marketRequiredTokens || []) {
    if (normalizedTitle.includes(token.toLowerCase())) {
      score += 6;
    }
  }

  return score;
}

function pickBestProduct(component: ConfigComponent, products: PcppProduct[]): PcppProduct | null {
  if (products.length === 0) {
    return null;
  }

  const strictlyFiltered = products.filter((product) => matchesFilters(component, product.title));
  const candidates = strictlyFiltered.length > 0 ? strictlyFiltered : products;

  let best: PcppProduct | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const product of candidates) {
    const score = scoreProduct(component, product.title);
    if (
      best === null ||
      score > bestScore ||
      (score === bestScore && product.spot < best.spot)
    ) {
      best = product;
      bestScore = score;
    }
  }

  return best;
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

async function fetchPcPartPickerMarketData(component: ConfigComponent): Promise<PcppMarketData | null> {
  if (!component.marketQuery || component.category === "profile") {
    return null;
  }

  const products = await fetchCategoryProducts(component.category);
  if (!products || products.length === 0) {
    return null;
  }

  const bestProduct = pickBestProduct(component, products);
  if (!bestProduct) {
    return null;
  }

  return {
    spot: bestProduct.spot,
    ...(bestProduct.image ? { image: bestProduct.image } : {})
  };
}

function buildOverride(
  component: ConfigComponent,
  spot: number,
  updatedAt: string,
  image?: string
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

  const base: MarketPriceOverride = {
    id: component.id,
    priceMin: min,
    priceMax: max,
    spot: Math.round(spot * 100) / 100,
    source: SOURCE_NAME,
    updatedAt
  };

  if (image) {
    return { ...base, image };
  }

  return base;
}

async function resolveOverride(component: ConfigComponent, updatedAt: string): Promise<MarketPriceOverride | null> {
  const now = Date.now();
  const cached = marketCache.get(component.id);
  if (cached && cached.expiresAt > now) {
    return cached.override;
  }

  const marketData = await fetchPcPartPickerMarketData(component);
  const override =
    marketData === null
      ? null
      : buildOverride(component, marketData.spot, updatedAt, marketData.image);

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
