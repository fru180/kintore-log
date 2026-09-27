import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modelMuscleIds, type MuscleModelNode } from "./muscleModel";
import { muscleOrder } from "./muscles";

type GlbNode = {
  name?: string;
  extras?: MuscleModelNode["userData"];
};

function readModelNodes(): { bytes: number; nodes: GlbNode[] } {
  const model = readFileSync(new URL("../public/models/body.glb", import.meta.url));
  expect(model.subarray(0, 4).toString("utf8")).toBe("glTF");
  const jsonLength = model.readUInt32LE(12);
  const json = JSON.parse(
    model
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .trim(),
  ) as {
    nodes: GlbNode[];
  };
  return { bytes: model.byteLength, nodes: json.nodes };
}

describe("anatomy model", () => {
  const model = readModelNodes();
  const muscleNodes = model.nodes
    .filter((node) => node.extras?.type === "muscle")
    .map((node) => ({ name: node.name, userData: node.extras }));

  it("Cloudflare Workersの静的アセット上限内に収まる", () => {
    expect(model.bytes).toBeLessThan(25 * 1024 * 1024);
  });

  it("精密な筋肉メッシュを収録する", () => {
    expect(muscleNodes.length).toBeGreaterThan(400);
  });

  it.each(muscleOrder)("%sに対応する実在メッシュがある", (muscle) => {
    expect(muscleNodes.some((node) => modelMuscleIds(node).includes(muscle))).toBe(true);
  });
});

describe("modelMuscleIds", () => {
  it("三角筋後部を三角筋全体と後部の両方へ対応させる", () => {
    expect(
      modelMuscleIds({
        name: "Scapular spinal part of deltoid muscle",
        userData: { name: "Deltoid", nameDetail: "Scapular Spinal Part Of Deltoid Muscle" },
      }),
    ).toEqual(expect.arrayContaining(["deltoid", "posteriorDeltoid"]));
  });

  it("上腕二頭筋と大腿二頭筋を混同しない", () => {
    expect(
      modelMuscleIds({
        name: "Long head of biceps femoris",
        userData: { name: "Biceps Femoris", nameDetail: "Long Head Of Biceps Femoris" },
      }),
    ).not.toContain("biceps");
  });
});
