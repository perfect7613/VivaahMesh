export const SHARED_AGENT_TRIGGERS = ["heartbeat", "manual", "approval", "call_result"] as const;

export const AGENT_CHECKED = { en: "Checked the plan.", hi: "प्लान जाँचा।", mr: "प्लॅन तपासला." };

/** Only a direct, explicit command can send user-entered text to public search providers. */
export function publicSearchTerms(note: string | undefined): string | null {
  const terms = /^\/search[ \t]+([^\r\n]+)$/i.exec(note?.trim() ?? "")?.[1].trim();
  return terms ? terms.slice(0, 200) : null;
}

/** The new scope also excludes legacy history that could contain another family's context. */
export function scopedChatKey(chat: string | undefined, member: string | undefined, channel: string | undefined): string | null {
  if (!chat || !member || channel) return null;
  return `member:${member}:${chat}`;
}

export function agentToolNames(scope: {
  isPrivate: boolean;
  webOnly: boolean;
  canReply: boolean;
  canReadPages: boolean;
  canSaveNote: boolean;
}): string[] {
  const names = ["finish"];
  if (scope.canReply) names.push("reply");
  if (scope.webOnly && scope.canReadPages) names.push("read_page");
  if (scope.isPrivate && !scope.webOnly && scope.canSaveNote) names.push("save_note");
  if (!scope.isPrivate && !scope.webOnly) names.push("send_message");
  return names;
}
