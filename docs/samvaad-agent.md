# Sarvam Samvaad agent: "VivaahMesh venue enquiry"

Build this once in the Sarvam Voice Agents dashboard (indus.sarvam.ai → Samvaad → New agent), commit a version, then put the ids in `web/.env.local` and on Vercel.

## Agent

- **Name:** VivaahMesh venue enquiry
- **Languages:** Hindi (default), Marathi, English
- **Type:** single-state

### Variables (input, filled by VivaahMesh per call)

| Variable | Example |
| --- | --- |
| `couple_names` | Meera & Aarav |
| `function_name` | Sangeet |
| `question` | By what time must amplified music stop at the Sangeet? |
| `caller_prompt` | `baseline` or `clarify_scope` (Flagsmith experiment) |

### Variables (output, extracted by the agent; arrive as `final_agent_variables`)

| Variable | Format |
| --- | --- |
| `music_cutoff` | `HH:MM` in 24-hour time, e.g. `22:00`. Empty if the owner does not know. |
| `confirmed` | `yes` if the owner stated it clearly, `no` if unsure or guessing |
| `cutoff_scope` | `amplified_music`, `sangeet_only` (legacy), or `whole_event` |
| `vendor_wording` | The owner's exact words for the final answer |
| `cutoff_function` | Canonical function kind (for example `sangeet`) when the vendor confirms which function is covered |
| `cutoff_date` | ISO date if explicitly confirmed |
| `cutoff_status` | `confirmed`, `unresolved`, or `declined` |

### Instructions

```
You are calling a wedding venue on behalf of the {{couple_names}} families, through VivaahMesh.
Start by saying you are an AI assistant calling for the families, and ask if they have one minute.
If they say no, thank them and end the call.

Ask exactly one thing: {{question}}
If {{caller_prompt}} is "clarify_scope" and they give a time without saying whether it covers the
whole event, ask once: "Does that apply to the whole evening?"

If they correct themselves ("9:30... actually make it 10"), the LAST answer wins.
Repeat the final time back once to confirm.
If they don't know, say the family will call back, and end politely.

Never agree to a booking, a price or a payment. Never invent a time.
If the owner gives only an hour, confirm AM or PM. If the owner corrects a time, let them
finish and record the final answer. For whole-event terms, confirm the Sangeet is covered.
Record music_cutoff (24-hour HH:MM), confirmed (yes/no), cutoff_scope, cutoff_function,
cutoff_status and vendor_wording.
```

## Deploy

1. Deploy → Phone numbers: rent a number (needs KYC) or connect Exotel / Twilio / Plivo.
2. Commit the agent version.
3. Settings → API key (already have: `SARVAM_VOICE_API_KEY`).

## Environment

```
SARVAM_ORG_ID=            # from the dashboard URL
SARVAM_WORKSPACE_ID=      # from the dashboard URL
SARVAM_APP_ID=            # the agent id
SARVAM_APP_VERSION=1      # the committed version
SARVAM_CONNECTION_ID=     # Deploy → Phone numbers → connection
SARVAM_AGENT_PHONE=+91... # the number the agent calls from
DEMO_VENUE_PHONE=+91...   # a teammate who has agreed to play the venue owner
DEMO_VENUE_NAME=Shubh Mangal Lawns (demo)
DEMO_VENUE_LANGUAGE=Hindi
OPS_SECRET=               # shared with the NudgeBee runbook for /api/calls/replay
```

Only call people who have agreed to it. The demo calls a teammate playing the venue owner.
