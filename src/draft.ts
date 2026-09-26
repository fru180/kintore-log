import type { Draft, Exercise, WorkoutRecord } from "./types";

export const defaultDraft: Draft = {
  weightKg: 0,
  reps: 10,
  sets: 3,
  distanceKm: 0,
  durationMinutes: 30,
};

const requiredDraftKeys: Record<Exercise["kind"], (keyof Draft)[]> = {
  strength: ["weightKg", "reps", "sets"],
  cardio: ["distanceKm", "durationMinutes"],
};

export function toDraftValue(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

export function createInitialDraft(
  record: WorkoutRecord | undefined,
  latestWeightKg: number,
  savedDefaults: Partial<Draft>,
): Draft {
  if (record) {
    return {
      weightKg: record.weightKg ?? defaultDraft.weightKg,
      reps: record.reps ?? defaultDraft.reps,
      sets: record.sets ?? defaultDraft.sets,
      distanceKm: record.distanceKm ?? defaultDraft.distanceKm,
      durationMinutes: record.durationMinutes ?? defaultDraft.durationMinutes,
    };
  }

  return { ...defaultDraft, ...savedDefaults, weightKg: latestWeightKg };
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
