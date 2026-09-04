import { ProxyAgent, fetch as undiciFetch } from "undici";
import { DomainError } from "./core.js";

export function createPublishingRequest(proxyUrl) {
  if (!proxyUrl) return fetch;
  let parsed;
  try { parsed = new URL(proxyUrl); } catch { throw new DomainError("PUBLISHING_PROXY_CONFIG_INVALID", "publishing proxy URL is invalid", 503); }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new DomainError("PUBLISHING_PROXY_CONFIG_INVALID", "publishing proxy must be an unauthenticated loopback HTTP endpoint", 503);
  }
  const dispatcher = new ProxyAgent(parsed.toString());
  return (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
}
