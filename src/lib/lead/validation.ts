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

export function sanitizeLeadPayload(payload: LeadPayload): LeadPayload {
  return {
    ...payload,
    name: sanitizeText(payload.name) ?? "",
    email: sanitizeText(payload.email) ?? "",
    phone: sanitizeText(payload.phone),
    company: sanitizeText(payload.company),
    budget: sanitizeText(payload.budget),
    timeline: sanitizeText(payload.timeline),
    message: sanitizeText(payload.message) ?? "",
    honeypot: sanitizeText(payload.honeypot),
    turnstileToken: sanitizeText(payload.turnstileToken)
  };
}
