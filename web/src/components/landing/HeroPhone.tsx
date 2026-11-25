"use client";
// Hero demo built on the Stageshow kit (MIT, github.com/benjitaylor/skills/stageshow),
// starting from its Telegram product study.
//
// Story, four beats (~11s, plays once in view, holds the result):
//   1. Context: MahiWay has greeted Aai in Marathi.
//   2. Aai types her family's wish in Marathi and sends it.
//   3. Ticks: sent, then read.
//   4. The bot files it under the Patil family, and the plan card beside the phone
//      gains the line with her name on it. That card is the payoff and stays up.
// Real strings: the bot greeting, Aai's message, the bot's reply, the plan card.

import { Avatar, Bubble, Phone, Stage, Stamp, Thread, type Act } from "@/stageshow/kit";
import "@/stageshow/telegram.css";
import "./hero-phone.css";

type Tick = "clock" | "sent" | "read";
type S = { draft: string; sent: boolean; tick: Tick; reply: boolean; card: boolean };

const initial: S = { draft: "", sent: false, tick: "clock", reply: false, card: false };
const poster: S = { draft: "", sent: true, tick: "read", reply: true, card: true };

const MINE = "आजीसाठी जेवण ८:३० ला सुरू व्हायला हवं";
const REST = { x: 300, y: 440 };

async function script(a: Act<S>) {
  await a.wait(900);
  await a.type("draft", MINE, { interval: 55 });
  await a.wait(250);
  await a.click({ at: "send", x: 0.5, y: 0.5 });
  await a.set({ sent: true, draft: "" });
  await a.wait(600);
  await a.set({ tick: "sent" });
  await a.wait(800);
  await a.set({ tick: "read" });
  await a.wait(900);
  await a.set({ reply: true });
  await a.wait(1100);
  await a.set({ card: true });
  await a.wait(3000);
}

function Ticks({ state }: { state: Tick }) {
  return (
    <svg className="tg-ticks" data-state={state} viewBox="0 0 17 11" width="17" height="11" aria-hidden>
      <g className="tg-ticks__clock">
        <circle cx="6" cy="5.5" r="4.6" />
        <path d="M6 3v2.7l1.7 1" />
      </g>
      <path className="tg-ticks__one" pathLength={1} d="M1.2 5.9 4.1 8.8 10.4 1.6" />
      <path className="tg-ticks__two" pathLength={1} d="M7.4 8.1 8.1 8.8 14.4 1.6" />
    </svg>
  );
}

function Meta({ time, tick }: { time: string; tick?: Tick }) {
  return (
    <span className="tg-meta">
      {time}
      {tick && <Ticks state={tick} />}
    </span>
  );
}

const Back = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <path d="M14.5 5 7.5 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Mic = () => (
  <svg viewBox="0 0 24 24" width="25" height="25" aria-hidden>
    <rect x="8.6" y="2.6" width="6.8" height="12" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M5.4 11a6.6 6.6 0 0 0 13.2 0M12 17.6v3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const Menu = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
    <path d="M5 7h14M5 12h14M5 17h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const Send = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
    <path d="M12 19V5.6M6 11.2 12 5.2l6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function HeroPhone() {
  return (
    <Stage<S>
      width={520}
      height={470}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      cursor={{ at: REST, style: "touch" }}
      className="tg vm-hero"
    >
      {(s) => (
        <>
          <Phone width={340} className="tg-phone vm-phone">
            <div className="tg-paper" aria-hidden />
            <header className="tg-head">
              <span className="tg-glass tg-back">
                <Back />
              </span>
              <span className="tg-glass tg-title">
                <span className="tg-name">MahiWay</span>
                <span className="tg-status">bot</span>
              </span>
              <Avatar name="MahiWay" size={48} className="tg-avatar" style={{ background: "linear-gradient(#f3b73a, #e08a12)" }} />
            </header>

            <Thread className="tg-thread">
              <Stamp className="tg-date">Today</Stamp>
              <Bubble from="them">
                नमस्कार आई 🌼 लग्नासाठी काहीही पाठवा, मी ते पाटील कुटुंबाकडे ठेवतो.
                <Meta time="18:02" />
              </Bubble>
              {s.sent && (
                <Bubble from="me" source="draft">
                  {MINE}
                  <Meta time="18:04" tick={s.tick} />
                </Bubble>
              )}
              {s.reply && (
                <Bubble from="them" className="vm-bot">
                  सेव्ह झालं ✅ पाटील कुटुंबाच्या नोट्समध्ये.
                  <span className="vm-inline-btn">आमचं लग्न उघडा</span>
                </Bubble>
              )}
            </Thread>

            <div className="tg-compose">
              <span className="tg-glass tg-round">
                <Menu />
              </span>
              <span className="tg-glass tg-field">
                <span className="tg-field__text" data-target="draft">
                  {s.draft}
                  {s.draft && <i className="tg-caret" />}
                </span>
                <span className="tg-field__ph" data-hide={s.draft ? "" : undefined}>
                  Message
                </span>
              </span>
              <span className="tg-action">
                <span className="tg-glass tg-round tg-mic" data-off={s.draft ? "" : undefined}>
                  <Mic />
                </span>
                <span className="tg-send" data-on={s.draft ? "" : undefined} data-target="send">
                  <Send />
                </span>
              </span>
            </div>
          </Phone>

          {/* Satellite: the shared plan, straddling the phone's edge. */}
          <div className="vm-plan" aria-label="Sangeet plan">
            <p className="vm-plan__eyebrow">Sangeet · Sat 14 Feb</p>
            <ul>
              <li>
                <span className="vm-plan__time">19:00</span>
                <span className="vm-plan__what">Haldi-kumkum</span>
              </li>
              <li className="vm-plan__new" data-on={s.card ? "" : undefined}>
                <span className="vm-plan__time">20:30</span>
                <span className="vm-plan__what">
                  Dinner for elders
                  <span className="vm-plan__who">Aai · Patil family</span>
                </span>
              </li>
              <li>
                <span className="vm-plan__time">21:45</span>
                <span className="vm-plan__what">Cousins&apos; dance</span>
              </li>
            </ul>
          </div>
        </>
      )}
    </Stage>
  );
}
