import { useMemo, useState } from "preact/hooks";
import type { QueueStatus, WorkshopStage } from "@/lib/types";

interface Props {
  stages: WorkshopStage[];
  queueStatus: QueueStatus;
}

function findInitialStageIndex(stages: WorkshopStage[], stageId: string | undefined): number {
  if (!stageId) {
    return 0;
  }
  const index = stages.findIndex((stage) => stage.id === stageId);
  return index >= 0 ? index : 0;
}

export default function BuildJourney({ stages, queueStatus }: Props) {
  const [activeIndex, setActiveIndex] = useState<number>(() =>
    findInitialStageIndex(stages, queueStatus.current_stage_id)
  );

  const activeStage = stages[activeIndex] ?? stages[0];
  const completedStages = useMemo(() => stages.slice(0, activeIndex), [activeIndex, stages]);

  if (!activeStage) {
    return null;
  }

  return (
    <section className="card stack" style={{ gap: "1rem" }} aria-label="Anatomy of a build journey">
      <div className="stack" style={{ gap: "0.35rem" }}>
        <p className="eyebrow" style={{ margin: 0 }}>
          Anatomy Of A Build
        </p>
        <h2 style={{ margin: 0 }}>Follow the Draconis Journey</h2>
        <p style={{ margin: 0 }}>
          Track what happens after your commission is confirmed, from curation through hand-off.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.55rem" }}>
        {stages.map((stage, index) => {
          const stateClass =
            index < activeIndex
              ? "journey-step is-complete"
              : index === activeIndex
                ? "journey-step is-active"
                : "journey-step";
          return (
            <button
              key={stage.id}
              type="button"
              className={stateClass}
              onClick={() => setActiveIndex(index)}
              style={{
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-md)",
                background:
                  index === activeIndex
                    ? "color-mix(in srgb, var(--brand) 12%, var(--bg-elev))"
                    : "var(--bg-elev)",
                color: "var(--text)",
                padding: "0.65rem",
                textAlign: "left",
                cursor: "pointer"
              }}
            >
              <span className="small" style={{ display: "block", marginBottom: "0.2rem" }}>
                Stage {stage.stage}
              </span>
              <strong style={{ display: "block", lineHeight: 1.15 }}>{stage.title}</strong>
              <span className="small" style={{ display: "block", marginTop: "0.2rem" }}>
                {stage.strapline}
              </span>
            </button>
          );
        })}
      </div>

      <div className="surface stack" style={{ padding: "0.95rem" }}>
        <h3 style={{ margin: 0 }}>
          Stage {activeStage.stage}: {activeStage.title}
        </h3>
        <p style={{ margin: 0 }}>{activeStage.description}</p>
        <p className="small" style={{ margin: 0 }}>
          {activeStage.detail}
        </p>
      </div>

      <div className="surface stack" style={{ padding: "0.85rem" }}>
        <strong>Live Workshop Context</strong>
        <p className="small" style={{ margin: 0 }}>
          {queueStatus.current_workshop_summary || queueStatus.current_focus}
        </p>
      </div>

      {completedStages.length > 0 && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <strong style={{ color: "var(--text)" }}>Completed checkpoints</strong>
          <ul className="clean stack small">
            {completedStages.map((stage) => (
              <li key={`complete-${stage.id}`}>
                Stage {stage.stage}: {stage.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
