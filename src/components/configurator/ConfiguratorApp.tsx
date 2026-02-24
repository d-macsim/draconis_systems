import { useEffect, useMemo, useState } from "preact/hooks";
import type {
  BuildSelection,
  ComponentCatalog,
  ConfiguratorRules,
  MarketPriceOverride,
  QueueStatus
} from "@/lib/types";
import BuildQuestionnaire from "@/components/configurator/BuildQuestionnaire";
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
import {
  clampCapacity,
  findBottleneckForComponent,
  getQueueTone,
  getSelectionDelayNotices,
  isImpactStatus
} from "@/lib/pulse";
import { formatCurrency } from "@/lib/format";

interface Props {
  catalog: ComponentCatalog;
  rules: ConfiguratorRules;
  showQuestionnaire?: boolean;
  queueStatus?: QueueStatus;
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
  const designerNote = typeof selection.designerNote === "string"
    ? selection.designerNote.trim().slice(0, 900)
    : undefined;

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
  if (designerNote) {
    next.designerNote = designerNote;
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

      const next = {
        ...component,
        priceMin: override.priceMin,
        priceMax: override.priceMax
      };

      if (override.image) {
        return { ...next, image: override.image };
      }

      return next;
    })
  };
}

function updateProfileQuery(profileId: string | undefined): void {
  const url = new URL(window.location.href);
  if (profileId) {
    url.searchParams.set("profile", profileId);
  } else {
    url.searchParams.delete("profile");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function ConfiguratorApp({
  catalog,
  rules,
  showQuestionnaire = false,
  queueStatus
}: Props) {
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

  const validProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const profile of getComponentsByCategory(catalog, "profile")) {
      ids.add(profile.id);
    }
    return ids;
  }, [catalog]);

  useEffect(() => {
    let nextSelection: BuildSelection = {};
    const saved = window.localStorage.getItem(STORAGE_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as BuildSelection;
        nextSelection = sanitizeSelection(parsed, catalog, parsed.profile);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    const requestedProfile = new URLSearchParams(window.location.search).get("profile");
    if (requestedProfile && validProfileIds.has(requestedProfile)) {
      nextSelection = sanitizeSelection(nextSelection, catalog, requestedProfile);
      setStep(Math.min(1, catalog.categories.length - 1));
    }

    setSelection(nextSelection);
  }, [catalog, validProfileIds]);

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
  const queueCapacity = queueStatus ? clampCapacity(queueStatus.queue_capacity) : null;
  const queueTone = queueStatus ? getQueueTone(queueCapacity ?? 0) : "normal";
  const selectionDelayNotices = useMemo(
    () => (queueStatus ? getSelectionDelayNotices(selection, effectiveCatalog, queueStatus) : []),
    [effectiveCatalog, queueStatus, selection]
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
      if (component.image) {
        images[component.id] = component.image;
      }
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
    if (categoryId === "profile") {
      updateProfileQuery(componentId);
    }

    setSelection((previous) => {
      if (categoryId === "profile") {
        const nextSelection: BuildSelection = { ...previous, profile: componentId };
        return sanitizeSelection(nextSelection, catalog, componentId);
      }

      const nextSelection: BuildSelection = { ...previous, [categoryId]: componentId };
      return sanitizeSelection(nextSelection, catalog, nextSelection.profile);
    });
  }

  function setDesignerNote(value: string): void {
    setSelection((previous) => ({
      ...previous,
      designerNote: value.slice(0, 900)
    }));
  }

  function resetSelection(): void {
    setSelection({});
    setStep(0);
    updateProfileQuery(undefined);
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: "1rem" }}>
      {queueStatus && (
        <div
          className="surface row"
          style={{
            padding: "0.8rem",
            justifyContent: "space-between",
            borderColor:
              queueTone === "full"
                ? "var(--danger)"
                : queueTone === "warning"
                  ? "var(--warn)"
                  : "var(--line)"
          }}
        >
          <div className="row" style={{ gap: "0.5rem" }}>
            <span className="badge">Live Status</span>
            <span className="small" style={{ color: "var(--text)" }}>
              {queueStatus.current_queue_label}: {queueCapacity ?? 0}% full
            </span>
          </div>
          <div className="row" style={{ gap: "0.55rem" }}>
            <span className="small">Lead time: {queueStatus.estimated_lead_time}</span>
            <span className="small">Stage: {queueStatus.current_stage}</span>
          </div>
        </div>
      )}

      {showQuestionnaire && (
        <details className="surface" style={{ padding: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text)" }}>
            Not sure what to choose? Open the quick questionnaire for a full preconfigured recommendation.
          </summary>
          <div style={{ marginTop: "1rem" }}>
            <BuildQuestionnaire catalog={catalog} rules={rules} />
          </div>
        </details>
      )}

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
                const image = optionImages[component.id];
                const bottleneckMatch = queueStatus
                  ? findBottleneckForComponent(component, queueStatus)
                  : null;
                const bottleneckTooltip =
                  bottleneckMatch && isImpactStatus(bottleneckMatch.bottleneck.status)
                    ? `Live status: ${bottleneckMatch.bottleneck.display}${
                        bottleneckMatch.bottleneck.lead_time_impact_days
                          ? ` (adds ${bottleneckMatch.bottleneck.lead_time_impact_days} days)`
                          : ""
                      }`
                    : null;
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
                    {image && (
                      <img
                        src={image}
                        alt={`${component.name} product photo`}
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
                    )}
                    <strong style={{ display: "block", marginBottom: "0.35rem" }}>{component.name}</strong>
                    <span className="small">
                      {component.priceMin !== null && component.priceMax !== null
                        ? `${formatCurrency(component.priceMin)}-${formatCurrency(component.priceMax)}`
                        : "Quote-only"}
                    </span>
                    {bottleneckTooltip && (
                      <p
                        className="small"
                        title={bottleneckTooltip}
                        style={{ marginTop: "0.35rem", color: "var(--warn)" }}
                      >
                        Live status: {bottleneckMatch?.bottleneck.display}
                      </p>
                    )}
                    {currentCategory.id === "profile" && profileRange && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        Typical build range: {formatCurrency(profileRange.min)}-{formatCurrency(profileRange.max)}
                      </p>
                    )}
                    {override && (
                      <p className="small" style={{ marginTop: "0.35rem" }}>
                        Live price synced
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

          {selectionDelayNotices.length > 0 && (
            <div className="surface" style={{ borderColor: "var(--warn)", padding: "0.8rem" }}>
              <strong>Live Availability Notes</strong>
              <ul className="clean stack small" style={{ marginTop: "0.45rem" }}>
                {selectionDelayNotices.map((notice) => (
                  <li key={notice.componentId}>{notice.message}</li>
                ))}
              </ul>
            </div>
          )}

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

          <div className="surface stack" style={{ padding: "0.8rem" }}>
            <label htmlFor="designer-note" style={{ margin: 0 }}>
              Designer&apos;s Note
            </label>
            <p className="small" style={{ margin: 0 }}>
              Tell us about your space. Is this for a minimalist studio or a high-octane gaming setup?
            </p>
            <textarea
              id="designer-note"
              rows={4}
              maxLength={900}
              value={selection.designerNote ?? ""}
              onInput={(event) => setDesignerNote(event.currentTarget.value)}
              placeholder="Share preferred aesthetics, noise goals, cable style, lighting mood, or room context."
            />
            <p className="small" style={{ margin: 0 }}>
              {(selection.designerNote ?? "").length}/900 characters
            </p>
          </div>

          <a className="button primary" href={quoteHref}>
            Export to Quote Request
          </a>
        </aside>
      </div>
    </div>
  );
}
