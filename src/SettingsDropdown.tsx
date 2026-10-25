import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";

export default function SettingsDropdown({
  selected,
  onEditExercises,
}: {
  selected: boolean;
  onEditExercises: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      className="settings-dropdown"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className={`icon-button ${selected || open ? "selected-icon" : ""}`}
        aria-label="設定"
        aria-expanded={open}
        aria-controls="settings-dropdown-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <Settings size={18} />
      </button>
      {open && (
        <div className="settings-dropdown-panel" id="settings-dropdown-panel">
          <button
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
              onEditExercises();
            }}
          >
            種目の編集
          </button>
        </div>
      )}
    </div>
  );
}
