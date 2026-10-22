import dns from "node:dns/promises";
import { isIP } from "node:net";
import type { Express, Request } from "express";

const MAX_URL_LENGTH = 2_048;
const MAX_HTML_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 8_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

const fail = (error: string, status = 400) => Object.assign(new Error(error), { status });

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff");
  }
  return true;
}

function checkRateLimit(req: Request) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT) throw fail("rate_limited", 429);
}

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gi, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " }[entity.toLowerCase()] || entity));
}
function clean(value: string, max: number) {
  return decodeEntities(value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()).slice(0, max);
}
function meta(html: string, property: string) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["'][^>]*>`, "i");
  const match = html.match(pattern);
  return clean(match?.[1] || match?.[2] || "", 600);
}
async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw fail("too_large", 413);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}
async function loadPreview(raw: unknown) {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) throw fail("bad_url", 400);
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw fail("bad_url", 400); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || isIP(url.hostname)) throw fail("ip_literal_not_supported", 400);
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw fail("blocked_target", 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "NaDvoihLinkPreview/1.0" } });
    if (response.status >= 300 && response.status < 400) throw fail("redirect_blocked", 400);
    if (!response.ok) throw fail("upstream_error", 502);
    const type = response.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("text/html")) throw fail("unsupported_type", 415);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_HTML_BYTES) throw fail("too_large", 413);
    const html = await readLimited(response);
    const title = meta(html, "og:title") || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""), 180);
    const description = meta(html, "og:description") || meta(html, "description");
    return { url: url.href, title, description, imageData: "" };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw fail("timeout", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function registerLinkPreviewRoute(app: Express) {
  app.post("/api/preview", async (req, res) => {
    try {
      checkRateLimit(req);
      const result = await loadPreview(req.body?.url);
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      const e = error as { status?: number; message?: string };
      res.status(e.status || 502).json({ error: e.message || "upstream_error" });
    }
  });
}
