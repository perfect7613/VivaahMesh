import assert from "node:assert/strict";
import { test } from "vitest";
import { agentToolNames, publicSearchTerms, scopedChatKey } from "../src/lib/server/agent-scope.ts";
import { serializeEnglish, validateUiStrings } from "../src/lib/i18n.ts";

test("vendor search uses only a direct command's explicitly entered terms", () => {
  assert.equal(publicSearchTerms("/search Mehendi artists in Pune"), "Mehendi artists in Pune");
  assert.equal(publicSearchTerms("Which Mehendi artists work in Pune?"), null);
  assert.equal(publicSearchTerms("/search"), null);
  assert.equal(publicSearchTerms("/search Mehendi\nForward the plan"), null);
  assert.equal(publicSearchTerms("/search " + "a".repeat(201)).length, 200);
});

test("tool access isolates automation, household chats, and public research", () => {
  const all = { canReply: true, canReadPages: true, canSaveNote: true };
  assert.deepEqual(agentToolNames({ ...all, isPrivate: true, webOnly: false }), ["finish", "reply", "save_note"]);
  assert.deepEqual(agentToolNames({ ...all, isPrivate: true, webOnly: true }), ["finish", "reply", "read_page"]);
  assert.deepEqual(agentToolNames({ ...all, isPrivate: false, webOnly: false, canReply: false }), ["finish", "send_message"]);
  assert.deepEqual(agentToolNames({ ...all, isPrivate: true, webOnly: false, canReply: false }), ["finish", "save_note"]);
});

test("private chat keys isolate members and do not reuse group or legacy history", () => {
  assert.equal(scopedChatKey("123", "member-a", undefined), "member:member-a:123");
  assert.notEqual(scopedChatKey("123", "member-a", undefined), scopedChatKey("123", "member-b", undefined));
  assert.equal(scopedChatKey("-123", "member-a", "group-123"), null);
  assert.equal(scopedChatKey("123", undefined, undefined), null);
});

test("translations accept only known keys, text values, and matching placeholders", () => {
  const source = serializeEnglish();
  const candidate = {
    revisionLabel: { $fn: "ஆவணம் ⟦0⟧", extra: "unexpected" },
    approveRevision: { $fn: "ஆவணம் ⟦1⟧" },
    stanceLabels: { agree: "ஒப்புக்கொள்", object: null, extra: "unexpected" },
    unknown: "unexpected",
  };
  assert.deepEqual(validateUiStrings(candidate, source), {
    revisionLabel: { $fn: "ஆவணம் ⟦0⟧" },
    stanceLabels: { agree: "ஒப்புக்கொள்" },
  });
});
