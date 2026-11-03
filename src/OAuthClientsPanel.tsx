import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { api, oauthMutation } from "./api";
import type { Notice } from "./types";

type Client = {
  clientId: string;
  name: string;
  authMethod: "none" | "client_secret_basic";
  redirectUris: string[];
  disabledAt: number | null;
};

const authMethodLabel = (method: Client["authMethod"]) =>
  method === "none" ? "公開クライアント（PKCE）" : "シークレットあり（Basic認証 + PKCE）";

export default function OAuthClientsPanel({ notify }: { notify: (notice: Notice) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [redirectUris, setRedirectUris] = useState("");
  const [authMethod, setAuthMethod] = useState<Client["authMethod"]>("none");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<{ clientId: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const reload = useCallback(async () => {
    const data = await api<{ clients: Client[] }>("/api/admin/oauth/clients");
    setClients(data.clients);
  }, []);
  useEffect(() => {
    reload()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  async function register(event: FormEvent) {
    event.preventDefault();
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setError("");
    setIssuedSecret(null);
    try {
      const result = await oauthMutation<{ clientId: string; clientSecret: string | null }>(
        "/api/admin/oauth/clients",
        "POST",
        {
          name,
          authMethod,
          redirectUris: redirectUris
            .split(/\r?\n/)
            .map((uri) => uri.trim())
            .filter(Boolean),
        },
      );
      setName("");
      setRedirectUris("");
      await reload();
      if (result.clientSecret) {
        setIssuedSecret({ clientId: result.clientId, value: result.clientSecret });
        setSelectedClientId(result.clientId);
      }
      notify({ message: "OAuthクライアントを登録しました", kind: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function changeClient(client: Client, action: "disable" | "delete") {
    const deleting = action === "delete";
    if (
      !window.confirm(
        deleting
          ? `${client.name}を削除しますか？全ユーザーのこのアプリへの連携と認証情報が削除されます。筋トレ記録は削除されません。この操作は取り消せません。`
          : `${client.name}を無効化しますか？全ユーザーのこのアプリへの連携が利用できなくなります。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await oauthMutation(
        `/api/admin/oauth/clients/${client.clientId}${deleting ? "" : "/disable"}`,
        deleting ? "DELETE" : "POST",
      );
      await reload();
      setSelectedClientId(null);
      setIssuedSecret(null);
      notify({
        message: deleting ? "クライアントを削除しました" : "クライアントを無効化しました",
        kind: "success",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : deleting ? "削除できませんでした" : "無効化できませんでした");
    } finally {
      setBusy(false);
    }
  }

  const selectedClient = clients.find((client) => client.clientId === selectedClientId);
  const closeDetails = () => {
    const trigger = returnFocusRef.current;
    setSelectedClientId(null);
    setIssuedSecret(null);
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  return (
    <article className="panel oauth-panel">
      <h2>OAuthクライアント管理</h2>
      <form className="oauth-client-form" onSubmit={register}>
        <label>
          表示名
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="例：Muse"
            required
          />
        </label>
        <label>
          クライアント認証方式
          <select value={authMethod} onChange={(e) => setAuthMethod(e.target.value as Client["authMethod"])}>
            <option value="none">{authMethodLabel("none")}</option>
            <option value="client_secret_basic">{authMethodLabel("client_secret_basic")}</option>
          </select>
        </label>
        <label className="oauth-redirect-field">
          リダイレクトURI（1行に1件、最大10件）
          <textarea
            value={redirectUris}
            onChange={(e) => setRedirectUris(e.target.value)}
            placeholder="連携先から提示されたHTTPS URL"
            rows={1}
            required
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "処理中…" : "クライアントを登録"}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <h3>登録済みのクライアント</h3>
      {loading ? (
        <p className="oauth-status">読み込み中…</p>
      ) : clients.length === 0 ? (
        <p className="oauth-status">登録されたクライアントはありません。</p>
      ) : (
        <ul className="oauth-client-list">
          {clients.map((client) => (
            <li key={client.clientId}>
              <span>{client.name}</span>
              <button
                className="icon-button"
                onClick={(event) => {
                  returnFocusRef.current = event.currentTarget;
                  setSelectedClientId(client.clientId);
                }}
                aria-label={`${client.name}の詳細`}
                aria-haspopup="dialog"
              >
                <Info size={17} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedClient && (
        <ClientDetails
          client={selectedClient}
          secret={issuedSecret?.clientId === selectedClient.clientId ? issuedSecret.value : null}
          busy={busy}
          error={error}
          onClose={closeDetails}
          onDisable={(client) => changeClient(client, "disable")}
          onDelete={(client) => changeClient(client, "delete")}
        />
      )}
    </article>
  );
}

function ClientDetails({
  client,
  secret,
  busy,
  error,
  onClose,
  onDisable,
  onDelete,
}: {
  client: Client;
  secret: string | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onDisable: (client: Client) => Promise<void>;
  onDelete: (client: Client) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="panel oauth-panel oauth-client-dialog"
      aria-labelledby="oauth-client-details-title"
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="oauth-dialog-heading">
        <h2 id="oauth-client-details-title">クライアント詳細</h2>
        <button className="icon-button" onClick={onClose} aria-label="詳細を閉じる" autoFocus>
          <X size={18} />
        </button>
      </div>
      <dl>
        <dt>表示名</dt>
        <dd>{client.name}</dd>
        <dt>Client ID</dt>
        <dd>
          <code>{client.clientId}</code>
        </dd>
        <dt>認証方式</dt>
        <dd>{authMethodLabel(client.authMethod)}</dd>
        <dt>リダイレクトURI</dt>
        <dd>
          {client.redirectUris.map((uri) => (
            <div key={uri}>{uri}</div>
          ))}
        </dd>
        <dt>状態</dt>
        <dd>{client.disabledAt ? "無効" : "有効"}</dd>
        {secret && (
          <>
            <dt>Client Secret（一度だけ表示）</dt>
            <dd>
              <code>{secret}</code>
            </dd>
          </>
        )}
      </dl>
      {secret && <p>シークレットを安全な場所に保存してください。この詳細を閉じると再表示できません。</p>}
      <div className="oauth-client-actions">
        {!client.disabledAt && (
          <button className="secondary danger" disabled={busy} onClick={() => onDisable(client)}>
            クライアントを無効化
          </button>
        )}
        <button className="secondary danger" disabled={busy} onClick={() => onDelete(client)}>
          クライアントを削除
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
