import { z } from "zod";
import type { LeadPayload } from "@/lib/types";

export const leadSchema = z.object({
  mode: z.enum(["inquiry", "quote"]),
  name: z.string().min(2).max(80),
  email: z.string().email().max(180),
  phone: z.string().max(40).optional(),
  company: z.string().max(120).optional(),
  budget: z.string().max(80).optional(),
  timeline: z.string().max(120).optional(),
  message: z.string().min(12).max(2500),
  buildSelection: z.record(z.string(), z.string()).optional(),
  honeypot: z.string().max(120).optional(),
  turnstileToken: z.string().max(2048).optional()
});

export type ValidLead = z.infer<typeof leadSchema>;

export function sanitizeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/<[^>]+>/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function sanitizeBuildSelection(
  value: LeadPayload["buildSelection"] | undefined
): LeadPayload["buildSelection"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    ([, item]) => typeof item === "string" && item.trim().length > 0
  );
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as LeadPayload["buildSelection"];
}

export function sanitizeLeadPayload(payload: Partial<LeadPayload>): LeadPayload {
  const sanitized: LeadPayload = {
    mode: payload.mode === "quote" ? "quote" : "inquiry",
    name: sanitizeText(payload.name) ?? "",
    email: sanitizeText(payload.email) ?? "",
    message: sanitizeText(payload.message) ?? ""
  };

  const phone = sanitizeText(payload.phone);
  const company = sanitizeText(payload.company);
  const budget = sanitizeText(payload.budget);
  const timeline = sanitizeText(payload.timeline);
  const honeypot = sanitizeText(payload.honeypot);
  const turnstileToken = sanitizeText(payload.turnstileToken);
  const buildSelection = sanitizeBuildSelection(payload.buildSelection);

  if (phone) sanitized.phone = phone;
  if (company) sanitized.company = company;
  if (budget) sanitized.budget = budget;
  if (timeline) sanitized.timeline = timeline;
  if (honeypot !== undefined) sanitized.honeypot = honeypot;
  if (turnstileToken) sanitized.turnstileToken = turnstileToken;
  if (buildSelection) sanitized.buildSelection = buildSelection;

  return sanitized;
}
