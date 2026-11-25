import { Marquee } from "@/components/ui/marquee";
import { BorderBeam } from "@/components/ui/border-beam";
import { FlowBeams } from "@/components/landing/FlowBeams";
import { HeroPhoneLazy } from "@/components/landing/HeroPhoneLazy";
import { WhatsAppGroup } from "@/components/landing/WhatsAppGroup";
import { TelegramIcon, VivaahMark, WhatsAppIcon } from "@/components/landing/BrandIcons";

const BOT = process.env.TELEGRAM_BOT_USERNAME ?? "vivaah_bot";
const BOT_URL = `https://t.me/${BOT}?start=web`;

// Example requests, the kind each family sends. Illustrative, not quotes from users.
const WISHES: { text: string; who: string; deva?: boolean }[] = [
  { text: "आजीसाठी जेवण ८:३० ला", who: "Aai · Patil family", deva: true },
  { text: "Pure veg at the Sangeet, please", who: "Riya · Deshmukh family" },
  { text: "मुहूर्त ११:४५ ला आहे", who: "Baba · Patil family", deva: true },
  { text: "Cousins' dance needs 20 minutes", who: "Kabir · Deshmukh family" },
  { text: "मेहंदी दोपहर में, धूप से पहले", who: "Nani · Deshmukh family", deva: true },
  { text: "Ramp at the hall for Ajoba's wheelchair", who: "Meera · the couple" },
  { text: "फोटोग्राफर रात दस बजे तक", who: "Mama · Deshmukh family", deva: true },
  { text: "Keep the reception under ₹6 lakh", who: "Aarav · the couple" },
];

const STEPS = [
  {
    n: "१",
    title: "Start in Telegram",
    body: "The couple opens @vivaah_bot, picks Marathi, Hindi or English, names the two families and ticks the functions. It takes about a minute.",
  },
  {
    n: "२",
    title: "Invite the other family",
    body: "Each family gets its own invite link and its own private notes. A note is shared with the other side only when someone flips the switch on it.",
  },
  {
    n: "३",
    title: "Send things the usual way",
    body: "Type to the bot, send it a voice note, or keep chatting in your WhatsApp group. Each request lands in the plan with the sender's name and family on it.",
  },
];

