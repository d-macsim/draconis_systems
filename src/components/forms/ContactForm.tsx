import { useEffect, useMemo, useState } from "preact/hooks";
import type { BuildSelection, LeadPayload } from "@/lib/types";
import { deserializeBuildSelection } from "@/lib/configurator/engine";

interface Props {
  turnstileSiteKey?: string;
}

declare global {
  interface Window {
    onDraconisTurnstile?: (token: string) => void;
  }
}

const defaultPayload: LeadPayload = {
  mode: "inquiry",
  name: "",
  email: "",
  phone: "",
  company: "",
  budget: "",
  timeline: "",
  message: "",
  honeypot: "",
  turnstileToken: ""
};

export default function ContactForm({ turnstileSiteKey }: Props) {
  const [payload, setPayload] = useState<LeadPayload>(defaultPayload);
  const [buildSelection, setBuildSelection] = useState<BuildSelection | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const build = params.get("build");

    const parsedBuild = deserializeBuildSelection(build);

    setBuildSelection(parsedBuild);
    setPayload((prev) => ({
      ...prev,
      mode: mode === "quote" ? "quote" : "inquiry",
      message:
        mode === "quote"
          ? "I would like a quote for a custom build."
          : "I am interested in learning more about Draconis Systems services."
    }));

    window.onDraconisTurnstile = (token: string) => {
      setPayload((prev) => ({ ...prev, turnstileToken: token }));
    };
  }, []);

  const serializedBuild = useMemo(() => {
    if (!buildSelection) {
      return undefined;
    }
    return JSON.stringify(buildSelection, null, 2);
  }, [buildSelection]);

  type TextField =
    | "name"
    | "email"
    | "phone"
    | "company"
    | "budget"
    | "timeline"
    | "message"
    | "honeypot"
    | "turnstileToken";

  function updateField(key: TextField, value: string): void {
    setPayload((prev) => ({ ...prev, [key]: value }));
  }

  function setMode(mode: "inquiry" | "quote"): void {
    setPayload((prev) => ({ ...prev, mode }));
  }

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    setStatus("sending");
    setFeedback("");

    try {
      const response = await fetch("/.netlify/functions/lead-submit", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...payload,
          buildSelection
        })
      });

      const result = (await response.json()) as { ok?: boolean; message?: string; leadId?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Submission failed.");
      }

      setStatus("success");
      setFeedback(`Request submitted successfully. Reference ID: ${result.leadId ?? "pending"}`);
      setPayload((prev) => ({ ...defaultPayload, mode: prev.mode }));
    } catch (error) {
      setStatus("error");
      setFeedback(error instanceof Error ? error.message : "Submission failed.");
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ marginBottom: 0 }}>Contact Draconis Systems</h2>
        <div className="row">
          <button
            type="button"
            className={`button ${payload.mode === "inquiry" ? "primary" : "secondary"}`}
            onClick={() => setMode("inquiry")}
          >
            Inquiry
          </button>
          <button
            type="button"
            className={`button ${payload.mode === "quote" ? "primary" : "secondary"}`}
            onClick={() => setMode("quote")}
          >
            Quote Request
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div>
          <label htmlFor="name">Name</label>
          <input id="name" required value={payload.name} onInput={(e) => updateField("name", e.currentTarget.value)} />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={payload.email}
            onInput={(e) => updateField("email", e.currentTarget.value)}
          />
        </div>
        <div>
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            value={payload.phone ?? ""}
            onInput={(e) => updateField("phone", e.currentTarget.value)}
          />
        </div>
        <div>
          <label htmlFor="company">Company (Optional)</label>
          <input
            id="company"
            value={payload.company ?? ""}
            onInput={(e) => updateField("company", e.currentTarget.value)}
          />
        </div>
      </div>

      {payload.mode === "quote" && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div>
            <label htmlFor="budget">Target Budget</label>
            <input
              id="budget"
              value={payload.budget ?? ""}
              onInput={(e) => updateField("budget", e.currentTarget.value)}
            />
          </div>
          <div>
            <label htmlFor="timeline">Desired Timeline</label>
            <input
              id="timeline"
              value={payload.timeline ?? ""}
              onInput={(e) => updateField("timeline", e.currentTarget.value)}
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="message">Message</label>
        <textarea
          id="message"
          required
          rows={6}
          value={payload.message}
          onInput={(e) => updateField("message", e.currentTarget.value)}
        />
      </div>

      {serializedBuild && (
        <div>
          <label>Configurator Selection</label>
          <textarea readOnly rows={8} value={serializedBuild} />
        </div>
      )}

      <div style={{ display: "none" }} aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          tabIndex={-1}
          autoComplete="off"
          value={payload.honeypot ?? ""}
          onInput={(e) => updateField("honeypot", e.currentTarget.value)}
        />
      </div>

      {turnstileSiteKey && (
        <div
          className="cf-turnstile"
          data-sitekey={turnstileSiteKey}
          data-callback="onDraconisTurnstile"
          data-theme="auto"
        ></div>
      )}

      <button className="button primary" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending..." : "Submit"}
      </button>

      {feedback && (
        <p className="small" style={{ color: status === "error" ? "var(--danger)" : "var(--ok)", margin: 0 }}>
          {feedback}
        </p>
      )}
    </form>
  );
}
