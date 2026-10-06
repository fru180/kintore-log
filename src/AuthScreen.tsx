import { type FormEvent, useState } from "react";
import { Dumbbell } from "lucide-react";
import { post } from "./api";
import type { User } from "./types";

export default function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
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
