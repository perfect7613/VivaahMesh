# Testing VivaahMesh (MahiWay) end to end

Two layers: automated live checks (5 minutes), then a hands-on run with real phones (about 20 minutes).

## 0. Automated checks against production

```bash
cd web
set -a; . ./.env.local; set +a
npx vitest run                                                  # 142 unit tests
node scripts/e2e-live.mjs https://vivaahmesh.vercel.app         # 24 checks: families → plan → call → approval → agent
node scripts/e2e-lifecycle.mjs https://vivaahmesh.vercel.app    # 28 checks: stages, vendors, spend, guests, RSVPs, registry
npm run experiment                                              # caller_prompt comparison → docs/caller-experiment.md
```

Each e2e script signs in throwaway Telegram users, creates its own wedding, and deletes it at the end. All three should end with exit code 0.

## 1. Setup for the hands-on run

You need three Telegram accounts:

- **Phone A:** the couple (Meera).
- **Phone B:** a parent on the same side (Aai).
- **Phone C:** someone from the other family (Riya).

You also need one Telegram group with Phone A and Phone B in it, and a laptop with the Flagsmith dashboard open (Production environment).

In Flagsmith, make sure `outbound_dialing_enabled` is ON and `result_processing_paused` is OFF.

## 2. Onboarding (Phone A)

1. Open @vivaah_bot, tap **Start**, then open the Mini App from the menu button.
2. Pick **English**. Create the wedding: Meera & Aarav, a date, Pune, the Haldi + Sangeet + Ceremony functions, 200 guests, a budget, and the names of both families.
3. **Expect:** the home screen shows both families and two invite links.

## 3. Families join (Phones B and C)

1. Send the side-A invite link to Phone B. Join as **Aai**, role parent, language **मराठी**. Pick "elders' dinner" and write a note set to *my household only*.
2. Send the side-B invite link to Phone C. Join as **Riya**, role cousin, English. Pick a shared priority such as the dance.
3. **Expect:**
   - Phone B's whole UI is in Marathi.
   - Phone A sees both people under their families within about 2 seconds, without a refresh (live updates).
   - Phone C cannot see Aai's household-only note.

## 4. Voice notes in the bot chat (Phone B)

1. In the normal Telegram chat with @vivaah_bot (not the Mini App), hold the mic and record under 30 s in Marathi or Hindi, e.g. "आजींचं जेवण साडेआठपर्यंत व्हायला हवं".
2. **Expect:** the bot replies within a few seconds, and the note appears on the plan / agent feed.
3. Send a voice note longer than 30 s. **Expect:** a polite "keep it under 30 seconds" reply.

## 5. Family group + always-on agent (Phones A and B)

1. On Phone A, go to Home → agent card → **Add me to your family group**, and choose your test group.
2. **Expect:** the bot confirms the group is linked.
3. In the group, chat normally ("Dinner should be early for elders"). Then mention the bot: "@vivaah_bot what time does the sangeet start?"
4. **Expect:**
   - The bot answers in the group.
   - Things worth remembering show up as notes in the app.
   - Household-only notes are never quoted in the group.
5. In the Mini App agent card, type a question that needs the web, e.g. "typical sangeet DJ price in Pune".
6. **Expect:** an answer with "searched the web", based on Firecrawl.

## 6. Plan, venue call, approval (Phones A and B)

1. Open the Sangeet plan. **Expect:** a clash between dinner and the dance, plus an open question about the music cutoff.
2. Tap **Call the venue** and give consent. Rehearsal mode is on until the Sarvam phone values are added, so the venue's answer is simulated and marked **Rehearsal**.
3. **Expect:** within about 10 s the cutoff appears as a fact with its evidence, and the schedule is recompiled.
4. Each family approves the revision. Phone A should see the other family's approval appear live.

## 7. Flagsmith changes the app live (laptop)

Flip each flag below in Flagsmith, then reopen or refresh the plan:

