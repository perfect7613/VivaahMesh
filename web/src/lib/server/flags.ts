import "server-only";
import { DefaultFlag, Flagsmith } from "flagsmith-nodejs";
import { db } from "./supabase";
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
  agent_enabled: { enabled: true, value: null },
  agent_model: { enabled: true, value: "glm5.3-flash" },
};

const STRATEGIES: CompilerPolicy["strategy"][] = ["preserve_family_priorities", "minimize_changes", "lowest_confirmed_cost"];

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

/** Evaluates every known flag for one Flagsmith identity, falling back to safe defaults. */
async function resolve(identity: string, traits: Record<string, string | boolean>): Promise<ResolvedFlags> {
  const fs = flagsmith();
  const features: ResolvedFlags["features"] = {};
  let source: ResolvedFlags["source"] = "safe_defaults";
  if (fs) {
    try {
      const flags = await fs.getIdentityFlags(identity, traits);
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
    if (!STRATEGIES.includes(policy.strategy)) policy = DEFAULT_POLICY;
  } catch {
    /* malformed remote config: keep the default */
  }
  return { source, features, policy };
}

/** Per-member flags: UI rollouts that may legitimately differ per household, language or role. */
export function flagsFor(t: ViewerTraits, identifier = `wedding:${t.weddingId}:member:${t.memberId}`): Promise<ResolvedFlags> {
  return resolve(identifier, {
    language: t.language,
    household_side: t.householdSide ?? "",
    role: t.role,
    is_couple: t.isCouple,
    wedding_stage: t.weddingStage,
  });
}

/**
 * Wedding-level flags, for anything both households must see identically: the compiler policy that
 * produces a plan revision, and the snapshot stored with revisions and approvals.
 */
export function weddingFlags(weddingId: string, weddingStage: string): Promise<ResolvedFlags> {
  return resolve(`wedding:${weddingId}`, { wedding_stage: weddingStage });
}

/**
 * Environment-wide switches (no identity): the operational kill switches that NudgeBee and the
 * on-call person flip for everyone at once. Unreachable Flagsmith → the safe default.
 */
export async function killSwitch(name: "outbound_dialing_enabled" | "result_processing_paused"): Promise<boolean> {
  const fs = flagsmith();
  if (!fs) return SAFE_DEFAULTS[name].enabled;
  try {
    return (await fs.getEnvironmentFlags()).isFeatureEnabled(name);
  } catch (e) {
    console.error("flagsmith unavailable, using safe default for", name, e);
    return SAFE_DEFAULTS[name].enabled;
  }
}

/** Flags for a member row (wedding stage and household side are looked up). */
export async function flagsForMember(me: { id: string; wedding_id: string; household_id: string | null; language: string; role: string; is_couple: boolean }) {
  const s = db();
  const [w, h] = await Promise.all([
    s.from("weddings").select("stage").eq("id", me.wedding_id).single(),
    s.from("households").select("side").eq("id", me.household_id).maybeSingle(),
  ]);
  return flagsFor({
    weddingId: me.wedding_id,
    memberId: me.id,
    language: me.language,
    householdSide: (h.data?.side ?? null) as "A" | "B" | null,
    role: me.role,
    isCouple: me.is_couple,
    weddingStage: w.data?.stage ?? "brief",
  });
}
