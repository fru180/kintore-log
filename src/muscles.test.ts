import { describe, expect, it } from "vitest";
import {
  exerciseMuscles,
  getExercisesForMuscles,
  getMusclesForExercise,
  getTrainedMuscles,
  getUntrainedMuscles,
  muscleLabels,
  muscleOrder,
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
    ).toEqual(["僧帽筋", "三角筋", "大胸筋", "上腕三頭筋"]);
  });

  it("未対応種目、有酸素運動、記録なしは対象外にする", () => {
    expect(getTrainedMuscles([{ name: "チンニング" }, { name: "ランニング" }])).toEqual([]);
    expect(getTrainedMuscles([])).toEqual([]);
  });
});

describe("getUntrainedMuscles", () => {
  it("鍛えた筋肉を除き、定義順で返す", () => {
    expect(
      getUntrainedMuscles(["triceps", "pectoralisMajor", "triceps"]).map((id) => muscleLabels[id]),
    ).toEqual(
      muscleOrder.filter((id) => id !== "triceps" && id !== "pectoralisMajor").map((id) => muscleLabels[id]),
    );
  });

  it("鍛えた筋肉がない場合は全筋群を返す", () => {
    expect(getUntrainedMuscles([])).toEqual(muscleOrder);
  });

  it("全筋群を鍛えた場合は空配列を返す", () => {
    expect(getUntrainedMuscles(muscleOrder)).toEqual([]);
  });
});

describe("getMusclesForExercise", () => {
  it("種目に対応する筋肉を頭側からの表示順で返す", () => {
    expect(getMusclesForExercise("レッグプレス").map((id) => muscleLabels[id])).toEqual([
      "大臀筋",
      "大腿四頭筋",
      "ハムストリング",
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
