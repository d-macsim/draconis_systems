import { useMemo, useState } from "preact/hooks";
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
import type { BuildSelection, ComponentCatalog, ConfigComponent, ConfiguratorRules } from "@/lib/types";

interface Props {
  catalog: ComponentCatalog;
  rules: ConfiguratorRules;
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

const PROFILE_LABELS: Record<ProfileId, string> = {
  "profile-budget": "Budget Build",
  "profile-mid-range": "Mid Range Build",
  "profile-high-end": "High End Build"
};

const PROFILE_PRIORITY: ProfileId[] = ["profile-mid-range", "profile-budget", "profile-high-end"];

const QUESTION_SET: QuestionnaireQuestion[] = [
  {
    id: "target-resolution",
    prompt: "What resolution are you targeting most of the time?",
    options: [
      {
        id: "res-1080",
        label: "1080p",
        detail: "Value-focused with strong framerate for the spend.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "res-1440",
        label: "1440p",
        detail: "Balanced visual quality and smooth performance.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "res-4k",
        label: "4K",
        detail: "High visual quality with heavier GPU demand.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "framerate-target",
    prompt: "What framerate are you aiming for in your main titles?",
    options: [
      {
        id: "fps-60",
        label: "60-100 FPS",
        detail: "Smooth gameplay with lower total system pressure.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "fps-144",
        label: "120-165 FPS",
        detail: "Strong high-refresh target for mixed games.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "fps-240",
        label: "240+ FPS where possible",
        detail: "Competitive overhead and lower input latency focus.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "game-style",
    prompt: "Which game style best matches your library?",
    options: [
      {
        id: "competitive",
        label: "Competitive shooters",
        detail: "CS2, Valorant, Warzone, or similar.",
        scores: { "profile-budget": 2, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "casual",
        label: "Casual and mixed games",
        detail: "Lighter or less demanding titles.",
        scores: { "profile-budget": 4, "profile-mid-range": 2, "profile-high-end": 0 }
      },
      {
        id: "graphics-heavy",
        label: "Graphics-heavy AAA",
        detail: "Examples include RDR2, Cyberpunk, and similar.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "stream-create",
    prompt: "Will you stream, edit, or do creator workloads on this machine?",
    options: [
      {
        id: "stream-none",
        label: "Rarely or never",
        detail: "Gaming-first setup without heavy background tasks.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "stream-occasional",
        label: "Occasionally",
        detail: "Light streaming or editing from time to time.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "stream-heavy",
        label: "Frequently",
        detail: "Regular streaming, editing, rendering, or similar.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "multitasking",
    prompt: "How heavy is your day-to-day multitasking?",
    options: [
      {
        id: "multi-light",
        label: "Light",
        detail: "A few apps and browser tabs while gaming.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "multi-medium",
        label: "Moderate",
        detail: "Discord, browser, and background apps together.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "multi-heavy",
        label: "Heavy",
        detail: "Many active apps, tabs, and productivity tools.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "storage-target",
    prompt: "How much fast storage do you want from day one?",
    options: [
      {
        id: "storage-1tb",
        label: "1TB",
        detail: "Enough for OS, key tools, and a smaller game library.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "storage-2tb",
        label: "2TB",
        detail: "A balanced starting point for modern libraries.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "storage-4tb",
        label: "4TB+",
        detail: "Large game library or bigger local project footprint.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "aesthetics",
    prompt: "How important are RGB lighting and showcase styling?",
    options: [
      {
        id: "aesthetic-minimal",
        label: "Minimal",
        detail: "Function-first, lower visual spend.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "aesthetic-balanced",
        label: "Balanced",
        detail: "Clean looks without forcing premium parts.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "aesthetic-showcase",
        label: "Showcase build",
        detail: "Tempered glass, RGB, and premium presentation.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "noise-preference",
    prompt: "What matters more for fan noise and cooling behaviour?",
    options: [
      {
        id: "noise-standard",
        label: "Standard",
        detail: "Normal load noise is acceptable.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "noise-balanced",
        label: "Balanced",
        detail: "Prefer a sensible balance of thermals and acoustics.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "noise-quiet",
        label: "Quieter under load",
        detail: "Stronger cooling and lower noise are priorities.",
        scores: { "profile-budget": 0, "profile-mid-range": 2, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "longevity",
    prompt: "How long should this build stay competitive before a major refresh?",
    options: [
      {
        id: "life-short",
        label: "2-3 years",
        detail: "Prioritise value now and upgrade sooner.",
        scores: { "profile-budget": 4, "profile-mid-range": 1, "profile-high-end": 0 }
      },
      {
        id: "life-medium",
        label: "3-5 years",
        detail: "Balanced lifecycle and upgrade path.",
        scores: { "profile-budget": 1, "profile-mid-range": 4, "profile-high-end": 1 }
      },
      {
        id: "life-long",
        label: "As long as possible",
        detail: "Favour stronger long-term headroom.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 4 }
      }
    ]
  },
  {
    id: "spend-range",
    prompt: "Which budget range best matches this build?",
    options: [
      {
        id: "budget-tight",
        label: "GBP 600-1000",
        detail: "Value-first build with controlled part spend.",
        scores: { "profile-budget": 5, "profile-mid-range": 0, "profile-high-end": 0 }
      },
      {
        id: "budget-balanced",
        label: "GBP 1000-1800",
        detail: "Mainstream spend for balanced performance.",
        scores: { "profile-budget": 1, "profile-mid-range": 5, "profile-high-end": 1 }
      },
      {
        id: "budget-premium",
        label: "GBP 1800+",
        detail: "Premium spend with stronger overhead and finish.",
        scores: { "profile-budget": 0, "profile-mid-range": 1, "profile-high-end": 5 }
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

function getAveragePrice(component: ConfigComponent): number {
  const min = component.priceMin ?? component.priceMax;
  const max = component.priceMax ?? component.priceMin;

  if (min === null || max === null) {
    return Number.POSITIVE_INFINITY;
  }

  return (min + max) / 2;
}

function sortByPrice(options: ConfigComponent[]): ConfigComponent[] {
  return [...options].sort((first, second) => getAveragePrice(first) - getAveragePrice(second));
}

function clampTier(value: number): number {
  return Math.max(0, Math.min(2, Math.round(value)));
}

function baseTierFromProfile(profileId: ProfileId): number {
  if (profileId === "profile-budget") {
    return 0;
  }
  if (profileId === "profile-mid-range") {
    return 1;
  }
  return 2;
}

function pickByTier(options: ConfigComponent[], tier: number): ConfigComponent | undefined {
  if (options.length === 0) {
    return undefined;
  }

  const sorted = sortByPrice(options);
  const index = Math.round((clampTier(tier) / 2) * (sorted.length - 1));
  return sorted[index];
}

function getCategoryOptions(
  catalog: ComponentCatalog,
  category: ConfigComponent["category"],
  profileId: ProfileId
): ConfigComponent[] {
  const profileOptions = getComponentsByCategory(catalog, category, profileId);
  if (profileOptions.length > 0) {
    return profileOptions;
  }

  return getComponentsByCategory(catalog, category);
}

function pickRamOption(
  options: ConfigComponent[],
  targetSizeGB: number,
  preferRgb: boolean | undefined
): ConfigComponent | undefined {
  if (options.length === 0) {
    return undefined;
  }

  let pool = options;
  if (preferRgb !== undefined) {
    const filtered = options.filter((option) => {
      const isRgb = option.name.toLowerCase().includes("rgb");
      return preferRgb ? isRgb : !isRgb;
    });
    if (filtered.length > 0) {
      pool = filtered;
    }
  }

  let best: ConfigComponent | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const option of pool) {
    const size = option.sizeGB ?? 0;
    const underTargetPenalty = size < targetSizeGB ? (targetSizeGB - size) * 2 : 0;
    const overTargetPenalty = size >= targetSizeGB ? size - targetSizeGB : 0;
    const pricePenalty = getAveragePrice(option) / 1000;
    const score = underTargetPenalty + overTargetPenalty + pricePenalty;

    if (score < bestScore) {
      best = option;
      bestScore = score;
    }
  }

  return best ?? pickByTier(pool, 1);
}

function filterStorageByNeed(options: ConfigComponent[], needId: string | undefined): ConfigComponent[] {
  const token =
    needId === "storage-1tb" ? "1tb" : needId === "storage-4tb" ? "4tb" : "2tb";
  const matched = options.filter((option) => option.name.toLowerCase().includes(token));
  if (matched.length > 0) {
    return matched;
  }
  return options;
}

function recommendProfile(
  questions: QuestionnaireQuestion[],
  answers: Record<string, string>
): ProfileId {
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

  return orderedProfiles[0] ?? "profile-mid-range";
}

function buildSuggestedSelection(
  catalog: ComponentCatalog,
  rules: ConfiguratorRules,
  answers: Record<string, string>,
  profileId: ProfileId
): BuildSelection {
  const selection: BuildSelection = { profile: profileId };
  const budget = answers["spend-range"];
  const resolution = answers["target-resolution"];
  const framerate = answers["framerate-target"];
  const gameStyle = answers["game-style"];
  const streamCreate = answers["stream-create"];
  const multitasking = answers["multitasking"];
  const storageNeed = answers["storage-target"];
  const aesthetics = answers["aesthetics"];
  const noisePreference = answers["noise-preference"];
  const longevity = answers["longevity"];

  const cpuOptions = getCategoryOptions(catalog, "cpu", profileId);
  let cpuTier = baseTierFromProfile(profileId);
  if (streamCreate === "stream-heavy") {
    cpuTier += 1;
  }
  if (longevity === "life-long") {
    cpuTier += 1;
  }
  if (framerate === "fps-240") {
    cpuTier += 1;
  }
  if (budget === "budget-tight") {
    cpuTier -= 1;
  }
  const selectedCpu = pickByTier(cpuOptions, cpuTier);
  if (selectedCpu) {
    selection.cpu = selectedCpu.id;
  }

  const gpuOptions = getCategoryOptions(catalog, "gpu", profileId);
  let gpuTier = baseTierFromProfile(profileId);
  if (resolution === "res-4k") {
    gpuTier += 1;
  }
  if (framerate === "fps-240") {
    gpuTier += 1;
  }
  if (gameStyle === "graphics-heavy") {
    gpuTier += 1;
  }
  if (gameStyle === "casual") {
    gpuTier -= 1;
  }
  if (budget === "budget-tight") {
    gpuTier -= 1;
  }
  const selectedGpu = pickByTier(gpuOptions, gpuTier);
  if (selectedGpu) {
    selection.gpu = selectedGpu.id;
  }

  const motherboardOptions = filterMotherboardsByCpu(
    getCategoryOptions(catalog, "motherboard", profileId),
    selectedCpu
  );
  let motherboardTier = baseTierFromProfile(profileId);
  if (longevity !== "life-short") {
    motherboardTier += 1;
  }
  if (aesthetics === "aesthetic-showcase") {
    motherboardTier += 1;
  }
  if (budget === "budget-tight") {
    motherboardTier -= 1;
  }
  const selectedMotherboard = pickByTier(motherboardOptions, motherboardTier);
  if (selectedMotherboard) {
    selection.motherboard = selectedMotherboard.id;
  }

  const ramOptions = getCategoryOptions(catalog, "ram", profileId).filter(
    (option) =>
      !selectedMotherboard?.ramType ||
      !option.ramType ||
      option.ramType === selectedMotherboard.ramType
  );
  let targetRamSize = rules.recommendedRamByProfile[profileId] ?? 32;
  if (streamCreate === "stream-heavy") {
    targetRamSize = Math.max(targetRamSize, 64);
  }
  if (multitasking === "multi-heavy") {
    targetRamSize = Math.max(targetRamSize, 48);
  }
  if (budget === "budget-tight") {
    targetRamSize = Math.min(targetRamSize, 32);
  }
  const preferRgb =
    aesthetics === "aesthetic-showcase"
      ? true
      : aesthetics === "aesthetic-minimal"
        ? false
        : undefined;
  const selectedRam = pickRamOption(ramOptions, targetRamSize, preferRgb);
  if (selectedRam) {
    selection.ram = selectedRam.id;
  }

  const storageOptions = filterStorageByNeed(
    getCategoryOptions(catalog, "storage", profileId),
    storageNeed
  );
  let storageTier = baseTierFromProfile(profileId);
  if (storageNeed === "storage-4tb") {
    storageTier += 1;
  }
  if (streamCreate === "stream-heavy") {
    storageTier += 1;
  }
  if (budget === "budget-tight") {
    storageTier -= 1;
  }
  const selectedStorage = pickByTier(storageOptions, storageTier);
  if (selectedStorage) {
    selection.storage = selectedStorage.id;
  }

  const psuOptions = sortByPrice(getCategoryOptions(catalog, "psu", profileId)).filter(
    (option) => typeof option.wattage === "number"
  );
  const requiredWattage = estimateRequiredWattage(selection, catalog, rules);
  let selectedPsu = psuOptions.find((option) => (option.wattage ?? 0) >= requiredWattage);
  if (!selectedPsu && psuOptions.length > 0) {
    selectedPsu = psuOptions[psuOptions.length - 1];
  }
  if (selectedPsu) {
    selection.psu = selectedPsu.id;
  }

  const caseOptions = getCategoryOptions(catalog, "case", profileId);
  let caseTier = baseTierFromProfile(profileId);
  if (aesthetics === "aesthetic-showcase") {
    caseTier += 1;
  }
  if (aesthetics === "aesthetic-minimal") {
    caseTier -= 1;
  }
  if (budget === "budget-tight") {
    caseTier -= 1;
  }
  const selectedCase = pickByTier(caseOptions, caseTier);
  if (selectedCase) {
    selection.case = selectedCase.id;
  }

  const coolingOptions = getCategoryOptions(catalog, "cooling", profileId);
  let coolingTier = baseTierFromProfile(profileId);
  if (noisePreference === "noise-quiet") {
    coolingTier += 1;
  }
  if (streamCreate === "stream-heavy") {
    coolingTier += 1;
  }
  if ((selectedCpu?.tdp ?? 0) > 170) {
    coolingTier += 1;
  }
  if (budget === "budget-tight") {
    coolingTier -= 1;
  }
  let coolingPool = coolingOptions;
  if (clampTier(coolingTier) === 2) {
    const aioCandidates = coolingOptions.filter((option) =>
      option.name.toLowerCase().includes("aio")
    );
    if (aioCandidates.length > 0) {
      coolingPool = aioCandidates;
    }
  }
  const selectedCooling = pickByTier(coolingPool, coolingTier);
  if (selectedCooling) {
    selection.cooling = selectedCooling.id;
  }

  return selection;
}

function getRecommendationTitle(profileId: ProfileId, answers: Record<string, string>): string {
  const resolutionLabel =
    answers["target-resolution"] === "res-4k"
      ? "4K"
      : answers["target-resolution"] === "res-1080"
        ? "1080p"
        : "1440p";

  return `${resolutionLabel} ${PROFILE_LABELS[profileId]} Recommendation`;
}

export default function BuildQuestionnaire({ catalog, rules }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const unansweredQuestions = useMemo(
    () => QUESTION_SET.filter((question) => !answers[question.id]),
    [answers]
  );

  const recommendationProfile = useMemo(
    () => recommendProfile(QUESTION_SET, answers),
    [answers]
  );

  const profilePriceRanges = useMemo(
    () => calculateProfilePriceRanges(catalog),
    [catalog]
  );

  const suggestedSelection = useMemo(
    () => buildSuggestedSelection(catalog, rules, answers, recommendationProfile),
    [answers, catalog, recommendationProfile, rules]
  );

  const compatibility = useMemo(
    () => validateSelection(suggestedSelection, catalog, rules),
    [catalog, rules, suggestedSelection]
  );

  const estimated = useMemo(
    () => estimatePriceRange(suggestedSelection, catalog),
    [catalog, suggestedSelection]
  );

  const performance = useMemo(
    () => estimatePerformanceScore(suggestedSelection, catalog),
    [catalog, suggestedSelection]
  );

  const wattage = useMemo(
    () => estimateRequiredWattage(suggestedSelection, catalog, rules),
    [catalog, rules, suggestedSelection]
  );

  const quoteHref = `/contact?mode=quote&build=${serializeBuildSelection(suggestedSelection)}`;
  const recommendationReady = hasSubmitted && unansweredQuestions.length === 0;
  const profileRange = profilePriceRanges[recommendationProfile];
  const recommendationTitle = getRecommendationTitle(recommendationProfile, answers);

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

  return (
    <section className="stack" aria-labelledby="builder-questionnaire-title">
      <div className="stack" style={{ gap: "0.35rem" }}>
        <h2 id="builder-questionnaire-title" style={{ marginBottom: 0 }}>
          Quick Build Questionnaire
        </h2>
        <p className="small" style={{ margin: 0 }}>
          This option is separate from the manual configurator and returns a full preconfigured system
          recommendation.
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

            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem" }}
            >
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
              Generate Recommended Build
            </button>
          </div>
        </div>
      </form>

      {hasSubmitted && unansweredQuestions.length > 0 && (
        <div className="surface" style={{ padding: "0.8rem", borderColor: "var(--warn)" }}>
          <p className="small" style={{ margin: 0, color: "var(--text)" }}>
            Please answer all questions to generate a complete recommendation.
          </p>
        </div>
      )}

      {recommendationReady && (
        <div className="surface stack" style={{ padding: "1rem" }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            Preconfigured Recommendation
          </p>
          <h3 style={{ marginBottom: "0.2rem" }}>{recommendationTitle}</h3>
          {profileRange && (
            <p className="small" style={{ margin: 0 }}>
              Typical range for this profile: {formatCurrency(profileRange.min)}-{formatCurrency(profileRange.max)}
            </p>
          )}

          <ul className="clean stack small">
            {catalog.categories.map((category) => {
              const component = getComponentById(catalog, suggestedSelection[category.id]);
              if (!component) {
                return null;
              }

              return (
                <li key={category.id}>
                  <strong>{category.label}:</strong> {component.name}
                </li>
              );
            })}
          </ul>

          <div className="surface" style={{ padding: "0.8rem" }}>
            <p className="small">Estimated Price Range</p>
            <p style={{ margin: 0, fontWeight: 800 }}>
              {formatCurrency(estimated.min)}-{formatCurrency(estimated.max)}
            </p>
            <p className="small" style={{ marginTop: "0.45rem" }}>
              Performance score: {performance > 0 ? `${performance}/100` : "Pending"}
            </p>
            <p className="small" style={{ marginTop: "0.3rem" }}>
              Recommended PSU headroom target: {wattage}W
            </p>
            <p className="small" style={{ marginTop: "0.3rem" }}>
              This is an estimate only. Final quote depends on live sourcing.
            </p>
          </div>

          {compatibility.errors.length > 0 && (
            <div className="surface" style={{ borderColor: "var(--danger)", padding: "0.8rem" }}>
              <strong>Compatibility Checks</strong>
              <ul className="clean stack small" style={{ marginTop: "0.45rem" }}>
                {compatibility.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <a className="button primary" href={quoteHref}>
            Request Quote For This Build
          </a>
        </div>
      )}
    </section>
  );
}
