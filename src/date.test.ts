import { describe, expect, it } from "vitest";
import { shiftMonth, toLocalDate } from "./date";

describe("date helpers", () => {
  it("formats a local calendar date", () => {
    expect(toLocalDate(new Date(2026, 8, 5))).toBe("2026-09-05");
  });

  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
