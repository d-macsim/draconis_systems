import { describe, expect, it } from "vitest";
import catalogData from "@/data/configurator/components.json";
import queueStatusData from "@/data/queue-status.json";
import {
  findBottleneckForComponent,
  getSelectionDelayNotices,
  getUpdatesCta
} from "@/lib/pulse";
import { getComponentById } from "@/lib/configurator/engine";
import type { BuildSelection, ComponentCatalog, QueueStatus } from "@/lib/types";

const catalog = catalogData as ComponentCatalog;
const queueStatus = queueStatusData as QueueStatus;

describe("pulse helpers", () => {
  it("switches to reserve CTA when queue is full", () => {
    const cta = getUpdatesCta({ ...queueStatus, queue_capacity: 100 });
    expect(cta.label).toBe("Claim a Spot in the March Queue");
  });

  it("matches bottlenecks by configured component ids", () => {
    const component = getComponentById(catalog, "gpu-rtx-5080");
    expect(component).toBeTruthy();

    if (!component) {
      return;
    }

    const match = findBottleneckForComponent(component, queueStatus);
    expect(match?.id).toBe("RTX_5090");
  });

  it("returns lead-time notices for impacted selected parts", () => {
    const selection: BuildSelection = {
      profile: "profile-high-end",
      gpu: "gpu-rtx-5080",
      case: "case-showcase-premium"
    };

    const notices = getSelectionDelayNotices(selection, catalog, queueStatus);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.some((notice) => notice.message.includes("adds 3 days"))).toBe(true);
  });
});
