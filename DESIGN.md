# VivaahMesh: experience and design philosophy

This document comes before the code. Each screen and bot message should hold up against it.

## Who we design for

| Person | Context | What they need from us |
|---|---|---|
| **Aai (60s, Marathi-first)** | Uses WhatsApp and Telegram daily, avoids forms, uses voice notes | Her own language, big targets, one question at a time, can speak instead of type |
| **The couple (late 20s)** | Busy, fielding calls from both sides | One place that shows what changed, what it costs and who decides |
| **The cousin who "handles things"** | Power user, on the phone all day | Speed, clear ownership, nothing lost in chat scroll |
| **The other family** | A guest in someone else's planning | Respect: their priorities are visible and attributed, and their private details stay private |

## Principles

1. **Start in the chat families already use.** The bot is the front door. Families start, join and get updates in Telegram (and on WhatsApp through the bridge). The Mini App opens only when something visual is needed, such as a timeline, a choice or an approval. We never ask anyone to "download our app".
2. **Ask one question per screen.** Onboarding is a conversation, not a form. Every step has a single question, a sensible default and a big primary button (Telegram's MainButton). Every step can be skipped or undone.
3. **Language comes first.** The first thing anyone does is choose a language, and everything after it, including bot messages, follows that choice. Names, dates and money stay in familiar formats (₹15,00,000, not ₹1,500,000).
4. **Every home screen answers three questions.** *What is the plan? What is the team handling? What needs me?* Anything that doesn't serve one of these moves off the home screen.
5. **Show who said what.** Every requirement carries its author and family ("Aai · Patil family"). Disagreements stay visible until someone resolves them.
6. **Make privacy visible.** Every input says who will see it ("Only the Patil family sees this", "Both families see this"). Budgets are private by default.
7. **Nothing is committed without the right person.** Proposals are never decisions. The UI always shows whose decision comes next.
8. **Be warm and calm.** It's a wedding, not a dashboard. We use a festive palette in a calm layout and save celebration for moments that matter (wedding created, family joined, plan approved).

## Visual language

- **Palette:** marigold `#E8A317`, sindoor `#B3261E`, mehendi green `#4F6B2F`, ivory `#FBF6EC`, ink `#2A1F14`. Inside Telegram we respect the user's theme (`themeParams`) and use our palette as accents only.
- **Type:** the system UI font plus Noto Sans Devanagari for Hindi and Marathi. Minimum 16px body, 20px or larger for primary questions.
- **Shape:** soft 16–20px radii and cards like invitation stock. Tap targets are at least 48px.

## Motion (following Emil Kowalski's design-engineering principles)

- Animate only with a purpose. Step transitions give a sense of place (slide plus fade, 220ms `cubic-bezier(0.23,1,0.32,1)`). Frequent actions such as toggling a chip get fast feedback only (scale 0.97 on press, 120ms).
- Celebrations are rare and can be playful: wedding created, family joined and approval each get a marigold burst and Telegram haptic `notificationOccurred('success')`.
- Never use `transition: all`, never animate from `scale(0)` and never use ease-in. Respect `prefers-reduced-motion` by fading only.
- Use haptics as touch feedback: `selectionChanged` on chips, `impactOccurred('light')` on the main button.

## Telegram-native rules

- Use `MainButton` for the primary action and `BackButton` for navigation. Don't duplicate them in the page.
- Call `ready()` and `expand()` on load, set header and background colours to match, and enable closing confirmation during onboarding.
- Deep links: `t.me/vivaah_bot?start=join_<code>` takes the invitee into a bot chat that opens the Mini App already set up for their family.
- The bot speaks in short, warm sentences in the user's language, with a single clear button.

## Copy voice

Write like a capable cousin, not a SaaS product. "Let's set up your wedding" rather than "Create workspace". "Invite the Deshmukh family" rather than "Add collaborators".
