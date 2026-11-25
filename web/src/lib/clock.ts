/**
 * Parses a spoken/extracted evening time into a minute of the day.
 * Accepts "22:00", "10 pm", "10:30 PM", "10", "दस बजे" is NOT handled (the agent extracts digits).
 * A bare hour from 5 to 11 is read as evening, because these are cutoffs for evening functions.
 * Anything else returns null, so an unclear answer stays unresolved instead of becoming a guess.
 */
export function parseClock(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59 || h > 23) return null;
  if (m[3] === "pm" && h < 12) h += 12;
  else if (m[3] === "am" && h === 12) h = 0;
  else if (!m[3] && !m[2] && h >= 5 && h <= 11) h += 12;
  else if (!m[3] && m[2] && h >= 5 && h <= 11) h += 12;
  return h * 60 + min;
}
