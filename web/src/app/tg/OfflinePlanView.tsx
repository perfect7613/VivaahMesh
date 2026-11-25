"use client";

import { VivaahMark } from "@/components/landing/BrandIcons";
import { clearOfflinePlan, offlineViewerKey, readOfflinePlanForLocation } from "@/lib/client/offline-plan";
import { useEffect, useState } from "react";

export function OfflinePlanView() {
  const [plan, setPlan] = useState<ReturnType<typeof readOfflinePlanForLocation>>(null);
  useEffect(() => {
    function update() {
      setPlan(readOfflinePlanForLocation(window.location.search));
    }
    const timer = setTimeout(update, 0);
    const accountChanged = (event: StorageEvent) => { if (event.key === offlineViewerKey) update(); };
    window.addEventListener("storage", accountChanged);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", accountChanged);
    };
  }, []);
  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <VivaahMark size={44} />
      <h1 className="mt-5 font-display text-3xl">You’re offline</h1>
      <p className="my-4 text-muted">{plan ? "This is the last wedding schedule saved on this device." : "Reconnect to open your wedding plan."}</p>
      {plan && <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-2xl">{plan.title}</h2>
        <ul className="mt-3 space-y-2">
          {plan.schedule.map((item, index) => <li key={index}>{item.title}{item.time && <span> · {item.time}</span>}</li>)}
        </ul>
        <button className="mt-4 text-sm underline" type="button" onClick={() => {
          clearOfflinePlan();
          setPlan(null);
        }}>Remove saved plan</button>
      </section>}
      <button className="mt-4 text-sm underline" type="button" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}
