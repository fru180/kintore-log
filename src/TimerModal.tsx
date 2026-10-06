import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { Notice } from "./types";

export default function TimerModal({
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
        <div className="timer-ring" style={{ "--progress": `${progress * 360}deg` } as CSSProperties}>
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
