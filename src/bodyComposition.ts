export const bodyMetrics = [
  { id: "weightKg", label: "体重", unit: "kg", min: 20, max: 500 },
  { id: "heightCm", label: "身長", unit: "cm", min: 0 },
  { id: "bmi", label: "BMI", unit: "" },
  { id: "bodyFatPercent", label: "体脂肪率", unit: "%", min: 0, max: 100 },
  { id: "muscleMassKg", label: "筋肉量", unit: "kg", min: 0 },
  { id: "visceralFatLevel", label: "内臓脂肪レベル", unit: "レベル", min: 0 },
  { id: "basalMetabolismKcal", label: "基礎代謝量", unit: "kcal/日", min: 0 },
] as const;

export type BodyMetric = (typeof bodyMetrics)[number]["id"];
export type WritableBodyMetric = Exclude<BodyMetric, "bmi">;
export type BodyCompositionDay = {
  values: Partial<Record<WritableBodyMetric, number>>;
  latestValues: Partial<Record<WritableBodyMetric, number>>;
  bmi: number | null;
};
export type BodyCompositionPoint = { date: string; value: number };

export function isValidBodyValue(metric: WritableBodyMetric, text: string): boolean {
  if (!text.trim()) return false;
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  if (metric === "weightKg") return value >= 20 && value <= 500;
  if (metric === "bodyFatPercent") return value >= 0 && value <= 100;
  return value > 0;
}
