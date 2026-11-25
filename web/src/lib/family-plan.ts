import { base, type Lang } from "./i18n";
import type { Activity, Snapshot } from "./compiler/types";

export type FamilyRequirementKind = "dinner_start" | "dance_duration";

export type FamilyRequirement = {
  id: string;
  kind: FamilyRequirementKind;
  functionKind: string;
  value: number;
  note: string;
  source: "typed" | "dictate" | "seed";
  author: string | null;
  version: number;
};

export type RecapActivity = Pick<Activity, "kind" | "functionKind" | "title" | "start" | "end">;

const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
const formatter = (lang: Lang) => new Intl.DateTimeFormat(LOCALE[base(lang)], {
  hour: "numeric", minute: "2-digit", timeZone: "UTC", hourCycle: "h12",
});

export function dictatedDinnerTime(text: unknown): string | null {
  if (typeof text !== "string") return null;
  try {
    const time = JSON.parse(text)?.dinner_time;
    return typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
  } catch {
    return null;
  }
}

export function planTime(minute: number, lang: Lang) {
  return formatter(lang).format(new Date(minute * 60_000));
}

export function requirementLabel(row: FamilyRequirement, lang: Lang) {
  if (row.kind === "dinner_start") {
    const time = planTime(row.value, lang);
    return { en: `Dinner starts at ${time}`, hi: `रात का खाना ${time} पर शुरू होगा`, mr: `जेवण ${time} वाजता सुरू होईल` }[base(lang)];
  }
  const value = new Intl.NumberFormat(LOCALE[base(lang)]).format(row.value);
  return { en: `Dance lasts ${value} minutes`, hi: `नृत्य ${value} मिनट का है`, mr: `नृत्याचा कालावधी ${value} मिनिटे` }[base(lang)];
}

const ACTIVITY_LABELS: Record<Lang, Partial<Record<Activity["kind"], string>>> = {
  en: { dance: "Dance", dinner: "Dinner", makeup: "Makeup", music: "Music", coverage: "Video coverage", ritual: "Ceremony ritual" },
  hi: { dance: "नृत्य", dinner: "रात का खाना", makeup: "मेकअप", music: "संगीत", coverage: "वीडियो रिकॉर्डिंग", ritual: "विवाह की रस्म" },
  mr: { dance: "नृत्य", dinner: "जेवण", makeup: "मेकअप", music: "संगीत", coverage: "व्हिडिओ चित्रीकरण", ritual: "विवाह विधी" },
};

export function approvedRecapText(activities: RecapActivity[], lang: Lang) {
  return [...activities].sort((a, b) => a.start - b.start).map((activity) => {
    const name = lang === "en" ? activity.title : ACTIVITY_LABELS[base(lang)][activity.kind] ?? activity.title;
    const start = planTime(activity.start, lang);
    const end = planTime(activity.end, lang);
    return { en: `${name}, from ${start} to ${end}.`, hi: `${name}, ${start} से ${end} तक।`, mr: `${name}, ${start} ते ${end}.` }[base(lang)];
  }).join(" ");
}

/** Apply reviewed inputs by function and canonical numeric value, before compilation. */
export function applyFamilyRequirements(snapshot: Snapshot, requirements: FamilyRequirement[]): Snapshot {
  const dinners = requirements.filter((item) => item.kind === "dinner_start");
  const replaced = new Set(dinners.map((item) => item.functionKind));
  const revisedFacts = snapshot.facts.filter((fact) => fact.kind !== "dinner_start" || !replaced.has(fact.functionKind));
  return {
    ...snapshot,
    activities: snapshot.activities.map((activity) => {
      if (activity.kind !== "dance" || !activity.flexible) return activity;
      const duration = requirements.find((item) => item.kind === "dance_duration" && item.functionKind === activity.functionKind);
      if (!duration) return activity;
      return { ...activity, end: activity.start + duration.value,
        requestedBy: duration.author ? { side: "B" as const, memberName: duration.author, priority: "prefer" as const } : activity.requestedBy };
    }),
    facts: [...revisedFacts, ...dinners.map((item) => ({
      id: `requirement:${item.id}:${item.version}`,
      functionKind: item.functionKind,
      kind: "dinner_start" as const,
      status: "confirmed" as const,
      value: item.value,
      source: { channel: item.source, ref: item.id, wording: item.note },
    }))],
  };
}
