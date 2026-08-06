import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

const SECRET_KEYS = /authorization|cookie|csrf|password|secret|token|session/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const INLINE_SECRET = /(password|secret|token|session)\s*[=:]\s*[^\s,;]+/gi;

export function redact(value, key = "") {
  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(BEARER, "Bearer [REDACTED]").replace(INLINE_SECRET, "$1=[REDACTED]");
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

export function createLogger(write = line => process.stdout.write(`${line}\n`), now = () => new Date().toISOString()) {
  return (event, fields = {}) => write(JSON.stringify({ timestamp: now(), event, ...redact(fields) }));
}

export function correlationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(value) ? value : randomUUID();
}

export function createMetrics() {
  const counts = new Map();
  let active = 0;
  return {
    begin() { active += 1; },
    end(status) { active = Math.max(0, active - 1); const group = `${Math.floor(Number(status) / 100)}xx`; counts.set(group, (counts.get(group) || 0) + 1); },
    render(ready) {
      const lines = ["# TYPE openreel_http_requests_total counter"];
      for (const group of ["2xx", "3xx", "4xx", "5xx"]) lines.push(`openreel_http_requests_total{status_class="${group}"} ${counts.get(group) || 0}`);
      lines.push("# TYPE openreel_http_requests_active gauge", `openreel_http_requests_active ${active}`, "# TYPE openreel_ready gauge", `openreel_ready ${ready ? 1 : 0}`);
      return `${lines.join("\n")}\n`;
    }
  };
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") throw new Error("NODE_ENV must be production");
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  const host = env.HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("HOST must be loopback; Caddy owns the public socket");
  const required = ["OPENREEL_DATABASE", "OPENREEL_ASSETS", "OPENREEL_PLATFORM"];
  for (const name of required) if (!env[name] || !isAbsolute(env[name])) throw new Error(`${name} must be an absolute path`);
  const paths = required.map(name => resolve(env[name]));
  if (new Set(paths).size !== paths.length) throw new Error("database, asset, and platform paths must be distinct");
  if (!env.OPENREEL_SESSION_SECRET || env.OPENREEL_SESSION_SECRET.length < 32 || /^(change|replace|example|test)/i.test(env.OPENREEL_SESSION_SECRET)) throw new Error("OPENREEL_SESSION_SECRET must be a non-placeholder value of at least 32 characters");
  if (!env.OPENREEL_ADMIN_KEY || env.OPENREEL_ADMIN_KEY.length < 32 || /^(change|replace|example|test)/i.test(env.OPENREEL_ADMIN_KEY)) throw new Error("OPENREEL_ADMIN_KEY must be a non-placeholder value of at least 32 characters");
  if (env.OPENREEL_ADMIN_PASSWORD_HASH && !/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(env.OPENREEL_ADMIN_PASSWORD_HASH)) throw new Error("OPENREEL_ADMIN_PASSWORD_HASH must be a valid scrypt password hash");
  return { port, host, databaseFile: paths[0], assetRoot: paths[1], platformFile: paths[2] };
}
