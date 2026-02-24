import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { leadSchema, sanitizeLeadPayload } from "../../src/lib/lead/validation";
import type { LeadPayload } from "../../src/lib/types";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

interface ErrorResponse {
  ok: false;
  code: string;
  message: string;
}

interface SuccessResponse {
  ok: true;
  leadId: string;
}

function json(statusCode: number, body: ErrorResponse | SuccessResponse) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const existing = rateLimitMap.get(ip);

  if (!existing || existing.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return false;
  }

  existing.count += 1;
  rateLimitMap.set(ip, existing);
  return true;
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return true;
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      secret,
      response: token,
      remoteip: remoteIp
    })
  });

  if (!response.ok) {
    return false;
  }

  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

function buildEmailText(payload: {
  mode: string;
  name: string;
  email: string;
  phone?: string | undefined;
  company?: string | undefined;
  budget?: string | undefined;
  timeline?: string | undefined;
  message: string;
  buildSelection?: Record<string, string> | undefined;
}): string {
  const lines = [
    `Mode: ${payload.mode}`,
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone || "N/A"}`,
    `Company: ${payload.company || "N/A"}`,
    `Budget: ${payload.budget || "N/A"}`,
    `Timeline: ${payload.timeline || "N/A"}`,
    "",
    "Message:",
    payload.message,
    "",
    "Build Selection:",
    payload.buildSelection ? JSON.stringify(payload.buildSelection, null, 2) : "None"
  ];

  return lines.join("\n");
}

function getClientIp(headers: Record<string, string | undefined>): string {
  const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();
  return (
    headers["x-nf-client-connection-ip"] ||
    forwarded ||
    headers["client-ip"] ||
    "unknown"
  );
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, code: "method_not_allowed", message: "Only POST is supported." });
  }

  if (!event.body) {
    return json(400, { ok: false, code: "bad_request", message: "Missing request body." });
  }

  const ip = getClientIp(event.headers);
  if (!checkRateLimit(ip)) {
    return json(429, { ok: false, code: "rate_limited", message: "Too many requests. Please retry later." });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(event.body);
  } catch {
    return json(400, { ok: false, code: "invalid_json", message: "Request body must be valid JSON." });
  }

  const sanitized = sanitizeLeadPayload(parsedBody as Partial<LeadPayload>);
  const parsed = leadSchema.safeParse(sanitized);
  if (!parsed.success) {
    return json(400, {
      ok: false,
      code: "validation_failed",
      message: "Invalid form submission. Check required fields and try again."
    });
  }

  const payload = parsed.data;
  const leadId = crypto.randomUUID();

  if (payload.honeypot) {
    return json(200, { ok: true, leadId });
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    const validTurnstile = await verifyTurnstile(payload.turnstileToken || "", ip);
    if (!validTurnstile) {
      return json(400, {
        ok: false,
        code: "bot_check_failed",
        message: "Bot verification failed. Please retry."
      });
    }
  }

  const toEmail = process.env.LEADS_TO_EMAIL;
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.LEADS_FROM_EMAIL || "Draconis Systems <leads@draconis-systems.co.uk>";

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseTable = process.env.SUPABASE_LEADS_TABLE || "leads";

  let emailSent = false;
  let dbSaved = false;

  if (resendApiKey && toEmail) {
    try {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: resendFrom,
        to: [toEmail],
        subject: `[Draconis Lead] ${payload.mode.toUpperCase()} - ${payload.name}`,
        text: buildEmailText(payload)
      });
      emailSent = true;
    } catch (error) {
      console.error("Failed to send lead email", error);
    }
  }

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from(supabaseTable).insert({
        lead_id: leadId,
        submitted_at: new Date().toISOString(),
        ip,
        mode: payload.mode,
        name: payload.name,
        email: payload.email,
        phone: payload.phone || null,
        company: payload.company || null,
        budget: payload.budget || null,
        timeline: payload.timeline || null,
        message: payload.message,
        build_selection: payload.buildSelection || null,
        email_sent: emailSent
      });

      if (!error) {
        dbSaved = true;
      } else {
        console.error("Failed to store lead in Supabase", error);
      }
    } catch (error) {
      console.error("Supabase insert failed", error);
    }
  }

  if (!emailSent && !dbSaved) {
    return json(500, {
      ok: false,
      code: "delivery_failed",
      message: "Unable to deliver your request right now. Please try again shortly."
    });
  }

  return json(200, { ok: true, leadId });
};
