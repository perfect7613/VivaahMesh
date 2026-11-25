import "server-only";

/**
 * Web tools for the agent, powered by Firecrawl (search + scrape to markdown). Without
 * FIRECRAWL_API_KEY they fall back to DuckDuckGo's HTML endpoint and a plain fetch. Results are data for the model, never
 * instructions, and the agent is told to cite links.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();

export async function webSearch(query: string, limit = 6): Promise<SearchHit[]> {
  const q = query.slice(0, 200);
  const fc = process.env.FIRECRAWL_API_KEY;
  if (fc) {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fc}` },
      body: JSON.stringify({ query: q, limit, country: "in" }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { data?: { web?: { title: string; url: string; description?: string }[] } };
    if (r.ok && j.data?.web) return j.data.web.map((x) => ({ title: x.title, url: x.url, snippet: (x.description ?? "").slice(0, 300) }));
  }
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`, {
    headers: { "user-agent": UA, "accept-language": "en-IN,en;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await r.text();
  const hits: SearchHit[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html)) && hits.length < limit; ) {
    let url = m[1];
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || url.includes("duckduckgo.com/y.js")) continue;
    hits.push({ title: decode(m[2]), url, snippet: decode(m[3]).slice(0, 300) });
  }
  return hits;
}

/** Reads a public web page as plain text (first ~6k characters). Only http(s), no private hosts. */
export async function readPage(url: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "error: not a URL";
  }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/.test(u.hostname) || u.hostname.endsWith(".internal")) {
    return "error: only public http(s) pages";
  }
  const fc = process.env.FIRECRAWL_API_KEY;
  if (fc) {
    const f = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fc}` },
      body: JSON.stringify({ url: u.toString(), formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await f.json().catch(() => ({}))) as { data?: { markdown?: string } };
    if (f.ok && j.data?.markdown) return j.data.markdown.slice(0, 6000);
  }
  const r = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return `error: HTTP ${r.status}`;
  const type = r.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text")) return `error: not a text page (${type})`;
  const html = (await r.text()).slice(0, 400_000);
  const text = decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|li|h\d|tr|br)>/gi, "\n"),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text.slice(0, 6000);
}
