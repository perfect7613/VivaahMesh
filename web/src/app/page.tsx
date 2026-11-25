const BOT = process.env.TELEGRAM_BOT_USERNAME ?? "vivaah_bot";

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-14">
      <div className="toran -mx-6 mb-10" />
      <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.2em] text-marigold">VivaahMesh</p>
      <h1 className="font-display text-[40px] leading-[1.1] tracking-tight">One wedding plan for two families.</h1>
      <p className="mt-4 text-[17px] text-muted">
        Each family adds what matters in its own language: Marathi, Hindi or English. Everyone sees what changed, what it costs and whose decision comes next.
      </p>

      <ul className="mt-8 flex flex-col gap-3 text-[15px]">
        <li className="flex gap-3"><span aria-hidden>🌼</span>Set up your wedding in about a minute, right inside Telegram.</li>
        <li className="flex gap-3"><span aria-hidden>💌</span>Invite the other family with one link. Their wishes stay theirs.</li>
        <li className="flex gap-3"><span aria-hidden>🎙️</span>Send a message or voice note to the bot and it lands in your plan.</li>
      </ul>

      <div className="mt-auto pt-12">
        <a
          href={`https://t.me/${BOT}?start=web`}
          className="pressable flex min-h-14 items-center justify-center rounded-2xl bg-marigold text-[17px] font-semibold text-[#2a1f14] shadow-[0_8px_24px_-8px_var(--marigold)]"
        >
          Start on Telegram
        </a>
        <p className="mt-3 text-center text-[13px] text-muted">Opens @{BOT}. No app download needed.</p>
      </div>
    </main>
  );
}
