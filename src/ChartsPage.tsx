import { useEffect, useState } from "react";
import { BarChart3, Dumbbell, Weight } from "lucide-react";
import { api } from "./api";
import { calculateChartScale, calculateIntegerTicks } from "./chartScale";
import { datePosition, daysBetween, shiftDay, toLocalDate } from "./date";
import type { Exercise, Notice, StatPoint } from "./types";

export default function ChartsPage({
  exercises,
  notify,
}: {
  exercises: Exercise[];
  notify: (notice: Notice) => void;
}) {
  const [exerciseId, setExerciseId] = useState(0);
  const [exerciseStats, setExerciseStats] = useState<StatPoint[]>([]);
  const [bodyWeights, setBodyWeights] = useState<StatPoint[]>([]);
  const selectedExercise = exercises.find((exercise) => exercise.id === exerciseId);
  const periodEnd = toLocalDate();
  const periodStart = shiftDay(periodEnd, -89);

  useEffect(() => {
    if (!exerciseId && exercises.length) setExerciseId(exercises[0].id);
  }, [exerciseId, exercises]);
  useEffect(() => {
    if (!exerciseId) return;
    api<{ exercise: StatPoint[]; bodyWeights: StatPoint[] }>(
      `/api/stats?exerciseId=${exerciseId}&from=${periodStart}&to=${periodEnd}`,
    )
      .then((data) => {
        setExerciseStats(data.exercise);
        setBodyWeights(data.bodyWeights);
      })
      .catch((e) => notify({ message: e.message, kind: "error" }));
  }, [exerciseId, notify, periodStart, periodEnd]);

  const exerciseValues = exerciseStats.map((point) =>
    selectedExercise?.kind === "cardio" ? point.distanceKm || 0 : point.weightKg || 0,
  );
  const weightValues = bodyWeights.map((point) => point.weightKg || 0);
  return (
    <section>
      <div className="chart-grid">
        <article className="panel chart-card">
          <div className="chart-title">
            <div>
              <span className="chart-icon">
                <Dumbbell />
              </span>
              <div>
                <h2>種目別の推移</h2>
              </div>
            </div>
            <select value={exerciseId} onChange={(e) => setExerciseId(Number(e.target.value))}>
              {exercises.map((exercise) => (
                <option value={exercise.id} key={exercise.id}>
                  {exercise.name}
                </option>
              ))}
            </select>
          </div>
          <LineChart
            points={exerciseStats}
            values={exerciseValues}
            unit={selectedExercise?.kind === "cardio" ? "km" : "kg"}
            minimumPadding={selectedExercise?.kind === "cardio" ? 0.1 : 0.5}
            color="#d7ff45"
          />
        </article>
        <article className="panel chart-card">
          <div className="chart-title">
            <div>
              <span className="chart-icon orange">
                <Weight />
              </span>
              <div>
                <h2>体重の推移</h2>
              </div>
            </div>
          </div>
          <LineChart
            points={bodyWeights}
            values={weightValues}
            unit="kg"
            minimumPadding={0.1}
            color="#ff815d"
          />
        </article>
      </div>
    </section>
  );
}

function LineChart({
  points,
  values,
  unit,
  minimumPadding,
  color,
}: {
  points: StatPoint[];
  values: number[];
  unit: string;
  minimumPadding: number;
  color: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  if (!points.length)
    return (
      <div className="chart-empty">
        <BarChart3 />
        <p>記録が増えるとグラフが表示されます</p>
      </div>
    );
  const width = 620,
    height = 240,
    padLeft = 32,
    padRight = 4,
    padY = 28;
  const { min, max, range } = calculateChartScale(values, minimumPadding);
  const yTicks = calculateIntegerTicks(min, max);
  const selectedIndex = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
  const activeIndex = hoveredIndex ?? (selectedIndex >= 0 ? selectedIndex : null);
  const formatValue = (value: number) => Number(value.toFixed(1)).toString();
  const firstDate = points[0].date;
  const lastDate = points.at(-1)?.date ?? firstDate;
  const coords = values.map((value, index) => ({
    x: padLeft + datePosition(points[index].date, firstDate, lastDate) * (width - padLeft - padRight),
    y: height - padY - ((value - min) / range) * (height - padY * 2),
  }));
  const chartDayRange = daysBetween(firstDate, lastDate);
  const axisLabelCount = Math.min(4, chartDayRange + 1);
  const axisLabels = Array.from({ length: axisLabelCount }, (_, index) => {
    const dayOffset = axisLabelCount === 1 ? 0 : Math.round((index * chartDayRange) / (axisLabelCount - 1));
    const date = shiftDay(firstDate, dayOffset);
    const x = padLeft + datePosition(date, firstDate, lastDate) * (width - padLeft - padRight);
    return { date, x };
  });
  return (
    <div className="chart-wrap">
      <div className="chart-summary">
        <b>
          {values.at(-1)}
          <small>{unit}</small>
        </b>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`推移グラフ。最新値${values.at(-1)}${unit}`}
        onClick={() => setSelectedDate(null)}
      >
        {yTicks.map((value) => {
          const y = height - padY - ((value - min) / range) * (height - padY * 2);
          return (
            <g key={value}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} className="grid-line" />
              <text x={padLeft - 8} y={y} className="chart-y-label">
                {value}
              </text>
            </g>
          );
        })}
        <polyline
          points={coords.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((point, index) => (
          <g
            key={points[index].date}
            className="chart-point"
            role="button"
            tabIndex={0}
            aria-label={`${points[index].date}: ${values[index]}${unit}`}
            onPointerEnter={() => setHoveredIndex(index)}
            onPointerLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedDate((current) => (current === points[index].date ? null : points[index].date));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setSelectedDate((current) => (current === points[index].date ? null : points[index].date));
            }}
          >
            <circle cx={point.x} cy={point.y} r="14" className="chart-point-hitbox" />
            <circle
              cx={point.x}
              cy={point.y}
              r={activeIndex === index ? "7" : "5"}
              fill="#101613"
              stroke={color}
              strokeWidth="3"
            />
          </g>
        ))}
        {activeIndex !== null ? (
          <ChartTooltip
            point={coords[activeIndex]}
            date={points[activeIndex].date}
            value={`${formatValue(values[activeIndex])}${unit}`}
            width={width}
            color={color}
          />
        ) : null}
      </svg>
      <div className="chart-axis">
        {axisLabels.map(({ date, x }) => (
          <span key={date} style={{ left: `${(x / width) * 100}%` }}>
            {date.slice(5).replace("-", "/")}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChartTooltip({
  point,
  date,
  value,
  width,
  color,
}: {
  point: { x: number; y: number };
  date: string;
  value: string;
  width: number;
  color: string;
}) {
  const tooltipWidth = 108;
  const tooltipHeight = 43;
  const x = Math.min(Math.max(point.x - tooltipWidth / 2, 4), width - tooltipWidth - 4);
  const y = point.y > tooltipHeight + 12 ? point.y - tooltipHeight - 10 : point.y + 12;
  return (
    <g className="chart-tooltip" aria-hidden="true">
      <rect x={x} y={y} width={tooltipWidth} height={tooltipHeight} rx="7" />
      <text x={x + tooltipWidth / 2} y={y + 17} className="chart-tooltip-value" fill={color}>
        {value}
      </text>
      <text x={x + tooltipWidth / 2} y={y + 33} className="chart-tooltip-date">
        {date.slice(5).replace("-", "/")}
      </text>
    </g>
  );
}
