import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_POLICY, createDatabaseStore, createMemoryStore, createPersistentStore, DomainError } from "./src/core.js";
import { createSqliteBackend } from "./src/durable.js";
import { createPlatform } from "./src/platform.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { correlationId, createLogger, createMetrics, redact, validateProductionConfig } from "./src/ops.js";
import { arkMaxRetries, createArkService, createArkTransports, loadArkConfig } from "./src/ark.js";

const root = fileURLToPath(new URL("./", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".md": "text/markdown" };
const SECURITY_HEADERS = Object.freeze({ "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'", "referrer-policy": "no-referrer", "permissions-policy": "camera=(), microphone=(), geolocation=()", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-origin" });
async function body(req, limit = 1024 * 1024) { const declared = Number(req.headers["content-length"]); if (Number.isFinite(declared) && declared > limit) throw new DomainError("BODY_TOO_LARGE", "request body exceeds byte limit", 413, { maxBytes: limit }); if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "JSON requests require application/json", 415); const chunks = []; let length = 0; for await (const c of req) { length += c.length; if (length > limit) throw new DomainError("BODY_TOO_LARGE", "request body exceeds byte limit", 413, { maxBytes: limit }); chunks.push(c); } if (!chunks.length) return {}; try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || Array.isArray(value) || typeof value !== "object") throw new DomainError("INVALID_INPUT", "request body must be a JSON object"); return value; } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("INVALID_JSON", "request body must be valid JSON"); } }
async function binaryBody(req, limit) { const chunks = []; let length = 0; for await (const c of req) { length += c.length; if (length > limit) throw new DomainError("ASSET_TOO_LARGE", "asset exceeds byte limit", 413, { maxBytes: limit, actualBytes: length }); chunks.push(c); } return Buffer.concat(chunks); }
function json(res, status, value, headers = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers }); res.end(JSON.stringify(value)); }
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(";").map(x => x.trim().split("=")).filter(x => x.length === 2).map(([k, v]) => [k, decodeURIComponent(v)])); }
function cookie(name, value, { secure = true, maxAge = null, expires = null } = {}) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${maxAge === null ? "" : `; Max-Age=${maxAge}`}${expires ? `; Expires=${new Date(expires).toUTCString()}` : ""}`; }
function sessionCookie(name, value, session, secure) { const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.parse(session.createdAt)) / 1000)); return cookie(name, value, { secure, maxAge, expires: session.expiresAt }); }
function safeEqual(a, b) { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); }
function sniffMime(bytes) { if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png"; if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg"; if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp"; if (bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp") return "video/mp4"; if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"))) return "video/webm"; if (bytes.length >= 3 && (bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return "audio/mpeg"; if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE") return "audio/wav"; return null; }
function uploadFilename(value, extension) { if (typeof value !== "string" || !value.trim() || value.length > 128 || value.includes("/") || value.includes("\\") || value.includes("\0") || [".", ".."].includes(value.trim())) throw new DomainError("INVALID_FILENAME", "a safe filename is required"); const name = value.trim(); if (!new RegExp(`\\.${extension}$`, "i").test(name)) throw new DomainError("INVALID_FILENAME", `filename must end in .${extension}`); return name; }
function createRateLimiter({ max = 60, windowMs = 60_000, now = Date.now, key = req => req.socket.remoteAddress || "unknown" } = {}) { const entries = new Map(); return req => { const id = key(req), time = Number(now()), old = entries.get(id); const entry = !old || time - old.startedAt >= windowMs ? { startedAt: time, count: 0 } : old; entry.count += 1; entries.set(id, entry); if (entry.count > max) throw new DomainError("RATE_LIMITED", "request rate limit exceeded", 429, { retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (time - entry.startedAt)) / 1000)) }); }; }

export function createOpenReelServer(store = createMemoryStore(), platform = createPlatform(), { production = false, secureCookies = production, jsonLimit = 1024 * 1024, rateLimit = {}, logger = () => {}, readiness = () => ({ database: "ok", assets: "ok" }), metrics = createMetrics(), adminToken = null, arkService = null } = {}) {
  const limit = createRateLimiter(rateLimit), log = (event, fields) => logger(event, redact(fields));
  return createServer(async (req, res) => {
    const requestId = correlationId(req.headers["x-request-id"]); res.setHeader("x-request-id", requestId); metrics.begin();
    res.once("finish", () => { metrics.end(res.statusCode); log("http_request", { requestId, method: req.method, path: new URL(req.url, "http://localhost").pathname, status: res.statusCode, authorization: req.headers.authorization, cookie: req.headers.cookie }); });
    try {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      const url = new URL(req.url, "http://localhost"), parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/health/live") return json(res, 200, { status: "ok" });
      if (req.method === "GET" && url.pathname === "/health/ready") { try { return json(res, 200, { status: "ready", dependencies: readiness() }); } catch (error) { log("readiness_failure", { requestId, error: error.message }); return json(res, 503, { status: "not_ready" }); } }
      if (req.method === "GET" && url.pathname === "/metrics") { let ready = true; try { readiness(); } catch { ready = false; } res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" }); return res.end(metrics.render(ready)); }
      const versioned = parts[0] === "api" && parts[1] === "v1", api = versioned ? parts.slice(2) : parts.slice(1), input = async () => body(req, jsonLimit), jar = cookies(req);
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || jar.openreel_session;
      const keyRoute = api[0] === "key" && api[1] === "status" && req.method === "GET";
      const adminRoute = api[0] === "admin";
      const arkRoute = api[0] === "inference";
      const publicRoute = (api[0] === "auth" && ["register", "login"].includes(api[1])) || keyRoute || adminRoute || arkRoute;
      if (production && url.pathname.startsWith("/api/")) limit(req);
      if (production && url.pathname.startsWith("/api/") && !publicRoute && req.method !== "OPTIONS") {
        if (jar.openreel_session && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !safeEqual(req.headers["x-csrf-token"], jar.openreel_csrf)) throw new DomainError("CSRF_REJECTED", "valid CSRF token required", 403);
        platform.authenticate(token);
      }
      const protectedApi = production && url.pathname.startsWith("/api/") && !publicRoute;
      const who = protectedApi ? platform.authenticate(token).id : "local-owner";
      let out;
      if (keyRoute) { const keySecret = req.headers["x-openreel-api-key"] || req.headers.authorization?.replace(/^Bearer\s+/i, ""); const auth = platform.authenticateApiKey(keySecret); out = { key: auth.apiKey, accountId: auth.account.id, plan: auth.subscription.plan, hardLimitMicros: auth.subscription.hardLimitMicros, spentMicros: auth.subscription.spentMicros, reservedMicros: auth.subscription.reservedMicros, remainingMicros: Math.max(0, auth.subscription.hardLimitMicros - auth.subscription.spentMicros - auth.subscription.reservedMicros), periodEndsAt: auth.subscription.periodEndsAt }; }
      else if (arkRoute) {
        if (!arkService) throw new DomainError("ARK_UNAVAILABLE", "Ark inference is not configured", 503);
        const keySecret = req.headers["x-openreel-api-key"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (req.method === "GET" && api[1] === "models" && api.length === 2) out = arkService.models();
        else if (req.method === "POST" && api[1] === "jobs" && api.length === 2) out = await arkService.submit(keySecret, await input());
        else if (req.method === "GET" && api[1] === "jobs" && api.length === 3) out = await arkService.poll(keySecret, api[2]);
        else if (req.method === "GET" && api[1] === "jobs" && api[3] === "asset") { const asset = await arkService.download(keySecret, api[2]); res.writeHead(200, { "content-type": asset.mimeType, "content-length": asset.bytes.length, "content-disposition": `attachment; filename="${api[2]}"`, "x-content-type-options": "nosniff" }); return res.end(asset.bytes); }
        else throw new DomainError("NOT_FOUND", "Ark inference route not found", 404);
      }
      else if (req.method === "POST" && api[0] === "users" && api.length === 1) out = store.createUser(await input());
      else if (req.method === "GET" && api[0] === "models" && api.length === 1) { out = store.listModels(); if (arkService) out.push(...arkService.models().filter(x => ["image", "video", "audio"].includes(x.capability)).map(x => ({ id: x.name, kind: x.capability, adapterId: "ark", schema: { modes: [], aspects: [], resolutions: [], durations: x.capability === "video" ? [5, 10] : [], audio: x.capability === "video", maxReferences: 0 } }))); }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "register") { const account = platform.register(await input()); store.createUser({ id: account.id, name: account.email }); out = account; }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "login") { const session = platform.login(await input()), csrf = randomBytes(24).toString("base64url"); return json(res, 200, { account: platform.authenticate(session.token), csrfToken: csrf, expiresAt: session.expiresAt }, { "set-cookie": [sessionCookie("openreel_session", session.token, session, secureCookies), sessionCookie("openreel_csrf", csrf, session, secureCookies)] }); }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "logout") { out = platform.logout(token); return json(res, 200, out, { "set-cookie": [cookie("openreel_session", "", { secure: secureCookies, maxAge: 0 }), cookie("openreel_csrf", "", { secure: secureCookies, maxAge: 0 })] }); }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "rotate") { const session = platform.rotateSession(token), csrf = randomBytes(24).toString("base64url"); return json(res, 200, { account: platform.authenticate(session.token), csrfToken: csrf, expiresAt: session.expiresAt }, { "set-cookie": [sessionCookie("openreel_session", session.token, session, secureCookies), sessionCookie("openreel_csrf", csrf, session, secureCookies)] }); }
      else if (req.method === "GET" && api[0] === "auth" && api[1] === "csrf") { const account = platform.authenticate(token), csrf = randomBytes(24).toString("base64url"), createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); return json(res, 200, { account, csrfToken: csrf }, { "set-cookie": sessionCookie("openreel_csrf", csrf, { createdAt, expiresAt }, secureCookies) }); }
      else if (req.method === "GET" && api[0] === "auth" && api[1] === "me") out = platform.authenticate(token);
      else if (adminRoute) {
        if (!adminToken || !safeEqual(req.headers["x-openreel-admin-key"], adminToken)) throw new DomainError("FORBIDDEN", "administrator authorization required", 403);
        if (req.method === "GET" && api[1] === "key-applications" && api.length === 2) out = platform.listKeyApplications({ status: url.searchParams.get("status") || undefined });
        else if (req.method === "POST" && api[1] === "key-applications" && api[3] === "approve") out = platform.approveKeyApplication(api[2], await input());
        else if (req.method === "POST" && api[1] === "key-applications" && api[3] === "reject") out = platform.rejectKeyApplication(api[2], await input());
        else if (req.method === "POST" && api[1] === "key-applications" && api[3] === "stop") out = platform.stopKeyAccess(api[2], await input());
        else throw new DomainError("NOT_FOUND", "administrator route not found", 404);
      }
      else if (req.method === "POST" && api[0] === "key-applications" && api.length === 1) out = platform.submitKeyApplication(token, await input());
      else if (req.method === "GET" && api[0] === "key-applications" && api.length === 1) out = platform.listOwnKeyApplications(token);
      else if (req.method === "POST" && api[0] === "api-keys" && api.length === 1) out = platform.createApiKey(token, await input());
      else if (req.method === "GET" && api[0] === "api-keys" && api.length === 1) out = platform.listApiKeys(token);
      else if (req.method === "DELETE" && api[0] === "api-keys" && api.length === 2) out = platform.revokeApiKey(token, api[1]);
      else if (req.method === "GET" && api[0] === "billing" && api[1] === "usage") out = platform.usageStatus(token);
      else if (req.method === "POST" && api[0] === "teams" && api.length === 1) out = platform.createTeam(token, await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "invites") out = platform.invite(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "invites" && api[2] === "accept") out = platform.acceptInvite(token, api[1]);
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "quote") out = platform.quote(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "reserve") out = platform.reserve(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "settle") throw new DomainError("FORBIDDEN", "client-directed settlement is disabled", 403);
      else if (req.method === "GET" && api[0] === "teams" && api[2] === "budget") out = platform.budgetStatus(token, api[1]);
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "workflows" && api[3] === "import") out = platform.importWorkflow(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "automations" && api[3] === "plan") out = platform.planAutomation(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "automations" && api[3] === "run") { const value = await input(); out = platform.runAutomation(token, api[1], value.plan, value.idempotencyKey); }
      else if (req.method === "GET" && api[0] === "security-boundary") out = platform.securityBoundary();
      else if (req.method === "GET" && api[0] === "projects" && api.length === 1) out = store.listProjects(who, Object.fromEntries(url.searchParams));
      else if (req.method === "POST" && api[0] === "projects" && api.length === 1) out = store.createProject(await input(), who);
      else if (req.method === "GET" && api[0] === "projects" && api.length === 2) out = store.snapshot(api[1], who);
      else if (req.method === "PATCH" && api[0] === "projects" && api.length === 2) out = store.updateProject(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "members") out = store.addMember(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "edges") out = store.createEdge(api[1], await input(), who);
      else if (req.method === "PATCH" && api[0] === "edges" && api.length === 2) out = store.updateEdge(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "groups") out = store.createGroup(api[1], await input(), who);
      else if (req.method === "PATCH" && api[0] === "groups" && api.length === 2) out = store.updateGroup(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "sessions" && api.length === 3) out = store.createSession(api[1], await input(), who);
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api.length === 3) out = store.listAssets(api[1], Object.fromEntries(url.searchParams), who);
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "history") out = store.listHistory(api[1], Object.fromEntries(url.searchParams), who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "assets" && api[4] === "copy") { const value = await input(); out = store.copyAsset(api[1], api[3], value.targetProjectId, who); }
      else if (req.method === "PUT" && api[0] === "projects" && api[2] === "story") out = store.upsertStory(api[1], await input(), who);
      else if (req.method === "PUT" && api[0] === "projects" && api[2] === "storyboard") out = store.upsertStoryboard(api[1], await input(), who);
      else if (req.method === "PUT" && api[0] === "projects" && api[2] === "timeline") out = store.upsertTimeline(api[1], await input(), who);
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "exports" && api[3] === "manifest") out = store.exportManifest(api[1], who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "exports" && api[3] === "render") out = store.renderProject(api[1], who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "close") out = store.closeSession(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "nodes") out = store.createNode(api[1], await input(), who);
      else if (req.method === "PATCH" && api[0] === "nodes" && api.length === 2) out = store.updateNode(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "jobs") out = store.createJob(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "ark-jobs") { if (!arkService) throw new DomainError("ARK_UNAVAILABLE", "Ark inference is not configured", 503); const value = await input(), parameters = value.parameters || {}, providerInput = { prompt: value.prompt, ...parameters, ...(parameters.aspect ? { ratio: parameters.aspect } : {}), ...(parameters.audio !== undefined ? { generate_audio: parameters.audio } : {}) }, arkJob = await arkService.submit(req.headers["x-openreel-api-key"], { model: value.model, capability: value.capability, input: providerInput, idempotencyKey: value.idempotencyKey }); out = store.createArkCanvasJob(api[1], value, arkJob, who); }
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "ark-poll") { if (!arkService) throw new DomainError("ARK_UNAVAILABLE", "Ark inference is not configured", 503); const local = store.arkCanvasJob(api[1], who), arkJob = await arkService.poll(req.headers["x-openreel-api-key"], local.arkJobId), output = arkJob.status === "succeeded" ? await arkService.download(req.headers["x-openreel-api-key"], arkJob.id) : null; out = store.reconcileArkCanvasJob(local.id, arkJob, output, who); }
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "tick") out = store.tickJob(api[1], who);
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "cancel") out = store.transitionJob(api[1], "canceled", {}, who);
      else if (req.method === "GET" && api[0] === "jobs" && api[2] === "progress") out = store.progress(api[1], url.searchParams.get("afterSeq") ?? 0, who);
      else if (versioned && req.method === "POST" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[5] === "references") { const mime = req.headers["content-type"]?.split(";", 1)[0], policy = ASSET_POLICY[mime]; if (!policy) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "unsupported reference media type", 415, { allowed: Object.keys(ASSET_POLICY) }); const bytes = await binaryBody(req, policy.maxBytes); if (!bytes.length) throw new DomainError("EMPTY_ASSET", "asset bytes are required"); if (sniffMime(bytes) !== mime) throw new DomainError("MEDIA_SIGNATURE_MISMATCH", "media signature does not match content-type", 415); out = store.uploadReference(api[1], api[3], { mimeType: mime, filename: uploadFilename(req.headers["x-filename"], policy.extension), bytes }, who); }
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api[4] === "manifest") out = store.assetManifest(api[1], api[3], undefined, who);
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api[4] === "content") { const a = store.assetContent(api[1], api[3], undefined, who); res.writeHead(200, { "content-type": a.manifest.mimeType, "content-length": a.bytes.length, "content-disposition": `attachment; filename="${a.manifest.filename}"`, "x-content-type-options": "nosniff" }); return res.end(a.bytes); }
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[6] === "manifest") out = store.assetManifest(api[1], api[3], api[5], who);
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[6] === "content") { const a = store.assetContent(api[1], api[3], api[5], who); res.writeHead(200, { "content-type": a.manifest.mimeType, "content-length": a.bytes.length }); return res.end(a.bytes); }
      else if (url.pathname.startsWith("/api/")) throw new DomainError("NOT_FOUND", "route not found", 404);
      else { await serveStatic(url.pathname, res); return; }
      json(res, req.method === "POST" ? 201 : 200, out);
    } catch (e) { if (e instanceof DomainError) { log("security_or_domain_event", { requestId, code: e.code, status: e.status }); return json(res, e.status, { error: { code: e.code, message: e.message, ...(e.details && { details: e.details }) } }, e.status === 429 ? { "retry-after": String(e.details.retryAfterSeconds) } : {}); } log("internal_error", { requestId, error: e.message }); json(res, 500, { error: { code: "INTERNAL_ERROR", message: "Internal server error" } }); }
  });
}
async function serveStatic(pathname, res) { const aliases = { "/admin": "admin.html", "/admin/": "admin.html" }, relative = aliases[pathname] || (pathname === "/" ? "index.html" : normalize(pathname).replace(/^\/+/, "")), file = join(root, relative); try { if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new DomainError("NOT_FOUND", "file not found", 404); res.writeHead(200, { "content-type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8` }); res.end(await readFile(file)); } catch (error) { if (error instanceof DomainError) throw error; if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw new DomainError("NOT_FOUND", "file not found", 404); throw error; } }
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const production = process.env.NODE_ENV === "production";
  const config = production ? validateProductionConfig() : { port: Number(process.env.PORT || 4173), host: "127.0.0.1", databaseFile: process.env.OPENREEL_DATABASE || join(root, ".data", "openreel.sqlite"), assetRoot: process.env.OPENREEL_ASSETS || join(root, ".data", "assets"), platformFile: process.env.OPENREEL_PLATFORM || join(root, ".data", "platform.json") };
  const backend = createSqliteBackend(config.databaseFile, { legacyJson: process.env.OPENREEL_LEGACY_JSON || null, assetRoot: config.assetRoot });
  const logger = createLogger();
  const platform = createPlatform({ file: config.platformFile }), arkConfig = loadArkConfig(), transports = createArkTransports({ retries: arkMaxRetries() });
  const arkService = createArkService({ config: arkConfig, platform, transport: transports.request, assetTransport: transports.asset, store: backend.arkJobs });
  const server = createOpenReelServer(createDatabaseStore(backend), platform, { production, secureCookies: production, readiness: backend.health, logger, adminToken: process.env.OPENREEL_ADMIN_KEY || null, arkService });
  server.on("error", error => { logger("startup_error", { error: error.message }); process.exitCode = 1; });
  server.listen(config.port, config.host, () => logger("service_started", { host: config.host, port: config.port }));
}
