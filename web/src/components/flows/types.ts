// Client-side mirror of the server's WeddingView (src/lib/server/weddings.ts).
export interface View {
  realtimeTopic: string | null;
  /** Resolved server-side by Flagsmith for this viewer (household, language, role, stage). */
  flags: { source: "flagsmith" | "safe_defaults"; on: Record<string, boolean>; policy: { version: string; strategy: string } };
  me: { id: string; householdId: string | null; displayName: string; language: string; isCouple: boolean; role: string; canManage: boolean };
  wedding: {
    id: string; partnerA: string; partnerB: string; date: string | null; city: string | null;
    guestCount: number | null; budgetInr: number | null; stage: string; coupleCode: string | null;
  };
  households: { id: string; side: "A" | "B"; name: string; inviteCode: string | null; members: { id: string; name: string; role: string; isCouple: boolean; isParentDelegate: boolean }[] }[];
  functions: { id: string; kind: string; title: string; sort: number; on_date: string | null; starts_at: string | null; venue: string | null; details: string | null }[];
  priorities: { id: string; kind: string; note: string | null; visibility: "shared" | "household"; source: string; voiceTranscript?: boolean; author: string; family: string; createdAt: string }[];
}

export interface InvitePreview {
  kind: "household" | "couple";
  family: string;
  couple: string;
  date: string | null;
  city: string | null;
}
