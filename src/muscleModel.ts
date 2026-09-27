import { muscleOrder, type MuscleId } from "./muscles";

export type MuscleModelNode = {
  name?: string;
  userData?: {
    name?: string;
    nameDetail?: string;
    type?: string;
  };
};

const muscleMeshPatterns: Readonly<Record<MuscleId, readonly RegExp[]>> = {
  quadriceps: [/Quadriceps Femoris/i],
  hamstrings: [/Biceps Femoris/i, /Semimembranosus/i, /Semitendinosus/i],
  gluteusMaximus: [/Gluteus Maximus/i],
  pectoralisMajor: [/Pectoralis Major/i],
  deltoid: [/Deltoid Muscle/i],
  triceps: [/Triceps Brachii/i],
  trapezius: [/Trapezius Muscle/i],
  teresMajor: [/Teres Major/i],
  latissimusDorsi: [/Latissimus Dorsi/i],
  biceps: [/Biceps Brachii/i],
  upperLatissimus: [/Latissimus Dorsi/i],
  lowerLatissimus: [/Latissimus Dorsi/i],
  gastrocnemius: [/Gastrocnemius/i],
  adductors: [
    /Adductor Magnus/i,
    /Adductor Longus/i,
    /Adductor Brevis/i,
    /Gracilis Muscle/i,
    /Pectineus Muscle/i,
  ],
  abductors: [/Gluteus Medius/i, /Gluteus Minimus/i],
  soleus: [/Soleus Muscle/i],
  erectorSpinae: [/Iliocostalis (Lumborum|Thoracis)/i, /Longissimus Thoracis/i, /Spinalis Thoracis/i],
  rectusAbdominis: [/Rectus Abdominis/i],
  internalObliques: [/Internal Abdominal Oblique/i],
  externalObliques: [/External Abdominal Oblique/i],
  posteriorDeltoid: [/Scapular Spinal Part Of Deltoid/i],
};

export function muscleModelSearchText(node: MuscleModelNode): string {
  return [node.name, node.userData?.name, node.userData?.nameDetail].filter(Boolean).join(" ");
}

export function modelMuscleIds(node: MuscleModelNode): MuscleId[] {
  const text = muscleModelSearchText(node);
  return muscleOrder.filter((muscle) => muscleMeshPatterns[muscle].some((pattern) => pattern.test(text)));
}
