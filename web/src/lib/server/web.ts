import "server-only";
import { isIP } from "node:net";

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

/** Accept domain names from search results. Page fetching stays off the app's network. */
function publicResultUrl(value: string): string | null {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/\.$/, "");
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.port ||
        isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") ||
        /\.(?:localhost|internal|local|test|invalid|example|onion|arpa)$/.test(host)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export async function webSearch(query: string, limit = 6): Promise<SearchHit[]> {
  const q = query.slice(0, 200);
  const fc = process.env.FIRECRAWL_API_KEY;
  if (fc) {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fc}` },
      body: JSON.stringify({ query: q, limit, country: "in" }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await r.json().catch(() => ({}))) as { data?: { web?: { title?: unknown; url?: unknown; description?: unknown }[] } };
    if (r.ok && Array.isArray(j?.data?.web)) return j.data.web.slice(0, limit).flatMap((x) => {
      const url = typeof x?.url === "string" ? publicResultUrl(x.url) : null;
      return url && typeof x.title === "string" ? [{
        title: x.title.slice(0, 200), url, snippet: typeof x.description === "string" ? x.description.slice(0, 300) : "",
      }] : [];
    });
  }
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`, {
    headers: { "user-agent": UA, "accept-language": "en-IN,en;q=0.9" },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) return [];
  const html = await r.text();
  const hits: SearchHit[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html)) && hits.length < limit; ) {
    let url = m[1];
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    try {
      if (uddg) url = decodeURIComponent(uddg[1]);
    } catch {
      continue;
    }
    if (url.startsWith("//")) url = `https:${url}`;
    const resultUrl = publicResultUrl(url);
    if (resultUrl && !resultUrl.includes("duckduckgo.com/y.js")) {
      hits.push({ title: decode(m[2]).slice(0, 200), url: resultUrl, snippet: decode(m[3]).slice(0, 300) });
    }
  }
  return hits;
}

/** The caller must authorize this exact URL using the current public search results. */
export async function readPage(url: string): Promise<string> {
  const publicUrl = publicResultUrl(url);
  const fc = process.env.FIRECRAWL_API_KEY;
  if (!publicUrl || !fc) return "Page text unavailable. Use the search result snippets.";
  const f = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fc}` },
    body: JSON.stringify({ url: publicUrl, formats: ["markdown"], onlyMainContent: true }),
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await f.json().catch(() => ({}))) as { data?: { markdown?: unknown } };
  if (f.ok && typeof j?.data?.markdown === "string") return j.data.markdown.slice(0, 6000);
  return "Page text unavailable. Use the search result snippets.";
}
