import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "./api";
import { toLocalDate } from "./date";
import { latestWeightsText, weightRecordsCsv, type ExportData } from "./export";

export default function ExportPage() {
  const [data, setData] = useState<ExportData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api<ExportData>("/api/export", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "記録を取得できませんでした");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  const download = () => {
    if (!data?.records.length) return;
    const url = URL.createObjectURL(new Blob([weightRecordsCsv(data)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `kintore-log-${toLocalDate().replaceAll("-", "")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="export-page">
      {!data && !error && <p role="status">記録を読み込み中…</p>}
      {error && (
        <div className="panel export-card">
          <p role="alert">{error}</p>
          <button className="secondary" onClick={() => setAttempt((current) => current + 1)}>
            再取得
          </button>
        </div>
      )}
      {data && !data.records.length && <p role="status">エクスポートできる重量記録がありません。</p>}
      <button className="primary export-download" disabled={!data?.records.length} onClick={download}>
        <Download size={18} aria-hidden="true" />
        過去の全記録をエクスポート
      </button>
      <article className="panel export-card">
        <h2>現在の重量</h2>
        {data &&
          (data.exercises.length ? (
            <pre className="export-text" aria-label="種目ごとの最新保存重量">
              {latestWeightsText(data)}
            </pre>
          ) : (
            <p>筋トレ種目がありません。</p>
          ))}
      </article>
    </section>
  );
}
