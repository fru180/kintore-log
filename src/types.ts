export type User = { id: number; accountName: string; isAdmin: number };
export type Exercise = { id: number; name: string; kind: "strength" | "cardio"; sortOrder: number };
export type WorkoutRecord = {
  id: number;
  exerciseId: number;
  date: string;
  name: string;
  kind: "strength" | "cardio";
  weightKg: number | null;
  reps: number | null;
  sets: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
};
export type Draft = {
  weightKg: number;
  reps: number;
  sets: number;
  distanceKm: number;
  durationMinutes: number;
};
export type StatPoint = {
  date: string;
  weightKg?: number;
  reps?: number;
  sets?: number;
  distanceKm?: number;
  durationMinutes?: number;
};
