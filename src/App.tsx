import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Dumbbell,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Timer as TimerIcon,
  Trash2,
  UserRound,
  Weight,
  X,
} from "lucide-react";
import { api, del, patch, post } from "./api";
import { monthLabel, shiftDay, shiftMonth, toLocalDate } from "./date";
import { isDraftComplete, toDraftValue } from "./draft";
import type { Draft, Exercise, StatPoint, User, WorkoutRecord } from "./types";

type Tab = "record" | "charts" | "admin";
type Notice = { message: string; kind: "success" | "error" } | null;

const defaultDraft: Draft = { weightKg: 0, reps: 10, sets: 3, distanceKm: 0, durationMinutes: 30 };

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [tab, setTab] = useState<Tab>("record");
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerStatus, setTimerStatus] = useState({ running: false, elapsed: 0 });
  const [date, setDate] = useState(toLocalDate());
  const [notice, setNotice] = useState<Notice>(null);

  const loadExercises = useCallback(async () => {
    const data = await api<{ exercises: Exercise[] }>("/api/exercises");
    setExercises(data.exercises);
  }, []);

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then(({ user: found }) => setUser(found))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) loadExercises().catch((error) => setNotice({ message: error.message, kind: "error" }));
  }, [user, loadExercises]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (user === undefined) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">
          <Dumbbell />
        </div>
        <p>筋トレログを準備中…</p>
      </main>
    );
  }
  if (!user) return <AuthScreen onLogin={setUser} />;

  const navItems: { id: Tab; label: string; icon: typeof Dumbbell }[] = [
    { id: "record", label: "記録", icon: Dumbbell },
    { id: "charts", label: "推移", icon: BarChart3 },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab("record")} aria-label="記録画面へ">
          <span className="brand-mark">
            <Dumbbell />
          </span>
          <span>
            <b>筋トレログ</b>
          </span>
        </button>
        <div className="account">
          {user.isAdmin ? (
            <button
              className={`icon-button ${tab === "admin" ? "selected-icon" : ""}`}
              aria-label="種目管理"
              onClick={() => setTab("admin")}
            >
              <Settings size={18} />
            </button>
          ) : null}
          <span>
            <UserRound size={16} />
            {user.accountName}
          </span>
          <button
            className="icon-button"
            aria-label="ログアウト"
            onClick={async () => {
              await post("/api/auth/logout");
              setUser(null);
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="page">
        {tab === "record" && (
          <RecordPage date={date} setDate={setDate} exercises={exercises} notify={setNotice} />
        )}
        {tab === "charts" && <ChartsPage exercises={exercises} notify={setNotice} />}
        {tab === "admin" && user.isAdmin ? (
          <AdminPage exercises={exercises} reload={loadExercises} notify={setNotice} />
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="メインメニュー">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {(tab === "record" || tab === "charts") && (
        <button
          className={`timer-fab ${timerStatus.running ? "running" : ""}`}
          onClick={() => setTimerOpen(true)}
          aria-label={
            timerStatus.running
              ? `タイマー動作中、経過${Math.floor(timerStatus.elapsed / 60)}分${timerStatus.elapsed % 60}秒`
              : "タイマーを開く"
          }
        >
          <TimerIcon />
          <span>
            {timerStatus.running
              ? `${String(Math.floor(timerStatus.elapsed / 60)).padStart(2, "0")}:${String(
                  timerStatus.elapsed % 60,
                ).padStart(2, "0")}`
              : "タイマー"}
          </span>
        </button>
      )}
      <TimerModal
        open={timerOpen}
        notify={setNotice}
        onClose={() => setTimerOpen(false)}
        onStateChange={setTimerStatus}
      />
      {notice && (
        <div className={`toast ${notice.kind}`} role="status">
          {notice.message}
        </div>
      )}
    </div>
  );
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await post("/api/auth/register", { accountName, password });
        setMode("login");
        setPassword("");
      } else {
        const result = await post<{ user: User }>("/api/auth/login", { accountName, password });
        onLogin(result.user);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark">
            <Dumbbell />
          </span>
          <b>筋トレログ</b>
        </div>
        <div className="segmented">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            ログイン
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            新規登録
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            アカウント名
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary wide" disabled={busy}>
            {busy ? "送信中…" : mode === "login" ? "ログイン" : "アカウントを作成"}
          </button>
        </form>
      </section>
    </main>
  );
}

function RecordPage({
  date,
  setDate,
  exercises,
  notify,
}: {
  date: string;
  setDate: (date: string) => void;
  exercises: Exercise[];
  notify: (notice: Notice) => void;
}) {
  const [records, setRecords] = useState<Map<number, WorkoutRecord>>(new Map());
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [bodyWeight, setBodyWeight] = useState("");
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ records: WorkoutRecord[]; bodyWeight: number | null }>(
      `/api/records?date=${date}`,
    );
    const map = new Map(data.records.map((record) => [record.exerciseId, record]));
    setRecords(map);
    setBodyWeight(data.bodyWeight === null ? "" : String(data.bodyWeight));
    const next: Record<number, Draft> = {};
    exercises.forEach((exercise) => {
      const stored = localStorage.getItem(`kintore-default-${exercise.id}`);
      const saved = stored ? { ...defaultDraft, ...JSON.parse(stored) } : defaultDraft;
      const record = map.get(exercise.id);
      next[exercise.id] = record
        ? {
            weightKg: record.weightKg ?? 0,
            reps: record.reps ?? 10,
            sets: record.sets ?? 3,
            distanceKm: record.distanceKm ?? 0,
            durationMinutes: record.durationMinutes ?? 30,
          }
        : { ...saved };
    });
    setDrafts(next);
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

  const saveRecord = async (exercise: Exercise) => {
    const draft = drafts[exercise.id] || defaultDraft;
    if (!isDraftComplete(draft, exercise.kind)) return;

    const values = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)]));
    const isUpdate = records.has(exercise.id);
    setBusyId(exercise.id);
    try {
      await post("/api/records", { exerciseId: exercise.id, date, ...values });
      localStorage.setItem(`kintore-default-${exercise.id}`, JSON.stringify(values));
      await load();
      notify({ message: `${exercise.name}を${isUpdate ? "更新" : "記録"}しました`, kind: "success" });
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "保存できませんでした", kind: "error" });
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
          const draftComplete = isDraftComplete(draft, exercise.kind);
          return (
            <article className={`exercise-row ${record ? "saved" : ""}`} key={exercise.id}>
              <div className="exercise-main">
                <div className="exercise-title">
                  <h2>{exercise.name}</h2>
                  {record && <span>記録済み</span>}
                </div>
                <div className="metrics">
                  {exercise.kind === "strength" ? (
                    <>
                      <Metric
                        label="重量"
                        unit="kg"
                        value={draft.weightKg}
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
                  disabled={busyId === exercise.id || !draftComplete}
                  onClick={() => saveRecord(exercise)}
                  aria-label={
                    busyId === exercise.id
                      ? `${exercise.name}を保存中`
                      : `${exercise.name}を${record ? "更新" : "記録"}`
                  }
                  title={record ? "更新" : "記録"}
                >
                  {record ? <RefreshCw size={17} /> : <Plus size={18} />}
                </button>
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
        <button className="primary" disabled={busyId === "weight"} onClick={saveBodyWeight}>
          <Save size={17} />
          保存
        </button>
      </article>
    </section>
  );
}

function Metric({
  label,
  unit,
  value,
  step,
  invalid,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | "";
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
          min="0"
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

function CalendarPage({
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

function ChartsPage({ exercises, notify }: { exercises: Exercise[]; notify: (notice: Notice) => void }) {
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
          <LineChart points={bodyWeights} values={weightValues} unit="kg" color="#ff815d" />
        </article>
      </div>
    </section>
  );
}

function LineChart({
  points,
  values,
  unit,
  color,
}: {
  points: StatPoint[];
  values: number[];
  unit: string;
  color: string;
}) {
  if (!points.length)
    return (
      <div className="chart-empty">
        <BarChart3 />
        <p>記録が増えるとグラフが表示されます</p>
      </div>
    );
  const width = 620,
    height = 240,
    padX = 34,
    padY = 28;
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const coords = values.map((value, index) => ({
    x: padX + (index / Math.max(values.length - 1, 1)) * (width - padX * 2),
    y: height - padY - ((value - min) / range) * (height - padY * 2),
  }));
  return (
    <div className="chart-wrap">
      <div className="chart-summary">
        <b>
          {values.at(-1)}
          <small>{unit}</small>
        </b>
        <span>{points.at(-1)?.date}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`推移グラフ。最新値${values.at(-1)}${unit}`}
      >
        {[0, 1, 2, 3].map((line) => (
          <line
            key={line}
            x1={padX}
            x2={width - padX}
            y1={padY + line * 58}
            y2={padY + line * 58}
            className="grid-line"
          />
        ))}
        <polyline
          points={coords.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((point, index) => (
          <circle
            key={points[index].date}
            cx={point.x}
            cy={point.y}
            r="5"
            fill="#101613"
            stroke={color}
            strokeWidth="3"
          >
            <title>
              {points[index].date}: {values[index]}
              {unit}
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis">
        <span>{points[0].date}</span>
        <span>{points.at(-1)?.date}</span>
      </div>
    </div>
  );
}

function TimerModal({
  open,
  notify,
  onClose,
  onStateChange,
}: {
  open: boolean;
  notify: (notice: Notice) => void;
  onClose: () => void;
  onStateChange: (state: { running: boolean; elapsed: number }) => void;
}) {
  const [duration, setDuration] = useState<3 | 10 | null>(3);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAtRef = useRef(0);
  const elapsedAtStartRef = useRef(0);
  const nextAlarmRef = useRef(60);
  const audioContextRef = useRef<AudioContext | null>(null);

  const beep = useCallback(() => {
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    const play = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.24, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.5);
    };

    if (context.state === "suspended") {
      void context
        .resume()
        .then(play)
        .catch(() => undefined);
    } else {
      play();
    }
  }, []);

  useEffect(
    () => () => {
      void audioContextRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (!running) return;
    const update = () => {
      const measured = elapsedAtStartRef.current + Math.floor((Date.now() - startedAtRef.current) / 1000);
      const limit = duration === null ? Number.POSITIVE_INFINITY : duration * 60;
      const next = Math.min(measured, limit);
      setElapsed(next);

      if (next >= limit) {
        setRunning(false);
        beep();
        notify({ message: "タイマーが終了しました", kind: "success" });
      } else if (next >= nextAlarmRef.current) {
        nextAlarmRef.current = (Math.floor(next / 60) + 1) * 60;
        beep();
      }
    };
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [running, beep, notify, duration]);

  useEffect(() => {
    onStateChange({ running, elapsed });
  }, [running, elapsed, onStateChange]);

  const start = () => {
    const limit = duration === null ? Number.POSITIVE_INFINITY : duration * 60;
    const startFrom = elapsed >= limit ? 0 : elapsed;
    if (startFrom !== elapsed) setElapsed(0);
    elapsedAtStartRef.current = startFrom;
    startedAtRef.current = Date.now();
    nextAlarmRef.current = (Math.floor(startFrom / 60) + 1) * 60;
    // iOS Safari requires audio to be created/resumed directly from a user gesture.
    beep();
    setRunning(true);
  };
  const pause = () => {
    const measured = elapsedAtStartRef.current + Math.floor((Date.now() - startedAtRef.current) / 1000);
    const limit = duration === null ? Number.POSITIVE_INFINITY : duration * 60;
    setElapsed(Math.min(measured, limit));
    setRunning(false);
  };
  const reset = () => {
    setRunning(false);
    setElapsed(0);
  };
  const selectDuration = (value: 3 | 10 | null) => {
    setDuration(value);
    setElapsed(0);
  };
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0"),
    ss = String(elapsed % 60).padStart(2, "0");
  const progress = duration === null ? (elapsed % 60) / 60 : elapsed / (duration * 60);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="panel timer-card" role="dialog" aria-modal="true" aria-labelledby="timer-title">
        <div className="modal-title">
          <div>
            <h2 id="timer-title">インターバルタイマー</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="閉じる">
            <X />
          </button>
        </div>
        <div className="timer-ring" style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}>
          <div>
            <b>
              {mm}:{ss}
            </b>
            <span>1分ごとにサウンド</span>
          </div>
        </div>
        <div className="timer-presets">
          {([3, 10, null] as const).map((value) => (
            <button
              key={value ?? "unlimited"}
              className={duration === value ? "active" : ""}
              onClick={() => selectDuration(value)}
              disabled={running}
            >
              {value === null ? "無制限" : `${value}分`}
            </button>
          ))}
        </div>
        <div className="timer-actions">
          <button className="primary big" onClick={running ? pause : start}>
            {running ? <Pause /> : <Play />}
            {running ? "一時停止" : "スタート"}
          </button>
          <button className="secondary big" onClick={reset}>
            <RotateCcw />
            リセット
          </button>
        </div>
        <p className="timer-note">
          画面を閉じたり端末をロックした場合、OSの制限により音が鳴らないことがあります。
        </p>
      </article>
    </div>
  );
}

function AdminPage({
  exercises,
  reload,
  notify,
}: {
  exercises: Exercise[];
  reload: () => Promise<void>;
  notify: (notice: Notice) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"strength" | "cardio">("strength");
  const [editing, setEditing] = useState<number | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await post("/api/exercises", { name, kind });
      setName("");
      await reload();
      notify({ message: "種目を追加しました", kind: "success" });
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "追加できませんでした", kind: "error" });
    }
  };
  const update = async (exercise: Exercise, changes: Partial<Exercise> = {}) => {
    try {
      await patch(`/api/exercises/${exercise.id}`, { ...exercise, ...changes });
      await reload();
      setEditing(null);
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "更新できませんでした", kind: "error" });
    }
  };
  const move = async (index: number, direction: -1 | 1) => {
    const other = exercises[index + direction];
    if (!other) return;
    await Promise.all([
      update(exercises[index], { sortOrder: other.sortOrder }),
      update(other, { sortOrder: exercises[index].sortOrder }),
    ]);
    notify({ message: "並び順を変更しました", kind: "success" });
  };
  const remove = async (exercise: Exercise) => {
    if (!window.confirm(`${exercise.name}を削除しますか？`)) return;
    try {
      await del(`/api/exercises/${exercise.id}`);
      await reload();
      notify({ message: "種目を削除しました", kind: "success" });
    } catch (e) {
      notify({ message: e instanceof Error ? e.message : "削除できませんでした", kind: "error" });
    }
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>種目の管理</h1>
        </div>
      </div>
      <div className="admin-layout">
        <form className="panel add-form" onSubmit={add}>
          <h2>
            <Plus />
            新しい種目
          </h2>
          <label>
            種目名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：ベンチプレス"
              required
            />
          </label>
          <label>
            種類
            <select value={kind} onChange={(e) => setKind(e.target.value as "strength" | "cardio")}>
              <option value="strength">筋力トレーニング</option>
              <option value="cardio">有酸素運動</option>
            </select>
          </label>
          <button className="primary">
            <Plus size={18} />
            追加する
          </button>
        </form>
        <article className="panel admin-list">
          <div className="admin-list-head">
            <h2>登録済みの種目</h2>
          </div>
          <ol>
            {exercises.map((exercise, index) => (
              <li key={exercise.id}>
                <span className="drag-index">{String(index + 1).padStart(2, "0")}</span>
                {editing === exercise.id ? (
                  <EditExercise exercise={exercise} onSave={update} onCancel={() => setEditing(null)} />
                ) : (
                  <>
                    <div className="admin-name">
                      <b>{exercise.name}</b>
                      <small>{exercise.kind === "strength" ? "筋力" : "有酸素"}</small>
                    </div>
                    <div className="order-buttons">
                      <button
                        className="icon-button"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        className="icon-button"
                        disabled={index === exercises.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                    </div>
                    <button className="icon-button" onClick={() => setEditing(exercise.id)} aria-label="編集">
                      <Pencil size={17} />
                    </button>
                    <button className="icon-button danger" onClick={() => remove(exercise)} aria-label="削除">
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}

function EditExercise({
  exercise,
  onSave,
  onCancel,
}: {
  exercise: Exercise;
  onSave: (exercise: Exercise, changes: Partial<Exercise>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(exercise.name);
  const [kind, setKind] = useState(exercise.kind);
  return (
    <div className="inline-edit">
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <select value={kind} onChange={(e) => setKind(e.target.value as Exercise["kind"])}>
        <option value="strength">筋力</option>
        <option value="cardio">有酸素</option>
      </select>
      <button className="primary small" onClick={() => onSave(exercise, { name, kind })}>
        保存
      </button>
      <button className="secondary small" onClick={onCancel}>
        取消
      </button>
    </div>
  );
}

export default App;
