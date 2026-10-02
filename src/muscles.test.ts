import { describe, expect, it } from "vitest";
import {
  exerciseMuscles,
  getExercisesForMuscles,
  getMusclesForExercise,
  getTrainedMuscles,
  muscleLabels,
} from "./muscles";

describe("exerciseMuscles", () => {
  it("指定された種目と筋肉の対応を保持する", () => {
    expect(exerciseMuscles["レッグプレス"].map((id) => muscleLabels[id])).toEqual([
      "大腿四頭筋",
      "ハムストリング",
      "大臀筋",
    ]);
    expect(exerciseMuscles["バタフライ"].map((id) => muscleLabels[id])).toEqual(["大胸筋"]);
  });

  it("チンニングは着色対象にしない", () => {
    expect(exerciseMuscles["チンニング"]).toBeUndefined();
  });
});

describe("getTrainedMuscles", () => {
  it("複数種目の筋肉を表示順で重複なく集計する", () => {
    expect(
      getTrainedMuscles([
        { name: "チェストプレス" },
        { name: "ショルダープレス" },
        { name: "チェストプレス" },
      ]).map((id) => muscleLabels[id]),
    ).toEqual(["大胸筋", "三角筋", "上腕三頭筋", "僧帽筋"]);
  });

  it("未対応種目、有酸素運動、記録なしは対象外にする", () => {
    expect(getTrainedMuscles([{ name: "チンニング" }, { name: "ランニング" }])).toEqual([]);
    expect(getTrainedMuscles([])).toEqual([]);
  });
});

describe("getMusclesForExercise", () => {
  it("種目に対応する筋肉を定義順で返す", () => {
    expect(getMusclesForExercise("レッグプレス").map((id) => muscleLabels[id])).toEqual([
      "大腿四頭筋",
      "ハムストリング",
      "大臀筋",
    ]);
  });

  it("着色対象のない種目には空配列を返す", () => {
    expect(getMusclesForExercise("チンニング")).toEqual([]);
    expect(getMusclesForExercise("ランニング")).toEqual([]);
    expect(getMusclesForExercise("未登録の種目")).toEqual([]);
  });

  it("呼び出し側による変更から対応表を保護する", () => {
    const muscles = getMusclesForExercise("バタフライ");
    muscles.length = 0;
    expect(getMusclesForExercise("バタフライ")).toEqual(["pectoralisMajor"]);
  });
});

describe("getExercisesForMuscles", () => {
  it("筋肉から種目を登録順で重複なく逆引きする", () => {
    expect(getExercisesForMuscles(["latissimusDorsi", "biceps"])).toEqual([
      "ラットプルダウン",
      "シーテッドロー",
      "ロングプル",
    ]);
  });

  it("対象筋肉がない場合は空配列を返す", () => {
    expect(getExercisesForMuscles([])).toEqual([]);
  });
});
