// Synthetic numbers only, none shaped like a real Israeli phone (pii-scan).
import { describe, expect, it } from "vitest";
import { mailHref, phoneDigits, telHref, waHref } from "./contactLinks";

describe("contact links", () => {
  it("a phone needs at least 6 digits; placeholder text gets no link", () => {
    expect(telHref("טלפון לדוגמה")).toBeNull();
    expect(waHref("12345")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(phoneDigits("(1) 23-45 6")).toBe("123456");
    expect(telHref("1-23 456")).toBe("tel:123456");
    expect(telHref(" +1 234 567")).toBe("tel:+1234567");
  });

  it("WhatsApp gets the international number: a local 0 becomes 972, 00 is dropped", () => {
    expect(waHref("01-234-567")).toBe("https://wa.me/9721234567");
    expect(waHref("00 1 234 567")).toBe("https://wa.me/1234567");
    expect(waHref("+1 234 567")).toBe("https://wa.me/1234567");
  });

  it("mail needs @ and a dot after it", () => {
    expect(mailHref(" speaker01@example.org ")).toBe("mailto:speaker01@example.org");
    expect(mailHref("not an address")).toBeNull();
    expect(mailHref("a@b")).toBeNull();
  });
});
