import { getExercisesForMuscles, type MuscleId } from "./muscles";
import { muscleModelSearchText, type MuscleModelNode } from "./muscleModel";

const selectableMuscleDefinitions = {
  pectoralisMajor: {
    label: "大胸筋",
    patterns: [/Pectoralis Major/i],
    trainingMuscles: ["pectoralisMajor"],
  },
  pectoralisMinor: {
    label: "小胸筋",
    patterns: [/Pectoralis Minor/i],
    trainingMuscles: [],
  },
  latissimusDorsi: {
    label: "広背筋",
    patterns: [/Latissimus Dorsi/i],
    trainingMuscles: ["latissimusDorsi", "upperLatissimus", "lowerLatissimus"],
  },
  trapezius: {
    label: "僧帽筋",
    patterns: [/Trapezius/i],
    trainingMuscles: ["trapezius"],
  },
  rhomboids: {
    label: "菱形筋",
    patterns: [/Rhomboid (Major|Minor)/i],
    trainingMuscles: [],
  },
  teresMajor: {
    label: "大円筋",
    patterns: [/Teres Major/i],
    trainingMuscles: ["teresMajor"],
  },
  serratusAnterior: {
    label: "前鋸筋",
    patterns: [/Serratus Anterior/i],
    trainingMuscles: [],
  },
  posteriorDeltoid: {
    label: "三角筋後部",
    patterns: [/Scapular Spinal Part Of Deltoid/i],
    trainingMuscles: ["posteriorDeltoid"],
  },
  deltoid: {
    label: "三角筋",
    patterns: [/Deltoid/i],
    trainingMuscles: ["deltoid"],
  },
  biceps: {
    label: "上腕二頭筋",
    patterns: [/Biceps Brachii/i],
    trainingMuscles: ["biceps"],
  },
  triceps: {
    label: "上腕三頭筋",
    patterns: [/Triceps Brachii/i],
    trainingMuscles: ["triceps"],
  },
  brachialis: {
    label: "上腕筋",
    patterns: [/Brachialis Muscle/i],
    trainingMuscles: [],
  },
  brachioradialis: {
    label: "腕橈骨筋",
    patterns: [/Brachioradialis/i],
    trainingMuscles: [],
  },
  forearmFlexors: {
    label: "前腕屈筋群",
    patterns: [
      /Flexor Carpi/i,
      /Flexor Digitorum (Superficialis|Profundus)/i,
      /Palmaris Longus/i,
      /Pronator (Teres|Quadratus)/i,
    ],
    trainingMuscles: [],
  },
  forearmExtensors: {
    label: "前腕伸筋群",
    patterns: [
      /Extensor Carpi/i,
      /Extensor Digitorum/i,
      /Extensor Digiti Minimi/i,
      /Extensor Indicis/i,
      /Supinator/i,
    ],
    trainingMuscles: [],
  },
  rectusAbdominis: {
    label: "腹直筋",
    patterns: [/Rectus Abdominis/i],
    trainingMuscles: ["rectusAbdominis"],
  },
  obliques: {
    label: "腹斜筋群",
    patterns: [/(Internal|External) Abdominal Oblique/i],
    trainingMuscles: ["internalObliques", "externalObliques"],
  },
  transverseAbdominis: {
    label: "腹横筋",
    patterns: [/Transversus Abdominis/i, /Transverse Abdominal/i],
    trainingMuscles: [],
  },
  erectorSpinae: {
    label: "脊柱起立筋",
    patterns: [/(Iliocostalis|Longissimus|Spinalis) (Lumborum|Thoracis)/i],
    trainingMuscles: ["erectorSpinae"],
  },
  quadratusLumborum: {
    label: "腰方形筋",
    patterns: [/Quadratus Lumborum/i],
    trainingMuscles: [],
  },
  gluteusMaximus: {
    label: "大臀筋",
    patterns: [/Gluteus Maximus/i],
    trainingMuscles: ["gluteusMaximus"],
  },
  gluteusMedius: {
    label: "中臀筋",
    patterns: [/Gluteus Medius/i],
    trainingMuscles: ["abductors"],
  },
  gluteusMinimus: {
    label: "小臀筋",
    patterns: [/Gluteus Minimus/i],
    trainingMuscles: ["abductors"],
  },
  iliopsoas: {
    label: "腸腰筋",
    patterns: [/Psoas Major/i, /Iliacus Muscle/i],
    trainingMuscles: [],
  },
  adductors: {
    label: "内転筋群",
    patterns: [/Adductor (Magnus|Longus|Brevis)/i, /Gracilis Muscle/i, /Pectineus Muscle/i],
    trainingMuscles: ["adductors"],
  },
  quadriceps: {
    label: "大腿四頭筋",
    patterns: [/Rectus Femoris/i, /Vastus (Intermedius|Lateralis|Medialis)/i],
    trainingMuscles: ["quadriceps"],
  },
  hamstrings: {
    label: "ハムストリング",
    patterns: [/Biceps Femoris/i, /Semimembranosus/i, /Semitendinosus/i],
    trainingMuscles: ["hamstrings"],
  },
  gastrocnemius: {
    label: "腓腹筋",
    patterns: [/Gastrocnemius/i],
    trainingMuscles: ["gastrocnemius"],
  },
  soleus: {
    label: "ヒラメ筋",
    patterns: [/Soleus Muscle/i],
    trainingMuscles: ["soleus"],
  },
  tibialisAnterior: {
    label: "前脛骨筋",
    patterns: [/Tibialis Anterior/i],
    trainingMuscles: [],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    patterns: readonly RegExp[];
    trainingMuscles: readonly MuscleId[];
  }
>;

export type SelectableMuscleId = keyof typeof selectableMuscleDefinitions;

export const selectableMuscleOrder = Object.keys(selectableMuscleDefinitions) as SelectableMuscleId[];

export function selectableMuscleId(node: MuscleModelNode): SelectableMuscleId | null {
  const text = muscleModelSearchText(node);
  return (
    selectableMuscleOrder.find((id) =>
      selectableMuscleDefinitions[id].patterns.some((pattern) => pattern.test(text)),
    ) ?? null
  );
}

export function selectableMuscleLabel(id: SelectableMuscleId): string {
  return selectableMuscleDefinitions[id].label;
}

export function exercisesForSelectableMuscle(id: SelectableMuscleId): string[] {
  return getExercisesForMuscles(selectableMuscleDefinitions[id].trainingMuscles);
}
