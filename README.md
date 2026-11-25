# VivaahMesh

**One wedding plan for two families, in every family's own language, with an always-on planning agent that listens to the family groups, calls the venue, and never commits anything without the right person.**

Built at **FestiveHacks × WeAreDevelopers Conference India** (25 Nov 2026) with **Sarvam AI**, **Flagsmith** and **NudgeBee**.

- Live: https://vivaahmesh.vercel.app · Telegram: `@vivaah_bot`
- PRD: [#1](https://github.com/perfect7613/VivaahMesh/issues/1), slices in #2 onward · Design principles: [`DESIGN.md`](./DESIGN.md)

## Why not just a WhatsApp group?

A WhatsApp group is where the plan gets *discussed*. It isn't the plan. Aai's "dinner by 8, the elders can't wait" is buried under 200 messages. The venue's "music till 10" is a voice note one cousin heard. Nobody knows which version is current, and one family's private worries leak to the other.

VivaahMesh keeps the groups and adds what they can't do:

| | Family WhatsApp/Telegram group | VivaahMesh |
|---|---|---|
| Who said what | Scrolls away | Every wish is a note credited to the person, private to their family unless they share it |
| Vendor terms | "I think he said 10" | The venue is called (Sarvam), and the answer is stored as evidence, word for word |
| Conflicts | Found on the day | The compiler checks the timeline against every confirmed fact and ranks options |
| Decisions | Whoever shouts last | Each family responds, and the couple approves one exact plan revision. An approval made on an outdated screen is rejected |
| Language | Everyone reads Hinglish | Each person reads in their own language (22 Indian languages + English) |

## What it does

**Families**
- Telegram bot + Mini App (also a PWA). Create a wedding, invite the other family, and pick any of the **22 scheduled Indian languages or English**. Marathi, Hindi and English are hand-written. Every other language is translated once by GLM-5.3 and cached, and Urdu, Kashmiri and Sindhi display right to left.
- **Functions in the family's own words**: Haldi, Sangeet and Pheras, plus anything they add (Tilak, Jaggo, Nikah…), each with its date, time, venue and notes.
- Voice notes in any language are transcribed by **Sarvam Saaras**. **Dictate** (Marathi household input) and a **Bulbul** spoken recap of the approved plan.

**The always-on planning agent** (GLM-5.3 on the **Sarvam Token Factory**)
- Wakes on every message, voice note, family-group update, call result and approval, and on a heartbeat every 5 minutes (GitHub Actions).
- **Reads each family's own group chat** once the couple or a parent adds the bot ("Add me to your family group" in the app). It saves real updates as notes credited to whoever said them and stays quiet otherwise. Mention it or reply to it and it answers in the group.
- **Ask anything**: DM the bot or use the Ask box in the app. It answers from the plan and uses **Firecrawl** web search and page reading for vendors, prices, muhurat dates and customs, citing links. It remembers each conversation.
- Rules enforced in code, not by the prompt: it can't dial or book, it can't leak one family's private note to the other (checked before every message), it sends at most 3 messages per run, and it nudges each audience at most once an hour.

**The plan**
- A pure, deterministic **wedding compiler** checks activities against confirmed facts (music cutoff, photographer coverage, makeup readiness…) and ranks options. Typed vendor terms stay *conditional* until the vendor confirms them.
- **Revision-bound decisions**: each household responds to an exact plan revision, and the couple approves one. Late evidence creates a new revision, so a tap on an outdated screen changes nothing.
- **Venue call** (Sarvam Samvaad outbound): a parent authorizes it and the agent asks the venue for the music cutoff. Corrections made mid-call are kept, and the last answer wins. There is also a browser voice fallback with per-call consent, and a makeup-artist enquiry by link. Until a Sarvam phone number is connected, **rehearsal mode** runs a simulated venue through the same pipeline, labelled "Rehearsal" everywhere.

## Sponsors

### Sarvam AI
| Use | API |
|---|---|
| Always-on agent, tool calling, translation of the whole UI | Token Factory `POST /v2/chat/completions`, model `glm5.3-flash` (switchable to `glm5.3` from Flagsmith) |
| Voice notes in any language | Saaras v4 `speech-to-text` |
| Bot and agent messages in 20 more languages | `sarvam-translate:v1` |
| Venue call | Samvaad voice agent, outbound API + webhook (prompt and variables: [`docs/samvaad-agent.md`](docs/samvaad-agent.md)) |
| Household dictation, spoken recap | Dictate, Bulbul |

### Flagsmith: the control plane (project `VivaahMesh`, Development + Production)
| Flag | What it controls |
|---|---|
| `compiler_policy` (JSON) | Ranking strategy (`preserve_family_priorities` / `minimize_changes` / `lowest_confirmed_cost`), buffers, max options, dance during dinner. Every revision and approval stores the policy version it used |
| `caller_prompt` | Venue-call question variant (A/B, bucketed per call) |
| `voice_channel` | Phone or browser voice |
| `outbound_dialing_enabled` | Kill switch: no real call without it |
| `result_processing_paused` | Kill switch: store call results but don't apply them (NudgeBee recovery flips it back) |
| `agent_enabled`, `agent_model` | Turn the agent off, or switch GLM model live |
| `voice_recap_bulbul`, `conditional_options_ui`, `whatsapp_bridge_enabled`, `onboarding_celebration`, `home_team_section` | Per-segment UI rollouts |
| `stage_sourcing` … `stage_closeout` | Stage gating |

Segments: `marathi_speakers` (language = mr → Bulbul recap), `household_a` (conditional options + WhatsApp bridge), and `stage_*_plus` (wedding_stage). Identities are `wedding:<id>:member:<id>` for per-person UI, and `wedding:<id>` for anything both families must see identically (the compiler policy). If Flagsmith is down, everything falls back to safe defaults: dialing off, agent on.

Create everything with `node web/scripts/flagsmith-setup.mjs`. Flip a flag live with `node web/scripts/flag.mjs <flag> on|off|key=value`.

### NudgeBee: incident and approval-gated recovery
1. A venue answer arrives while `result_processing_paused` is on, or applying it fails. The app stores it and reports a **HIGH** event through NudgeBee `events.store`, with `finding_id = vivaahmesh-call:<attempt_id>`, so a duplicate callback updates the same event. AI analysis is triggered. Agent failures are reported too (once per wedding per hour).
2. The NudgeBee automation `vivaahmesh-call-result-recovery` (created by `web/scripts/nudgebee-setup.mjs`) triggers on that event. It checks state, then **waits for a human approval**.
3. On approval it calls `POST /api/ops/recover`. That turns the Flagsmith kill switch off, waits until the app sees it, and replays every stored answer **exactly once**. Each applied answer resolves its NudgeBee event. Recovery never dials anyone.

## Demo script (≈4 min)

1. **Two families, two languages.** Meera creates the wedding in Marathi and adds "Tilak". Riya joins the other family in Tamil, and the whole app is in Tamil.
2. **Family group.** In Aai's family Telegram group: "Mama says dinner must be by 8, the elders can't wait." The agent saves it as a private Patil-family note credited to Mama. Then "@vivaah_bot what does a Sangeet DJ cost in Pune?" gets an answer with links (Firecrawl).
3. **The conflict.** The plan shows the cousins' dance clashing with dinner, blocked on the venue's music cutoff.
4. **The call.** Aai taps *Call the venue* (Sarvam). The venue says "Music till ten… actually, make it ten-thirty." The correction wins, every phone updates, and 3 options appear, ranked by Flagsmith policy v2.
5. **Flagsmith live.** Switch `compiler_policy` to `lowest_confirmed_cost`. The ranking reorders, and the footer shows the new policy version.
6. **Decide.** Each family responds, and Meera approves option 1. An approval from an outdated screen is rejected. Aai hears the Bulbul recap in Marathi.
7. **NudgeBee.** Turn `result_processing_paused` on, and another call result is stored but not applied. The NudgeBee incident appears with its evidence. Approve the recovery: the flag flips, the answer is applied once, and the event resolves.

Re-run the whole story against any deployment with `node web/scripts/e2e-demo.mjs https://vivaahmesh.vercel.app`.

## Setup from a fresh checkout

Prerequisites: Node 20.9+, the Supabase CLI, the Vercel CLI, and a Telegram bot from @BotFather (`/setprivacy` → **Disable**, so it can read family groups).

```bash
git clone https://github.com/perfect7613/VivaahMesh && cd VivaahMesh
supabase link --project-ref <ref> && supabase db push      # schema + RPCs
cd web && cp .env.example .env.local                        # fill in (table below)
npm install && npm test                                     # 81 tests
npm run dev                                                 # http://localhost:3000/tg (DEV_AUTH_BYPASS=1 for a browser)
node scripts/flagsmith-setup.mjs                            # flags + segments
vercel deploy --prod                                        # then set the same env on Vercel
curl -X POST "$APP_URL/api/telegram/setup" -H "x-setup-secret: $TELEGRAM_WEBHOOK_SECRET"
NUDGEBEE_API_KEY=… OPS_SECRET=… node scripts/nudgebee-setup.mjs "$APP_URL"
gh secret set OPS_SECRET                                    # heartbeat workflow (.github/workflows/heartbeat.yml)
```

| Env | For |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Database (service key server-only) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `APP_URL` | Bot + Mini App |
| `SARVAM_API_KEY` | Token Factory (GLM), STT, Translate, Bulbul |
| `SARVAM_VOICE_API_KEY`, `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `SARVAM_APP_ID`, `SARVAM_APP_VERSION`, `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE`, `DEMO_VENUE_PHONE` | Samvaad outbound call (only people who consented are ever called) |
| `DEMO_REHEARSAL_CALLS=1` | Simulated, labelled venue answer until a number is connected |
| `CALLS_WEBHOOK_SECRET` (32+ chars) | Per-call webhook tokens, dictation drafts |
| `FLAGSMITH_SERVER_KEY`, `FLAGSMITH_ADMIN_API_KEY` | Flag evaluation; admin key for setup and recovery |
| `FIRECRAWL_API_KEY` | Agent web search + page reading |
| `NUDGEBEE_API_KEY` | Ops events (`sk-nb-…` platform token) |
| `OPS_SECRET` | Heartbeat, replay and recovery endpoints |

## Security model

- The browser never sees a server key. Every API route verifies Telegram `initData` (HMAC) on the server. The bot webhook checks Telegram's secret header, and each Sarvam callback carries a per-call HMAC token.
- RLS is on for every table with no anon policies. Budgets are couple-only, and household-private notes are filtered on the server and checked again before the agent sends anything.
- Web pages the agent reads are treated as data, never as instructions. Search queries never include names, phone numbers or budgets.

## Repo layout

```
web/src/app/tg              Telegram Mini App            web/src/lib/compiler      Pure wedding compiler + tests
web/src/app/api/*           JSON API, bot + Sarvam webhooks, agent, ops endpoints
web/src/lib/server/agent.ts Always-on GLM agent (tools, privacy rules, heartbeat, family groups)
web/src/lib/server/*        Sarvam, Flagsmith, NudgeBee, Firecrawl, plan, calls, translate
web/scripts                 flagsmith-setup, flag, nudgebee-setup, e2e-demo
supabase/migrations         Schema and atomic RPCs (record_revision, approve_revision, apply_call_evidence…)
```

## Team

Built by the VivaahMesh team: @perfect7613, @guglxni and @ghoshvidip26. Teammates' pull requests (#20–#23: revision approvals, Marathi voice input and Bulbul recap, browser voice fallback, call corrections and makeup replies) were reviewed and merged into `main`.

## AI assistance disclosure

As the hackathon rules require: this project was built with the help of AI coding assistants (Claude Code). Inside the product, GLM-5.3 (via Sarvam) runs the planning agent and the UI translation, and the Sarvam models handle speech, translation and voice. Each AI-written message is labelled as coming from the planning agent. The team reviewed the code and can explain everything submitted.
