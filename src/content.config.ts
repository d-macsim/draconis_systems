import { z, defineCollection } from "astro:content";

const projects = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    featured: z.boolean().default(false),
    useCase: z.enum(["gaming", "creator", "workstation", "hybrid"]),
    budgetTier: z.enum(["entry", "mid", "high", "flagship"]),
    tags: z.array(z.string()),
    heroImage: z.string(),
    gallery: z.array(z.string()).default([]),
    cpu: z.string(),
    gpu: z.string(),
    ram: z.string(),
    storage: z.string(),
    outcome: z.string()
  })
});

const updates = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    category: z.enum(["company", "build-log", "availability", "events"]),
    featured: z.boolean().default(false)
  })
});

export const collections = {
  projects,
  updates
};
