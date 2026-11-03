import { useCallback, useEffect, useState } from "react";
import { api, oauthMutation } from "./api";
import type { Notice } from "./types";

type Connection = { id: string; name: string; scope: string; createdAt: number; expiresAt: number };
const dateLabel = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("ja-JP");

export default function ConnectionsPage({ notify }: { notify: (notice: Notice) => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const data = await api<{ connections: Connection[] }>("/api/oauth/connections");
    setConnections(data.connections);
  }, []);
  useEffect(() => {
    reload()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  async function disconnect(connection: Connection) {
    if (!window.confirm(`${connection.name}との連携を解除しますか？この連携から記録を取得できなくなります。`))
      return;
    setBusy(true);
    setError("");
    try {
      await oauthMutation(`/api/oauth/connections/${connection.id}`, "DELETE");
      await reload();
      notify({ message: "連携を解除しました", kind: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel oauth-panel">
      <h1>外部連携</h1>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="oauth-status">読み込み中…</p>
      ) : !error && connections.length === 0 ? (
        <p className="oauth-status">現在、連携中のアプリはありません。</p>
      ) : (
        <ul className="oauth-items">
          {connections.map((connection) => (
            <li key={connection.id}>
              <div>
                <h2>{connection.name}</h2>
                <p>筋トレ・有酸素の記録、体重、種目一覧と重量アップ候補設定の読み取り</p>
                <p>有効期限：{dateLabel(connection.expiresAt)}</p>
              </div>
              <button className="secondary danger" disabled={busy} onClick={() => disconnect(connection)}>
                連携を解除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
