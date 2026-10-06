import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flame,
  Weight,
  X,
} from "lucide-react";
import { api, del, patch, post } from "./api";
import CalendarPage from "./CalendarPage";
import { shiftDay } from "./date";
import { createInitialDraft, defaultDraft, isDraftChanged, isDraftComplete, toDraftValue } from "./draft";
import { getMusclesForExercise, getTrainedMuscles, type MuscleId } from "./muscles";
import type { Draft, Exercise, LatestWeight, Notice, WorkoutRecord } from "./types";

const TrainedMusclesCard = lazy(() =>
  import("./MusclePanels").then((module) => ({ default: module.TrainedMusclesCard })),
);

const ExerciseMusclesModal = lazy(() =>
  import("./MusclePanels").then((module) => ({ default: module.ExerciseMusclesModal })),
);

export default function RecordPage({
  date,
  setDate,
  exercises,
  onExerciseReadinessChange,
  notify,
}: {
  date: string;
  setDate: (date: string) => void;
  exercises: Exercise[];
  onExerciseReadinessChange: (exerciseId: number, ready: boolean) => void;
  notify: (notice: Notice) => void;
}) {
  const [records, setRecords] = useState<Map<number, WorkoutRecord>>(new Map());
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [bodyWeight, setBodyWeight] = useState("");
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [recordsDate, setRecordsDate] = useState<string | null>(null);
  const [recordsStatus, setRecordsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [readinessBusyIds, setReadinessBusyIds] = useState<Set<number>>(() => new Set());
  const [selectedExercise, setSelectedExercise] = useState<{
    name: string;
    muscles: MuscleId[];
  } | null>(null);
  const loadRequestRef = useRef(0);
  const closeExerciseMusclesModal = useCallback(() => setSelectedExercise(null), []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setRecordsStatus("loading");
    setRecordsDate(null);
    try {
      const data = await api<{
        records: WorkoutRecord[];
        bodyWeight: number | null;
        latestWeights: LatestWeight[];
      }>(`/api/records?date=${date}`);
      if (requestId !== loadRequestRef.current) return;
      const map = new Map(data.records.map((record) => [record.exerciseId, record]));
      const latestWeights = new Map(data.latestWeights.map((item) => [item.exerciseId, item.weightKg]));
      setRecords(map);
      setBodyWeight(data.bodyWeight === null ? "" : String(data.bodyWeight));
      const next: Record<number, Draft> = {};
      exercises.forEach((exercise) => {
        const stored = localStorage.getItem(`kintore-default-${exercise.id}`);
        const saved: Partial<Draft> = stored ? JSON.parse(stored) : {};
        delete saved.weightKg;
        const record = map.get(exercise.id);
        next[exercise.id] = createInitialDraft(record, latestWeights.get(exercise.id) ?? 0, saved);
      });
      setDrafts(next);
      setRecordsDate(date);
      setRecordsStatus("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setRecords(new Map());
      setRecordsDate(date);
      setRecordsStatus("error");
      throw error;
    }
  }, [date, exercises]);

  useEffect(() => {
    load().catch((e) => notify({ message: e.message, kind: "error" }));
  }, [load, notify]);

  const changeDraft = (id: number, key: keyof Draft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || defaultDraft), [key]: toDraftValue(value) },
    }));
  };

  const toggleWeightIncreaseReadiness = async (exercise: Exercise) => {
    if (readinessBusyIds.has(exercise.id)) return;
    const previous = exercise.readyForWeightIncrease;
    const next = !previous;
    onExerciseReadinessChange(exercise.id, next);
    setReadinessBusyIds((current) => new Set(current).add(exercise.id));
    try {
      const result = await patch<{ exerciseId: number; readyForWeightIncrease: boolean }>(
        `/api/exercises/${exercise.id}/weight-increase-ready`,
        { ready: next },
      );
      onExerciseReadinessChange(result.exerciseId, result.readyForWeightIncrease);
    } catch (error) {
      onExerciseReadinessChange(exercise.id, previous);
      notify({
        message: error instanceof Error ? error.message : "重量アップ候補を保存できませんでした",
        kind: "error",
      });
    } finally {
      setReadinessBusyIds((current) => {
        const updated = new Set(current);
        updated.delete(exercise.id);
        return updated;
      });
    }
  };

  const saveRecord = async (exercise: Exercise) => {
    const draft = drafts[exercise.id] || defaultDraft;
    if (!isDraftComplete(draft, exercise.kind)) return;

    const currentRecord = records.get(exercise.id);
    if (currentRecord && !isDraftChanged(draft, currentRecord, exercise.kind)) return;

    const values = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)]));
    const isUpdate = currentRecord !== undefined;
    setBusyId(exercise.id);
    try {
      const { record } = await post<{ record: Omit<WorkoutRecord, "name" | "kind"> }>("/api/records", {
        exerciseId: exercise.id,
        kind: exercise.kind,
        date,
        ...values,
      });
      const storedDefaults =
        exercise.kind === "strength"
          ? { reps: values.reps, sets: values.sets }
          : { distanceKm: values.distanceKm, durationMinutes: values.durationMinutes };
      localStorage.setItem(`kintore-default-${exercise.id}`, JSON.stringify(storedDefaults));
      setRecords((current) =>
        new Map(current).set(exercise.id, { ...record, name: exercise.name, kind: exercise.kind }),
      );
      notify({ message: `${exercise.name}を${isUpdate ? "更新" : "記録"}しました`, kind: "success" });
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "保存できませんでした", kind: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const cancelRecord = async (exercise: Exercise, record: WorkoutRecord) => {
    setBusyId(exercise.id);
    try {
      await del(`/api/records/${record.id}`);
      await load();
      notify({ message: `${exercise.name}の記録を取り消しました`, kind: "success" });
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "取り消しできませんでした", kind: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const saveBodyWeight = async () => {
    const value = Number(bodyWeight);
    setBusyId("weight");
    try {
      if (bodyWeight === "") await del(`/api/body-weight?date=${date}`);
      else await post("/api/body-weight", { date, weightKg: value });
      notify({
        message: bodyWeight === "" ? "体重記録を削除しました" : "体重を記録しました",
        kind: "success",
      });
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "保存できませんでした", kind: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const trainedMuscles = useMemo(
    () => (recordsDate === date && recordsStatus === "ready" ? getTrainedMuscles([...records.values()]) : []),
    [date, records, recordsDate, recordsStatus],
  );
  const trainedMusclesStatus = recordsDate === date ? recordsStatus : "loading";

  return (
    <section>
      <div className="record-toolbar">
        <div className="date-navigator">
          <button className="icon-button" onClick={() => setDate(shiftDay(date, -1))} aria-label="前の日">
            <ChevronLeft />
          </button>
          <label className="date-picker">
            <CalendarDays size={18} />
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </label>
          <button className="icon-button" onClick={() => setDate(shiftDay(date, 1))} aria-label="次の日">
            <ChevronRight />
          </button>
        </div>
        <button
          className="calendar-toggle"
          onClick={() => setCalendarOpen((open) => !open)}
          aria-expanded={calendarOpen}
        >
          <CalendarDays size={16} />
          カレンダー
          {calendarOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {calendarOpen && (
        <CalendarPage
          currentDate={date}
          onEdit={(selected) => {
            setDate(selected);
          }}
          notify={notify}
        />
      )}

      <div className="exercise-list">
        {exercises.map((exercise) => {
          const draft = drafts[exercise.id] || defaultDraft;
          const record = records.get(exercise.id);
          const exerciseTargetMuscles =
            exercise.kind === "strength" ? getMusclesForExercise(exercise.name) : [];
          const draftComplete = isDraftComplete(draft, exercise.kind);
          const draftChanged = record ? isDraftChanged(draft, record, exercise.kind) : true;
          return (
            <article className={`exercise-row ${record ? "saved" : ""}`} key={exercise.id}>
              <div className="exercise-main">
                <div className="exercise-title">
                  <h2>
                    {exerciseTargetMuscles.length ? (
                      <button
                        className="exercise-name-button"
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`${exercise.name}で鍛えられる筋肉を見る`}
                        onClick={() =>
                          setSelectedExercise({ name: exercise.name, muscles: exerciseTargetMuscles })
                        }
                      >
                        {exercise.name}
                      </button>
                    ) : (
                      exercise.name
                    )}
                  </h2>
                  {exercise.kind === "strength" && (
                    <button
                      className={`weight-increase-button ${exercise.readyForWeightIncrease ? "active" : ""}`}
                      type="button"
                      disabled={readinessBusyIds.has(exercise.id)}
                      aria-label={
                        exercise.readyForWeightIncrease
                          ? `${exercise.name}を重量アップ候補から外す`
                          : `${exercise.name}を重量アップ候補にする`
                      }
                      aria-pressed={exercise.readyForWeightIncrease}
                      onClick={() => toggleWeightIncreaseReadiness(exercise)}
                    >
                      <Flame size={18} aria-hidden="true" />
                    </button>
                  )}
                  {record && <span>記録済み</span>}
                </div>
                <div className="metrics">
                  {exercise.kind === "strength" ? (
                    <>
                      <Metric
                        label="重量"
                        unit="kg"
                        value={draft.weightKg}
                        min="-1000"
                        step="0.5"
                        invalid={draft.weightKg === ""}
                        onChange={(v) => changeDraft(exercise.id, "weightKg", v)}
                      />
                      <span className="multiply">×</span>
                      <Metric
                        label="回数"
                        unit="回"
                        value={draft.reps}
                        step="1"
                        invalid={draft.reps === ""}
                        onChange={(v) => changeDraft(exercise.id, "reps", v)}
                      />
                      <span className="multiply">×</span>
                      <Metric
                        label="セット"
                        unit="set"
                        value={draft.sets}
                        step="1"
                        invalid={draft.sets === ""}
                        onChange={(v) => changeDraft(exercise.id, "sets", v)}
                      />
                    </>
                  ) : (
                    <>
                      <Metric
                        label="距離"
                        unit="km"
                        value={draft.distanceKm}
                        step="0.1"
                        invalid={draft.distanceKm === ""}
                        onChange={(v) => changeDraft(exercise.id, "distanceKm", v)}
                      />
                      <Metric
                        label="時間"
                        unit="分"
                        value={draft.durationMinutes}
                        step="1"
                        invalid={draft.durationMinutes === ""}
                        onChange={(v) => changeDraft(exercise.id, "durationMinutes", v)}
                      />
                    </>
                  )}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="primary save-button"
                  disabled={busyId === exercise.id || !draftComplete || !draftChanged}
                  onClick={() => saveRecord(exercise)}
                  aria-label={
                    busyId === exercise.id
                      ? `${exercise.name}を保存中`
                      : `${exercise.name}を${record ? "更新" : "記録"}`
                  }
                  title={record ? "更新" : "記録"}
                >
                  <Check size={18} />
                </button>
                {record && (
                  <button
                    className="secondary cancel-button"
                    disabled={busyId === exercise.id}
                    onClick={() => cancelRecord(exercise, record)}
                    aria-label={
                      busyId === exercise.id
                        ? `${exercise.name}の記録を取り消し中`
                        : `${exercise.name}の記録を取り消す`
                    }
                    title="取り消し"
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <article className="weight-card">
        <div className="weight-icon">
          <Weight />
        </div>
        <div>
          <h2>体重</h2>
        </div>
        <label>
          <input
            type="number"
            min="20"
            max="500"
            step="0.1"
            placeholder="--.-"
            value={bodyWeight}
            onChange={(e) => setBodyWeight(e.target.value)}
          />
          <span>kg</span>
        </label>
        <button
          className="primary save-button"
          disabled={busyId === "weight"}
          onClick={saveBodyWeight}
          aria-label="体重を記録"
          title="記録"
        >
          <Check size={18} />
        </button>
      </article>

      <Suspense fallback={<div className="trained-muscles-loading">3D人体図を準備中…</div>}>
        <TrainedMusclesCard muscles={trainedMuscles} status={trainedMusclesStatus} />
      </Suspense>

      {selectedExercise && (
        <Suspense
          fallback={
            <div className="modal-backdrop exercise-muscle-modal-loading" role="status">
              3D人体図を準備中…
            </div>
          }
        >
          <ExerciseMusclesModal
            exerciseName={selectedExercise.name}
            muscles={selectedExercise.muscles}
            onClose={closeExerciseMusclesModal}
          />
        </Suspense>
      )}
    </section>
  );
}

function Metric({
  label,
  unit,
  value,
  min = "0",
  step,
  invalid,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | "";
  min?: string;
  step: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="metric">
      <span>{label}</span>
      <div className={invalid ? "invalid" : ""}>
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          required
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
