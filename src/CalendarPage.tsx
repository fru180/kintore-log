import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api";
import { monthLabel, shiftMonth } from "./date";
import type { Notice } from "./types";

export default function CalendarPage({
  currentDate,
  onEdit,
  notify,
}: {
  currentDate: string;
  onEdit: (date: string) => void;
  notify: (notice: Notice) => void;
}) {
  const [month, setMonth] = useState(currentDate.slice(0, 7));
  const [days, setDays] = useState<Record<string, number>>({});

  useEffect(() => {
    setMonth(currentDate.slice(0, 7));
  }, [currentDate]);

  useEffect(() => {
    api<{ days: { date: string; count: number }[] }>(`/api/calendar?month=${month}`)
      .then((data) => setDays(Object.fromEntries(data.days.map((day) => [day.date, day.count]))))
      .catch((e) => notify({ message: e.message, kind: "error" }));
  }, [month, notify]);
  const cells = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return [...Array(first.getDay()).fill(null), ...Array.from({ length: lastDay }, (_, i) => i + 1)];
  }, [month]);

  return (
    <section className="inline-calendar">
      <div className="calendar-layout">
        <article className="panel calendar-panel">
          <div className="month-nav">
            <button className="icon-button" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft />
            </button>
            <h2>{monthLabel(month)}</h2>
            <button className="icon-button" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight />
            </button>
          </div>
          <div className="weekdays">
            {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const date = `${month}-${String(day).padStart(2, "0")}`;
              return (
                <button
                  key={date}
                  className={`${days[date] ? "worked" : ""} ${currentDate === date ? "selected" : ""}`}
                  onClick={() => onEdit(date)}
                >
                  <b>{day}</b>
                  {days[date] ? <i>{days[date]}</i> : null}
                </button>
              );
            })}
          </div>
          <div className="calendar-legend">
            <span>
              <i className="legend-dot" />
              トレーニング実施日
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}
