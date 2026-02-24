export type BudgetTier = "entry" | "mid" | "high" | "flagship";
export type UseCase = "gaming" | "creator" | "workstation" | "hybrid";

export interface ProjectEntry {
  slug: string;
  title: string;
  summary: string;
  description: string;
  date: string;
  featured: boolean;
  useCase: UseCase;
  budgetTier: BudgetTier;
  tags: string[];
  heroImage: string;
  gallery: string[];
  cpu: string;
  gpu: string;
  ram: string;
  storage: string;
  outcome: string;
}

export interface UpdateEntry {
  slug: string;
  title: string;
  summary: string;
  date: string;
  category: "company" | "build-log" | "availability" | "events";
  featured: boolean;
}

export interface ServiceEntry {
  id: string;
  title: string;
  description: string;
  bullets: string[];
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface ConfigComponent {
  id: string;
  category:
    | "profile"
    | "cpu"
    | "gpu"
    | "motherboard"
    | "ram"
    | "storage"
    | "psu"
    | "case"
    | "cooling";
  name: string;
  priceMin: number | null;
  priceMax: number | null;
  socket?: string;
  ramType?: "DDR4" | "DDR5";
  tdp?: number;
  wattage?: number;
  sizeGB?: number;
  score?: number;
  tags?: string[];
  profiles?: string[];
  marketQuery?: string;
  marketRequiredTokens?: string[];
  marketExcludeTokens?: string[];
  marketPriceBandPercent?: number;
  marketMaxDeviationPercent?: number;
}

export interface ComponentCategory {
  id: ConfigComponent["category"];
  label: string;
  required: boolean;
}

export interface ComponentCatalog {
  categories: ComponentCategory[];
  components: ConfigComponent[];
}

export interface CompatibilityRule {
  id: string;
  description: string;
}

export interface ConfiguratorRules {
  psuHeadroomPercent: number;
  recommendedRamByProfile: Record<string, number>;
}

export interface MarketPriceOverride {
  id: string;
  priceMin: number;
  priceMax: number;
  spot: number;
  source: string;
  updatedAt: string;
}

export interface BuildSelection {
  [key: string]: string | undefined;
  profile?: string;
  cpu?: string;
  gpu?: string;
  motherboard?: string;
  ram?: string;
  storage?: string;
  psu?: string;
  case?: string;
  cooling?: string;
}

export interface LeadPayload {
  mode: "inquiry" | "quote";
  name: string;
  email: string;
  phone?: string | undefined;
  company?: string | undefined;
  budget?: string | undefined;
  timeline?: string | undefined;
  message: string;
  buildSelection?: BuildSelection | undefined;
  honeypot?: string | undefined;
  turnstileToken?: string | undefined;
}
