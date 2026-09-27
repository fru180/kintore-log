import type { WorkoutRecord } from "./types";

export const muscleLabels = {
  quadriceps: "大腿四頭筋",
  hamstrings: "ハムストリング",
  gluteusMaximus: "大臀筋",
  pectoralisMajor: "大胸筋",
  deltoid: "三角筋",
  triceps: "上腕三頭筋",
  trapezius: "僧帽筋",
  teresMajor: "大円筋",
  latissimusDorsi: "広背筋",
  biceps: "上腕二頭筋",
  upperLatissimus: "広背筋上部",
  lowerLatissimus: "広背筋下部",
  gastrocnemius: "腓腹筋",
  adductors: "内転筋",
  abductors: "外転筋",
  soleus: "ヒラメ筋",
  erectorSpinae: "脊柱起立筋",
  rectusAbdominis: "腹直筋",
  internalObliques: "内腹斜筋",
  externalObliques: "外腹斜筋",
  posteriorDeltoid: "三角筋後部",
} as const;

export type MuscleId = keyof typeof muscleLabels;

export const muscleOrder = Object.keys(muscleLabels) as MuscleId[];

export const exerciseMuscles: Readonly<Record<string, readonly MuscleId[]>> = {
  レッグプレス: ["quadriceps", "hamstrings", "gluteusMaximus"],
  チェストプレス: ["pectoralisMajor", "deltoid", "triceps"],
  ラットプルダウン: ["trapezius", "teresMajor", "latissimusDorsi"],
  シーテッドロー: ["biceps", "upperLatissimus", "latissimusDorsi"],
  ロングプル: ["lowerLatissimus", "biceps"],
  ショルダープレス: ["deltoid", "trapezius", "triceps"],
  ラインレッグカール: ["hamstrings", "gastrocnemius"],
  レッグエクステンション: ["quadriceps"],
  ヒップアブダクター: ["adductors", "abductors"],
  ヒップアダクター: ["adductors"],
  カーフレイズ: ["gastrocnemius", "soleus"],
  バックエクステンション: ["erectorSpinae"],
  アブドミナルクランチ: ["rectusAbdominis"],
  ロータリートルソー: ["internalObliques", "externalObliques"],
  リアデルト: ["posteriorDeltoid"],
  バタフライ: ["pectoralisMajor"],
};

export function getTrainedMuscles(records: Pick<WorkoutRecord, "name">[]): MuscleId[] {
  const trained = new Set<MuscleId>();
  records.forEach(({ name }) => exerciseMuscles[name]?.forEach((muscle) => trained.add(muscle)));
  return muscleOrder.filter((muscle) => trained.has(muscle));
}

export function getExercisesForMuscles(muscles: Iterable<MuscleId>): string[] {
  const targets = new Set(muscles);
  return Object.entries(exerciseMuscles)
    .filter(([, trainedMuscles]) => trainedMuscles.some((muscle) => targets.has(muscle)))
    .map(([exercise]) => exercise);
}
