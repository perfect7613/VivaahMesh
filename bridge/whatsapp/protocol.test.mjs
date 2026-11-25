import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { normalizeMessage, validSignature } from "./protocol.mjs";

const group = "120363000000000000@g.us";
const timestamp = "2026-11-25T10:00:00Z";
const now = Date.parse(timestamp);
const event = {
  Chat: group, ID: "3EB001", SenderJID: "15551234567@s.whatsapp.net", Timestamp: timestamp,
  FromMe: false, Text: "आजीसाठी जेवण ८:३० ला", ChatName: "Family", PushName: "माधुरी",
  Media: null, Edited: false, Revoked: false,
};
const parse = (overrides) => normalizeMessage({ ...event, ...overrides }, group, "mr", now);

test("verify a signed wacli Message, retaining only app fields", () => {
  const raw = Buffer.from(JSON.stringify(event));
  const secret = "synthetic-local-key";
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(validSignature(secret, raw, signature), true);
  assert.equal(validSignature(secret, Buffer.concat([raw, Buffer.from(" ")]), signature), false);
  assert.equal(validSignature(secret, raw, "sha256=abc"), false);
  assert.deepEqual(parse({}), {
    group, action: "text", messageId: event.ID, sentAt: now, author: event.PushName, text: event.Text,
  });
});

test("reject unrelated chats, replay, outbound messages and other event kinds", () => {
  for (const overrides of [
    { Chat: "15551234567@s.whatsapp.net" }, { Chat: "120363111111111111@g.us" },
    { FromMe: true }, { Edited: true }, { Revoked: true }, { EventType: "receipt" },
    { ReactionToID: "3EB002" }, { Timestamp: "2026-11-25T09:30:00Z" },
    { Timestamp: "2026-11-25T10:20:00Z" }, { ID: "../bad" },
  ]) assert.equal(parse(overrides), null);
});

test("link command never becomes note content", () => {
  assert.deepEqual(parse({ Text: "/link eeeeabcdef" }), {
    group, action: "link", code: "eeeeabcdef", language: "mr",
    messageId: event.ID, sentAt: now, author: event.PushName,
  });
  assert.equal(parse({ Text: "/link invalid" }), null);
});

test("voice only accepts bounded Ogg audio metadata", () => {
  const Media = { Type: "audio", MimeType: "audio/ogg; codecs=opus", FileLength: 53842 };
  assert.equal(parse({ Text: "", Media }).action, "voice");
  assert.equal(parse({ Text: "", Media: { ...Media, FileLength: 1_048_577 } }), null);
  assert.equal(parse({ Media: { Type: "image", MimeType: "image/png", FileLength: 42 } }), null);
});
