import "server-only";
import { DefaultFlag, Flagsmith } from "flagsmith-nodejs";
import { DEFAULT_POLICY, type CompilerPolicy } from "@/lib/compiler/types";

/**
 * Flagsmith is the control plane (PRD → "Flagsmith as the wedding's control plane").
 * Evaluated on the server only; the browser receives the resulting booleans and values.
 * If Flagsmith is unreachable, every flag falls back to a committed safe default
 * (dialing off, family-priorities policy) and `source` says so.
 */

const SAFE_DEFAULTS: Record<string, { enabled: boolean; value: string | null }> = {
  compiler_policy: { enabled: true, value: JSON.stringify(DEFAULT_POLICY) },
  caller_prompt: { enabled: true, value: "baseline" },
  voice_channel: { enabled: true, value: "phone" },
  outbound_dialing_enabled: { enabled: false, value: null },
  result_processing_paused: { enabled: false, value: null },
  whatsapp_bridge_enabled: { enabled: false, value: null },
  voice_recap_bulbul: { enabled: false, value: null },
  conditional_options_ui: { enabled: false, value: null },
  onboarding_celebration: { enabled: true, value: null },
  home_team_section: { enabled: true, value: null },
  stage_sourcing: { enabled: false, value: null },
  stage_booking: { enabled: false, value: null },
  stage_guests: { enabled: false, value: null },
  stage_day_of: { enabled: false, value: null },
  stage_closeout: { enabled: false, value: null },
};

let client: Flagsmith | null = null;
function flagsmith(): Flagsmith | null {
  const key = process.env.FLAGSMITH_SERVER_KEY;
  if (!key) return null;
  if (!client) {
    client = new Flagsmith({
      environmentKey: key,
      requestTimeoutSeconds: 3,
      defaultFlagHandler: (name: string) => {
        const d = SAFE_DEFAULTS[name] ?? { enabled: false, value: null };
        return new DefaultFlag(d.value, d.enabled);
      },
    });
  }
  return client;
}

export interface ViewerTraits {
  weddingId: string;
  memberId: string;
  language: string;
  householdSide: "A" | "B" | null;
  role: string;
  isCouple: boolean;
  weddingStage: string;
}

export interface ResolvedFlags {
  source: "flagsmith" | "safe_defaults";
  features: Record<string, { enabled: boolean; value: string | null }>;
  policy: CompilerPolicy;
}

export async function flagsFor(t: ViewerTraits): Promise<ResolvedFlags> {
  const fs = flagsmith();
  const features: ResolvedFlags["features"] = {};
  let source: ResolvedFlags["source"] = "safe_defaults";
  if (fs) {
    try {
      const flags = await fs.getIdentityFlags(`wedding:${t.weddingId}:member:${t.memberId}`, {
        language: t.language,
        household_side: t.householdSide ?? "",
        role: t.role,
        is_couple: t.isCouple,
        wedding_stage: t.weddingStage,
      });
      for (const name of Object.keys(SAFE_DEFAULTS)) {
        const v = flags.getFeatureValue(name);
        features[name] = { enabled: flags.isFeatureEnabled(name), value: v == null ? null : String(v) };
      }
      source = "flagsmith";
    } catch (e) {
      console.error("flagsmith unavailable, using safe defaults", e);
    }
  }
  for (const [name, d] of Object.entries(SAFE_DEFAULTS)) features[name] ??= d;

  let policy = DEFAULT_POLICY;
  try {
    const raw = features.compiler_policy.value;
    if (raw) policy = { ...DEFAULT_POLICY, ...(JSON.parse(raw) as Partial<CompilerPolicy>) };
  } catch {
    /* malformed remote config: keep the default */
  }
  return { source, features, policy };
}
