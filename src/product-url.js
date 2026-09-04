import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { DomainError } from "./core.js";

const blocked = new BlockList();
for (const [network, prefix, family] of [["0.0.0.0", 8, "ipv4"], ["10.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"], ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["172.16.0.0", 12, "ipv4"], ["192.0.0.0", 24, "ipv4"], ["192.168.0.0", 16, "ipv4"], ["198.18.0.0", 15, "ipv4"], ["224.0.0.0", 4, "ipv4"], ["::", 128, "ipv6"], ["::1", 128, "ipv6"], ["fc00::", 7, "ipv6"], ["fe80::", 10, "ipv6"], ["ff00::", 8, "ipv6"]]) blocked.addSubnet(network, prefix, family);

function publicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) return publicAddress(address.slice(7));
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

function safeTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new DomainError("PRODUCT_URL_INVALID", "product URL must be a valid HTTPS URL", 422); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new DomainError("PRODUCT_URL_REJECTED", "product URL target is not allowed", 422);
  url.hash = "";
  return url;
}

async function resolveTarget(url, resolver) {
  const read = async () => (await resolver(url.hostname, { all: true, verbatim: true })).map(item => item.address).sort();
  let first, second;
  try { first = await read(); second = await read(); } catch { throw new DomainError("PRODUCT_URL_DNS_REJECTED", "product URL hostname could not be safely resolved", 422); }
  if (!first.length || first.some(address => !publicAddress(address)) || first.join(",") !== second.join(",")) throw new DomainError("PRODUCT_URL_DNS_REJECTED", "product URL hostname resolved to a blocked or unstable address", 422);
  return first;
}

function pinnedRequest(url, { addresses, signal }) {
  return new Promise((resolve, reject) => {
    const address = addresses[0], family = isIP(address);
    const req = httpsRequest(url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "OpenReel-Product-Extractor/1.0" }, signal, servername: url.hostname, lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family) }, response => resolve({ status: response.statusCode, headers: { get: name => response.headers[String(name).toLowerCase()] ?? null }, body: response }));
    req.on("error", reject);
    req.end();
  });
}

function entityText(value) {
  return value.replace(/&(?:amp|#38);/gi, "&").replace(/&(?:lt|#60);/gi, "<").replace(/&(?:gt|#62);/gi, ">").replace(/&(?:quot|#34);/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))));
}

function metadata(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (key && new RegExp(`^${escaped}$`, "i").test(key)) return tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || "";
  }
  return "";
}

export function extractProductPage(html) {
  const title = entityText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || metadata(html, "og:title")).replace(/\s+/g, " ").trim().slice(0, 300);
  const description = entityText(metadata(html, "description") || metadata(html, "og:description")).replace(/\s+/g, " ").trim().slice(0, 1000);
  const text = entityText(html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 20_000);
  return { title, description, text };
}

export function createProductUrlFetcher({ resolver = lookup, request = pinnedRequest, timeoutMs = 8_000, maxBytes = 1024 * 1024, maxRedirects = 3, now = () => new Date().toISOString() } = {}) {
  return async ({ url: inputUrl } = {}) => {
    let current = safeTarget(inputUrl), response;
    const requestedUrl = current.href, redirects = [], controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const addresses = await resolveTarget(current, resolver);
        try { response = await request(current, { addresses, signal: controller.signal }); } catch (error) { if (controller.signal.aborted) throw new DomainError("PRODUCT_URL_TIMEOUT", "product URL fetch timed out", 504); throw new DomainError("PRODUCT_URL_FETCH_FAILED", "product URL could not be fetched", 502); }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new DomainError("PRODUCT_URL_REDIRECT_INVALID", "product URL redirect has no location", 502);
          if (hop === maxRedirects) throw new DomainError("PRODUCT_URL_REDIRECT_LIMIT", "product URL exceeded redirect limit", 422, { maxRedirects });
          const next = safeTarget(new URL(location, current).href);
          response.body.destroy?.(); redirects.push({ from: current.href, to: next.href, status: response.status }); current = next; continue;
        }
        break;
      }
      if (response.status < 200 || response.status >= 300) throw new DomainError("PRODUCT_URL_UPSTREAM_ERROR", "product URL returned an unsuccessful status", 502, { upstreamStatus: response.status });
      const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (!["text/html", "application/xhtml+xml"].includes(contentType)) throw new DomainError("PRODUCT_URL_MIME_REJECTED", "product URL must return HTML", 415, { contentType });
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw new DomainError("PRODUCT_URL_TOO_LARGE", "product URL response exceeds byte limit", 413, { maxBytes });
      const chunks = []; let byteLength = 0;
      try { for await (const chunk of response.body) { byteLength += chunk.length; if (byteLength > maxBytes) throw new DomainError("PRODUCT_URL_TOO_LARGE", "product URL response exceeds byte limit", 413, { maxBytes }); chunks.push(chunk); } }
      catch (error) { if (error instanceof DomainError) throw error; if (controller.signal.aborted) throw new DomainError("PRODUCT_URL_TIMEOUT", "product URL fetch timed out", 504); throw new DomainError("PRODUCT_URL_FETCH_FAILED", "product URL response could not be read", 502); }
      const bytes = Buffer.concat(chunks), html = bytes.toString("utf8");
      return { schema: "openreel-product-page/v1", source: { requestedUrl, finalUrl: current.href, redirects, contentType, byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), fetchedAt: now() }, extracted: extractProductPage(html) };
    } finally { clearTimeout(timer); }
  };
}
