// Sarvam's extracted values can only confirm the narrow question authorized for this call.
export function browserEvidence(
  variables: Record<string, unknown>,
  transcript: readonly { role: "agent" | "user"; text: string }[],
) {
  const answers = transcript.filter((turn) => turn.role === "user");
  const wording = variables.vendor_wording ?? variables.cutoff_wording;
  const quote = typeof wording === "string" ? wording.trim() : "";
  const verified = quote.length > 0 && answers.some((turn) => turn.text.includes(quote));
  const scope = variables.cutoff_scope;
  const time = variables.music_cutoff;
  const validTime = typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  const confirmation = variables.confirmed ?? variables.cutoff_status;
  const confirmed = verified && validTime && (scope === "whole_event" || scope === "sangeet_only")
    && (confirmation === "yes" || confirmation === "confirmed");
  return {
    ...variables,
    music_cutoff: confirmed ? time : "",
    confirmed: confirmed ? "yes" : "no",
    vendor_wording: verified ? quote : (answers.at(-1)?.text ?? ""),
  };
}