| Flag change | What should happen |
| --- | --- |
| `compiler_policy` → set `allowDanceDuringDinner` | The proposal changes. |
| `outbound_dialing_enabled` OFF | **Call the venue** is blocked with a clear message. Turn it back ON afterwards. |
| `result_processing_paused` ON, then make a call | The result is held. A NudgeBee event appears. Approving the NudgeBee workflow `vivaahmesh-call-result-recovery` replays it. |

## 8. Planner: stages, vendors, money (Phones A and B)

1. Phone A: in the family section on Home, **grant Aai access** (parents can approve vendors only after the couple grants it).
1. Home → **Planner**. The stage is *brief*, and the Vendors tab is locked.
2. Phone A: **Advance stage** → *sourcing*. Add "Kaka's Caterers" as **family's own**, ₹3.8 L, for all three functions.
3. Phone B (Aai) tries to authorize it. **Expect:** locked until the stage is *booking*.
4. Phone A: advance to *booking*.
5. Phone B: authorize the caterer at the quoted ₹3.8 L (only the couple can change the approved amount), then tap "vendor accepted".
6. Phone A: enter an invoice of ₹3.95 L and a payment of ₹1 L. **Expect:**
   - Spend shows planned ₹3.8 L / committed ₹3.8 L / actual ₹1 L.
   - A red discrepancy warning for ₹15k.
   - An "Invoice from…" task owned by Aai.
7. Phone C (cousin) opens the Planner. **Expect:** no amounts anywhere.
8. Copy the vendor's **run sheet link** and open it in a private browser. **Expect:** only that vendor's functions and times, with no money and no family notes.

## 9. Guests, RSVP, registry (browser, no Telegram)

1. Phone A: advance to *guests*. Add two guests and one registry item.
2. Open guest 1's RSVP link in a browser. Mark Sangeet *yes*: 4 people, 3 veg. Mark the ceremony *no*.
3. **Expect:** the Planner's Guests tab shows Sangeet 4 (3 veg) and ceremony declined.
4. Open guest 1's and guest 2's links in two tabs. Tap **Reserve** on the same gift in both, quickly.
5. **Expect:**
   - One succeeds.
   - The other shows "taken", never by whom.

## 10. Cancellation and closeout

1. Planner → Vendors → **Cancel** the caterer with the reason "double-booked".
2. **Expect:**
   - An ⚠️ incident and a "Find a replacement caterer" task, both with an owner.
   - The agent card's task list shows them at the top.
   - The vendor drops out of the spend.
3. Add a deliverable task "Wedding album delivered". Advance to *closeout* and tap **Sign off**.
4. **Expect:** the sign-off is recorded, and the album task stays open until it's marked done.

## 11. Clean up

Delete the test wedding in Supabase (`weddings` table; everything else cascades). Reset any flags you changed.


## Browser PWA

Use the [browser sign-in setup](../README.md#browser-sign-in-at-tg) on a test deployment, or use a local Supabase project with its development mail inbox and run `npm run build && npm start` to enable the service worker.

1. Open a web invite `/tg?join=<code>` in Chrome before signing in. Request an email link, open it in the same browser, and finish joining. The invite should survive sign-in. The link should show a retry message in a different browser without the original request.
2. In a separate browser profile, use **Continue with Telegram** with the same account used by the Mini App. Its existing weddings should appear. Reopen the Mini App and confirm it still opens directly.
3. On Android Chrome, finish onboarding and tap **Install VivaahMesh**. In iOS Safari, confirm the Share → **Add to Home Screen** hint appears after onboarding. After dismissal or install, revisit the page and confirm the prompt stays dismissed.
4. Open a wedding with a schedule. Go offline and reload `/tg`. Confirm the last schedule and **You’re offline** appear. An invite link or a link to a different wedding should ask you to reconnect. Inspect the application cache and confirm it contains the public shell and static assets only.
5. Reconnect, sign out, and reload offline. Confirm the saved schedule is gone. Run Lighthouse’s PWA category (Lighthouse 11) against the production build. In current Chrome the Application panel also reports manifest installability.
