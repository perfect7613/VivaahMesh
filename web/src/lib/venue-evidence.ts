import type { Fact } from "./compiler/types";

export type VenueEvidence = {
  callId: string;
  functionKind: string;
  functionDate?: string | null;
  channel: "samvaad_call" | "browser_agent";
  transcript: { role: "user" | "agent"; text: string }[];
  variables: Record<string, unknown>;
  connected: boolean;
  originalTranscript: boolean;
};

const devanagari = "०१२३४५६७८९";
const hourWords: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  एक: 1, दोन: 2, दो: 2, तीन: 3, चार: 4, पाच: 5, पांच: 5, पाँच: 5, सहा: 6, छह: 6, सात: 7, आठ: 8,
  नऊ: 9, नौ: 9, दहा: 10, दस: 10, अकरा: 11, ग्यारह: 11, बारा: 12, बारह: 12,
};
const timeToken = new RegExp(
  `(?<![\\p{L}\\p{M}\\d:])(\\d{1,2}|${Object.keys(hourWords).join("|")})(?::(\\d{2}))?` +
  "(?:\\s*(a\\.?\\s*m\\.?|p\\.?\\s*m\\.?|वाजता|बजे))?(?![\\p{L}\\p{M}\\d:])",
  "giu",
);
const correction = /(?<![\p{L}\p{M}])(?:actually(?:[\s,]+make it)?|make it|i meant?|correction|sorry|नाही|नहीं|म्हणजे|खरं तर|मेरा मतलब|बल्कि)(?![\p{L}\p{M}])/iu;
const uncertain = /\b(?:not sure|not certain|don['’]?t know|do not know|(?:cannot|can['’]?t|won['’]?t) (?:say|confirm|answer)|maybe|perhaps|probably|approximately|roughly|around|it depends|depends on|i think|i guess|guessing|subject to|between|except|if they|if we)\b|-ish\b|माहित नाही|खात्री नाही|कदाचित|बहुतेक|पता नहीं|नहीं पता|शायद|लगभग/iu;
const cutoffTopic = /\b(?:amplified|music|cutoff|curfew|sound limit|speakers?|whole (?:event|function))\b|(?:संगीत|म्युझिक|ध्वनी|आवाज|आवाज़|माइक|गाना)/iu;
const asksQuestion = /[?？]|\b(?:what time|when (?:does|must|should|will)|does (?:that|the)|is (?:that|it)|can you|could you|please (?:tell|confirm|clarify)|confirm (?:it|that|the)|correct\b)|(?:किती वाजता|कधी|कितने बजे|कब|बताइए|सांगा)/iu;
const clarification = /\b(?:clarify|confirm|repeat|sorry|did you say|do you mean|is that|does that|is it|does it|and that)\b|(?:म्हणजे|पुन्हा|का\s*\?|कृपया|वापस|दोहर)/iu;

const functionAliases: Record<string, RegExp> = {
  sangeet: /\bsangeet\b|संगीत\s*(?:समारंभ|कार्यक्रम)/iu,
  ceremony: /\b(?:ceremony|wedding rituals?)\b|(?:लग्नविधी|विवाह संस्कार)/iu,
  reception: /\breception\b|(?:रिसेप्शन|स्वागत समारंभ)/iu,
  haldi: /\bhaldi\b|(?:हळद|हल्दी)/iu,
  mehendi: /\bmeh(?:en|n)d[ie]\b|(?:मेहंदी|मेंदी)/iu,
  engagement: /\bengagement\b|(?:साखरपुडा|सगाई)/iu,
};

type Period = "am" | "pm";
type Answer = { wording: string; value: number | null };

function timeTokens(wording: string) {
  const text = wording.replace(/[०-९]/g, (digit) => String(devanagari.indexOf(digit))).replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");
  return [...text.matchAll(timeToken)].filter(({ index, 0: token }) =>
    !/^\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b|^\s*(?:मिनिट|मिनट|तास|घंटे|सेकंड)/iu.test(text.slice(index + token.length)),
  );
}

function markerIn(match: RegExpMatchArray): string | undefined {
  return match[3]?.toLowerCase().replace(/[.\s]/g, "");
}

function periodIn(text: string, tokens = timeTokens(text)): "conflicting" | Period | null {
  const markers = tokens.map(markerIn);
  const evening = markers.includes("pm") || /रात्री|रात\s+के|शाम|संध्याकाळ|\b(?:night|evening)\b/iu.test(text);
  const morning = markers.includes("am") || /सकाळ|सुबह|\bmorning\b/iu.test(text);
  if (evening && morning) return "conflicting";
  return evening ? "pm" : morning ? "am" : null;
}

function fromClock(wording: string, inheritedPeriod: Period | null): number | null {
  if (uncertain.test(wording) || /[?？]\s*$/u.test(wording)) return null;
  const matches = timeTokens(wording);
  if (matches.length !== 1) return null;
  const [, rawHour, rawMinute] = matches[0];
  const hours = Object.hasOwn(hourWords, rawHour.toLowerCase()) ? hourWords[rawHour.toLowerCase()] : Number(rawHour);
  const minutes = Number(rawMinute ?? 0);
  if (minutes > 59) return null;

  const marker = markerIn(matches[0]);
  const statedPeriod = periodIn(wording, matches);
  if (statedPeriod === "conflicting") return null;
  if (rawMinute && hours <= 23 && (hours > 12 || hours === 0 || (!statedPeriod && /^0/.test(rawHour))) && marker !== "am" && marker !== "pm") {
    const actualPeriod = hours >= 12 ? "pm" : "am";
    return statedPeriod && actualPeriod !== statedPeriod ? null : hours * 60 + minutes;
  }
  const period = statedPeriod ?? inheritedPeriod;
  return period && hours >= 1 && hours <= 12 ? (hours % 12 + (period === "pm" ? 12 : 0)) * 60 + minutes : null;
}

export function clockMinutes(wording: string): number | null {
  return fromClock(wording, null);
}

function namedFunctions(wording: string): string[] {
  return Object.entries(functionAliases).flatMap(([kind, alias]) => alias.test(wording) ? [kind] : []);
}

function fitsFunction(wording: string, functionKind: string): boolean {
  const named = namedFunctions(wording);
  return named.length === 0 || named.includes(functionKind);
}

function nearestUserTurn(transcript: VenueEvidence["transcript"], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (transcript[i].role === "user") return i;
    if (asksQuestion.test(transcript[i].text) && !cutoffTopic.test(transcript[i].text) && !clarification.test(transcript[i].text)) break;
  }
  return -1;
}

function correctionPhrases(wording: string): string[] {
  const cuts = [...wording.matchAll(new RegExp(correction.source, "giu"))]
    .map(({ index }) => index)
    .filter((index) => index > 0);
  const boundaries = [0, ...cuts, wording.length];
  return boundaries.slice(1).map((end, index) => wording.slice(boundaries[index], end).trim()).filter(Boolean);
}

function answerChain(input: VenueEvidence, anchor: number): Answer[] {
  const { transcript, functionKind } = input;
  let first = anchor;
  while (transcript[first].text.trim().search(correction) === 0) {
    const previous = nearestUserTurn(transcript, first);
    if (previous < 0 || !timeTokens(transcript[previous].text).length || !fitsFunction(transcript[previous].text, functionKind)) break;
    first = previous;
  }

  const answers: Answer[] = [];
  let period: Period | null = null;
  let questionAboutCutoff: boolean | null = null;
  // A scoped question can provide the period that a terse reply leaves implicit.
  const question = transcript[first - 1];
  if (question?.role === "agent" && cutoffTopic.test(question.text) && fitsFunction(question.text, functionKind)) {
    const statedPeriod = periodIn(question.text);
    if (statedPeriod !== "conflicting") period = statedPeriod;
  }

  for (let i = first; i < transcript.length; i++) {
    const { role, text } = transcript[i];
    if (role === "agent") {
      if (asksQuestion.test(text)) {
        questionAboutCutoff = fitsFunction(text, functionKind) && (cutoffTopic.test(text) || clarification.test(text));
        const statedPeriod = periodIn(text);
        if (questionAboutCutoff && statedPeriod) period = statedPeriod === "conflicting" ? null : statedPeriod;
      }
      continue;
    }
    const explicitCutoff = cutoffTopic.test(text);
    const plausibleChange = timeTokens(text).length > 0 || uncertain.test(text) || correction.test(text);
    const respondsToCutoff = i <= anchor || (plausibleChange && (
      explicitCutoff || questionAboutCutoff === true || (questionAboutCutoff === null && (correction.test(text) || uncertain.test(text)))
    ));
    questionAboutCutoff = null;
    if (!respondsToCutoff) continue;

    for (const wording of correctionPhrases(text)) {
      const value = fitsFunction(wording, functionKind) ? fromClock(wording, period) : null;
      // Once a candidate is uncertain, carry forward only a period spoken by the vendor or asked explicitly.
      const statedPeriod = periodIn(wording);
      period = value === null ? (statedPeriod === "conflicting" ? null : statedPeriod) : value >= 12 * 60 ? "pm" : "am";
      const previous = answers.at(-1);
      if (previous?.value === value && previous.wording === wording) continue;
      answers.push({ wording, value });
    }
  }
  return answers;
}

export function venueFollowUpCount({ connected, transcript }: Pick<VenueEvidence, "connected" | "transcript">): number {
  if (!connected) return 0;
  let questions = 0;
  for (const turn of transcript) {
    if (turn.role === "agent" && asksQuestion.test(turn.text) && (
      cutoffTopic.test(turn.text) || (questions > 0 && (clarification.test(turn.text) || clockMinutes(turn.text.replace(/[?？]\s*$/u, "")) !== null))
    )) {
      questions++;
    }
  }
  return Math.max(0, questions - 1);
}

export function venueEvidence(input: VenueEvidence): Fact[] {
  const { callId, functionKind, channel, transcript, variables, connected, originalTranscript } = input;
  const quote = typeof variables.cutoff_wording === "string" ? variables.cutoff_wording.trim() : "";
  const anchor = quote && originalTranscript && connected
    ? transcript.findLastIndex((turn) => turn.role === "user" && turn.text.includes(quote))
    : -1;
  const lastWord = originalTranscript && connected ? transcript.findLast((turn) => turn.role === "user")?.text.trim() ?? "" : "";
  const scope = variables.cutoff_scope;
  const scopedFunction = variables.cutoff_function;
  const scopedDate = variables.cutoff_date;
  const functionMatches = scopedFunction == null || scopedFunction === functionKind;
  const dateMatches = scopedDate == null || (typeof scopedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(scopedDate) && (!input.functionDate || scopedDate === input.functionDate));
  const caseScope = scope === "whole_function" || scope === "whole_event";
  const confirmedScope = scope === "amplified_music" || (caseScope && (
    scopedFunction === functionKind || (anchor >= 0 && namedFunctions(transcript[anchor].text).includes(functionKind))
  ));
  const answers = anchor >= 0 && confirmedScope && functionMatches && dateMatches ? answerChain(input, anchor) : [];
  const outcome = variables.cutoff_status;
  if (answers.length && outcome != null && outcome !== "confirmed") {
    // Preserve earlier provenance while preventing a declined or unconfirmed conclusion from applying.
    const last = answers[answers.length - 1];
    answers[answers.length - 1] = { ...last, value: null };
  }
  if (!answers.length) answers.push({ wording: lastWord, value: null });

  const factId = (index: number) => index === answers.length - 1 ? `venue:${callId}` : `venue:${callId}:${index + 1}`;
  return answers.map(({ wording, value }, index) => ({
    id: factId(index),
    kind: "music_cutoff",
    functionKind,
    value,
    status: value === null ? "unresolved" : "confirmed",
    source: { channel, ref: callId, wording },
    ...(index > 0 ? { supersedes: factId(index - 1) } : {}),
  }));
}
