import { WhatsAppIcon, VivaahMark } from "./BrandIcons";

/**
 * The honest answer to "couldn't a WhatsApp group do this?": the same Sangeet, twice.
 * Left: the messages a family group actually has. Right: what VivaahMesh works out from them.
 */
const CHAT: { who: string; text: string; time: string; me?: boolean; deva?: boolean }[] = [
  { who: "Aai", text: "आजीसाठी जेवण ८:३० लाच हवं", time: "7:02 pm", deva: true },
  { who: "Kabir", text: "Dance slot is 9:45 to 10:05, we need the full 20 min 🙏", time: "7:10 pm" },
  { who: "Mama", text: "Videographer said till 10 only. Overtime extra, he'll tell rate", time: "7:31 pm" },
  { who: "Riya", text: "Does the hall allow music after 10?? Someone ask", time: "8:15 pm" },
  { who: "You", text: "Will call them tomorrow", time: "8:16 pm", me: true },
  { who: "Kabir", text: "Any update on the dance timing?", time: "3 days later" },
];

const ROWS: [string, string, string][] = [
  ["The clash", "Someone notices at the rehearsal, if they scroll far enough.", "Flagged the moment the facts disagree: the dance runs 5 minutes past video coverage."],
  ["Calling the venue", "Whoever feels guilty enough calls, then reports back from memory.", "A parent taps Authorize. Sarvam's voice agent calls, asks one question, and saves the venue's exact words."],
  ["The options", "Forty messages of suggestions, half of them about something else.", "Up to three options, ranked, each with its cost and whose wish it keeps."],
  ["Two families", "One group means everyone sees everything, so the real talk moves to a second group.", "Each family keeps private notes. The budget stays with the couple."],
  ["Languages", "Aai's voice note gets a 👍 from people who didn't listen to it.", "Voice notes are transcribed, and each person reads the plan in Marathi, Hindi or English."],
];

export function GroupVsPlan() {
  return (
    <section id="why" className="mx-auto max-w-6xl scroll-mt-10 px-5 py-20 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#b3261e]">Couldn&apos;t a WhatsApp group do this?</p>
        <h2 className="font-[family-name:var(--font-gloock)] text-[36px] leading-tight sm:text-[44px]">
          The group remembers what was said. VivaahMesh works out what it changes.
        </h2>
        <p className="mt-4 text-[17px] text-[#5a4c40]">Same Sangeet, same messages. Keep the group: VivaahMesh reads it and does the follow-up.</p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* The group */}
        <figure className="min-w-0 overflow-hidden rounded-[28px] border border-[#e9d9b8] bg-[#efe7da]">
          <figcaption className="flex items-center gap-3 bg-[#075e54] px-5 py-3.5 text-white">
            <WhatsAppIcon size={20} />
            <span className="font-medium">Patil family · Wedding 💍</span>
            <span className="ml-auto text-[12px] opacity-75">23 members</span>
          </figcaption>
          <ul className="flex flex-col gap-2 px-4 py-5">
            {CHAT.map((m, i) => (
              <li key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-[15px] shadow-sm ${m.me ? "ml-auto bg-[#d9fdd3]" : "bg-white"}`}>
                {!m.me ? <p className="text-[12px] font-semibold text-[#1c7a46]">{m.who}</p> : null}
                <p className={m.deva ? "font-[family-name:var(--font-tiro)] text-[16px]" : ""}>{m.text}</p>
                <p className="mt-0.5 text-right text-[11px] text-[#85776a]">{m.time}</p>
              </li>
            ))}
          </ul>
          <p className="border-t border-[#e0d4bf] px-5 py-3 text-[13px] text-[#85776a]">Nobody called. The dance still ends at 10:05.</p>
        </figure>

        {/* The plan */}
        <figure className="min-w-0 overflow-hidden rounded-[28px] border border-[#e8a317]/50 bg-white shadow-[0_24px_60px_-30px_rgba(179,38,30,0.45)]">
          <figcaption className="flex items-center gap-3 border-b border-[#e9d9b8] px-5 py-3.5">
            <VivaahMark size={22} />
            <span className="font-medium">Sangeet · plan check</span>
            <span className="ml-auto rounded-full bg-[#fbeccb] px-2.5 py-0.5 text-[12px]">Both families see this</span>
          </figcaption>
          <div className="flex flex-col gap-3 p-5">
            <div className="rounded-2xl border border-[#b3261e]/40 bg-[#b3261e]/[0.07] px-4 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#b3261e]">Needs a change · video coverage</p>
              <p className="mt-0.5 font-medium">Cousins&apos; dance · 9:45–10:05 pm</p>
              <p className="text-[14px] text-[#b3261e]">5 min past the videographer&apos;s 10 pm</p>
            </div>
            <div className="rounded-2xl border border-[#e9d9b8] px-4 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#85776a]">📞 Venue call · Sarvam Samvaad</p>
              <p className="mt-1 text-[15px]">&ldquo;Music has to stop by 10. Actually, make it 10:30 for you.&rdquo;</p>
              <p className="mt-1 text-[13px] text-[#4f6b2f]">Saved: music cutoff 10:30 pm, confirmed by the venue owner</p>
            </div>
            <ol className="flex flex-col gap-2">
              <Option n={1} move="Move the dance to 9:20–9:40 pm" cost="No extra cost" why="Dinner stays at 8:30 (Aai, Patil family · must have) · keeps all 20 minutes (Kabir)" />
              <Option n={2} move="Extend video coverage to 10:05 pm" cost="Price pending" why="Nothing moves · waiting on the videographer's overtime rate" pending />
            </ol>
            <p className="text-[13px] text-[#85776a]">Ranked by Flagsmith policy: family wishes first. The couple approves; nothing is booked until then.</p>
          </div>
        </figure>
      </div>

      <div className="mt-10 overflow-hidden rounded-[28px] border border-[#e9d9b8] bg-white/70">
        <div className="hidden grid-cols-[180px_1fr_1fr] gap-6 border-b border-[#e9d9b8] px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#85776a] md:grid">
          <span />
          <span className="flex items-center gap-2"><WhatsAppIcon size={14} className="text-[#25D366]" /> A group on its own</span>
          <span className="flex items-center gap-2"><VivaahMark size={14} /> With VivaahMesh</span>
        </div>
        <dl>
          {ROWS.map(([k, group, mesh], i) => (
            <div key={k} className={`grid gap-2 px-6 py-5 md:grid-cols-[180px_1fr_1fr] md:gap-6 ${i ? "border-t border-[#e9d9b8]" : ""}`}>
              <dt className="font-[family-name:var(--font-gloock)] text-[20px]">{k}</dt>
              <dd className="text-[15px] leading-relaxed text-[#85776a]">{group}</dd>
              <dd className="text-[15px] leading-relaxed text-[#2a1f14]">{mesh}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Option({ n, move, cost, why, pending }: { n: number; move: string; cost: string; why: string; pending?: boolean }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-[#e9d9b8] px-4 py-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#fbeccb] text-[13px] font-semibold">{n}</span>
      <div className="min-w-0">
        <p className="font-medium">{move}</p>
        <p className={`text-[13px] ${pending ? "font-medium text-[#b3261e]" : "text-[#85776a]"}`}>{cost}</p>
        <p className="mt-1 text-[13px] text-[#5a4c40]">✓ {why}</p>
      </div>
    </li>
  );
}
