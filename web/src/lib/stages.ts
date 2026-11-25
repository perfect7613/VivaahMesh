/**
 * Lifecycle stages (PRD → "Lifecycle spine"; issues #11, #12, #13). Pure, so it can be unit-tested
 * and used by both the server (to refuse) and the UI (to hide).
 *
 * Two independent switches must agree before a stage's screens open:
 *  1. the wedding has actually REACHED that stage (`weddings.stage`, a hard rule in code), and
 *  2. the matching Flagsmith flag (`stage_<name>`, targeted by the `wedding_stage` segment) is on,
 *     which lets the team hold a stage back for one wedding or roll it out gradually.
 * If Flagsmith is unreachable the committed defaults turn every stage flag off, so nothing past
 * the brief opens by accident.
 */
export const STAGES = ["brief", "sourcing", "booking", "guests", "day_of", "closeout"] as const;
export type Stage = (typeof STAGES)[number];

/** Stages that have a Flagsmith flag. `brief` is always open. */
export const STAGE_FLAGS: Record<Exclude<Stage, "brief">, string> = {
  sourcing: "stage_sourcing",
  booking: "stage_booking",
  guests: "stage_guests",
  day_of: "stage_day_of",
  closeout: "stage_closeout",
};

export const isStage = (s: unknown): s is Stage => typeof s === "string" && (STAGES as readonly string[]).includes(s);

/** Has the wedding reached `required`? An unknown stage value counts as the earliest stage. */
export function reachedStage(weddingStage: string, required: Stage): boolean {
  const have = isStage(weddingStage) ? STAGES.indexOf(weddingStage) : 0;
  return have >= STAGES.indexOf(required);
}

/**
 * Can this wedding open `required`'s screens and actions? Needs the stage reached AND its flag on.
 * `flags` is the resolved boolean map (e.g. `view.flags.on` or wedding-level flags).
 */
export function canOpenStage(weddingStage: string, required: Stage, flags: Record<string, boolean>): boolean {
  if (required === "brief") return true;
  return reachedStage(weddingStage, required) && flags[STAGE_FLAGS[required]] === true;
}

/** Every stage the wedding can open right now, in order. */
export function openStages(weddingStage: string, flags: Record<string, boolean>): Stage[] {
  return STAGES.filter((s) => canOpenStage(weddingStage, s, flags));
}
