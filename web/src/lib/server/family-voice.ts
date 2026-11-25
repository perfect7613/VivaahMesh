import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { approvedRecapText, type FamilyRequirement, type FamilyRequirementKind, type RecapActivity } from "@/lib/family-plan";
import { base, pickLang } from "@/lib/i18n";
import { flagsFor, type ViewerTraits } from "./flags";
import { bulbulRecap, dictateClip } from "./sarvam-models";
import { db } from "./supabase";
import { HttpError, memberships, pingWedding } from "./weddings";
import { takeVoiceRequest } from "./voice-request";

type Member = Awaited<ReturnType<typeof memberships>>[number];
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SELECT = "id,kind,function_kind,value_min,note,source,version,member:members(display_name)";

export async function memberTraits(me: Member): Promise<ViewerTraits> {
  const [wedding, household] = await Promise.all([
    db().from("weddings").select("stage").eq("id", me.wedding_id).single(),
    me.household_id ? db().from("households").select("side").eq("id", me.household_id).maybeSingle() : null,
  ]);
  if (wedding.error || household?.error) throw wedding.error ?? household?.error;
  return {
    weddingId: me.wedding_id, memberId: me.id, language: me.language,
    householdSide: household?.data?.side ?? null, role: me.role,
    isCouple: me.is_couple, weddingStage: wedding.data.stage,
  };
}

async function familyMember(tgId: number, weddingId: unknown) {
  if (typeof weddingId !== "string" || !UUID.test(weddingId)) throw new HttpError(400, "invalid_wedding");
  const member = (await memberships(tgId)).find((entry) => entry.wedding_id === weddingId);
  if (!member) throw new HttpError(403, "not_a_member");
  return member;
}

export async function familyRequirements(weddingId: string): Promise<FamilyRequirement[]> {
  const { data, error } = await db().from("family_plan_requirements").select(SELECT)
    .eq("wedding_id", weddingId).order("kind");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, kind: row.kind, functionKind: row.function_kind, value: row.value_min,
    note: row.note, source: row.source, version: row.version,
    author: (row.member as unknown as { display_name: string } | null)?.display_name ?? null,
  }));
}

async function approvedRecap(weddingId: string) {
  const { data, error } = await db().from("approvals").select("snapshot_revision,approved_activities")
    .eq("wedding_id", weddingId).eq("function_kind", "sangeet").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data || !Array.isArray(data.approved_activities) || !data.approved_activities.length) return null;
  const activities = data.approved_activities.filter((activity): activity is RecapActivity =>
    !!activity && typeof activity.title === "string" && typeof activity.kind === "string"
    && typeof activity.functionKind === "string" && Number.isInteger(activity.start) && Number.isInteger(activity.end)
    && activity.start >= 0 && activity.end <= 1440 && activity.end > activity.start);
  return activities.length === data.approved_activities.length ? { revision: data.snapshot_revision as number, activities } : null;
}

function preparedDinner(me: Member, traits: ViewerTraits) {
  return me.wedding_id === process.env.VIVAAHMESH_DEMO_WEDDING_ID && traits.householdSide === "A"
    ? { note: "आजी-आजोबांसाठी रात्री ८:३० वाजता जेवण सुरू व्हायला हवे.", value: 1230 } : null;
}

export async function familyVoiceView(tgId: number, weddingId: unknown) {
  const me = await familyMember(tgId, weddingId);
  const traits = await memberTraits(me);
  const [requirements, flags] = await Promise.all([
    familyRequirements(me.wedding_id), flagsFor(traits),
  ]);
  const recap = flags.features.voice_recap_bulbul.enabled ? await approvedRecap(me.wedding_id) : null;
  return {
    requirements,
    canEdit: traits.householdSide === "A" ? "dinner_start" : traits.householdSide === "B" ? "dance_duration" : null,
    prepared: preparedDinner(me, traits),
    recapRevision: recap?.revision ?? null,
  };
}

function dictateProof(me: Member, expiry: number, note: string) {
  const secret = process.env.CALLS_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, "dictate_proof_unconfigured");
  return createHmac("sha256", secret).update(JSON.stringify(["family-dictate-v2", me.id, me.wedding_id, expiry, note])).digest("base64url");
}

