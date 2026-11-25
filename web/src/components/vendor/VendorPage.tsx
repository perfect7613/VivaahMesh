"use client";
import { useEffect, useState } from "react";
import { dict, isBase, isRtl, pickLang, registerDict, tr } from "@/lib/i18n";
import type { VendorView } from "@/lib/vendors";

/** A vendor's run sheet, opened from their personal link: only what the family approved for them. */
export function VendorPage({ code }: { code: string }) {
  const [page, setPage] = useState<VendorView | null | undefined>(undefined);
  const [error, setError] = useState<"broken" | "closed" | null>(null);
  const [lang, setLang] = useState("en");
  const [, setLoadedLangs] = useState(0);
  const t = tr(lang);

  useEffect(() => {
    let alive = true;
    fetch(`/api/vendor?code=${encodeURIComponent(code)}`)
      .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }))
      .then(({ ok, status, json }) => {
        if (!alive) return;
        // Vendors have no language on file, so follow the phone's language (Marathi, Hindi or English).
        setLang(pickLang(navigator.language.slice(0, 2)));
        if (ok) return setPage(json.page as VendorView);
        setPage(null);
        setError(status === 403 && json.error === "stage_locked" ? "closed" : "broken");
      })
      .catch(() => alive && (setPage(null), setError("broken")));
    return () => {
      alive = false;
    };
  }, [code]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
    if (isBase(lang) || dict[lang]) return;
    let alive = true;
    fetch(`/api/i18n?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && registerDict(lang, j.data))
      .catch(() => {})
      .finally(() => alive && setLoadedLangs((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [lang]);

  if (page === undefined) return <Shell><p className="animate-pulse text-center text-4xl" aria-label="Loading">🌼</p></Shell>;
  if (page === null) return <Shell><p className="text-center text-[16px]">{error === "closed" ? t.vendorNotOpen : t.guestLinkBroken}</p></Shell>;

  return (
    <Shell>
      <header className="mb-6">
        <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-sindoor">
          {t.vendorCategories[page.vendor.category] ?? page.vendor.category}
          {page.sample ? <span className="ml-2 rounded-full bg-marigold-soft px-2 py-0.5 normal-case tracking-normal text-body">{t.sampleData}</span> : null}
        </p>
        <h1 className="font-display text-[30px] leading-tight">{page.vendor.name}</h1>
        <p className="mt-1 text-[16px] text-body">{t.vendorRunSheet}</p>
      </header>

      {page.contact ? (
        <a href={`tel:${page.contact.phone.replace(/[^+\d]/g, "")}`} className="pressable mb-6 flex min-h-14 items-center justify-between gap-3 rounded-3xl border border-marigold/50 bg-marigold-soft px-5 py-3">
          <span>
            <span className="block text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{t.onGroundContact}</span>
            <span className="block font-medium">{page.contact.name}</span>
          </span>
          <span className="text-[15px] font-semibold text-sindoor">📞 {page.contact.phone}</span>
        </a>
      ) : null}

      {page.items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card px-4 py-4 text-[15px] text-muted">{t.vendorNothingShared}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.items.map((i) => (
            <li key={`${i.functionId}:${i.package}`} className="rounded-3xl border border-line bg-card p-4">
              <p className="font-display text-[20px]">{i.function}</p>
              <p className="text-[13px] text-muted">{[i.onDate, i.startsAt?.slice(0, 5), i.venue].filter(Boolean).join(" · ")}</p>
              {i.arrivalTime ? <p className="mt-2 inline-block rounded-full bg-mehendi/15 px-3 py-1 text-[14px] font-medium text-mehendi">{t.arriveBy(i.arrivalTime)}</p> : null}
              {i.brief ? (
                <div className="mt-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">{t.briefLabel}</p>
                  <p className="text-[15px] leading-relaxed">{i.brief}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="toran" />
      <main className="relative mx-auto w-full max-w-md px-5 pb-16 pt-6">{children}</main>
    </div>
  );
}
