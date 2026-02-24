import { useEffect, useMemo, useState } from "preact/hooks";
import type { BuildSelection, ComponentCatalog, ConfiguratorRules } from "@/lib/types";
import {
  estimatePerformanceScore,
  estimatePriceRange,
  estimateRequiredWattage,
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

const STORAGE_KEY = "draconis-configurator-selection";

export default function ConfiguratorApp({ catalog, rules }: Props) {
  const [selection, setSelection] = useState<BuildSelection>({});
  const [step, setStep] = useState(0);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }
    try {
      const parsed = JSON.parse(saved) as BuildSelection;
      setSelection(parsed);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }, [selection]);

  const categories = catalog.categories;
  const currentCategory = categories[step] ?? categories[0];

  const compatibility = useMemo(
    () => validateSelection(selection, catalog, rules),
    [selection, catalog, rules]
  );
  const estimated = useMemo(() => estimatePriceRange(selection, catalog), [selection, catalog]);
  const performance = useMemo(() => estimatePerformanceScore(selection, catalog), [selection, catalog]);
  const wattage = useMemo(() => estimateRequiredWattage(selection, catalog, rules), [selection, catalog, rules]);

  const quoteHref = `/contact?mode=quote&build=${serializeBuildSelection(selection)}`;

  function setCategorySelection(categoryId: string, componentId: string): void {
    setSelection((prev) => ({ ...prev, [categoryId]: componentId }));
  }

  function resetSelection(): void {
    setSelection({});
    setStep(0);
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr", gap: "1rem" }}>
      <div className="card" style={{ padding: "1rem" }}>
        <p className="small">Step {step + 1} of {categories.length}</p>
        <div className="row" style={{ gap: "0.4rem" }}>
          {categories.map((category, index) => (
            <button
              type="button"
              className="button secondary"
              style={{
                padding: "0.45rem 0.65rem",
                borderColor: index === step ? "var(--brand)" : undefined,
                background: selection[category.id] ? "color-mix(in srgb, var(--brand) 12%, var(--bg-elev))" : undefined
              }}
              onClick={() => setStep(index)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "1rem", alignItems: "start" }}>
        <section className="card stack">
          <h2 style={{ marginBottom: "0.2rem" }}>{currentCategory?.label}</h2>
          <p className="small">Choose one option to continue. You can revisit any step later.</p>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.75rem" }}>
            {currentCategory &&
              getComponentsByCategory(catalog, currentCategory.id).map((component) => {
                const selected = selection[currentCategory.id] === component.id;
                return (
                  <button
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
                    <strong style={{ display: "block", marginBottom: "0.35rem" }}>{component.name}</strong>
                    <span className="small">
                      {component.priceMin !== null && component.priceMax !== null
                        ? `${formatCurrency(component.priceMin)}-${formatCurrency(component.priceMax)}`
                        : "Quote-only"}
                    </span>
                    {component.socket && <p className="small" style={{ marginTop: "0.35rem" }}>Socket: {component.socket}</p>}
                    {component.ramType && <p className="small" style={{ marginTop: "0.35rem" }}>RAM: {component.ramType}</p>}
                    {component.wattage && <p className="small" style={{ marginTop: "0.35rem" }}>{component.wattage}W</p>}
                  </button>
                );
              })}
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="button secondary" onClick={() => setStep(Math.max(0, step - 1))}>
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
              const selected = getComponentById(catalog, selection[category.id]);
              return (
                <li>
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
            <p className="small" style={{ marginTop: "0.3rem" }}>Recommended PSU headroom target: {wattage}W</p>
            <p className="small" style={{ marginTop: "0.3rem" }}>
              Estimate only. Final quote may vary by market availability and sourcing.
            </p>
          </div>

          {compatibility.errors.length > 0 && (
            <div className="surface" style={{ borderColor: "var(--danger)", padding: "0.8rem" }}>
              <strong>Compatibility Errors</strong>
              <ul className="clean stack small" style={{ marginTop: "0.45rem" }}>
                {compatibility.errors.map((error) => (
                  <li>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {compatibility.warnings.length > 0 && (
            <div className="surface" style={{ borderColor: "var(--warn)", padding: "0.8rem" }}>
              <strong>Warnings</strong>
              <ul className="clean stack small" style={{ marginTop: "0.45rem" }}>
                {compatibility.warnings.map((warning) => (
                  <li>{warning}</li>
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
