import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("a team member's address", () => {
  it("is trimmed and lower-cased, as public.members stores it", () => {
    expect(normalizeEmail("  New.Member@Example.org ")).toBe("new.member@example.org");
  });
  it("is taken out of what people paste", () => {
    expect(normalizeEmail("חבר/ת צוות <Someone@Example.org>")).toBe("someone@example.org");
    expect(normalizeEmail("mailto:someone@example.org")).toBe("someone@example.org");
    expect(normalizeEmail(String.fromCharCode(0x200f) + "someone@example.org" + String.fromCharCode(0x200e))).toBe("someone@example.org");
  });
  it("refuses what is not an address", () => {
    for (const bad of ["", "someone", "someone@", "@example.org", "some one@example.org", "a@b", "a@@example.org", "a@example.org, b@example.org"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });
});
