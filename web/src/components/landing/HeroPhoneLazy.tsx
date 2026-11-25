"use client";
import dynamic from "next/dynamic";

// The Stageshow stage measures the DOM and runs a script, so it renders on the client only.
const HeroPhone = dynamic(() => import("./HeroPhone"), {
  ssr: false,
  loading: () => <div className="aspect-[520/470] w-full" aria-hidden />,
});

export function HeroPhoneLazy() {
  return (
    <div className="mx-auto w-full max-w-[520px]">
      <HeroPhone />
    </div>
  );
}
