import { describe, expect, it } from "vitest";
import { calculateChartScale, calculateIntegerTicks } from "./chartScale";

describe("calculateChartScale", () => {
  it("正数だけでも0を含めずデータ範囲に余白を加える", () => {
    expect(calculateChartScale([80, 100], 0.5)).toEqual({ min: 78, max: 102, range: 24 });
  });

  it("負数だけでも0を含めずデータ範囲に余白を加える", () => {
    expect(calculateChartScale([-30, -20], 0.5)).toEqual({ min: -31, max: -19, range: 12 });
  });

  it("正負が混在するデータをすべて含める", () => {
    expect(calculateChartScale([-10, 20], 0.5)).toEqual({ min: -13, max: 23, range: 36 });
  });

  it("単一値には指定された最低余白を加える", () => {
    expect(calculateChartScale([80], 0.5)).toEqual({ min: 79.5, max: 80.5, range: 1 });
  });

  it("差が小さい体重には0.1kgの最低余白を加える", () => {
    const scale = calculateChartScale([60, 60.1], 0.1);

    expect(scale.min).toBeCloseTo(59.9);
    expect(scale.max).toBeCloseTo(60.2);
    expect(scale.range).toBeCloseTo(0.3);
  });

  it("狭い範囲にも整数の目盛りを1つ以上含める", () => {
    const scale = calculateChartScale([60.4], 0.1);

    expect(Math.ceil(scale.min)).toBeLessThanOrEqual(Math.floor(scale.max));
    expect(scale.min).toBeLessThanOrEqual(60.4);
    expect(scale.max).toBeGreaterThanOrEqual(60.4);
  });

  it("空配列には安全な既定範囲を返す", () => {
    expect(calculateChartScale([], 0.5)).toEqual({ min: 0, max: 1, range: 1 });
  });
});

describe("calculateIntegerTicks", () => {
  it("縦軸の範囲から整数の目盛りだけを返す", () => {
    expect(calculateIntegerTicks(59.9, 63.2)).toEqual([63, 62, 61, 60]);
  });

  it("広い範囲でも目盛り数を上限以内に収める", () => {
    expect(calculateIntegerTicks(78, 102)).toEqual([102, 94, 86, 78]);
  });

  it("範囲内に整数がない場合は空配列を返す", () => {
    expect(calculateIntegerTicks(60.2, 60.8)).toEqual([]);
  });
});
