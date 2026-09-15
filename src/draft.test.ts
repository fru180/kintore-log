import { describe, expect, it } from "vitest";
import { isDraftComplete, toDraftValue } from "./draft";
import type { Draft } from "./types";

const completeDraft: Draft = {
  weightKg: 0,
  reps: 10,
  sets: 3,
  distanceKm: 0,
  durationMinutes: 30,
};

describe("toDraftValue", () => {
  it("空欄を0に変換せず保持する", () => {
    expect(toDraftValue("")).toBe("");
  });

  it("入力された数値をnumberへ変換する", () => {
    expect(toDraftValue("3")).toBe(3);
  });
});

describe("isDraftComplete", () => {
  it("筋トレの必須項目に空欄がある場合は未入力と判定する", () => {
    expect(isDraftComplete({ ...completeDraft, sets: "" }, "strength")).toBe(false);
  });

  it("有酸素運動の必須項目に空欄がある場合は未入力と判定する", () => {
    expect(isDraftComplete({ ...completeDraft, distanceKm: "" }, "cardio")).toBe(false);
  });

  it("0は入力済みと判定する", () => {
    expect(isDraftComplete(completeDraft, "strength")).toBe(true);
    expect(isDraftComplete(completeDraft, "cardio")).toBe(true);
  });
});
