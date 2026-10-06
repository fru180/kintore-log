import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { MuscleBody, MuscleTags } from "./MuscleBody";
import { getUntrainedMuscles, muscleLabels, type MuscleId } from "./muscles";

type RecordStatus = "loading" | "ready" | "error";

interface ExerciseMusclesModalProps {
  exerciseName: string;
  muscles: MuscleId[];
  onClose: () => void;
}

interface TrainedMusclesCardProps {
  muscles: MuscleId[];
  status: RecordStatus;
}

function MuscleModelAttribution() {
  return (
    <p className="muscle-attribution">
      3D model: <a href="https://www.z-anatomy.com/">Z-Anatomy</a> / BodyParts3D · web optimization by{" "}
      <a href="https://github.com/hpfrei/body-anatomy-3d-viewer">hpfrei</a> ·{" "}
      <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
    </p>
  );
}

export function ExerciseMusclesModal({ exerciseName, muscles, onClose }: ExerciseMusclesModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [focusedMuscle, setFocusedMuscle] = useState<MuscleId | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop exercise-muscle-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        className="panel exercise-muscle-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="modal-title exercise-muscle-modal-title">
          <div>
            <h2 id={titleId}>{exerciseName}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="閉じる"
          >
            <X />
          </button>
        </header>

        <div className="exercise-muscle-modal-content">
          <MuscleBody
            muscles={muscles}
            ariaContext={`${exerciseName}で鍛えられる筋肉`}
            focusedMuscle={focusedMuscle}
          />
          <aside className="trained-muscles-summary">
            <h3>鍛えられる筋肉</h3>
            <MuscleTags
              id={descriptionId}
              muscles={muscles}
              focusedMuscle={focusedMuscle}
              ariaLabel={`${exerciseName}で鍛えられる筋肉`}
              onFocusMuscle={(muscle) => setFocusedMuscle((current) => (current === muscle ? null : muscle))}
            />
          </aside>
        </div>

        <MuscleModelAttribution />
      </article>
    </div>,
    document.body,
  );
}

export function TrainedMusclesCard({ muscles, status }: TrainedMusclesCardProps) {
  const labels = useMemo(() => muscles.map((muscle) => muscleLabels[muscle]), [muscles]);
  const untrainedMuscles = useMemo(() => getUntrainedMuscles(muscles), [muscles]);
  const [focusedMuscle, setFocusedMuscle] = useState<MuscleId | null>(null);

  return (
    <section className="trained-muscles-card" aria-labelledby="trained-muscles-heading">
      <header className="trained-muscles-heading">
        <div>
          <h2 id="trained-muscles-heading">鍛えた部位</h2>
        </div>
      </header>

      <div className="trained-muscles-content">
        <MuscleBody muscles={muscles} focusedMuscle={focusedMuscle} />

        <div className="trained-muscles-summary">
          {status === "loading" ? (
            <p className="muscle-empty">記録を確認しています…</p>
          ) : status === "error" ? (
            <p className="muscle-empty error">記録を読み込めませんでした。</p>
          ) : (
            <>
              <section className="muscle-summary-group" aria-labelledby="trained-muscle-list-heading">
                <h3 id="trained-muscle-list-heading">鍛えた筋肉</h3>
                {labels.length ? (
                  <MuscleTags
                    muscles={muscles}
                    focusedMuscle={focusedMuscle}
                    ariaLabel="鍛えた筋肉"
                    onFocusMuscle={(muscle) =>
                      setFocusedMuscle((current) => (current === muscle ? null : muscle))
                    }
                  />
                ) : (
                  <p className="muscle-empty">
                    この日の種目を記録すると、鍛えた筋肉がライム色で表示されます。
                  </p>
                )}
              </section>

              <section className="muscle-summary-group" aria-labelledby="untrained-muscle-list-heading">
                <h3 id="untrained-muscle-list-heading">鍛えられていない筋肉</h3>
                {untrainedMuscles.length ? (
                  <MuscleTags
                    muscles={untrainedMuscles}
                    focusedMuscle={focusedMuscle}
                    ariaLabel="鍛えられていない筋肉"
                    onFocusMuscle={(muscle) =>
                      setFocusedMuscle((current) => (current === muscle ? null : muscle))
                    }
                  />
                ) : (
                  <p className="muscle-empty">すべての対象筋肉を鍛えています。</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <MuscleModelAttribution />
    </section>
  );
}
