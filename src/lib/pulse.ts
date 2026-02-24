import { getComponentById } from "@/lib/configurator/engine";
import type {
  BuildSelection,
  ComponentCatalog,
  ConfigComponent,
  QueueAvailabilityState,
  QueueStatus,
  QueueStatusBottleneck
} from "@/lib/types";

type QueueTone = "normal" | "warning" | "full";

const IMPACT_STATES = new Set<QueueAvailabilityState>(["limited", "high-demand", "out-of-stock"]);

export interface BottleneckEntry {
  id: string;
  bottleneck: QueueStatusBottleneck;
}

export interface SelectionDelayNotice {
  componentId: string;
  componentName: string;
  message: string;
}

export function clampCapacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getQueueTone(capacity: number): QueueTone {
  const normalized = clampCapacity(capacity);
  if (normalized >= 100) {
    return "full";
  }
  if (normalized >= 90) {
    return "warning";
  }
  return "normal";
}

export function getBottleneckEntries(status: QueueStatus): BottleneckEntry[] {
  return Object.entries(status.bottlenecks).map(([id, bottleneck]) => ({ id, bottleneck }));
}

export function isImpactStatus(state: QueueAvailabilityState): boolean {
  return IMPACT_STATES.has(state);
}

export function getAvailabilityTone(state: QueueAvailabilityState): "green" | "amber" | "red" {
  if (state === "in-stock") {
    return "green";
  }
  if (state === "limited" || state === "high-demand") {
    return "amber";
  }
  return "red";
}

export function getUpdatesCta(status: QueueStatus): { label: string; href: string } {
  if (getQueueTone(status.queue_capacity) === "full") {
    return {
      label: `Claim a Spot in the ${status.next_queue_label}`,
      href: "/contact?mode=quote"
    };
  }

  return {
    label: "Get a Quote",
    href: "/contact?mode=quote"
  };
}

function tokenMatch(component: ConfigComponent, tokens: string[] | undefined): boolean {
  if (!tokens || tokens.length === 0) {
    return false;
  }

  const source = `${component.name} ${component.marketQuery ?? ""}`.toLowerCase();
  return tokens.some((token) => {
    const normalized = token.trim().toLowerCase();
    return normalized.length > 0 && source.includes(normalized);
  });
}

export function matchesBottleneck(component: ConfigComponent, bottleneck: QueueStatusBottleneck): boolean {
  if (bottleneck.component_ids?.includes(component.id)) {
    return true;
  }

  return tokenMatch(component, bottleneck.query_tokens);
}

export function findBottleneckForComponent(
  component: ConfigComponent,
  status: QueueStatus
): BottleneckEntry | null {
  const all = getBottleneckEntries(status).filter((entry) => matchesBottleneck(component, entry.bottleneck));
  if (all.length === 0) {
    return null;
  }

  const impact = all.find((entry) => isImpactStatus(entry.bottleneck.status));
  return impact ?? all[0] ?? null;
}

export function getSelectionDelayNotices(
  selection: BuildSelection,
  catalog: ComponentCatalog,
  status: QueueStatus
): SelectionDelayNotice[] {
  const notices: SelectionDelayNotice[] = [];
  const seen = new Set<string>();

  for (const selectedId of Object.values(selection)) {
    if (!selectedId || seen.has(selectedId)) {
      continue;
    }

    const component = getComponentById(catalog, selectedId);
    if (!component || component.category === "profile") {
      continue;
    }

    const match = findBottleneckForComponent(component, status);
    if (!match) {
      continue;
    }

    const impactDays = match.bottleneck.lead_time_impact_days;
    if (!impactDays || impactDays <= 0) {
      continue;
    }

    seen.add(selectedId);
    const suffix = impactDays === 1 ? "day" : "days";
    notices.push({
      componentId: component.id,
      componentName: component.name,
      message: `${component.name}: ${match.bottleneck.display} (adds ${impactDays} ${suffix} to lead time).`
    });
  }

  return notices;
}
