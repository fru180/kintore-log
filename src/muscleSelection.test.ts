import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exercisesForSelectableMuscle, selectableMuscleId, selectableMuscleOrder } from "./muscleSelection";
import type { MuscleModelNode } from "./muscleModel";

type GlbNode = {
  name?: string;
  extras?: MuscleModelNode["userData"];
};

function readMuscleNodes(): MuscleModelNode[] {
  const model = readFileSync(new URL("../public/models/body.glb", import.meta.url));
  const jsonLength = model.readUInt32LE(12);
  const json = JSON.parse(
    model
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .trim(),
  ) as { nodes: GlbNode[] };

  return json.nodes
    .filter((node) => node.extras?.type === "muscle")
    .map((node) => ({ name: node.name, userData: node.extras }));
}

describe("selectableMuscleId", () => {
  const muscleNodes = readMuscleNodes();

  it.each(selectableMuscleOrder)("%sに対応するモデルメッシュがある", (muscle) => {
    expect(muscleNodes.some((node) => selectableMuscleId(node) === muscle)).toBe(true);
  });

  it("細かな筋肉は選択対象にしない", () => {
    expect(
      selectableMuscleId({
        name: "Lateral rectus muscle",
        userData: { name: "Lateral Rectus", nameDetail: "Lateral Rectus Muscle" },
      }),
    ).toBeNull();
  });

  it("三角筋後部を三角筋全体より優先して判定する", () => {
    expect(
      selectableMuscleId({
        name: "Scapular spinal part of deltoid muscle",
        userData: { name: "Deltoid", nameDetail: "Scapular Spinal Part Of Deltoid Muscle" },
      }),
    ).toBe("posteriorDeltoid");
  });
});

describe("exercisesForSelectableMuscle", () => {
  it("複数分類にまたがる種目を登録順で重複なく返す", () => {
    expect(exercisesForSelectableMuscle("latissimusDorsi")).toEqual([
      "ラットプルダウン",
      "シーテッドロー",
      "ロングプル",
    ]);
  });

  it("個別に対応する種目を返す", () => {
    expect(exercisesForSelectableMuscle("posteriorDeltoid")).toEqual(["リアデルト"]);
    expect(exercisesForSelectableMuscle("gluteusMedius")).toEqual(["ヒップアブダクター"]);
  });

  it("対応表にない主要筋群は空配列を返す", () => {
    expect(exercisesForSelectableMuscle("tibialisAnterior")).toEqual([]);
  });
});
