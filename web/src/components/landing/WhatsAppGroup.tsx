import { WhatsAppIcon } from "./BrandIcons";

/** A still of a family WhatsApp group with the bridge's reply in it. Illustrative, not real data. */
export function WhatsAppGroup() {
  return (
    <div className="relative mx-auto w-full max-w-[380px] overflow-hidden rounded-[28px] border border-black/5 bg-[#efeae2] shadow-[0_30px_60px_-24px_rgba(20,60,30,0.35)]">
      <header className="flex items-center gap-3 bg-[#f6f5f3] px-4 py-3">
        <span className="grid size-10 place-items-center rounded-full bg-[#fbeccb] text-lg" aria-hidden>🌼</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[#111b21]">Patil Parivaar · Lagna</p>
          <p className="truncate text-[12px] text-[#667781]">Aai, Baba, Mama, Riya, you</p>
        </div>
        <WhatsAppIcon size={20} className="text-[#25D366]" />
      </header>
      <div className="flex flex-col gap-1.5 px-3 py-4 text-[14.5px] leading-snug text-[#111b21]">
        <Msg who="Mama" color="#c2410c">Caterer said ₹650 a plate for full veg, includes jalebi</Msg>
        <Msg who="Aai" color="#7c3aed">
          <span className="flex items-center gap-2">
            <span aria-hidden>🎙️</span>
            <span className="h-1 w-28 rounded-full bg-[#9ca3af]" />
            <span className="text-[12px] text-[#667781]">0:14</span>
          </span>
        </Msg>
        <div className="mt-1 self-start rounded-lg rounded-tl-none border-l-4 border-[#e8a317] bg-white px-3 py-2 shadow-sm">
          <p className="mb-0.5 text-[12.5px] font-semibold text-[#b3261e]">MahiWay</p>
          <p>📌 Added to the plan</p>
          <p className="text-[13.5px] text-[#3b4a54]">· Catering quote ₹650/plate, veg (Mama)</p>
          <p className="text-[13.5px] text-[#3b4a54]">· “Dinner by 8:30 for Aaji” (Aai, from voice)</p>
          <p className="mt-1 text-[13px] text-[#027eb5] underline">Open our wedding</p>
        </div>
      </div>
    </div>
  );
}

function Msg({ who, color, children }: { who: string; color: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] self-start rounded-lg rounded-tl-none bg-white px-3 py-1.5 shadow-sm">
      <p className="text-[12.5px] font-semibold" style={{ color }}>{who}</p>
      {children}
    </div>
  );
}
