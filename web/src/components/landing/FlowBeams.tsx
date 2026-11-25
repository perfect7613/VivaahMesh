"use client";
import { useRef, type ReactNode, type RefObject } from "react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { TelegramIcon, VivaahMark, WhatsAppIcon } from "./BrandIcons";

function Node({ nodeRef, children, label, className = "" }: { nodeRef: RefObject<HTMLDivElement | null>; children: ReactNode; label: string; className?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={nodeRef} className={`z-10 grid size-14 place-items-center rounded-full border border-[#e9d9b8] bg-[#fffdf8] shadow-[0_6px_20px_-8px_rgba(120,40,10,0.3)] ${className}`}>
        {children}
      </div>
      <span className="text-center text-[13px] leading-tight text-[#6b5d50]">{label}</span>
    </div>
  );
}

const Mic = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="text-[#b3261e]">
    <rect x="8.6" y="2.6" width="6.8" height="12" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M5.4 11a6.6 6.6 0 0 0 13.2 0M12 17.6v3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Where messages come from (left), the plan (centre), who it reaches (right). */
export function FlowBeams() {
  const box = useRef<HTMLDivElement>(null);
  const tg = useRef<HTMLDivElement>(null);
  const wa = useRef<HTMLDivElement>(null);
  const voice = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const famA = useRef<HTMLDivElement>(null);
  const famB = useRef<HTMLDivElement>(null);
  const couple = useRef<HTMLDivElement>(null);

  const beam = { containerRef: box, pathColor: "#c9a86a", pathOpacity: 0.35, gradientStartColor: "#e8a317", gradientStopColor: "#b3261e", duration: 4 };

  return (
    <div ref={box} className="relative mx-auto flex w-full max-w-3xl items-center justify-between px-2 py-6 sm:px-8">
      <div className="flex flex-col gap-8">
        <Node nodeRef={tg} label="Telegram">
          <TelegramIcon size={26} className="text-[#229ED9]" />
        </Node>
        <Node nodeRef={wa} label="WhatsApp group">
          <WhatsAppIcon size={26} className="text-[#25D366]" />
        </Node>
        <Node nodeRef={voice} label="Voice note">
          <Mic />
        </Node>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div ref={hub} className="z-10 grid size-24 place-items-center rounded-full border border-[#e8a317]/60 bg-[#fffdf8] shadow-[0_18px_40px_-14px_rgba(179,38,30,0.45)]">
          <VivaahMark size={56} />
        </div>
        <span className="text-[13px] font-semibold tracking-wide text-[#2a1f14]">One plan</span>
      </div>

      <div className="flex flex-col gap-8">
        <Node nodeRef={famA} label="Patil family" className="font-[family-name:var(--font-tiro)] text-lg text-[#2a1f14]">
          पा
        </Node>
        <Node nodeRef={couple} label="The couple">
          <span className="text-xl" aria-hidden>💍</span>
        </Node>
        <Node nodeRef={famB} label="Deshmukh family" className="font-[family-name:var(--font-tiro)] text-lg text-[#2a1f14]">
          दे
        </Node>
      </div>

      <AnimatedBeam {...beam} fromRef={tg} toRef={hub} curvature={-40} />
      <AnimatedBeam {...beam} fromRef={wa} toRef={hub} delay={0.6} />
      <AnimatedBeam {...beam} fromRef={voice} toRef={hub} curvature={40} delay={1.2} />
      <AnimatedBeam {...beam} fromRef={hub} toRef={famA} curvature={-40} delay={1.8} />
      <AnimatedBeam {...beam} fromRef={hub} toRef={couple} delay={2.1} />
      <AnimatedBeam {...beam} fromRef={hub} toRef={famB} curvature={40} delay={2.4} />
    </div>
  );
}
