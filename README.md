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
- **Reads messages from linked household members** once the couple or an authorized parent connects a Telegram group. It saves real updates as private household notes credited to the speaker. Mentions can get a reply based on the recent group messages.
- **Ask about your plan** in a Telegram DM or the app. For vendor ideas, prices, muhurat dates or customs, type `/search` followed by public search terms. The agent cites public search results and can read a result through Firecrawl. Direct chat history is scoped to the wedding and member.
- Private conversations only reach their originating chat, and automated notifications use shared plan context. The agent can point authorized family members to the call review screen. Automatic runs can send up to three notifications and are limited to one nudge per audience per hour. Each Telegram account gets 20 interactive agent requests per 24-hour quota window, shared across the Mini App, direct chats, and group mentions or audio. Scheduled checks do not use this quota.

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

Caller-prompt experiment (5 scripted scenarios × 2 variants, observed counts, not a statistical claim): [`docs/caller-experiment.md`](docs/caller-experiment.md), reproduce with `cd web && npm run experiment`.

Create everything with `node web/scripts/flagsmith-setup.mjs`. Flip a flag live with `node web/scripts/flag.mjs <flag> on|off|key=value`.

### NudgeBee: incident and approval-gated recovery
The Azure worker leases saved vendor answers from Postgres. A stopped worker leaves answers available for recovery. An independent NudgeBee scan reports overdue results, keyed by the provider result ID, and requests an investigation. Human approval turns off the Flagsmith pause switch, restores the worker and replays the identified call. Both households read the resulting plan revision. [Azure worker setup](docs/result-worker.md) · [NudgeBee workflows and rehearsal](docs/nudgebee-workflows.md)

Existing inline deployments can keep their API-key incident reporting, agent-failure alerts and approved recovery endpoint. The Azure workflows use a separate integration webhook.


## Live test

Run against a deployment (signed Telegram users, throwaway weddings): `node web/scripts/e2e-live.mjs <url>` (families → call → approval → agent) and `node web/scripts/e2e-lifecycle.mjs <url>` (stages, vendors, spend, guests, RSVPs, registry race, vendor run sheet).

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
# For the Azure result worker and NudgeBee automation, follow docs/result-worker.md.
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
| `WEDDING_REALTIME_SECRET` | Optional server secret of at least 32 characters for rotating realtime topics independently. |
| `NUDGEBEE_API_KEY`, `NUDGEBEE_ACCOUNT_ID` | API-based ops events and cluster selection |
| `CALL_RESULT_PROCESSOR`, `NUDGEBEE_EVENT_WEBHOOK_URL` | Azure result worker mode and incident workflow |
| `OPS_SECRET` | Heartbeat, replay and recovery endpoints |

## Security model

- The browser never sees a server key. Every API route verifies Telegram `initData` (HMAC) on the server. The bot webhook checks Telegram's secret header, and each Sarvam callback carries a per-call HMAC token.
- RLS is on for every table with no anon policies. Budgets are couple-only, and household-private notes are loaded only into that household's direct-chat context. The shared activity feed contains status and delivery counts.
- A public search sends only the terms explicitly entered after `/search` to the provider. Enter public terms only. Search runs receive no wedding data or chat history, and Firecrawl page reads are limited to results from the same search.

## Repo layout

```
web/src/app/tg              Telegram Mini App            web/src/lib/compiler      Pure wedding compiler + tests
web/src/app/api/*           JSON API, bot + Sarvam webhooks, agent, ops endpoints
web/src/lib/server/agent.ts Always-on GLM agent (tools, privacy rules, heartbeat, family groups)
web/src/lib/server/*        Sarvam, Flagsmith, NudgeBee, Firecrawl, plan, calls, translate
web/scripts                 flagsmith-setup, flag, nudgebee-setup, e2e-live
supabase/migrations         Schema and atomic RPCs (record_revision, approve_revision, apply_call_evidence…)
```

## Team

Built by the VivaahMesh team: @perfect7613, @guglxni and @ghoshvidip26. Teammates' pull requests (#20–#23: revision approvals, Marathi voice input and Bulbul recap, browser voice fallback, call corrections and makeup replies) were reviewed and merged into `main`.

## AI assistance disclosure

As the hackathon rules require: this project was built with the help of AI coding assistants (Claude Code). Inside the product, GLM-5.3 (via Sarvam) runs the planning agent and the UI translation, and the Sarvam models handle speech, translation and voice. Each AI-written message is labelled as coming from the planning agent. The team reviewed the code and can explain everything submitted.
