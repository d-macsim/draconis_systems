import { useMemo, useState } from "preact/hooks";
import { getComponentsByCategory } from "@/lib/configurator/engine";
import { formatCurrency } from "@/lib/format";
import type { ComponentCatalog } from "@/lib/types";

interface Props {
  catalog: ComponentCatalog;
}

type ProfileId = "profile-budget" | "profile-mid-range" | "profile-high-end";

interface QuestionnaireOption {
  id: string;
  label: string;
  detail: string;
  scores: Record<ProfileId, number>;
}

interface QuestionnaireQuestion {
  id: string;
  prompt: string;
  options: QuestionnaireOption[];
}

interface PriceRange {
  min: number;
  max: number;
}

const APPLY_PROFILE_EVENT = "draconis:apply-profile";

const PROFILE_LABELS: Record<ProfileId, string> = {
  "profile-budget": "Budget Build",
  "profile-mid-range": "Mid Range Build",
  "profile-high-end": "High End Build"
};

const PROFILE_PRIORITY: ProfileId[] = ["profile-mid-range", "profile-budget", "profile-high-end"];

const QUESTION_SET: QuestionnaireQuestion[] = [
  {
    id: "primary-use",
    prompt: "Primary use case",
    options: [
      {
        id: "esports",
        label: "Mostly esports titles",
        detail: "Competitive games such as CS2, Valorant, or Fortnite.",
        scores: { "profile-budget": 3, "profile-mid-range": 2, "profile-high-end": 0 }
      },
      {
        id: "mixed-gaming",
        label: "Mixed gaming",
        detail: "A balance of esports and modern AAA games.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "aaa-heavy",
        label: "Graphics-heavy AAA",
        detail: "Cinematic titles such as RDR2 or Cyberpunk.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      },
      {
        id: "creator-heavy",
        label: "Gaming plus content creation",
        detail: "Streaming, editing, rendering, or CAD on top of gaming.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "target-resolution",
    prompt: "Target gaming resolution",
    options: [
      {
        id: "1080p",
        label: "1080p",
        detail: "High-value performance target.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "1440p",
        label: "1440p",
        detail: "Balanced quality and framerate.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "4k",
        label: "4K",
        detail: "High visual fidelity with stronger GPU demand.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "framerate-goal",
    prompt: "Typical framerate goal",
    options: [
      {
        id: "sixty",
        label: "60-100 FPS",
        detail: "Smooth play without chasing peak competitive framerates.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "one-twenty",
        label: "120-165 FPS",
        detail: "Strong high-refresh target for many games.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "two-forty",
        label: "240 FPS+ where possible",
        detail: "Prioritises competitive responsiveness and overhead.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 3 }
      }
    ]
  },
  {
    id: "game-style",
    prompt: "What do you play most often?",
    options: [
      {
        id: "competitive",
        label: "Competitive shooters",
        detail: "Low latency and high FPS are top priority.",
        scores: { "profile-budget": 2, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "casual",
        label: "Laid-back and indie games",
        detail: "Lighter graphics load and value-focused setup.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "cinematic",
        label: "Cinematic AAA titles",
        detail: "More GPU-heavy games with higher texture and RT demand.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "streaming-workload",
    prompt: "Streaming and multitasking",
    options: [
      {
        id: "light",
        label: "Light multitasking only",
        detail: "Gaming with a few background apps.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "moderate",
        label: "Occasional streaming",
        detail: "Gaming, Discord, browser tabs, and occasional capture.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "heavy",
        label: "Heavy streaming or editing",
        detail: "Frequent capture, edits, and heavier background work.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "storage-needs",
    prompt: "Storage requirement",
    options: [
      {
        id: "one-tb",
        label: "1TB is enough",
        detail: "Tighter library and lower budget footprint.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "two-tb",
        label: "2TB preferred",
        detail: "Space for modern games and apps.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "four-plus",
        label: "4TB+ ideal",
        detail: "Large game libraries or project files.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "visual-style",
    prompt: "Case and aesthetics preference",
    options: [
      {
        id: "value",
        label: "Function over looks",
        detail: "Prioritise value and airflow.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "balanced",
        label: "Balanced look and value",
        detail: "Clean setup with sensible spend.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "showcase",
        label: "Premium showcase build",
        detail: "Tempered glass, RGB options, and premium components.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "noise-thermal",
    prompt: "Noise and thermal target",
    options: [
      {
        id: "standard",
        label: "Standard cooling",
        detail: "Normal gaming noise levels are fine.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "quiet",
        label: "Quieter under load",
        detail: "Prefer lower fan noise with better cooling headroom.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "very-quiet",
        label: "Cool and quiet in heavy loads",
        detail: "Higher-end cooling and stronger case airflow.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "upgrade-window",
    prompt: "How long should this build stay strong?",
    options: [
      {
        id: "two-years",
        label: "2-3 years",
        detail: "Shorter-term value-first build lifecycle.",
        scores: { "profile-budget": 3, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "four-years",
        label: "3-5 years",
        detail: "Balanced longevity with upgrade flexibility.",
        scores: { "profile-budget": 1, "profile-mid-range": 3, "profile-high-end": 1 }
      },
      {
        id: "longest",
        label: "As long as possible",
        detail: "Maximum headroom for demanding future titles.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "budget-window",
    prompt: "Preferred total budget",
    options: [
      {
        id: "under-1000",
        label: "GBP 600-1000",
        detail: "Tight value target focused on essentials.",
        scores: { "profile-budget": 4, "profile-mid-range": 0, "profile-high-end": 0 }
      },
      {
        id: "1000-1800",
        label: "GBP 1000-1800",
        detail: "Most common range for balanced gaming performance.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "1800-plus",
        label: "GBP 1800+",
        detail: "Premium hardware and stronger long-term headroom.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  }
];

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

function getSelectedOption(
  questions: QuestionnaireQuestion[],
  answers: Record<string, string>,
  questionId: string
): QuestionnaireOption | undefined {
  const question = questions.find((entry) => entry.id === questionId);
  if (!question) {
    return undefined;
  }
  return question.options.find((option) => option.id === answers[questionId]);
}

function recommendProfile(
  questions: QuestionnaireQuestion[],
  answers: Record<string, string>
): { profileId: ProfileId; scores: Record<ProfileId, number> } {
  const scores: Record<ProfileId, number> = {
    "profile-budget": 0,
    "profile-mid-range": 0,
    "profile-high-end": 0
  };

  for (const question of questions) {
    const selectedId = answers[question.id];
    if (!selectedId) {
      continue;
    }

    const selectedOption = question.options.find((option) => option.id === selectedId);
    if (!selectedOption) {
      continue;
    }

    scores["profile-budget"] += selectedOption.scores["profile-budget"];
    scores["profile-mid-range"] += selectedOption.scores["profile-mid-range"];
    scores["profile-high-end"] += selectedOption.scores["profile-high-end"];
  }

  const orderedProfiles = (Object.keys(scores) as ProfileId[]).sort((first, second) => {
    if (scores[second] !== scores[first]) {
      return scores[second] - scores[first];
    }
    return PROFILE_PRIORITY.indexOf(first) - PROFILE_PRIORITY.indexOf(second);
  });

  const profileId = orderedProfiles[0] ?? "profile-mid-range";
  return { profileId, scores };
}

function updateProfileQuery(profileId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("profile", profileId);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function BuildQuestionnaire({ catalog }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const unansweredQuestions = useMemo(
    () => QUESTION_SET.filter((question) => !answers[question.id]),
    [answers]
  );

  const recommendation = useMemo(
    () => recommendProfile(QUESTION_SET, answers),
    [answers]
  );

  const profilePriceRanges = useMemo(
    () => calculateProfilePriceRanges(catalog),
    [catalog]
  );

  const rationale = useMemo(() => {
    const keyQuestions = ["primary-use", "target-resolution", "budget-window"];
    return keyQuestions
      .map((questionId) => {
        const option = getSelectedOption(QUESTION_SET, answers, questionId);
        return option ? option.detail : undefined;
      })
      .filter((value): value is string => Boolean(value));
  }, [answers]);

  const recommendationReady = hasSubmitted && unansweredQuestions.length === 0;
  const range = profilePriceRanges[recommendation.profileId];

  function handleAnswer(questionId: string, optionId: string): void {
    setAnswers((previous) => ({ ...previous, [questionId]: optionId }));
  }

  function handleSubmit(event: Event): void {
    event.preventDefault();
    setHasSubmitted(true);
  }

  function handleReset(): void {
    setAnswers({});
    setHasSubmitted(false);
  }

  function applyRecommendation(): void {
    if (!recommendationReady) {
      return;
    }

    updateProfileQuery(recommendation.profileId);

    window.dispatchEvent(
      new CustomEvent(APPLY_PROFILE_EVENT, {
        detail: { profileId: recommendation.profileId }
      })
    );

    const configurator = document.getElementById("configurator-builder");
    configurator?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="card stack" aria-labelledby="builder-questionnaire-title">
      <div className="stack" style={{ gap: "0.45rem" }}>
        <p className="eyebrow">Quick Guidance</p>
        <h2 id="builder-questionnaire-title" style={{ marginBottom: 0 }}>
          Need help picking your build tier?
        </h2>
        <p className="small" style={{ margin: 0 }}>
          Answer 10 quick questions and we will suggest the most suitable starting profile.
        </p>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {QUESTION_SET.map((question, index) => (
          <fieldset
            key={question.id}
            className="surface"
            style={{ margin: 0, padding: "0.9rem", borderColor: "var(--line)" }}
          >
            <legend style={{ padding: "0 0.35rem", fontWeight: 700, color: "var(--text)" }}>
              {index + 1}. {question.prompt}
            </legend>

            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem" }}>
              {question.options.map((option) => {
                const checked = answers[question.id] === option.id;
                return (
                  <label
                    key={option.id}
                    className="card"
                    style={{
                      padding: "0.75rem",
                      cursor: "pointer",
                      borderColor: checked ? "var(--brand)" : "var(--line)",
                      background: checked
                        ? "color-mix(in srgb, var(--brand) 10%, var(--bg-elev))"
                        : "var(--bg-elev)"
                    }}
                  >
                    <span className="row" style={{ alignItems: "flex-start", gap: "0.55rem" }}>
                      <input
                        type="radio"
                        name={question.id}
                        value={option.id}
                        checked={checked}
                        onChange={() => handleAnswer(question.id, option.id)}
                        style={{ width: "auto", marginTop: "0.2rem" }}
                      />
                      <span className="stack" style={{ gap: "0.2rem" }}>
                        <strong style={{ color: "var(--text)" }}>{option.label}</strong>
                        <span className="small">{option.detail}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <p className="small" style={{ margin: 0 }}>
            {Object.keys(answers).length}/{QUESTION_SET.length} answered
          </p>
          <div className="row" style={{ gap: "0.6rem" }}>
            <button type="button" className="button secondary" onClick={handleReset}>
              Clear
            </button>
            <button type="submit" className="button primary">
              Get Recommendation
            </button>
          </div>
        </div>
      </form>

      {hasSubmitted && unansweredQuestions.length > 0 && (
        <div className="surface" style={{ padding: "0.8rem", borderColor: "var(--warn)" }}>
          <p className="small" style={{ margin: 0, color: "var(--text)" }}>
            Please answer all questions to get an accurate recommendation.
          </p>
        </div>
      )}

      {recommendationReady && (
        <div className="surface stack" style={{ padding: "1rem" }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            Suggested Profile
          </p>
          <h3 style={{ marginBottom: "0.2rem" }}>{PROFILE_LABELS[recommendation.profileId]}</h3>
          {range && (
            <p className="small" style={{ margin: 0 }}>
              Typical current range: {formatCurrency(range.min)}-{formatCurrency(range.max)}
            </p>
          )}
          <ul className="small" style={{ margin: 0, paddingLeft: "1rem", color: "var(--text-soft)" }}>
            {rationale.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button type="button" className="button primary" onClick={applyRecommendation}>
            Apply to Configurator
          </button>
        </div>
      )}
    </section>
  );
}
