import { describe, expect, it } from "vitest";
import { planningFormat } from "../../lib/extension/format";

/**
 * Numbers and dates on the planning screens (design b0-vertical-slice.md
 * §12.5, decision 5): Western digits and the Gregorian calendar, in every
 * language, with the reader's own separators and month names.
 */

const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe("numbers", () => {
  it("are Western digits in Arabic, grouped the Arabic way", () => {
    const { number } = planningFormat("ar", "Asia/Riyadh");
    const written = number(12345);
    expect(written).not.toMatch(ARABIC_INDIC);
    expect(written.replace(/\D/g, "")).toBe("12345");
  });

  it("are grouped the English way in English", () => {
    expect(planningFormat("en", "UTC").number(12345)).toBe("12,345");
  });
});

describe("dates", () => {
  const iso = "2027-03-14T09:30:00Z";

  it("are Gregorian with Arabic month names and Western digits in Arabic", () => {
    const written = planningFormat("ar", "Asia/Riyadh").date(iso);
    expect(written).not.toMatch(ARABIC_INDIC);
    expect(written).toContain("2027");
    expect(written).toContain("مارس");
    // Riyadh is three hours ahead of the stored instant.
    expect(written).toMatch(/12:30/);
  });

  it("are in the reader's timezone in English", () => {
    const written = planningFormat("en", "UTC").date(iso);
    expect(written).toContain("2027");
    expect(written).toMatch(/9:30|09:30/);
  });

  it("fall back to UTC when the timezone is not one", () => {
    const written = planningFormat("en", "Not/AZone").date(iso);
    expect(written).toMatch(/9:30|09:30/);
  });
});
