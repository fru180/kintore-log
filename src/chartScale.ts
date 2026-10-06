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
  let min = rawMin - padding;
  let max = rawMax + padding;

  if (Math.ceil(min) > Math.floor(max)) {
    const nearestInteger = Math.round((min + max) / 2);
    min = Math.min(min, nearestInteger);
    max = Math.max(max, nearestInteger);
  }

  return { min, max, range: max - min };
}

export function calculateIntegerTicks(min: number, max: number, maximumTickCount = 4): number[] {
  const firstTick = Math.ceil(min);
  const lastTick = Math.floor(max);
  if (firstTick > lastTick || maximumTickCount < 1) return [];
  if (maximumTickCount === 1) return [lastTick];

  const step = Math.max(1, Math.ceil((lastTick - firstTick) / (maximumTickCount - 1)));
  const ticks: number[] = [];

  for (let tick = lastTick; tick >= firstTick; tick -= step) ticks.push(tick);

  return ticks;
}
