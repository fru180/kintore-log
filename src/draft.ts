import type { Draft, Exercise, WorkoutRecord } from "./types";

const requiredDraftKeys: Record<Exercise["kind"], (keyof Draft)[]> = {
  strength: ["weightKg", "reps", "sets"],
  cardio: ["distanceKm", "durationMinutes"],
};

export function toDraftValue(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

export function isDraftComplete(draft: Draft, kind: Exercise["kind"]) {
  return requiredDraftKeys[kind].every((key) => draft[key] !== "");
}

export function isDraftChanged(
  draft: Draft,
  record: Pick<WorkoutRecord, keyof Draft>,
  kind: Exercise["kind"],
) {
  return requiredDraftKeys[kind].some((key) => draft[key] !== record[key]);
}
