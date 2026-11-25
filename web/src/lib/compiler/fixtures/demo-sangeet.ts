import type { Snapshot } from "../types";

const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * The PRD's demo Sangeet (Solution → Demo wedding).
 * The venue cutoff starts UNRESOLVED: the Samvaad call (issue #6) resolves it live.
 * Tests (issue #3) should vary the cutoff: 21:00 / 21:30 / 22:00.
 */
export const demoSangeet: Snapshot = {
  weddingId: "demo",
  revision: 1,
  activities: [
    { id: "makeup", functionKind: "sangeet", title: "Bride makeup (Meera)", kind: "makeup", start: t("18:30"), end: t("19:55"), flexible: false },
    {
      id: "dinner", functionKind: "sangeet", title: "Dinner service", kind: "dinner", start: t("20:30"), end: t("22:00"), flexible: false,
      requestedBy: { side: "A", memberName: "Aai", priority: "must" },
    },
    {
      id: "dance", functionKind: "sangeet", title: "Cousins' dance", kind: "dance", start: t("21:45"), end: t("22:05"), flexible: true,
      requiresAmplifiedMusic: true, requestedBy: { side: "B", memberName: "Riya", priority: "prefer" },
    },
    { id: "video", functionKind: "sangeet", title: "Video coverage", kind: "coverage", start: t("18:00"), end: t("22:00"), flexible: false },
  ],
  facts: [
    { id: "f-dinner", kind: "dinner_start", functionKind: "sangeet", value: t("20:30"), status: "confirmed", source: { channel: "seed", ref: "household-A-marathi-note", wording: "आजीसाठी जेवण ८:३० ला सुरू व्हायला हवं" } },
    { id: "f-coverage", kind: "coverage_end", functionKind: "sangeet", value: t("22:00"), status: "confirmed", source: { channel: "quote", ref: "videographer-quote", wording: "Coverage until 10 pm" } },
    { id: "f-cutoff", kind: "music_cutoff", functionKind: "sangeet", value: null, status: "unresolved", source: { channel: "quote", ref: "venue-quote", wording: "Music subject to venue restrictions" } },
    { id: "f-overtime", kind: "overtime_rate", functionKind: "sangeet", value: null, status: "unresolved", source: { channel: "quote", ref: "videographer-quote", wording: "Overtime on request" } },
  ],
};