export default function Landing() {
  return (
    <div className="landing relative overflow-x-clip bg-[#fbf6ec] text-[#2a1f14]">
      <div className="toran" />

      {/* ---------- Nav ---------- */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <a href="#" className="flex items-center gap-2.5">
          <VivaahMark size={30} />
          <span className="font-[family-name:var(--font-gloock)] text-xl">VivaahMesh</span>
        </a>
        <div className="flex items-center gap-5 text-[15px]">
          <a href="#how" className="hidden text-[#6b5d50] hover:text-[#2a1f14] sm:inline">How it works</a>
          <a href="#whatsapp" className="hidden text-[#6b5d50] hover:text-[#2a1f14] sm:inline">WhatsApp</a>
          <a href={BOT_URL} className="pressable flex items-center gap-2 rounded-full bg-[#229ED9] px-4 py-2 font-medium text-white">
            <TelegramIcon size={16} /> Open bot
          </a>
        </div>
      </nav>

      {/* ---------- Hero ---------- */}
      <header className="relative mx-auto grid max-w-6xl items-center gap-6 px-5 pb-10 pt-6 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-14">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-24 size-[620px] rounded-full bg-[radial-gradient(circle,rgba(232,163,23,0.28),transparent_65%)]" />
        <div className="relative min-w-0">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#e8a317]/40 bg-white/60 px-3 py-1 text-[13px] text-[#6b5d50]">
            For shaadi season · <span className="font-[family-name:var(--font-tiro)]">मराठी · हिन्दी</span> · English
          </p>
          <h1 className="font-[family-name:var(--font-gloock)] text-[46px] leading-[1.02] tracking-tight sm:text-[64px]">
            Two families,
            <br />
            <span className="text-[#b3261e]">one wedding plan.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-[#5a4c40]">
            Aai sends a voice note in Marathi. The groom&apos;s mama types in Hindi. VivaahMesh puts both requests into one plan, keeps the name of whoever asked, and tells each family what changed in its own language.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={BOT_URL}
              className="pressable flex min-h-14 items-center justify-center gap-2.5 whitespace-nowrap rounded-2xl bg-[#229ED9] px-6 text-[17px] font-semibold text-white shadow-[0_12px_30px_-12px_#229ED9]"
            >
              <TelegramIcon size={22} /> Start on Telegram
            </a>
            <a
              href="#whatsapp"
              className="pressable flex min-h-14 items-center justify-center gap-2.5 whitespace-nowrap rounded-2xl border border-[#2a1f14]/12 bg-white px-6 text-[17px] font-medium"
            >
              <WhatsAppIcon size={22} className="text-[#25D366]" /> Bring your WhatsApp group
            </a>
          </div>
          <p className="mt-4 text-[14px] text-[#85776a]">Free while in beta. Nothing to install: it runs inside Telegram.</p>
        </div>
        <div className="relative min-w-0">
          <HeroPhoneLazy />
        </div>
      </header>

      {/* ---------- Wishes marquee ---------- */}
      <section aria-label="Example requests from families" className="border-y border-[#e9d9b8] bg-[#fffaf0] py-6">
        <p className="mb-4 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-[#b3261e]">Every request keeps its author</p>
        <div className="relative">
          <Marquee pauseOnHover className="[--duration:48s] [--gap:0.9rem]">
            {WISHES.map((w) => (
              <figure key={w.text} className="w-64 rounded-2xl border border-[#e9d9b8] bg-white px-4 py-3">
                <blockquote className={`text-[16px] leading-snug ${w.deva ? "font-[family-name:var(--font-tiro)] text-[17px]" : ""}`}>{w.text}</blockquote>
                <figcaption className="mt-1.5 text-[12.5px] text-[#4f6b2f]">{w.who}</figcaption>
              </figure>
            ))}
          </Marquee>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#fffaf0]" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#fffaf0]" />
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-10 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#b3261e]">How it works</p>
          <h2 className="font-[family-name:var(--font-gloock)] text-[36px] leading-tight sm:text-[44px]">Families keep talking where they already talk.</h2>
          <p className="mt-4 text-[17px] text-[#5a4c40]">
            Nobody has to learn a new app. Messages from Telegram, WhatsApp and voice notes go into one plan, and each family sees the parts meant for it.
          </p>
        </div>
        <div className="mt-10">
          <FlowBeams />
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-3xl border border-[#e9d9b8] bg-white/70 p-6">
              <span className="font-[family-name:var(--font-tiro)] text-3xl text-[#e8a317]">{s.n}</span>
              <h3 className="mt-2 text-[19px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-[#5a4c40]">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- WhatsApp ---------- */}
      <section id="whatsapp" className="scroll-mt-10 bg-[#f1ead9]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#1c7a46]">
              <WhatsAppIcon size={16} className="text-[#25D366]" /> WhatsApp · in beta
            </p>
            <h2 className="font-[family-name:var(--font-gloock)] text-[36px] leading-tight sm:text-[44px]">Your family group stays where it is.</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-[#5a4c40]">
              Most wedding planning already happens in a WhatsApp group with half the family in it. Link that group to your wedding with one message. Requests, voice notes and quotes from the group reach the plan, and plan changes come back as a single short message in the family&apos;s language.
            </p>
            <ul className="mt-6 flex flex-col gap-3 text-[15.5px]">
              <li className="flex gap-3"><Dot />Voice notes are transcribed with Sarvam&apos;s speech models, so Aai can keep speaking Marathi.</li>
              <li className="flex gap-3"><Dot />Nothing from the group is shared with the other family until someone in your family shares it.</li>
              <li className="flex gap-3"><Dot />It connects as a linked device, the same way WhatsApp Web does. Use a number you are happy to link.</li>
            </ul>
          </div>
          <WhatsAppGroup />
        </div>
      </section>

      {/* ---------- Privacy ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#4f6b2f]">Privacy</p>
            <h2 className="font-[family-name:var(--font-gloock)] text-[36px] leading-tight sm:text-[44px]">Each family keeps its own notes.</h2>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact title="Budget" body="Only the couple can see the total budget." icon="🔒" />
            <Fact title="Family notes" body="Private by default when sent through chat. Each note has its own share switch." icon="🪔" />
            <Fact title="Vendors" body="A vendor gets its own slot: the time, the job and one contact person." icon="📋" />
            <Fact title="Decisions" body="A proposal never books, pays or calls anyone. The person with the authority approves it." icon="✍️" />
          </dl>
        </div>
      </section>

      {/* ---------- Built with ---------- */}
      <section className="border-t border-[#e9d9b8] bg-[#fffaf0]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <p className="mb-8 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-[#85776a]">Built at FestiveHacks, Bengaluru, with</p>
          <div className="grid gap-4 md:grid-cols-3">
            <Sponsor name="Sarvam AI" body="Speech, translation and voice calls in Indian languages. It calls the venue to confirm when the music has to stop." />
            <Sponsor name="Flagsmith" body="Controls how the planner ranks options and which family gets a new feature first, changed live without a redeploy." />
            <Sponsor name="NudgeBee" body="Watches the call pipeline. If a worker stalls, it opens an incident and, after approval, replays the saved answer." />
          </div>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="relative overflow-hidden rounded-[32px] bg-[#2a1f14] px-6 py-14 text-center text-[#fbf6ec] sm:px-12">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 toran opacity-90" />
          <h2 className="font-[family-name:var(--font-gloock)] text-[34px] leading-tight sm:text-[46px]">Set up your wedding tonight.</h2>
          <p className="mx-auto mt-4 max-w-lg text-[17px] text-[#e7dcc8]">
            Open the bot, answer six short questions, and send the invite link to the other family.
          </p>
          <a
            href={BOT_URL}
            className="pressable mx-auto mt-8 inline-flex min-h-14 items-center gap-2.5 rounded-2xl bg-[#e8a317] px-7 text-[17px] font-semibold text-[#2a1f14]"
          >
            <TelegramIcon size={22} /> Open @{BOT}
          </a>
          <BorderBeam size={220} duration={9} colorFrom="#e8a317" colorTo="#b3261e" />
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 pb-10 text-[13px] text-[#85776a] sm:flex-row sm:px-8">
        <span className="flex items-center gap-2"><VivaahMark size={18} /> VivaahMesh · made in one day at FestiveHacks, 25 Nov 2026</span>
        <a href="https://github.com/perfect7613/VivaahMesh" className="hover:text-[#2a1f14]">Source on GitHub</a>
      </footer>
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-[#25D366]" />;
}

function Fact({ title, body, icon }: { title: string; body: string; icon: string }) {
  return (
    <div className="rounded-3xl border border-[#e9d9b8] bg-white/70 p-5">
      <dt className="flex items-center gap-2 font-semibold"><span aria-hidden>{icon}</span>{title}</dt>
      <dd className="mt-1.5 text-[15px] leading-relaxed text-[#5a4c40]">{body}</dd>
    </div>
  );
}

function Sponsor({ name, body }: { name: string; body: string }) {
  return (
    <div className="rounded-3xl border border-[#e9d9b8] bg-white p-6">
      <p className="font-[family-name:var(--font-gloock)] text-[22px]">{name}</p>
      <p className="mt-2 text-[15px] leading-relaxed text-[#5a4c40]">{body}</p>
    </div>
  );
}
