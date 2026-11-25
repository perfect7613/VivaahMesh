import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeAuthorized, receiveWhatsApp } from "./whatsapp";

const { from, rpc, enabled, transcribe, insert } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), enabled: vi.fn(), transcribe: vi.fn(), insert: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ db: () => ({ from, rpc }) }));
vi.mock("./flags", () => ({ whatsappEnabled: enabled }));
vi.mock("./sarvam", () => ({ transcribe }));

const group = "120363000000000000@g.us";
const channel = {
  id: "channel-a", household_id: "family-a", wedding_id: "wedding-a", kind: "whatsapp_group",
  chat_id: group, whatsapp_language: "mr", created_at: "2026-01-01T00:00:00Z",
};
const family = { id: channel.household_id, wedding_id: channel.wedding_id, side: "A" };
const message = () => ({ group, sentAt: Date.now(), messageId: "3EB010", author: "माधुरी" });

function query(row: Record<string, unknown> | null) {
  let selected = row;
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      if (selected?.[column] !== value) selected = null;
      return builder;
    },
    maybeSingle: async () => ({ data: selected, error: null }),
  };
  return builder;
}

beforeEach(() => {
  vi.resetAllMocks();
  enabled.mockResolvedValue(true);
  insert.mockResolvedValue({ error: null });
  from.mockImplementation((table) => {
    if (table === "channels") return query(channel);
    if (table === "households") return query(family);
    if (table === "priorities") return { insert };
    throw new Error("Unexpected table");
  });
});

describe("WhatsApp bridge requests", () => {
  it("requires a configured, exact secret", () => {
    const secret = "synthetic".repeat(5);
    expect(bridgeAuthorized(secret, secret)).toBe(true);
    expect(bridgeAuthorized(secret, secret + " ")).toBe(false);
    expect(bridgeAuthorized(secret, null)).toBe(false);
    expect(bridgeAuthorized("", "")).toBe(false);
  });

  it("creates a note scoped to the linked wedding and household, ignoring caller-supplied scope", async () => {
    expect(await receiveWhatsApp({
      ...message(), action: "text", text: "Keep dinner early", weddingId: "other-wedding",
      householdId: "other-family",
    })).toEqual({ status: "saved" });
    expect(enabled).toHaveBeenCalledWith(family.wedding_id, family.id, family.side);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      wedding_id: "wedding-a", household_id: "family-a", source: "whatsapp", visibility: "household",
      author_name: "माधुरी", note: "Keep dinner early", whatsapp_message_id: "3EB010",
    }));
  });

  it("ignores unlinked or disabled groups before accepting media", async () => {
    expect(await receiveWhatsApp({ ...message(), group: "120363111111111111@g.us", action: "voice_check" }))
      .toEqual({ status: "ignored" });
    enabled.mockResolvedValue(false);
    expect(await receiveWhatsApp({ ...message(), action: "voice", audio: "not-an-audio-body" }))
      .toEqual({ status: "ignored" });
    expect(rpc).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("transcribes only a claimed voice message and saves it for household review", async () => {
    const audio = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(30)]).toString("base64");
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: true, error: null });
    const payload = { ...message(), action: "voice", audio };
    expect(await receiveWhatsApp(payload)).toEqual({ status: "ignored" });
    expect(transcribe).not.toHaveBeenCalled();
    transcribe.mockResolvedValue({ transcript: "जेवण ८:३० ला", languageCode: "mr-IN" });
    expect(await receiveWhatsApp(payload)).toEqual({ status: "saved" });
    expect(rpc).toHaveBeenCalledWith("claim_whatsapp_voice", { p_channel: "channel-a", p_message: "3EB010" });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "household", note: "जेवण ८:३० ला", transcript: "जेवण ८:३० ला", transcript_lang: "mr-IN",
    }));
  });
});
