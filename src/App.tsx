import { useCallback, useEffect, useState } from "react";
import { BarChart3, Dumbbell, LogOut, Settings, Timer as TimerIcon, UserRound } from "lucide-react";
import AdminPage from "./AdminPage";
import { api, post } from "./api";
import AuthScreen from "./AuthScreen";
import ChartsPage from "./ChartsPage";
import RecordPage from "./RecordPage";
import TimerModal from "./TimerModal";
import { toLocalDate } from "./date";
import type { Exercise, Notice, User } from "./types";

type Tab = "record" | "charts" | "admin";

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

  const updateExerciseReadiness = useCallback((exerciseId: number, ready: boolean) => {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId ? { ...exercise, readyForWeightIncrease: ready } : exercise,
      ),
    );
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
          <span className="account-name">
            <UserRound size={16} />
            <span title={user.accountName}>{user.accountName}</span>
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
          <RecordPage
            date={date}
            setDate={setDate}
            exercises={exercises}
            onExerciseReadinessChange={updateExerciseReadiness}
            notify={setNotice}
          />
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

export default App;
