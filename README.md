# VivaahMesh

A shared wedding plan for two families, with multilingual vendor calls and a deterministic wedding compiler.

Built at **FestiveHacks × WeAreDevelopers Conference India** (25 Nov 2026) with **Sarvam AI**, **Flagsmith** and **NudgeBee**.

- PRD: [#1](https://github.com/perfect7613/VivaahMesh/issues/1), with work broken into issues #2 onward
- Experience principles: [`DESIGN.md`](./DESIGN.md). Read this before building UI.

## What works today

- **Telegram bot `@vivaah_bot`**: `/start` greets in the user's language and opens the Mini App. Invite deep links (`t.me/vivaah_bot?start=join_<code>`) bring the other family straight into their join flow. Any text or voice note sent to the bot is saved as a private family note.
- **Telegram Mini App (`/tg`)**:
  - *Create flow*: language → couple → date/city → functions → guests/budget (private) → the two families.
  - *Join flow*: language → invitation card → name/role → family priorities, with an explicit private/shared choice.
  - *Home*: the wedding card, "Needs you", families, the plan, what the team is handling, and attributed priorities.
  - Uses Telegram's MainButton, BackButton, haptics and theme.
- **The same app works as a PWA** (`/manifest.webmanifest`, `start_url=/tg`).
- **Languages**: Marathi, Hindi and English, chosen per person.

## Repo layout

```
web/                     Next.js 16 app (Mini App, PWA, API routes, bot webhook) → deployed on Vercel
  src/app/tg             Telegram Mini App entry
  src/app/api/telegram   Bot webhook + one-time setup route
  src/app/api/*          JSON API (all callers verified via Telegram initData)
  src/lib/server         Server-only: Supabase service client, Telegram auth/bot, wedding service
  src/lib/compiler       Compiler CONTRACT (types.ts) + demo fixture. Implementation: issue #3
  src/lib/i18n.ts        en / hi / mr strings for app and bot
supabase/migrations      Database schema (apply with `supabase db push`)
bridge/whatsapp          (planned) wacli → Supabase bridge
DESIGN.md                Experience and design philosophy
```

## Setup from a fresh checkout

Prerequisites: Node 20.9+, the [Supabase CLI](https://supabase.com/docs/guides/cli), the [Vercel CLI](https://vercel.com/docs/cli), and a Telegram bot token from @BotFather.

```bash
git clone https://github.com/perfect7613/VivaahMesh && cd VivaahMesh

# 1. Database
supabase link --project-ref <your-project-ref>
supabase db push                        # applies supabase/migrations

# 2. App
cd web
cp .env.example .env.local              # fill in Supabase + Telegram values
npm install
npm run dev                             # http://localhost:3000/tg works in a browser with DEV_AUTH_BYPASS=1
```

### Run it inside Telegram

Telegram needs a public https URL.

```bash
# Deploy (or use a tunnel such as `cloudflared tunnel --url http://localhost:3000` for local testing)
cd web && vercel deploy --prod
# Set the same env vars on Vercel (vercel env add …), including APP_URL=https://<your-deployment>

# Register webhook, commands, menu button and description
curl -X POST "$APP_URL/api/telegram/setup" -H "x-setup-secret: $TELEGRAM_WEBHOOK_SECRET"
```

Then open `@vivaah_bot` in Telegram and send `/start`.

## Security model

- The browser never gets the Supabase service key or the bot token. Every API route verifies the Telegram `initData` HMAC on the server (`src/lib/server/telegram-auth.ts`).
- RLS is enabled on every table with **no anon policies**, so the public anon key can't read wedding data.
- The webhook checks Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
- Budgets are visible only to the couple. Household-private priorities are filtered out on the server for the other family.

## Sponsor integrations

| Sponsor | Role | Issues |
|---|---|---|
| Sarvam AI | Samvaad outbound vendor call, Dictate, Bulbul recap, speech-to-text for voice notes | #6, #7, #8 |
| Flagsmith | Control plane: compiler policy, stage gating, per-household rollout, caller experiment, kill switches | #4, #9 |
| NudgeBee | Incident investigation and approval-gated recovery that flips a Flagsmith kill switch | #10 |

## AI assistance disclosure

As the hackathon rules require: this project was built with the help of AI coding assistants (Claude Code). The team reviewed the code and can explain everything submitted.
