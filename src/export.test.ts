import { describe, expect, it } from "vitest";
import { latestWeightsText, weightRecordsCsv, type ExportData } from "./export";

const data: ExportData = {
  exercises: [
    { id: 2, name: "チェストプレス", sortOrder: 2 },
    { id: 1, name: "レッグプレス", sortOrder: 1 },
    { id: 3, name: "未記録種目", sortOrder: 3 },
  ],
  records: [
    { exerciseId: 1, date: "2026-10-25", weightKg: 87.5 },
    { exerciseId: 2, date: "2026-10-25", weightKg: 0 },
    { exerciseId: 1, date: "2026-10-23", weightKg: -10 },
    { exerciseId: 2, date: "2026-10-22", weightKg: 32 },
  ],
};

describe("weight export", () => {
  it("shows the latest saved weight in exercise order, including zero and unrecorded exercises", () => {
    expect(latestWeightsText(data)).toBe("レッグプレス 87.5kg\nチェストプレス 0kg\n未記録種目 0kg");
    expect(data.exercises[0].id).toBe(2);
  });

  it("builds a BOM-prefixed chronological matrix preserving missing, zero, decimal and negative weights", () => {
    expect(weightRecordsCsv(data)).toBe(
      "\uFEFF種目,2026-10-22,2026-10-23,2026-10-25\r\n" +
        "レッグプレス,,-10,87.5\r\nチェストプレス,32,,0\r\n未記録種目,,,\r\n",
    );
  });

  it("escapes commas, quotes and line breaks in exercise names", () => {
    expect(
      weightRecordsCsv({
        exercises: [{ id: 1, name: '種目,"A"\r\n次行', sortOrder: 1 }],
        records: [{ exerciseId: 1, date: "2026-10-25", weightKg: 20 }],
      }),
    ).toBe('\uFEFF種目,2026-10-25\r\n"種目,""A""\r\n次行",20\r\n');
  });

  it("handles an empty dataset", () => {
    expect(latestWeightsText({ exercises: [], records: [] })).toBe("");
    expect(weightRecordsCsv({ exercises: [], records: [] })).toBe("\uFEFF種目\r\n");
  });
});
