export type ChartScale = {
  min: number;
  max: number;
  range: number;
};

export function calculateChartScale(values: number[], minimumPadding: number): ChartScale {
  if (!values.length) return { min: 0, max: 1, range: 1 };

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.1, minimumPadding);
  const min = rawMin - padding;
  const max = rawMax + padding;

  return { min, max, range: max - min };
}
