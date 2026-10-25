export type ExportExercise = { id: number; name: string; sortOrder: number };
export type ExportRecord = { exerciseId: number; date: string; weightKg: number };
export type ExportData = { exercises: ExportExercise[]; records: ExportRecord[] };

function sortedExercises(data: ExportData) {
  return [...data.exercises].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function latestWeightsText(data: ExportData): string {
  const latest = new Map<number, ExportRecord>();
  for (const record of data.records) {
    const previous = latest.get(record.exerciseId);
    if (!previous || record.date > previous.date) latest.set(record.exerciseId, record);
  }
  return sortedExercises(data)
    .map((exercise) => `${exercise.name} ${latest.get(exercise.id)?.weightKg ?? 0}kg`)
    .join("\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function weightRecordsCsv(data: ExportData): string {
  const dates = [...new Set(data.records.map((record) => record.date))].sort();
  const weights = new Map<number, Map<string, number>>();
  for (const record of data.records) {
    if (!weights.has(record.exerciseId)) weights.set(record.exerciseId, new Map());
    weights.get(record.exerciseId)!.set(record.date, record.weightKg);
  }
  const rows = [
    ["種目", ...dates],
    ...sortedExercises(data).map((exercise) => [
      exercise.name,
      ...dates.map((date) => weights.get(exercise.id)?.get(date) ?? ""),
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
