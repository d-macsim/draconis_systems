import type {
  BuildSelection,
  ComponentCatalog,
  ConfigComponent,
  ConfiguratorRules
} from "@/lib/types";

export interface CompatibilityResult {
  errors: string[];
  warnings: string[];
  requiredWattage: number;
}

export interface PriceEstimate {
  min: number;
  max: number;
  missing: string[];
}

export function getComponentById(
  catalog: ComponentCatalog,
  id: string | undefined
): ConfigComponent | undefined {
  if (!id) {
    return undefined;
  }
  return catalog.components.find((component) => component.id === id);
}

export function getComponentsByCategory(
  catalog: ComponentCatalog,
  category: ConfigComponent["category"]
): ConfigComponent[] {
  return catalog.components.filter((component) => component.category === category);
}

export function estimateRequiredWattage(
  selection: BuildSelection,
  catalog: ComponentCatalog,
  rules: ConfiguratorRules
): number {
  const cpu = getComponentById(catalog, selection.cpu);
  const gpu = getComponentById(catalog, selection.gpu);

  const base = (cpu?.tdp ?? 0) + (gpu?.tdp ?? 0) + 120;
  const withHeadroom = Math.ceil(base * (1 + rules.psuHeadroomPercent / 100));
  return withHeadroom;
}

export function validateSelection(
  selection: BuildSelection,
  catalog: ComponentCatalog,
  rules: ConfiguratorRules
): CompatibilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cpu = getComponentById(catalog, selection.cpu);
  const motherboard = getComponentById(catalog, selection.motherboard);
  const ram = getComponentById(catalog, selection.ram);
  const psu = getComponentById(catalog, selection.psu);

  if (cpu?.socket && motherboard?.socket && cpu.socket !== motherboard.socket) {
    errors.push("CPU and motherboard sockets do not match.");
  }

  if (motherboard?.ramType && ram?.ramType && motherboard.ramType !== ram.ramType) {
    errors.push("Motherboard and RAM memory types are incompatible.");
  }

  const requiredWattage = estimateRequiredWattage(selection, catalog, rules);
  if (psu?.wattage && psu.wattage < requiredWattage) {
    errors.push(`Selected PSU wattage is too low. Recommended minimum is ${requiredWattage}W.`);
  }

  const profileId = selection.profile;
  if (profileId && ram?.sizeGB) {
    const recommendedRam = rules.recommendedRamByProfile[profileId];
    if (recommendedRam && ram.sizeGB < recommendedRam) {
      warnings.push(`The selected profile typically benefits from at least ${recommendedRam}GB of RAM.`);
    }
  }

  const missingRequired = catalog.categories
    .filter((category) => category.required)
    .filter((category) => !selection[category.id])
    .map((category) => category.label);
  if (missingRequired.length > 0) {
    warnings.push(`Missing selections: ${missingRequired.join(", ")}.`);
  }

  return { errors, warnings, requiredWattage };
}

export function estimatePriceRange(
  selection: BuildSelection,
  catalog: ComponentCatalog
): PriceEstimate {
  let min = 0;
  let max = 0;
  const missing: string[] = [];

  for (const category of catalog.categories) {
    const id = selection[category.id];
    if (!id) {
      continue;
    }
    const component = getComponentById(catalog, id);
    if (!component) {
      missing.push(category.label);
      continue;
    }
    if (component.priceMin === null || component.priceMax === null) {
      missing.push(component.name);
      continue;
    }
    min += component.priceMin;
    max += component.priceMax;
  }

  return { min, max, missing };
}

export function estimatePerformanceScore(
  selection: BuildSelection,
  catalog: ComponentCatalog
): number {
  const cpu = getComponentById(catalog, selection.cpu);
  const gpu = getComponentById(catalog, selection.gpu);

  if (!cpu && !gpu) {
    return 0;
  }

  const score = Math.round(((cpu?.score ?? 0) * 0.45 + (gpu?.score ?? 0) * 0.55) * 10) / 10;
  return score;
}

export function serializeBuildSelection(selection: BuildSelection): string {
  return encodeURIComponent(JSON.stringify(selection));
}

export function deserializeBuildSelection(value: string | null): BuildSelection | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(decodeURIComponent(value)) as BuildSelection;
  } catch {
    return undefined;
  }
}

export function buildSelectionSummary(
  selection: BuildSelection,
  catalog: ComponentCatalog
): string {
  const lines = catalog.categories.map((category) => {
    const component = getComponentById(catalog, selection[category.id]);
    return `${category.label}: ${component?.name ?? "Not selected"}`;
  });

  return lines.join("\n");
}