export async function dictateFamilyNote(tgId: number, weddingId: unknown, audio: File, language: "en" | "hi" | "mr") {
  const me = await familyMember(tgId, weddingId);
  if ((await memberTraits(me)).householdSide !== "A") throw new HttpError(403, "household_role_required");
  const expiry = Date.now() + 30 * 60_000;
  await takeVoiceRequest(me.id, "family-dictate");
  const output = await dictateClip(audio, language);
  if (output.text.length > 1000) throw new HttpError(422, "dictate_no_short_transcript");
  return { ...output, draftToken: `${expiry}.${dictateProof(me, expiry, output.text)}` };
}

export async function publishFamilyRequirement(tgId: number, input: Record<string, unknown>) {
  const me = await familyMember(tgId, input.weddingId);
  const traits = await memberTraits(me);
  const { kind, functionKind, value, expectedVersion } = input;
  if (functionKind !== "sangeet" || (kind !== "dinner_start" && kind !== "dance_duration")) {
    throw new HttpError(400, "invalid_requirement_scope");
  }
  if ((kind === "dinner_start" ? "A" : "B") !== traits.householdSide) {
    throw new HttpError(403, "household_role_required");
  }
  if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || typeof value !== "number" || !Number.isInteger(value)
    || (kind === "dinner_start" ? value < 0 || value > 1439 : value < 1 || value > 180)) {
    throw new HttpError(400, "invalid_requirement_value");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 1000) throw new HttpError(400, "requirement_note_too_long");
  let source: FamilyRequirement["source"] = "typed";
  if (input.source === "seed") {
    const prepared = preparedDinner(me, traits);
    if (!prepared || kind !== "dinner_start" || note !== prepared.note || value !== prepared.value) {
      throw new HttpError(403, "prepared_input_unavailable");
    }
    source = "seed";
  } else if (input.draftToken) {
    const parts = typeof input.draftToken === "string" ? /^(\d{13})\.([\w-]{43})$/.exec(input.draftToken) : null;
    const expiry = Number(parts?.[1]);
    if (!parts || expiry <= Date.now() || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(dictateProof(me, expiry, note)))) {
      throw new HttpError(403, "invalid_dictate_proof");
    }
    source = "dictate";
  }
  const functionLookup = await db().from("functions").select("id")
    .eq("wedding_id", me.wedding_id).eq("kind", functionKind).limit(1);
  if (functionLookup.error) throw functionLookup.error;
  if (!functionLookup.data?.length) throw new HttpError(404, "function_not_found");
  const scope = { wedding_id: me.wedding_id, function_kind: functionKind, kind: kind as FamilyRequirementKind };
  const next = {
    household_id: me.household_id, member_id: me.id, value_min: value, note, source,
    version: expectedVersion + 1, updated_at: new Date().toISOString(),
  };
  const table = db().from("family_plan_requirements");
  const { data, error } = expectedVersion === 0
    ? await table.insert({ ...scope, ...next }).select("id").single()
    : await table.update(next).match(scope).eq("version", expectedVersion).select("id").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw new HttpError(409, "requirement_changed");
  if (error?.code === "23503") throw new HttpError(404, "function_not_found");
  if (error) throw error;
  await pingWedding(me.wedding_id);
  return { requirements: await familyRequirements(me.wedding_id) };
}

export async function playFamilyRecap(tgId: number, weddingId: unknown, revision: unknown) {
  const me = await familyMember(tgId, weddingId);
  const flags = await flagsFor(await memberTraits(me));
  if (!flags.features.voice_recap_bulbul.enabled) throw new HttpError(403, "recap_disabled");
  const recap = await approvedRecap(me.wedding_id);
  if (!recap || recap.revision !== revision) throw new HttpError(409, "recap_revision_changed");
  const language = base(pickLang(me.language));
  const text = approvedRecapText(recap.activities, language);
  await takeVoiceRequest(me.id, "family-recap");
  return { audio: await bulbulRecap(text, language), revision: recap.revision };
}
