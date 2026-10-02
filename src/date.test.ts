import { describe, expect, it } from "vitest";
import { datePosition, daysBetween, shiftDay, shiftMonth, toLocalDate } from "./date";

describe("date helpers", () => {
  it("formats a local calendar date", () => {
    expect(toLocalDate(new Date(2026, 8, 5))).toBe("2026-09-05");
  });

  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("moves one day across month boundaries", () => {
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("calculates calendar-day distances across month and year boundaries", () => {
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
    expect(daysBetween("2026-12-31", "2027-01-02")).toBe(2);
  });

  it("supports proportional positions within a date range", () => {
    const start = "2026-09-01";
    const end = "2026-09-11";

    expect(datePosition("2026-09-03", start, end)).toBe(0.2);
    expect(datePosition(end, start, end)).toBe(1);
  });

  it("uses the start position when the date range has one point", () => {
    expect(datePosition("2026-09-01", "2026-09-01", "2026-09-01")).toBe(0);
  });
});
