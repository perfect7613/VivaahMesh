"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client/telegram";
import { base, tr, type Lang } from "@/lib/i18n";
import { formatVenueTime } from "@/lib/venue-time";
import { shareInvite } from "./shared";

export type MakeupEnquiryView = {
  functionKind: string;
  proposalId: string;
  artist: string;
  readyBy: number;
  status: "open" | "confirmed" | "withdrawn";
  expired: boolean;
  reply: { source: "typed" | "voice"; wording: string } | null;
};

const text = {
  en: {
    waiting: "Waiting for a reply", renewing: "Preparing reply link…", getLink: "Get reply link",
    renewLink: "Renew expired link", sharing: "Share reply link", copied: "Link copied",
    failed: "Could not prepare or share the link. Try again.",
    invite: "Please confirm the requested makeup time for the wedding.",
    replies: "Makeup replies", confirmed: "Timing confirmed", withdrawn: "Option withdrawn",
    voice: "Voice reply", typed: "Typed reply",
  },
  hi: {
    waiting: "जवाब का इंतज़ार", renewing: "जवाब का लिंक तैयार हो रहा है…", getLink: "जवाब का लिंक पाएँ",
    renewLink: "नया जवाब लिंक बनाएँ", sharing: "जवाब का लिंक भेजें", copied: "लिंक कॉपी हुआ",
    failed: "लिंक तैयार नहीं हुआ या भेज नहीं पाए। फिर कोशिश करें।",
    invite: "कृपया शादी के लिए मेकअप का समय पक्का करें।",
    replies: "मेकअप के जवाब", confirmed: "समय पक्का है", withdrawn: "विकल्प वापस लिया गया",
    voice: "आवाज़ में जवाब", typed: "लिखा हुआ जवाब",
  },
  mr: {
    waiting: "उत्तराची प्रतीक्षा", renewing: "उत्तराची लिंक तयार होत आहे…", getLink: "उत्तराची लिंक मिळवा",
    renewLink: "नवीन उत्तर लिंक तयार करा", sharing: "उत्तराची लिंक पाठवा", copied: "लिंक कॉपी झाली",
    failed: "लिंक तयार झाली नाही किंवा पाठवता आली नाही. पुन्हा प्रयत्न करा.",
    invite: "कृपया लग्नासाठी मेकअपची वेळ निश्चित करा.",
    replies: "मेकअपची उत्तरे", confirmed: "वेळ निश्चित झाली", withdrawn: "पर्याय मागे घेतला",
    voice: "आवाजातील उत्तर", typed: "लिहिलेले उत्तर",
  },
};
const button = "pressable min-h-12 rounded-xl border border-marigold/60 bg-marigold-soft px-3 font-semibold focus-visible:ring-2 focus-visible:ring-marigold focus-visible:ring-offset-2 disabled:opacity-60";

export function AskMakeupArtist({ weddingId, proposalId, artist, readyBy, enquired, canAsk, lang, onUpdate }: {
  weddingId: string;
  proposalId: string;
  artist: string;
  readyBy: number;
  enquired?: MakeupEnquiryView;
  canAsk: boolean;
  lang: Lang;
  onUpdate: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);
  const t = text[base(lang)];

  async function ask() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setFailed(false);
    try {
      const { replyPath } = await api<{ replyPath: string | null }>("/api/calls/makeup", {
        body: { weddingId, proposalId, readyBy },
      });
      setLink(replyPath ? new URL(replyPath, window.location.origin).href : null);
      setCopied(false);
    } catch {
      setFailed(true);
    } finally {
      sending.current = false;
      setPending(false);
      onUpdate();
    }
  }

  async function share(url: string) {
    setFailed(false);
    try {
      if (await shareInvite(url, t.invite) === "copied") setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  const replyLink = enquired?.expired ? null : link;
  return (
    <div className="mt-2 space-y-2">
      {enquired?.status === "open" && !enquired.expired ? <p role="status" className="text-sm">{t.waiting}</p> : null}
      {failed ? <p role="alert">{t.failed}</p> : null}
      {canAsk && !replyLink ? (
        <button type="button" className={button} disabled={pending} aria-busy={pending} onClick={() => void ask()}>
          {pending ? t.renewing : enquired?.expired ? t.renewLink : enquired ? t.getLink : tr(lang).askWhom(artist)}
        </button>
      ) : null}
      {replyLink ? (
        <>
          <button type="button" className={button} onClick={() => void share(replyLink)}>{copied ? t.copied : t.sharing}</button>
          <p className="break-all text-sm select-all">{replyLink}</p>
        </>
      ) : null}
    </div>
  );
}

export function MakeupReplies({ enquiries, lang }: { enquiries: MakeupEnquiryView[]; lang: Lang }) {
  const replies = enquiries.filter((enquiry) => enquiry.reply);
  if (replies.length === 0) return null;
  const t = text[base(lang)];
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t.replies}</h3>
      <ul className="space-y-2">
        {replies.map((enquiry) => (
          <li
            key={`${enquiry.functionKind}:${enquiry.proposalId}:${enquiry.readyBy}`}
            className="space-y-1 rounded-xl border border-line bg-card p-3"
          >
            <p className="font-semibold">{enquiry.artist} · {formatVenueTime(enquiry.readyBy, lang)}</p>
            <p className="text-sm">
              {enquiry.status === "confirmed" ? t.confirmed : t.withdrawn}
              {enquiry.reply ? ` · ${t[enquiry.reply.source]}` : ""}
            </p>
            <blockquote className="break-words" dir="auto" lang="">{enquiry.reply?.wording}</blockquote>
          </li>
        ))}
      </ul>
    </section>
  );
}
