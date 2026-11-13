import { useEffect, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { api, del, post } from "./api";
import {
  bodyMetrics,
  isValidBodyValue,
  type BodyCompositionDay,
  type WritableBodyMetric,
} from "./bodyComposition";
import { shiftDay } from "./date";
import MetricInput from "./MetricInput";
import type { Notice } from "./types";

export default function BodyCompositionPage({
  date,
  setDate,
  notify,
}: {
  date: string;
  setDate: (date: string) => void;
  notify: (notice: Notice) => void;
}) {
  const [day, setDay] = useState<BodyCompositionDay>({ values: {}, latestValues: {}, bmi: null });
  const [drafts, setDrafts] = useState<Partial<Record<WritableBodyMetric, string>>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    api<BodyCompositionDay>(`/api/body-composition?date=${date}`)
      .then((data) => {
        if (!active) return;
        setDay(data);
        setDrafts(
          Object.fromEntries(
            Object.entries({ ...data.latestValues, ...data.values }).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        );
        setStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        setStatus("error");
        notify({ message: error.message, kind: "error" });
      });
    return () => {
      active = false;
    };
  }, [date, notify, retry]);

  const save = async (metric: WritableBodyMetric, remove = false) => {
    if (busy || status !== "ready") return;
    const text = drafts[metric] ?? "";
    if (!remove && !isValidBodyValue(metric, text)) return;
    setBusy(true);
    try {
      if (remove) await del(`/api/body-composition?date=${date}&metric=${metric}`);
      else await post("/api/body-composition", { date, metric, value: Number(text) });
      // Keep other unsaved fields while refreshing the server-calculated BMI.
      const data = await api<BodyCompositionDay>(`/api/body-composition?date=${date}`);
      setDay(data);
      setDrafts((current) => ({
        ...current,
        [metric]: String(data.values[metric] ?? data.latestValues[metric] ?? ""),
      }));
      const label = bodyMetrics.find((item) => item.id === metric)?.label;
      notify({ message: `${label}を${remove ? "削除" : "保存"}しました`, kind: "success" });
    } catch (error) {
      setStatus("error");
      notify({
        message: error instanceof Error ? error.message : "保存できませんでした。再読み込みしてください",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="体組成の記録">
      <div className="record-toolbar">
        <div className="date-navigator">
          <button
            className="icon-button"
            disabled={busy}
            onClick={() => setDate(shiftDay(date, -1))}
            aria-label="前の日"
          >
            <ChevronLeft />
          </button>
          <label className="date-picker">
            <CalendarDays size={18} />
            <input
              type="date"
              aria-label="記録日"
              value={date}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          </label>
          <button
            className="icon-button"
            disabled={busy}
            onClick={() => setDate(shiftDay(date, 1))}
            aria-label="次の日"
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      {status === "loading" && (
        <p className="body-status" role="status">
          体組成の記録を読み込み中…
        </p>
      )}
      {status === "error" && (
        <div className="body-status" role="alert">
          記録を取得・保存できませんでした。
          <button className="secondary" onClick={() => setRetry((value) => value + 1)}>
            再読み込み
          </button>
        </div>
      )}
      <div className="exercise-list">
        {bodyMetrics.map((metric) => {
          if (metric.id === "bmi")
            return (
              <article className="exercise-row body-bmi-row" key={metric.id}>
                <div className="exercise-main">
                  <div>
                    <div className="exercise-title">
                      <h2>BMI</h2>
                      <span>自動計算</span>
                    </div>
                  </div>
                  <div className="metrics body-composition-metrics">
                    <div className="metric">
                      <span>計算結果</span>
                      <div>
                        <output className="body-bmi" aria-label="BMI">
                          {status === "ready" && day.bmi !== null ? day.bmi.toFixed(1) : "—"}
                        </output>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          const id = metric.id;
          const text = drafts[id] ?? "";
          const recorded = day.values[id] !== undefined;
          const valid = isValidBodyValue(id, text);
          return (
            <form
              className={`exercise-row ${recorded ? "saved" : ""}`}
              key={id}
              onSubmit={(event) => {
                event.preventDefault();
                void save(id);
              }}
            >
              <div className="exercise-main">
                <div className="exercise-title">
                  <h2>
                    <label htmlFor={`body-${id}`}>{metric.label}</label>
                  </h2>
                  {recorded && <span>記録済み</span>}
                </div>
                <div className="metrics body-composition-metrics">
                  <MetricInput
                    id={`body-${id}`}
                    ariaLabel={metric.label}
                    label="測定値"
                    unit={metric.unit}
                    value={status === "ready" ? text : ""}
                    min={metric.min}
                    max={"max" in metric ? metric.max : undefined}
                    step="any"
                    placeholder="—"
                    disabled={status !== "ready" || busy}
                    invalid={text !== "" && !valid}
                    onChange={(value) => setDrafts((current) => ({ ...current, [id]: value }))}
                  />
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="primary save-button"
                  type="submit"
                  disabled={
                    status !== "ready" || busy || !valid || (recorded && Number(text) === day.values[id])
                  }
                  aria-label={`${metric.label}を${recorded ? "更新" : "記録"}`}
                  title={recorded ? "更新" : "記録"}
                >
                  <Check size={18} />
                </button>
                {recorded && (
                  <button
                    className="secondary cancel-button"
                    type="button"
                    disabled={status !== "ready" || busy}
                    onClick={() => void save(id, true)}
                    aria-label={`${metric.label}の記録を取り消す`}
                    title="取り消し"
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
            </form>
          );
        })}
      </div>
    </section>
  );
}
