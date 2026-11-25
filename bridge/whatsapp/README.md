# WhatsApp bridge

This third-party bridge uses WhatsApp Web through [wacli](https://wacli.sh/). WhatsApp Web is not a public API. Run the bridge on a laptop or VM with a dedicated spare WhatsApp number, a private local store, and one consenting test family group. Keep the spare number out of unrelated chats. WhatsApp sync can store all conversations visible to the linked device on disk. The bridge forwards only new messages from the configured group.

## Set up the pilot

1. Install Node.js 22+, FFmpeg (`ffprobe`), and [wacli v0.26.1](https://github.com/openclaw/wacli/releases/tag/v0.26.1). The pinned release supports signed message webhooks and read-only media retrieval alongside a running sync. Verify the release checksum and run `wacli --version`.
2. Apply the WhatsApp migration to the same Supabase project used by the web app. Set a random `BRIDGE_SECRET` on the app server and bridge process using their secret stores. For example, generate 32 random bytes with `openssl rand -hex 32`. Set `WHATSAPP_PLAN_URL` on the web app to its HTTPS PWA URL (the app's `/tg` entry point) or its Telegram Mini App link. The bridge sends the secret only as the `X-Bridge-Secret` header to your HTTPS app. Keep database and Sarvam credentials on the web app server.
3. Leave `whatsapp_bridge_enabled` off by default in Flagsmith. Enable it for the approved identity `wedding:<wedding_id>:household:<household_id>`. Identity traits include `household_id` and `household_side`. Linking, ingest, and notice polling all fail closed when the flag is off or unavailable.
4. Explain to everyone in the group that new texts and short recordings will be copied to the household's private plan notes and that Sarvam transcribes the recordings. Agree on the group's language: English (`en`), Hindi (`hi`), or Marathi (`mr`).
5. Create an isolated store, pair the spare number using WhatsApp's Linked Devices screen, and find the exact family group JID in the synced group list.

   ```sh
   export WACLI_STORE_DIR="$HOME/.local/share/vivaahmesh-wacli"
   mkdir -p -m 700 "$WACLI_STORE_DIR"
   wacli --store "$WACLI_STORE_DIR" auth
   wacli --store "$WACLI_STORE_DIR" groups list
   ```

6. Export `WHATSAPP_GROUP` with that single group JID, and `WHATSAPP_LANGUAGE` with its language. From the repository root preview the event types first.

   ```sh
   node bridge/whatsapp/bridge.mjs --read-only
   ```

   Preview runs WhatsApp sync in its local SQLite store and logs only event types for the configured group. It skips app requests, media downloads, Sarvam, and outgoing messages.

7. Set `BRIDGE_APP_URL` to the deployed app origin and load `BRIDGE_SECRET` into the process's environment. Stop preview and start the live bridge.

   ```sh
   node bridge/whatsapp/bridge.mjs
   ```

8. Have an authorized household member send `/link <invite_code>` in the group from their regular account. Use the household invite code, which grants the ability to join that household. Treat the message as sensitive and remove it from the group once the setup is verified. The bridge never saves the link command as a note. One WhatsApp group can link to one household, and one household can link to one WhatsApp group. The configured language is saved at link time. Send a new text or a recording after linking and verify it under Priorities from that household's account.

## Scope and delivery

- The worker reads lifecycle NDJSON from `wacli sync --follow --events`. wacli delivers message envelopes separately through an HMAC-signed loopback webhook.
- The worker skips DMs, other groups, its own messages, and events more than 15 minutes old. It downloads only matching Ogg Opus audio from a linked, enabled group. wacli's webhook does not distinguish push-to-talk from other Ogg Opus audio. Audio is limited to 30 seconds and 1 MiB and removed from the bridge's temporary directory after use.
- Text and transcripts appear only to members of the linked household, with the sender's WhatsApp push name when available. The app identifies transcripts for household review. The server allows ten transcription attempts per household per hour and one attempt per WhatsApp message.
- Member joins within the same household and new plan revisions enqueue one short, localized update with an app link. Updates contain no member names or plan details. WhatsApp delivery is at most once: the server claims each update before the worker sends, and the worker does not retry an uncertain send. The ingress queue is bounded and in memory, so bridge stops and upstream webhook delivery failures can lose messages. Keep the app as the source of truth.
- To pause the pilot, stop the worker and disable the household flag. To remove the link, have the app operator delete the exact linked `channels` row of kind `whatsapp_group`, then remove the linked device in WhatsApp. Deleting the link clears queued updates. Previously imported notes remain in that household's plan.

Run the fixture tests with `node --test bridge/whatsapp/*.test.mjs`.
