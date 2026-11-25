import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readPage, webSearch } from "../src/lib/server/web.ts";
import { telegramHtml } from "../src/lib/server/telegram-bot.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("web search and page reads use fixed provider endpoints and reject URL redirects", async () => {
  vi.stubEnv("FIRECRAWL_API_KEY", "test-provider-key");
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: { web: [
      { title: "Mehendi vendors", url: "https://vendors.wedding.com/pune#top", description: "Contact vendors" },
      { title: "Editorial preview", url: "https://vendors.internal/pune" },
      { title: "Local file", url: "file:///draft.txt" },
    ] } }))
    .mockResolvedValueOnce(Response.json({ data: { markdown: "Public vendor directory" } }));
  vi.stubGlobal("fetch", fetch);
  const [hit, ...rejected] = await webSearch("Mehendi artists in Pune");
  assert.deepEqual(rejected, []);
  assert.equal(hit.url, "https://vendors.wedding.com/pune");
  assert.equal(await readPage(hit.url), "Public vendor directory");
  assert.deepEqual(fetch.mock.calls.map(([url]) => url), [
    "https://api.firecrawl.dev/v2/search",
    "https://api.firecrawl.dev/v2/scrape",
  ]);
  assert.ok(fetch.mock.calls.every(([, options]) => options.redirect === "error"));
});

test("missing or unsuccessful page provider never causes an app-server fetch to the result", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("FIRECRAWL_API_KEY", "");
  assert.match(await readPage("https://vendors.wedding.com/pune"), /unavailable/);
  assert.equal(fetch.mock.calls.length, 0);
  vi.stubEnv("FIRECRAWL_API_KEY", "test-provider-key");
  assert.match(await readPage("https://vendors.wedding.com/pune"), /unavailable/);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(fetch.mock.calls[0][0], "https://api.firecrawl.dev/v2/scrape");
});

test("Telegram copy preserves bold and escaped names while treating other markup as text", () => {
  assert.equal(telegramHtml("Hello <b>A &amp; B</b>"), "Hello <b>A &amp; B</b>");
  assert.equal(telegramHtml("<span>Welcome</span> <b>A"), "&lt;span&gt;Welcome&lt;/span&gt; &lt;b&gt;A");
});
