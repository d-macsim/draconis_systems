import { useEffect, useMemo, useState } from "preact/hooks";
import type {
  BuildSelection,
  ConfigComponent,
  ComponentCatalog,
  ConfiguratorRules,
  MarketPriceOverride
} from "@/lib/types";
import {
  estimatePerformanceScore,
  estimatePriceRange,
  estimateRequiredWattage,
  filterMotherboardsByCpu,
  getComponentById,
  getComponentsByCategory,
  serializeBuildSelection,
  validateSelection
} from "@/lib/configurator/engine";
import { formatCurrency } from "@/lib/format";

interface Props {
  catalog: ComponentCatalog;
  rules: ConfiguratorRules;
}

interface MarketPriceResponse {
  ok: boolean;
  source: string;
  fetchedAt: string;
  overrides: MarketPriceOverride[];
}

const STORAGE_KEY = "draconis-configurator-selection";
const MARKET_PRICES_ENDPOINT = "/.netlify/functions/market-prices";

interface PriceRange {
  min: number;
  max: number;
}

const CATEGORY_COLORS: Record<ConfigComponent["category"], { from: string; to: string; accent: string }> = {
  profile: { from: "#3b82f6", to: "#1d4ed8", accent: "#93c5fd" },
  cpu: { from: "#0ea5e9", to: "#0369a1", accent: "#7dd3fc" },
  gpu: { from: "#7c3aed", to: "#4c1d95", accent: "#c4b5fd" },
  motherboard: { from: "#10b981", to: "#065f46", accent: "#6ee7b7" },
  ram: { from: "#f97316", to: "#9a3412", accent: "#fdba74" },
  storage: { from: "#6366f1", to: "#3730a3", accent: "#a5b4fc" },
  psu: { from: "#ef4444", to: "#991b1b", accent: "#fca5a5" },
  case: { from: "#14b8a6", to: "#0f766e", accent: "#99f6e4" },
  cooling: { from: "#06b6d4", to: "#155e75", accent: "#67e8f9" }
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function splitLabel(value: string): [string, string] {
  const words = value.split(" ");
  if (words.length <= 3) {
    return [value, ""];
  }

  const pivot = Math.ceil(words.length / 2);
  return [words.slice(0, pivot).join(" "), words.slice(pivot).join(" ")];
}

function generateComponentIllustration(component: ConfigComponent): string {
  const palette = CATEGORY_COLORS[component.category];
  const [line1, line2] = splitLabel(component.name);
  const meta = component.socket || component.ramType || component.wattage ? `${component.socket || ""} ${component.ramType || ""} ${component.wattage ? `${component.wattage}W` : ""}`.trim() : component.category.toUpperCase();

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="${escapeXml(component.name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.from}" />
      <stop offset="100%" stop-color="${palette.to}" />
    </linearGradient>
  </defs>
  <rect width="720" height="420" fill="url(#bg)" rx="22" />
  <circle cx="660" cy="65" r="95" fill="${palette.accent}" fill-opacity="0.22" />
  <circle cx="80" cy="350" r="140" fill="${palette.accent}" fill-opacity="0.17" />
  <text x="36" y="64" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="${palette.accent}" letter-spacing="2">${escapeXml(component.category.toUpperCase())}</text>
  <text x="36" y="206" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="#ffffff" font-weight="700">${escapeXml(line1)}</text>
  ${line2 ? `<text x="36" y="254" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="#ffffff" font-weight="700">${escapeXml(line2)}</text>` : ""}
  <rect x="36" y="304" width="270" height="46" fill="rgba(15,23,42,0.26)" rx="10" />
  <text x="52" y="334" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#e2e8f0">${escapeXml(meta)}</text>
</svg>
  `.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function calculateProfilePriceRanges(catalog: ComponentCatalog): Record<string, PriceRange> {
  const profileRanges: Record<string, PriceRange> = {};
  const profiles = getComponentsByCategory(catalog, "profile");
  const requiredCategories = catalog.categories.filter((category) => category.required && category.id !== "profile");

  for (const profile of profiles) {
    let min = 0;
    let max = 0;
    let complete = true;

    for (const category of requiredCategories) {
      const options = getComponentsByCategory(catalog, category.id, profile.id).filter(
        (component) => component.priceMin !== null && component.priceMax !== null
      );

      if (options.length === 0) {
        complete = false;
        break;
      }

      min += Math.min(...options.map((option) => option.priceMin as number));
      max += Math.max(...options.map((option) => option.priceMax as number));
    }

    if (complete) {
      profileRanges[profile.id] = { min, max };
    }
  }

  return profileRanges;
}

function isComponentProfileCompatible(componentProfileIds: string[] | undefined, profileId: string): boolean {
  return !componentProfileIds || componentProfileIds.length === 0 || componentProfileIds.includes(profileId);
}

function sanitizeSelection(
  selection: BuildSelection,
  catalog: ComponentCatalog,
  profileId?: string
): BuildSelection {
  const next: BuildSelection = {};

  for (const category of catalog.categories) {
    const selectedId = selection[category.id];
    if (!selectedId) {
      continue;
    }

    const component = catalog.components.find(
      (item) => item.id === selectedId && item.category === category.id
    );
    if (!component) {
      continue;
    }

    if (category.id !== "profile" && profileId && !isComponentProfileCompatible(component.profiles, profileId)) {
      continue;
    }

    next[category.id] = component.id;
  }

  if (profileId) {
    next.profile = profileId;
  }

  const selectedCpu = getComponentById(catalog, next.cpu);
  const selectedMotherboard = getComponentById(catalog, next.motherboard);
  if (selectedCpu?.socket && selectedMotherboard?.socket && selectedCpu.socket !== selectedMotherboard.socket) {
    delete next.motherboard;
  }

  return next;
}

function mergeCatalogPrices(
  catalog: ComponentCatalog,
  overrides: Record<string, MarketPriceOverride>
): ComponentCatalog {
  return {
    ...catalog,
    components: catalog.components.map((component) => {
      const override = overrides[component.id];
      if (!override) {
        return component;
      }

      return {
        ...component,
        priceMin: override.priceMin,
        priceMax: override.priceMax
      };
    })
  };
}

export default function ConfiguratorApp({ catalog, rules }: Props) {
  const [selection, setSelection] = useState<BuildSelection>({});
  const [step, setStep] = useState(0);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, MarketPriceOverride>>({});
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);

  const effectiveCatalog = useMemo(
    () => mergeCatalogPrices(catalog, priceOverrides),
    [catalog, priceOverrides]
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as BuildSelection;
      const cleaned = sanitizeSelection(parsed, catalog, parsed.profile);
      setSelection(cleaned);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [catalog]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }, [selection]);

  useEffect(() => {
    if (!selection.profile) {
      return;
    }

    setSelection((previous) => sanitizeSelection(previous, catalog, selection.profile));
  }, [catalog, selection.profile]);

  useEffect(() => {
    if (!selection.profile && step > 0) {
      setStep(0);
    }
  }, [selection.profile, step]);

  const categories = effectiveCatalog.categories;
  const currentCategory = categories[step] ?? categories[0];
  const selectedCpu = useMemo(
    () => getComponentById(effectiveCatalog, selection.cpu),
    [effectiveCatalog, selection.cpu]
  );
  const profilePriceRanges = useMemo(
    () => calculateProfilePriceRanges(effectiveCatalog),
    [effectiveCatalog]
  );

  const currentOptions = useMemo(() => {
    if (!currentCategory) {
      return [];
    }

    if (currentCategory.id !== "profile" && !selection.profile) {
      return [];
    }

    const profileFilter = currentCategory.id === "profile" ? undefined : selection.profile;
    const options = getComponentsByCategory(effectiveCatalog, currentCategory.id, profileFilter);

    if (currentCategory.id === "motherboard") {
      if (!selectedCpu?.socket) {
        return [];
      }
      return filterMotherboardsByCpu(options, selectedCpu);
    }

    return options;
  }, [currentCategory, effectiveCatalog, selection.profile, selectedCpu]);

  const optionImages = useMemo(() => {
    const images: Record<string, string> = {};
    for (const component of currentOptions) {
      images[component.id] = component.image || generateComponentIllustration(component);
    }
    return images;
  }, [currentOptions]);

  useEffect(() => {
    if (!currentCategory || currentCategory.id === "profile") {
      return;
    }

    const dynamicIds = currentOptions
      .filter((component) => component.marketQuery)
      .map((component) => component.id)
      .filter((id) => !priceOverrides[id]);

    if (dynamicIds.length === 0) {
      return;
    }

    const controller = new AbortController();
    setMarketLoading(true);

    const params = new URLSearchParams({ ids: dynamicIds.join(",") });

    fetch(`${MARKET_PRICES_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Price sync failed with status ${response.status}.`);
        }

        const payload = (await response.json()) as MarketPriceResponse;
        if (!payload.ok || !Array.isArray(payload.overrides)) {
          throw new Error("Market price response format was invalid.");
        }

        if (payload.overrides.length === 0) {
          return;
        }

        setPriceOverrides((previous) => {
          const merged = { ...previous };
          for (const override of payload.overrides) {
            merged[override.id] = override;
          }
          return merged;
        });

        setMarketUpdatedAt(payload.fetchedAt);
        setMarketError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to sync live market prices.";
        setMarketError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setMarketLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currentCategory, currentOptions, priceOverrides]);

  const compatibility = useMemo(
    () => validateSelection(selection, effectiveCatalog, rules),
    [selection, effectiveCatalog, rules]
  );

  const estimated = useMemo(
    () => estimatePriceRange(selection, effectiveCatalog),
    [selection, effectiveCatalog]
  );

  const performance = useMemo(
    () => estimatePerformanceScore(selection, effectiveCatalog),
    [selection, effectiveCatalog]
  );

  const wattage = useMemo(
    () => estimateRequiredWattage(selection, effectiveCatalog, rules),
    [selection, effectiveCatalog, rules]
  );

  const quoteHref = `/contact?mode=quote&build=${serializeBuildSelection(selection)}`;

  function setCategorySelection(categoryId: string, componentId: string): void {
    setSelection((previous) => {
      if (categoryId === "profile") {
        const nextSelection: BuildSelection = { ...previous, profile: componentId };
        return sanitizeSelection(nextSelection, catalog, componentId);
      }

      const nextSelection: BuildSelection = { ...previous, [categoryId]: componentId };
      return sanitizeSelection(nextSelection, catalog, nextSelection.profile);
    });
  }

  function resetSelection(): void {
    setSelection({});
    setStep(0);
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: "1rem" }}>
      <div className="card" style={{ padding: "1rem" }}>
        <p className="small">
          Step {step + 1} of {categories.length}
        </p>
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          {categories.map((category, index) => {
            const disabled = !selection.profile && category.id !== "profile";
            return (
              <button
                key={category.id}
                type="button"
                className="button secondary"
                disabled={disabled}
                style={{
                  padding: "0.45rem 0.65rem",
                  borderColor: index === step ? "var(--brand)" : undefined,
                  background: selection[category.id]
                    ? "color-mix(in srgb, var(--brand) 12%, var(--bg-elev))"
                    : undefined,
                  opacity: disabled ? 0.55 : 1
                }}
                onClick={() => setStep(index)}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "1rem", alignItems: "start" }}>
        <section className="card stack">
          <h2 style={{ marginBottom: "0.2rem" }}>{currentCategory?.label}</h2>
          <p className="small">
            {currentCategory?.id === "profile"
              ? "Pick your build tier first. Parts in later steps adapt to this profile."
              : "Choose one option to continue. You can revisit any step later."}
          </p>

          {!selection.profile && currentCategory?.id !== "profile" && (
            <div className="surface" style={{ padding: "0.8rem" }}>
              <p className="small" style={{ margin: 0 }}>
                Select a Usage Profile first to unlock tier-specific hardware options.
              </p>
            </div>
          )}

          {currentCategory?.id === "motherboard" && !selectedCpu && (
            <div className="surface" style={{ padding: "0.8rem" }}>
              <p className="small" style={{ margin: 0 }}>
                Select a CPU first. Only motherboards that match its socket will be shown.
              </p>
            </div>
          )}

          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.75rem" }}
          >
            {currentCategory &&
              currentOptions.map((component) => {
                const selected = selection[currentCategory.id] === component.id;
                const override = priceOverrides[component.id];
                const profileRange = profilePriceRanges[component.id];
                return (
                  <button
                    key={component.id}
                    type="button"
                    className="card"
                    onClick={() => setCategorySelection(currentCategory.id, component.id)}
                    style={{
                      textAlign: "left",
                      borderColor: selected ? "var(--brand)" : "var(--line)",
                      background: selected
                        ? "color-mix(in srgb, var(--brand) 10%, var(--bg-elev))"
                        : "var(--bg-elev)",
                      cursor: "pointer"
                    }}
                  >
                    <img
                      src={optionImages[component.id]}
                      alt={`${component.name} preview`}
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: "100%",
                        aspectRatio: "16 / 9",
                        objectFit: "cover",
                        borderRadius: "0.65rem",
                        marginBottom: "0.6rem",
                        border: "1px solid var(--line)"
                      }}
                    />
                    <strong style={{ display: "block", marginBottom: "0.35rem" }}>{component.name}</strong>
                    <span className="small">
                      {component.priceMin !== null && component.priceMax !== null
                        ? `${formatCurrency(component.priceMin)}-${formatCurrency(component.priceMax)}`
                        : "Quote-only"}
                    </span>
                    {currentCategory.id === "profile" && profileRange && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        Typical build range: {formatCurrency(profileRange.min)}-{formatCurrency(profileRange.max)}
                      </p>
                    )}
                    {override && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        Live market synced ({override.source})
                      </p>
                    )}
                    {component.socket && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        Socket: {component.socket}
                      </p>
                    )}
                    {component.ramType && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        RAM: {component.ramType}
                      </p>
                    )}
                    {component.wattage && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        {component.wattage}W
                      </p>
                    )}
                    {component.highlights && component.highlights.length > 0 && (
                      <ul
                        className="small"
                        style={{
                          marginTop: "0.5rem",
                          marginBottom: 0,
                          paddingLeft: "1rem",
                          color: "var(--text-soft)"
                        }}
                      >
                        {component.highlights.map((highlight) => (
                          <li key={`${component.id}-${highlight}`}>{highlight}</li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="button secondary"
              onClick={() => setStep(Math.max(0, step - 1))}
            >
              Previous
            </button>
            <div className="row">
              <button type="button" className="button secondary" onClick={resetSelection}>
                Reset
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => setStep(Math.min(categories.length - 1, step + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <aside className="card stack">
          <h3 style={{ marginBottom: "0.2rem" }}>Build Summary</h3>
          <ul className="clean stack small">
            {categories.map((category) => {
              const selected = getComponentById(effectiveCatalog, selection[category.id]);
              return (
                <li key={category.id}>
                  <strong>{category.label}:</strong> {selected?.name ?? "Not selected"}
                </li>
              );
            })}
          </ul>

          <div className="surface" style={{ padding: "0.8rem" }}>
            <p className="small">Estimated Price Range</p>
            <p style={{ margin: 0, fontWeight: 800 }}>
              {formatCurrency(estimated.min)}-{formatCurrency(estimated.max)}
            </p>
            <p className="small" style={{ marginTop: "0.5rem" }}>
              Performance score: {performance > 0 ? `${performance}/100` : "Pending selections"}
            </p>
            <p className="small" style={{ marginTop: "0.3rem" }}>
              Recommended PSU headroom target: {wattage}W
            </p>
            <p className="small" style={{ marginTop: "0.3rem" }}>
              Estimate only. Final quote may vary by market availability and sourcing.
            </p>
            <p className="small" style={{ marginTop: "0.3rem" }}>
              {marketLoading
                ? "Refreshing live market prices for this step..."
                : `Live prices synced on ${marketUpdatedAt ? new Date(marketUpdatedAt).toLocaleString() : "local defaults"}.`}
            </p>
            {marketError && (
              <p className="small" style={{ marginTop: "0.3rem", color: "var(--warn)" }}>
                {marketError}
              </p>
            )}
          </div>

          {compatibility.errors.length > 0 && (
            <div className="surface" style={{ borderColor: "var(--danger)", padding: "0.8rem" }}>
              <strong>Compatibility Errors</strong>
              <ul className="clean stack small" style={{ marginTop: "0.45rem" }}>
                {compatibility.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {compatibility.warnings.length > 0 && (
            <div className="surface" style={{ borderColor: "var(--warn)", padding: "0.8rem" }}>
              <strong>Warnings</strong>
              <ul className="clean stack small" style={{ marginTop: "0.45rem" }}>
                {compatibility.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <a className="button primary" href={quoteHref}>
            Export to Quote Request
          </a>
        </aside>
      </div>
    </div>
  );
}
