import { describe, expect, it } from "vitest";
import { createInitialDraft, isDraftChanged, isDraftComplete, toDraftValue } from "./draft";
import type { Draft, WorkoutRecord } from "./types";

const completeDraft: Draft = {
  weightKg: 0,
  reps: 10,
  sets: 3,
  distanceKm: 0,
  durationMinutes: 30,
};

const savedRecord: WorkoutRecord = {
  id: 1,
  exerciseId: 1,
  date: "2026-09-15",
  name: "ベンチプレス",
  kind: "strength",
  weightKg: 0,
  reps: 10,
  sets: 3,
  distanceKm: null,
  durationMinutes: null,
};

describe("toDraftValue", () => {
  it("空欄を0に変換せず保持する", () => {
    expect(toDraftValue("")).toBe("");
  });

  it("入力された数値をnumberへ変換する", () => {
    expect(toDraftValue("3")).toBe(3);
  });
});

describe("createInitialDraft", () => {
  it("選択日の記録がある場合は最新重量や保存済み初期値より優先する", () => {
    expect(createInitialDraft(savedRecord, 80, { weightKg: 70, reps: 12 })).toEqual(completeDraft);
  });

  it("選択日の記録がない場合はAPIの最新重量と保存済みの回数・セット数を使う", () => {
    expect(createInitialDraft(undefined, 80, { weightKg: 70, reps: 12, sets: 4 })).toEqual({
      ...completeDraft,
      weightKg: 80,
      reps: 12,
      sets: 4,
    });
  });

  it("未記録種目のAPI初期値0kgを保持する", () => {
    expect(createInitialDraft(undefined, 0, {})).toEqual(completeDraft);
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

  it("アシスト重量の負数は入力済みと判定する", () => {
    expect(isDraftComplete({ ...completeDraft, weightKg: -20 }, "strength")).toBe(true);
  });
});

describe("isDraftChanged", () => {
  it("筋トレの入力値が保存済みの値と同じ場合は未変更と判定する", () => {
    expect(isDraftChanged(completeDraft, savedRecord, "strength")).toBe(false);
  });

  it("筋トレの対象フィールドが変わった場合は変更ありと判定する", () => {
    expect(isDraftChanged({ ...completeDraft, reps: 11 }, savedRecord, "strength")).toBe(true);
  });

  it("種目タイプの対象外フィールドは変更判定に含めない", () => {
    expect(isDraftChanged({ ...completeDraft, distanceKm: 5 }, savedRecord, "strength")).toBe(false);
  });

  it("有酸素運動の対象フィールドを比較する", () => {
    const cardioRecord = {
      ...savedRecord,
      kind: "cardio" as const,
      weightKg: null,
      reps: null,
      sets: null,
      distanceKm: 0,
      durationMinutes: 30,
    };

    expect(isDraftChanged(completeDraft, cardioRecord, "cardio")).toBe(false);
    expect(isDraftChanged({ ...completeDraft, durationMinutes: 31 }, cardioRecord, "cardio")).toBe(true);
  });
});
