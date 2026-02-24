import { describe, expect, it } from "vitest";
import { leadSchema, sanitizeLeadPayload } from "@/lib/lead/validation";

describe("lead payload validation", () => {
  it("accepts valid quote payload", () => {
    const payload = {
      mode: "quote",
      name: "Alex Builder",
      email: "alex@example.com",
      message: "Need a hybrid build for gaming and 4K editing.",
      budget: "$2500-$3500"
    };

    const result = leadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const payload = {
      mode: "inquiry",
      name: "Taylor",
      email: "not-an-email",
      message: "Interested in services."
    };

    const result = leadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("sanitizes html from text fields", () => {
    const cleaned = sanitizeLeadPayload({
      mode: "inquiry",
      name: "<b>Alice</b>",
      email: "alice@example.com",
      message: "<script>alert(1)</script>Hello"
    });

    expect(cleaned.name).toBe("Alice");
    expect(cleaned.message.includes("<script>")).toBe(false);
  });
});
