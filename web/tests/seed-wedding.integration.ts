import { afterEach, expect, it, vi } from "vitest";
import { planView } from "@/lib/server/plan";
import { seedRehearsalWedding } from "@/lib/server/rehearsal-wedding";
import { db } from "@/lib/server/supabase";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("opens one complete rehearsal for concurrent seeds and preserves subsequent edits", async () => {
  const endpoint = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(endpoint.hostname);
  vi.stubEnv("FLAGSMITH_SERVER_KEY", "");
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== endpoint.origin) throw new Error("Unexpected external request");
    url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
    return realFetch(input instanceof Request ? new Request(url, input) : url, init);
  });
  const owner = 61021;
  const client = db();
  const real = await client.from("weddings").insert({ created_by_tg: owner, partner_a: "Existing", partner_b: "Wedding" }).select("id").single();
  expect(real.error).toBeNull();
  const seed = () => seedRehearsalWedding(owner, "RehearsalBot");
  const [first, duplicate] = await Promise.all([seed(), seed()]);
  expect(duplicate).toEqual(first);
  expect(first.weddingId).not.toBe(real.data?.id);
  expect(new Set([first.householdA, first.householdB, first.couple]).size).toBe(3);
  expect(first.householdA).toMatch(/^https:\/\/t\.me\/RehearsalBot\?start=join_/);
  const rows = async (table: string, columns: string) => {
    const result = await client.from(table).select(columns).eq("wedding_id", first.weddingId);
    if (result.error) throw result.error;
    return result.data;
  };
  expect(await rows("functions", "kind")).toHaveLength(3);
  expect(await rows("family_plan_requirements", "id")).toHaveLength(2);
  expect(await rows("vendors", "seeded")).toEqual(Array(3).fill({ seeded: true }));
  expect(await rows("plan_revisions", "revision")).toEqual([{ revision: first.revision }]);
  const plan = await planView(owner, first.weddingId);
  expect(plan?.result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ overByMin: 5 })]));
  expect(plan?.facts).toEqual(expect.arrayContaining(["music_cutoff", "makeup_ready"].map((kind) => expect.objectContaining({ kind, status: "unresolved", value: null }))));
  expect((await client.from("weddings").update({ partner_b: "Changed" }).eq("id", first.weddingId)).error).toBeNull();
  expect(await seed()).toEqual(first);
  expect((await client.from("weddings").select("partner_b,is_seeded_demo").eq("created_by_tg", owner).order("is_seeded_demo")).data)
    .toEqual([{ partner_b: "Wedding", is_seeded_demo: false }, { partner_b: "Changed", is_seeded_demo: true }]);
});
