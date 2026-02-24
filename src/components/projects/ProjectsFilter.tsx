import { useMemo, useState } from "preact/hooks";
import type { BudgetTier, UseCase } from "@/lib/types";

interface ProjectCard {
  slug: string;
  title: string;
  summary: string;
  useCase: UseCase;
  budgetTier: BudgetTier;
  tags: string[];
  heroImage: string;
  date: string;
}

interface Props {
  projects: ProjectCard[];
}

const useCaseOptions: Array<UseCase | "all"> = ["all", "gaming", "creator", "workstation", "hybrid"];
const budgetOptions: Array<BudgetTier | "all"> = ["all", "entry", "mid", "high", "flagship"];

export default function ProjectsFilter({ projects }: Props) {
  const [useCase, setUseCase] = useState<UseCase | "all">("all");
  const [budget, setBudget] = useState<BudgetTier | "all">("all");
  const [tag, setTag] = useState<string>("all");

  const tags = useMemo(() => {
    const unique = new Set<string>();
    projects.forEach((project) => project.tags.forEach((item) => unique.add(item)));
    return ["all", ...Array.from(unique).sort()];
  }, [projects]);

  const filtered = useMemo(() => {
    return projects.filter((project) => {
      if (useCase !== "all" && project.useCase !== useCase) {
        return false;
      }
      if (budget !== "all" && project.budgetTier !== budget) {
        return false;
      }
      if (tag !== "all" && !project.tags.includes(tag)) {
        return false;
      }
      return true;
    });
  }, [budget, projects, tag, useCase]);

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="card" style={{ padding: "1rem" }}>
        <div className="grid" style={{ gap: "0.8rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div>
            <label htmlFor="useCaseFilter">Use Case</label>
            <select
              id="useCaseFilter"
              value={useCase}
              onChange={(event) => setUseCase(event.currentTarget.value as UseCase | "all")}
            >
              {useCaseOptions.map((option) => (
                <option value={option}>{option === "all" ? "All" : option}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="budgetFilter">Budget Tier</label>
            <select
              id="budgetFilter"
              value={budget}
              onChange={(event) => setBudget(event.currentTarget.value as BudgetTier | "all")}
            >
              {budgetOptions.map((option) => (
                <option value={option}>{option === "all" ? "All" : option}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="tagFilter">Tag</label>
            <select id="tagFilter" value={tag} onChange={(event) => setTag(event.currentTarget.value)}>
              {tags.map((option) => (
                <option value={option}>{option === "all" ? "All" : option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <p className="small">Showing {filtered.length} project(s).</p>

      <div className="grid grid-3">
        {filtered.map((project) => (
          <article className="card" style={{ padding: 0, overflow: "hidden" }}>
            <img src={project.heroImage} alt={project.title} loading="lazy" width={1200} height={675} />
            <div style={{ padding: "1rem" }}>
              <p className="small">
                {project.useCase} / {project.budgetTier}
              </p>
              <h3>{project.title}</h3>
              <p>{project.summary}</p>
              <div className="row small" style={{ gap: "0.4rem", marginBottom: "0.75rem" }}>
                {project.tags.map((item) => (
                  <span className="badge" style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem" }}>
                    {item}
                  </span>
                ))}
              </div>
              <a className="button secondary" href={`/projects/${project.slug}`}>
                View Project
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
