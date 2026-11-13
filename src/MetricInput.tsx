export default function MetricInput({
  label,
  unit,
  value,
  min = "0",
  max,
  step,
  invalid,
  disabled,
  placeholder,
  id,
  ariaLabel,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | string;
  min?: number | string;
  max?: number;
  step: string;
  invalid: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="metric">
      <span>{label}</span>
      <div className={invalid ? "invalid" : ""}>
        <input
          id={id}
          aria-label={ariaLabel}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          required
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
