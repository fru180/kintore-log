import { type FormEvent, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { del, patch, post } from "./api";
import type { Exercise, Notice } from "./types";

export default function AdminPage({
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
