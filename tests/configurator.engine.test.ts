import { describe, expect, it } from "vitest";
import catalog from "@/data/configurator/components.json";
import rules from "@/data/configurator/rules.json";
import {
  estimatePriceRange,
  estimateRequiredWattage,
  getComponentsByCategory,
  validateSelection
} from "@/lib/configurator/engine";
import type { BuildSelection, ComponentCatalog, ConfiguratorRules } from "@/lib/types";

const typedCatalog = catalog as ComponentCatalog;
const typedRules = rules as ConfiguratorRules;

describe("configurator engine", () => {
  it("flags socket mismatch", () => {
    const selection: BuildSelection = {
      profile: "profile-budget",
      cpu: "cpu-r5-9600x",
      motherboard: "mb-z790-gaming-plus"
    };

    const result = validateSelection(selection, typedCatalog, typedRules);
    expect(result.errors.some((error) => error.includes("sockets"))).toBe(true);
  });

  it("computes price range for selected components", () => {
    const selection: BuildSelection = {
      profile: "profile-mid-range",
      cpu: "cpu-r7-9700x",
      gpu: "gpu-rtx-4070-super",
      motherboard: "mb-b650-atx-plus",
      ram: "ram-32-ddr5",
      storage: "storage-2tb-nvme-mainstream",
      psu: "psu-850-gold",
      case: "case-lancool-216",
      cooling: "cooling-aio-240"
    };

    const result = estimatePriceRange(selection, typedCatalog);
    expect(result.min).toBeGreaterThan(0);
    expect(result.max).toBeGreaterThan(result.min);
    expect(result.missing.length).toBe(0);
  });

  it("calculates wattage with rule headroom", () => {
    const selection: BuildSelection = {
      cpu: "cpu-r7-9800x3d",
      gpu: "gpu-rtx-5080"
    };

    const watts = estimateRequiredWattage(selection, typedCatalog, typedRules);
    expect(watts).toBeGreaterThan(500);
  });

  it("flags PSU capacity issues", () => {
    const selection: BuildSelection = {
      profile: "profile-high-end",
      cpu: "cpu-i7-14700k",
      gpu: "gpu-rtx-5080",
      psu: "psu-750-gold"
    };

    const result = validateSelection(selection, typedCatalog, typedRules);
    expect(result.errors.some((error) => error.includes("PSU"))).toBe(true);
  });

  it("filters category options by usage profile", () => {
    const budgetGpus = getComponentsByCategory(typedCatalog, "gpu", "profile-budget");
    const highEndGpus = getComponentsByCategory(typedCatalog, "gpu", "profile-high-end");

    expect(budgetGpus.some((component) => component.id === "gpu-rtx-5080")).toBe(false);
    expect(highEndGpus.some((component) => component.id === "gpu-rtx-5080")).toBe(true);
  });
});
