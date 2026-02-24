import { describe, expect, it } from "vitest";
import catalog from "@/data/configurator/components.json";
import rules from "@/data/configurator/rules.json";
import {
  estimatePriceRange,
  estimateRequiredWattage,
  validateSelection
} from "@/lib/configurator/engine";
import type { BuildSelection, ComponentCatalog, ConfiguratorRules } from "@/lib/types";

const typedCatalog = catalog as ComponentCatalog;
const typedRules = rules as ConfiguratorRules;

describe("configurator engine", () => {
  it("flags socket mismatch", () => {
    const selection: BuildSelection = {
      cpu: "cpu-r7-7800x3d",
      motherboard: "mb-z790"
    };

    const result = validateSelection(selection, typedCatalog, typedRules);
    expect(result.errors.some((error) => error.includes("sockets"))).toBe(true);
  });

  it("computes price range for selected components", () => {
    const selection: BuildSelection = {
      cpu: "cpu-r7-7800x3d",
      gpu: "gpu-rx-7800xt",
      motherboard: "mb-b650",
      ram: "ram-32-ddr5",
      storage: "storage-2tb-nvme",
      psu: "psu-850-gold",
      case: "case-airflow-mid",
      cooling: "cooling-air-premium"
    };

    const result = estimatePriceRange(selection, typedCatalog);
    expect(result.min).toBeGreaterThan(0);
    expect(result.max).toBeGreaterThan(result.min);
    expect(result.missing.length).toBe(0);
  });

  it("calculates wattage with rule headroom", () => {
    const selection: BuildSelection = {
      cpu: "cpu-r7-7800x3d",
      gpu: "gpu-rtx-4080-super"
    };

    const watts = estimateRequiredWattage(selection, typedCatalog, typedRules);
    expect(watts).toBeGreaterThan(500);
  });

  it("flags PSU capacity issues", () => {
    const selection: BuildSelection = {
      cpu: "cpu-i7-14700k",
      gpu: "gpu-rtx-4080-super",
      psu: "psu-750-gold"
    };

    const result = validateSelection(selection, typedCatalog, typedRules);
    expect(result.errors.some((error) => error.includes("PSU"))).toBe(true);
  });
});
