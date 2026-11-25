import "server-only";
import { demoSangeet } from "../compiler/fixtures/demo-sangeet";
import { activityToRow } from "../plan-input";
import { planView } from "./plan";
import { db } from "./supabase";

export async function seedRehearsalWedding(owner: number, botUsername: string) {
  if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("A positive Telegram user ID is required");
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(botUsername)) throw new Error("A Telegram bot username is required");
  const client = db();
  const facts = demoSangeet.facts.map((fact) => ({
    kind: fact.kind, function_kind: fact.functionKind, value: fact.value,
    status: fact.status, channel: fact.source.channel, ref: fact.source.ref,
    wording: `[Rehearsal] ${fact.source.wording}`,
  }));
  facts.push({ kind: "makeup_ready", function_kind: "sangeet", value: null, status: "unresolved",
    channel: "quote", ref: "makeup-quote", wording: "[Rehearsal] Bridal makeup is included. The artist must confirm an earlier finish." });
  const { data: id, error } = await client.rpc("seed_rehearsal_wedding", {
    p_owner: owner, p_activities: demoSangeet.activities.map(activityToRow), p_facts: facts,
  });
  if (error || typeof id !== "string") throw new Error("Could not seed the rehearsal wedding. Check the migrations and server credentials.");
  // Use the same compiler and optimistic revision write as both household views. A retry resumes
  // here if the database transaction succeeded but the first revision could not be recorded.
  const plan = await planView(owner, id);
  if (!plan) throw new Error("The rehearsal plan has no revision");
  const families = await client.from("households").select("side,invite_code").eq("wedding_id", id);
  const wedding = await client.from("weddings").select("couple_code").eq("id", id).single();
  if (families.error || wedding.error) throw new Error("Could not load rehearsal invitations");
  const link = (code?: string) => {
    if (!code) throw new Error("Missing rehearsal invitation");
    return `https://t.me/${botUsername}?start=join_${encodeURIComponent(code)}`;
  };
  return { weddingId: id, revision: plan.revision, householdA: link(families.data.find((h) => h.side === "A")?.invite_code),
    householdB: link(families.data.find((h) => h.side === "B")?.invite_code), couple: link(wedding.data.couple_code) };
}
