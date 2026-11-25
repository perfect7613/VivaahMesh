import "server-only";
import { weddingFlags } from "./flags";
import { HttpError } from "./weddings";
import { canOpenStage, type Stage } from "@/lib/stages";

/**
 * Refuses (403 stage_locked) unless the wedding has reached `required` AND its Flagsmith flag is on.
 * The flags are evaluated at the wedding level, so every household and every guest or vendor link
 * sees the same answer. See src/lib/stages.ts for the rule.
 */
export async function requireStageOpen(weddingId: string, weddingStage: string, required: Stage) {
  const flags = await weddingFlags(weddingId, weddingStage);
  const on = Object.fromEntries(Object.entries(flags.features).map(([k, v]) => [k, v.enabled]));
  if (!canOpenStage(weddingStage, required, on)) throw new HttpError(403, "stage_locked");
}
