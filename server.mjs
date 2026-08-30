import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_POLICY, createDatabaseStore, createMemoryStore, createPersistentStore, DomainError } from "./src/core.js";
import { createSqliteBackend } from "./src/durable.js";
import { createPlatform, validateWorkflow } from "./src/platform.js";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { correlationId, createLogger, createMetrics, redact, validateProductionConfig } from "./src/ops.js";
import { arkMaxRetries, createArkService, createArkTransports, loadArkConfig } from "./src/ark.js";
import { createComfyUiService, createInferenceRouter, loadComfyUiConfig } from "./src/comfyui.js";
import { createModelCatalog, validateProviderMappings } from "./src/model-catalog.js";
import { compareCapabilityBaseline, referenceCapabilityCatalog } from "./src/capability-baseline.js";
import { prepareWorkflowShortcutApplication, workflowShortcutCatalog } from "./src/workflow-shortcuts.js";
import { tutorialById, tutorialProgress, tutorialWorkflow } from "./src/tutorials.js";
import { createQwenTtsClient, loadQwenTtsConfig } from "./src/qwen-tts.js";
import { createProductUrlFetcher } from "./src/product-url.js";
import { createProductUnderstandingService } from "./src/product-understanding.js";
import { createGooglePublishingOAuth } from "./src/publishing-google-oauth.js";
import { createTikTokPublishingOAuth } from "./src/publishing-tiktok-oauth.js";
import { createPublishingOAuthRouter } from "./src/publishing-oauth-router.js";
import { createPublishingRequest } from "./src/publishing-proxy.js";
import { createProductionPublishingRuntime } from "./src/publishing-runtime.js";
import { parsePlanningResult, planningLanguage, planningPrompt, planningProvenance } from "./src/workbench-planning.js";
import { createWorkbenchCommercialService } from "./src/workbench-commercial.js";
import { createCommercialProviderOrchestrator } from "./src/commercial-provider-orchestrator.js";
import { createCommercialQualityInspector } from "./src/commercial-quality-inspector.js";
import { createArkCommercialPerceptualEvaluator } from "./src/ark-commercial-perceptual-evaluator.js";
import { createCommercialJobLifecycle, createFileCommercialJobStore } from "./src/commercial-job-lifecycle.js";
import { requireCommercialRelease } from "./src/commercial-release-gate.js";
import { createFileAgentFilmStore, createMemoryAgentFilmStore } from "./src/agent-film-store.js";
import { createSeedAudioMusicService } from "./src/seedaudio-music-service.js";
import { createDirectorSystemStore } from "./src/director-system-store.js";

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
function verifyAdminPassword(password, encoded) {
  const [scheme, salt, digest] = String(encoded || "").split("$");
  if (scheme !== "scrypt" || !salt || !digest || typeof password !== "string" || password.length > 1024) return false;
  try { return safeEqual(scryptSync(password, Buffer.from(salt, "base64url"), 64), Buffer.from(digest, "base64url")); } catch { return false; }
}
function sniffMime(bytes) { if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png"; if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg"; if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp"; if (bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp") return "video/mp4"; if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"))) return "video/webm"; if (bytes.length >= 3 && (bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return "audio/mpeg"; if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE") return "audio/wav"; return null; }
function uploadFilename(value, extension) { if (typeof value !== "string" || !value.trim() || value.length > 128 || value.includes("/") || value.includes("\\") || value.includes("\0") || [".", ".."].includes(value.trim())) throw new DomainError("INVALID_FILENAME", "a safe filename is required"); const name = value.trim(); if (!new RegExp(`\\.${extension}$`, "i").test(name)) throw new DomainError("INVALID_FILENAME", `filename must end in .${extension}`); return name; }
function uploadText(value, field) { try { const text = decodeURIComponent(String(value || "")).trim(); if (!text || text.length > 500) throw new Error(); return text; } catch { throw new DomainError("INVALID_INPUT", `${field} is required and must be at most 500 characters`); } }
function createRateLimiter({ max = 60, windowMs = 60_000, now = Date.now, key = req => req.socket.remoteAddress || "unknown" } = {}) { const entries = new Map(); return req => { const id = key(req), time = Number(now()), old = entries.get(id); const entry = !old || time - old.startedAt >= windowMs ? { startedAt: time, count: 0 } : old; entry.count += 1; entries.set(id, entry); if (entry.count > max) throw new DomainError("RATE_LIMITED", "request rate limit exceeded", 429, { retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (time - entry.startedAt)) / 1000)) }); }; }

async function runPlanningModel(arkService, principal, { model, prompt, duration, language, idempotencyKey }) {
  let invalidOutput = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const repair = attempt === 1 ? "" : `\nYour previous response was invalid: ${invalidOutput.message}. Return one valid JSON object only with shot durations totaling exactly ${duration} seconds. Do not include markdown, commentary, or code fences.`;
    const job = await arkService.submit(principal, { model, capability: "text", input: { prompt: `${prompt}${repair}`, temperature: attempt === 1 ? 0.4 : 0, max_completion_tokens: 4000, disableThinking: true, jsonOutput: true }, idempotencyKey: `${idempotencyKey}:attempt-${attempt}` });
    if (job.status !== "succeeded" || typeof job.result?.content !== "string") throw new DomainError("MODEL_OUTPUT_INVALID", "text planning job did not produce content", 502);
    try { return { job, plan: parsePlanningResult(job.result.content, duration, language), attempts: attempt }; }
    catch (error) {
      if (error?.code !== "MODEL_OUTPUT_INVALID" || attempt === 2) throw error;
      invalidOutput = error;
    }
  }
  throw invalidOutput;
}

export function createOpenReelServer(store = createMemoryStore(), platform = createPlatform(), { production = false, secureCookies = production, enforceCommercialPolicySafety = production, jsonLimit = 1024 * 1024, rateLimit = {}, logger = () => {}, readiness = () => ({ database: "ok", assets: "ok" }), metrics = createMetrics(), adminToken = null, adminPasswordHash = null, arkService = null, workbenchPlanningModel = null, qwenTtsService = null, authorizeQwenTts = () => false, productUrlFetcher = createProductUrlFetcher(), publishingOrchestrator = null, publishingAccounts = () => [], publishingOAuth = null, commercialLifecycle = null, commercialJobs = null, commercialEstimate = null, agentFilmStore = createMemoryAgentFilmStore(), directorSystemStore = createDirectorSystemStore() } = {}) {
  const limit = createRateLimiter(rateLimit), log = (event, fields) => logger(event, redact(fields)), adminSessions = new Map();
  const understandProductUrl = createProductUnderstandingService(productUrlFetcher, arkService);
  const commercial = commercialLifecycle && commercialEstimate ? createWorkbenchCommercialService({ lifecycle: commercialLifecycle, snapshot: (projectId, actorId) => store.snapshot(projectId, actorId), estimate: commercialEstimate }) : null;
  const canvasModels = () => { const models = store.listModels(); if (arkService) models.push(...arkService.models().filter(x => ["image", "video", "audio"].includes(x.capability)).map(x => ({ id: x.name, kind: x.capability, adapterId: "ark", schema: { modes: [], aspects: [], resolutions: [], durations: x.capability === "video" ? [5, 10] : [], audio: x.capability === "video", maxReferences: 0 } }))); if (qwenTtsService) models.push({ id: "qwen-tts-tailnet", kind: "audio", adapterId: "qwen-tts", schema: { modes: ["text-to-audio"], aspects: [], resolutions: [], durations: [1, 2, 3, 4, 5, 10], controls: ["voice", "audio-format"], maxReferences: 0, execution: "server-authorized-only" } }); return models; };
  const catalogModels = () => canvasModels().map(({ id, kind, adapterId, schema }) => ({ id, kind, adapterId, schema }));
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
      else if (req.method === "GET" && api[0] === "models" && api.length === 1) out = canvasModels();
      else if (req.method === "POST" && api[0] === "product-url" && api[1] === "extract" && api.length === 2) out = await productUrlFetcher(await input());
      else if (req.method === "POST" && api[0] === "product-url" && api[1] === "understand" && api.length === 2) out = await understandProductUrl({ ...(await input()), principal: { kind: "account", accountId: who } });
      else if (req.method === "GET" && api[0] === "model-catalog" && api.length === 1) out = createModelCatalog(catalogModels());
      else if (req.method === "GET" && api[0] === "model-catalog" && api[1] === "coverage" && api.length === 2) out = compareCapabilityBaseline(createModelCatalog(catalogModels()));
      else if (req.method === "GET" && api[0] === "model-catalog" && api[1] === "reference" && api.length === 2) out = referenceCapabilityCatalog();
      else if (req.method === "GET" && api[0] === "model-catalog" && api[1] === "mapping-validation" && api.length === 2) out = validateProviderMappings(createModelCatalog(catalogModels()));
      else if (req.method === "GET" && api[0] === "workflow-shortcuts" && api.length === 1) out = workflowShortcutCatalog();
      else if (req.method === "GET" && api[0] === "tutorials" && api[2] === "workflow" && api.length === 3) {
        let workflow;
        try { workflow = tutorialWorkflow(api[1]); validateWorkflow(workflow); } catch { throw new DomainError("NOT_FOUND", "valid tutorial workflow not found", 404); }
        out = workflow;
      }
      else if (api[0] === "projects" && api[2] === "tutorials" && api[4] === "progress" && api.length === 5) {
        const tutorial = tutorialById(api[3]);
        if (!tutorial) throw new DomainError("NOT_FOUND", "tutorial not found", 404);
        if (req.method === "GET") out = store.getTutorialProgress(api[1], tutorial.id, tutorial.version, who) || tutorialProgress(tutorial.id);
        else if (req.method === "PUT") { let progress; try { progress = tutorialProgress(tutorial.id, (await input()).completedSteps); } catch { throw new DomainError("INVALID_INPUT", "completedSteps contains an invalid tutorial step"); } out = store.setTutorialProgress(api[1], progress, who); }
        else throw new DomainError("NOT_FOUND", "tutorial progress route not found", 404);
      }
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "sessions" && api[4] === "workflow-shortcuts" && api[6] === "apply" && api.length === 7) {
        const prepared = prepareWorkflowShortcutApplication(api[5], await input());
        const provenance = JSON.parse(prepared.content);
        for (const assetId of provenance.referenceAssetIds) {
          const asset = store.assetManifest(api[1], api[3], assetId, who);
          if (asset.kind !== "image" || asset.role !== "reference") throw new DomainError("INVALID_INPUT", "workflow shortcut references must be uploaded images");
        }
        out = store.createNode(api[3], prepared, who);
      }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "register") { const account = platform.register(await input()); store.createUser({ id: account.id, name: account.email }); out = account; }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "login") { const session = platform.login(await input()), csrf = randomBytes(24).toString("base64url"); return json(res, 200, { account: platform.authenticate(session.token), csrfToken: csrf, expiresAt: session.expiresAt }, { "set-cookie": [sessionCookie("openreel_session", session.token, session, secureCookies), sessionCookie("openreel_csrf", csrf, session, secureCookies)] }); }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "logout") { out = platform.logout(token); return json(res, 200, out, { "set-cookie": [cookie("openreel_session", "", { secure: secureCookies, maxAge: 0 }), cookie("openreel_csrf", "", { secure: secureCookies, maxAge: 0 })] }); }
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "rotate") { const session = platform.rotateSession(token), csrf = randomBytes(24).toString("base64url"); return json(res, 200, { account: platform.authenticate(session.token), csrfToken: csrf, expiresAt: session.expiresAt }, { "set-cookie": [sessionCookie("openreel_session", session.token, session, secureCookies), sessionCookie("openreel_csrf", csrf, session, secureCookies)] }); }
      else if (req.method === "GET" && api[0] === "auth" && api[1] === "csrf") { const account = platform.authenticate(token), csrf = randomBytes(24).toString("base64url"), createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); return json(res, 200, { account, csrfToken: csrf }, { "set-cookie": sessionCookie("openreel_csrf", csrf, { createdAt, expiresAt }, secureCookies) }); }
      else if (req.method === "GET" && api[0] === "auth" && api[1] === "me") out = platform.authenticate(token);
      else if (adminRoute) {
        if (req.method === "POST" && api[1] === "login" && api.length === 2) {
          const value = await input();
          if (!verifyAdminPassword(value.password, adminPasswordHash)) { log("admin_login_failed", { requestId }); throw new DomainError("INVALID_CREDENTIALS", "invalid administrator credentials", 401); }
          const sessionToken = randomBytes(32).toString("base64url"), csrf = randomBytes(24).toString("base64url"), now = Date.now(), expiresAt = new Date(now + 8 * 60 * 60 * 1000).toISOString();
          adminSessions.set(sessionToken, { expiresAt: Date.parse(expiresAt) });
          log("admin_login_succeeded", { requestId });
          return json(res, 200, { expiresAt, csrfToken: csrf }, { "set-cookie": [cookie("openreel_admin_session", sessionToken, { secure: secureCookies, maxAge: 8 * 60 * 60, expires: expiresAt }), cookie("openreel_admin_csrf", csrf, { secure: secureCookies, maxAge: 8 * 60 * 60, expires: expiresAt })] });
        }
        const adminSession = jar.openreel_admin_session && adminSessions.get(jar.openreel_admin_session), sessionAuthorized = adminSession && adminSession.expiresAt > Date.now(), keyAuthorized = adminToken && safeEqual(req.headers["x-openreel-admin-key"], adminToken);
        if (!sessionAuthorized && !keyAuthorized) throw new DomainError("FORBIDDEN", "administrator authorization required", 403);
        if (sessionAuthorized && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !safeEqual(req.headers["x-csrf-token"], jar.openreel_admin_csrf)) throw new DomainError("CSRF_REJECTED", "valid administrator CSRF token required", 403);
        if (req.method === "POST" && api[1] === "logout" && api.length === 2) { adminSessions.delete(jar.openreel_admin_session); return json(res, 200, { loggedOut: true }, { "set-cookie": [cookie("openreel_admin_session", "", { secure: secureCookies, maxAge: 0 }), cookie("openreel_admin_csrf", "", { secure: secureCookies, maxAge: 0 })] }); }
        if (req.method === "GET" && api[1] === "session" && api.length === 2) out = { authenticated: true, expiresAt: adminSession ? new Date(adminSession.expiresAt).toISOString() : null };
        else if (req.method === "GET" && api[1] === "key-applications" && api.length === 2) out = platform.listKeyApplications({ status: url.searchParams.get("status") || undefined });
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
      else if (req.method === "DELETE" && api[0] === "teams" && api[2] === "invites" && api.length === 4) out = platform.revokeInvite(token, api[1], api[3]);
      else if (req.method === "POST" && api[0] === "invites" && api[2] === "accept") out = platform.acceptInvite(token, api[1]);
      else if (req.method === "PATCH" && api[0] === "teams" && api[2] === "members" && api.length === 4) out = platform.updateMember(token, api[1], api[3], await input());
      else if (req.method === "DELETE" && api[0] === "teams" && api[2] === "members" && api.length === 4) out = platform.removeMember(token, api[1], api[3]);
      else if (req.method === "PUT" && api[0] === "teams" && api[2] === "presence" && api.length === 3) out = platform.updatePresence(token, api[1], await input());
      else if (req.method === "GET" && api[0] === "teams" && api[2] === "presence" && api.length === 3) out = platform.listPresence(token, api[1], url.searchParams.get("documentId"));
      else if (req.method === "GET" && api[0] === "teams" && api[2] === "documents" && api.length === 4) out = platform.collaborativeDocument(token, api[1], api[3]);
      else if (req.method === "PUT" && api[0] === "teams" && api[2] === "documents" && api.length === 4) out = platform.updateCollaborativeDocument(token, api[1], api[3], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "quote") out = platform.quote(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "reserve") out = platform.reserve(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "settle") throw new DomainError("FORBIDDEN", "client-directed settlement is disabled", 403);
      else if (req.method === "GET" && api[0] === "teams" && api[2] === "budget") out = platform.budgetStatus(token, api[1]);
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "workflows" && api[3] === "import") out = platform.importWorkflow(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "automations" && api[3] === "plan") out = platform.planAutomation(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "automations" && api[3] === "run") { const value = await input(); out = platform.runAutomation(token, api[1], value.plan, value.idempotencyKey); }
      else if (req.method === "GET" && api[0] === "security-boundary") out = platform.securityBoundary();
      else if (req.method === "GET" && api[0] === "publishing" && api[1] === "accounts" && api.length === 2) {
        const bindings = await publishingAccounts({ tenantId: who, accountId: who }), byPlatform = new Map((Array.isArray(bindings) ? bindings : []).map(item => [item.platform, item]));
        out = { schema: "openreel-publishing-account-view/v1", platforms: ["tiktok", "douyin", "instagram_reels", "youtube_shorts"].map(name => { const item = byPlatform.get(name), connected = item?.status === "connected", privacyOptions = Array.isArray(item?.privacyOptions) ? item.privacyOptions.filter(value => typeof value === "string" && value.length <= 100).slice(0, 20) : []; return { platform: name, status: connected ? "connected" : "unbound", accountId: connected ? String(item.accountId || "") : null, displayName: connected ? String(item.displayName || "") : null, canPublish: connected && item.canPublish === true, capabilities: connected ? { privacyOptions, audienceRequired: item.audienceRequired === true, interactions: { comment: item.interactions?.comment === true, duet: item.interactions?.duet === true, stitch: item.interactions?.stitch === true } } : null }; }) };
      }
      else if (api[0] === "publishing" && api[1] === "oauth" && ["tiktok", "youtube_shorts"].includes(api[2])) {
        if (!publishingOAuth) throw new DomainError("PUBLISHING_OAUTH_UNAVAILABLE", "publishing OAuth is not configured", 503);
        if (req.method === "POST" && api[3] === "begin" && api.length === 4) out = await publishingOAuth.begin({ tenantId: who, actorId: who, platform: api[2], ...(await input()) });
        else if (req.method === "GET" && api[3] === "callback" && api.length === 4) { const completed = await publishingOAuth.complete({ tenantId: who, actorId: who, platform: api[2], state: url.searchParams.get("state"), code: url.searchParams.get("code") }); if (typeof completed?.returnPath !== "string" || !completed.returnPath.startsWith("/") || completed.returnPath.startsWith("//")) throw new DomainError("PUBLISHING_OAUTH_RETURN_INVALID", "publishing OAuth return path is invalid", 502); res.writeHead(303, { location: completed.returnPath, "cache-control": "no-store" }); return res.end(); }
        else throw new DomainError("NOT_FOUND", "publishing OAuth route not found", 404);
      }
      else if (req.method === "DELETE" && api[0] === "publishing" && api[1] === "accounts" && api.length === 3) {
        if (!publishingOAuth) throw new DomainError("PUBLISHING_OAUTH_UNAVAILABLE", "publishing OAuth is not configured", 503);
        out = await publishingOAuth.disconnect({ tenantId: who, actorId: who, bindingId: api[2] });
      }
      else if (api[0] === "publishing" && api[1] === "batches") {
        if (!publishingOrchestrator) throw new DomainError("PUBLISHING_UNAVAILABLE", "publishing is not configured", 503);
        const principal = { tenantId: who, accountId: who }, batchId = api[2], action = api[3];
        if (req.method === "POST" && api.length === 2) out = publishingOrchestrator.create(principal, await input());
        else if (req.method === "GET" && api.length === 2) out = publishingOrchestrator.list(principal);
        else if (req.method === "GET" && batchId === "export" && api.length === 3) out = publishingOrchestrator.export(principal);
        else if (req.method === "GET" && api.length === 3) out = publishingOrchestrator.get(principal, batchId);
        else if (req.method === "DELETE" && api.length === 3) out = publishingOrchestrator.remove(principal, batchId);
        else if (req.method === "POST" && action === "validate" && api.length === 4) out = await publishingOrchestrator.validate(principal, batchId);
        else if (req.method === "POST" && action === "confirm" && api.length === 4) out = publishingOrchestrator.confirm(principal, batchId, (await input()).platform || null);
        else if (req.method === "POST" && action === "advance" && api.length === 4) out = await publishingOrchestrator.advance(principal, batchId);
        else if (req.method === "POST" && action === "retry" && api.length === 4) out = publishingOrchestrator.retry(principal, batchId, (await input()).platform);
        else if (req.method === "POST" && action === "cancel" && api.length === 4) out = publishingOrchestrator.cancel(principal, batchId);
        else if (req.method === "POST" && action === "reconcile" && api.length === 4) out = await publishingOrchestrator.reconcile(principal, batchId, (await input()).platform);
        else throw new DomainError("NOT_FOUND", "publishing route not found", 404);
        const operation = action || (batchId === "export" ? "export" : req.method === "DELETE" ? "delete" : req.method === "POST" ? "create" : "read"); metrics.publishing?.(operation, "success"); log("publishing_operation", { requestId, operation, batchId: batchId || out?.id || null, actorId: who, status: out?.summary?.status || null });
      }
      else if (req.method === "GET" && api[0] === "projects" && api.length === 1) out = store.listProjects(who, Object.fromEntries(url.searchParams));
      else if (req.method === "POST" && api[0] === "projects" && api.length === 1) out = store.createProject(await input(), who);
      else if (req.method === "GET" && api[0] === "projects" && api.length === 2) out = store.snapshot(api[1], who);
      else if (api[0] === "projects" && api[2] === "director" && api[3] === "records") {
        const principal = { tenantId: who, actorId: who };
        if (req.method === "POST" && api.length === 4) out = directorSystemStore.put(principal, api[1], await input());
        else if (req.method === "GET" && api.length === 7) out = directorSystemStore.get(principal, api[1], api[4], api[5], api[6]);
        else throw new DomainError("NOT_FOUND", "director record route not found", 404);
      }
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
      else if (api[0] === "projects" && api[2] === "continuity" && api.length === 3) {
        if (req.method === "GET") out = store.listContinuityEntities(api[1], who);
        else if (req.method === "POST") out = store.createContinuityEntity(api[1], await input(), who);
        else throw new DomainError("NOT_FOUND", "continuity route not found", 404);
      }
      else if (req.method === "PATCH" && api[0] === "projects" && api[2] === "continuity" && api.length === 4) out = store.updateContinuityEntity(api[1], api[3], await input(), who);
      else if (req.method === "PUT" && api[0] === "projects" && api[2] === "story") out = store.upsertStory(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "workbench-plan") {
        if (!arkService) throw new DomainError("ARK_UNAVAILABLE", "real text planning is not configured", 503);
        const value = await input(), before = store.snapshot(api[1], who), model = value.model || workbenchPlanningModel || arkService.models().find(item => item.capability === "text")?.name;
        if (!model) throw new DomainError("ARK_MODEL_UNAVAILABLE", "no real text planning model is configured", 503);
        if (value.projectVersion !== before.project.version) throw new DomainError("VERSION_CONFLICT", "project changed before text planning", 409);
        const prompt = `${planningPrompt(value)}\nBinding: projectId=${api[1]}; projectVersion=${value.projectVersion}; storyVersion=${before.story?.version || 0}; storyboardVersion=${before.storyboard?.version || 0}`;
        const { job, plan, attempts } = await runPlanningModel(arkService, { kind: "account", accountId: who }, { model, prompt, duration: Number(value.duration), language: planningLanguage(value.brief), idempotencyKey: value.idempotencyKey });
        if (store.snapshot(api[1], who).project.version !== value.projectVersion) throw new DomainError("VERSION_CONFLICT", "project changed while text planning was running", 409);
        const planning = { ...planningProvenance({ prompt, output: job.result.content, job, model }), attempts };
        const story = store.upsertStory(api[1], { title: plan.title, synopsis: plan.synopsis, hooks: plan.hooks, selectedHook: plan.selectedHook, scenes: plan.shots.map(shot => ({ title: shot.title, summary: shot.line })) }, who);
        const storyboard = store.upsertStoryboard(api[1], { shots: story.scenes.map((scene, index) => ({ sceneId: scene.id, prompt: plan.shots[index].visual, broll: plan.shots[index].broll, duration: plan.shots[index].duration, referenceAssetIds: value.referenceAssetIds || [] })) }, who);
        out = { story, storyboard, planning, binding: { projectId: api[1], projectVersion: value.projectVersion, storyVersion: story.version, storyboardVersion: storyboard.version } };
      }
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "agent-films" && api.length === 3) {
        if (!commercial || !arkService) throw new DomainError("AGENT_FILM_UNAVAILABLE", "Agent film orchestration is not configured", 503);
        const value = await input(), principal = { kind: "account", accountId: who };
        if (value.action === "prepare") {
          if (typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200) throw new DomainError("AGENT_FILM_INVALID", "idempotencyKey is required", 422);
          const idempotencyKey = value.idempotencyKey.trim(), replay = agentFilmStore.get(who, api[1], idempotencyKey);
          if (replay) out = replay.result;
          else {
            const before = store.snapshot(api[1], who), model = value.model || workbenchPlanningModel || arkService.models().find(item => item.capability === "text")?.name;
            if (!model) throw new DomainError("ARK_MODEL_UNAVAILABLE", "no real text planning model is configured", 503);
            if (value.projectVersion !== before.project.version) throw new DomainError("VERSION_CONFLICT", "project changed before Agent planning", 409);
            const prompt = `${planningPrompt(value)}\nBinding: projectId=${api[1]}; projectVersion=${value.projectVersion}; storyVersion=${before.story?.version || 0}; storyboardVersion=${before.storyboard?.version || 0}`;
            const { job, plan, attempts } = await runPlanningModel(arkService, principal, { model, prompt, duration: Number(value.duration), language: planningLanguage(value.brief), idempotencyKey: `${value.idempotencyKey.trim()}:planning` });
            if (store.snapshot(api[1], who).project.version !== value.projectVersion) throw new DomainError("VERSION_CONFLICT", "project changed while Agent planning was running", 409);
            const planning = { ...planningProvenance({ prompt, output: job.result.content, job, model }), attempts };
            const story = store.upsertStory(api[1], { title: plan.title, synopsis: plan.synopsis, hooks: plan.hooks, selectedHook: plan.selectedHook, scenes: plan.shots.map(shot => ({ title: shot.title, summary: shot.line })) }, who);
            const storyboard = store.upsertStoryboard(api[1], { shots: story.scenes.map((scene, index) => ({ sceneId: scene.id, prompt: plan.shots[index].visual, broll: plan.shots[index].broll, duration: plan.shots[index].duration, referenceAssetIds: value.referenceAssetIds || [] })) }, who);
            const current = store.snapshot(api[1], who), binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
            const quote = commercial.quote(principal, api[1], { ...binding, quality: value.quality, identityReference: value.identityReference, declarations: value.declarations });
            out = { schema: "openreel-agent-film-preparation/v1", action: "prepared", projectId: api[1], planning, binding, quote };
            agentFilmStore.put({ schema: "openreel-agent-film-record/v1", ownerId: who, projectId: api[1], idempotencyKey, status: "prepared", result: out });
          }
        } else if (value.action === "execute") {
          if (typeof value.preparationIdempotencyKey !== "string" || !value.preparationIdempotencyKey.trim()) throw new DomainError("AGENT_FILM_PREPARATION_MISMATCH", "execution requires its Agent film preparation", 409);
          const preparationKey = value.preparationIdempotencyKey.trim(), preparation = agentFilmStore.get(who, api[1], preparationKey);
          if (!preparation || preparation.result?.quote?.id !== value.quoteId) throw new DomainError("AGENT_FILM_PREPARATION_MISMATCH", "execution does not match the Agent film preparation", 409);
          const created = commercial.confirm(principal, api[1], { quoteId: value.quoteId, confirmed: value.confirmed, idempotencyKey: value.idempotencyKey });
          agentFilmStore.linkExecution(who, api[1], preparationKey, created.id);
          out = await commercial.execute(principal, api[1], created.id);
        } else throw new DomainError("AGENT_FILM_INVALID", "action must be prepare or execute", 422);
      }
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "agent-films" && api.length === 4) {
        const record = agentFilmStore.get(who, api[1], api[3]);
        if (!record) throw new DomainError("AGENT_FILM_NOT_FOUND", "Agent film run not found", 404);
        out = record.result;
      }
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "agent-films" && api[4] === "progress" && api.length === 5) {
        if (!commercial) throw new DomainError("AGENT_FILM_UNAVAILABLE", "Agent film orchestration is not configured", 503);
        const record = agentFilmStore.get(who, api[1], api[3]);
        if (!record) throw new DomainError("AGENT_FILM_NOT_FOUND", "Agent film run not found", 404);
        const job = record.executionJobId ? commercial.get({ accountId: who }, api[1], record.executionJobId) : null;
        out = { schema: "openreel-agent-film-progress/v1", projectId: api[1], idempotencyKey: api[3], status: job?.status || "prepared", stage: job?.stage || "planning-complete", stageDetail: job?.stageDetail || null, preparation: record.result, execution: job };
      }
      else if (req.method === "PUT" && api[0] === "projects" && api[2] === "storyboard") out = store.upsertStoryboard(api[1], await input(), who);
      else if (api[0] === "projects" && api[2] === "commercial") {
        if (!commercial) throw new DomainError("COMMERCIAL_WORKBENCH_UNAVAILABLE", "commercial generation is not configured", 503);
        const principal = { kind: "account", accountId: who }, action = api[3], jobId = api[4];
        if (req.method === "POST" && action === "production-assets" && api.length === 4) { const mimeType = req.headers["content-type"]?.split(";", 1)[0], policy = ASSET_POLICY[mimeType]; if (!policy) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "unsupported production asset media type", 415); const bytes = await binaryBody(req, policy.maxBytes); if (!bytes.length) throw new DomainError("EMPTY_ASSET", "asset bytes are required"); if (sniffMime(bytes) !== mimeType) throw new DomainError("MEDIA_SIGNATURE_MISMATCH", "media signature does not match content-type", 415); const stage = req.headers["x-openreel-asset-stage"]; out = store.uploadCommercialProductionAsset(api[1], { stage, mimeType, filename: uploadFilename(req.headers["x-filename"], policy.extension), bytes, projectVersion: Number(req.headers["x-project-version"]), storyVersion: Number(req.headers["x-story-version"]), storyboardVersion: Number(req.headers["x-storyboard-version"]), ...(stage === "caption" ? { shotId: req.headers["x-shot-id"], captionText: uploadText(req.headers["x-caption-text"], "captionText") } : { sourceDeclaration: uploadText(req.headers["x-source-declaration"], "sourceDeclaration") }) }, who); }
        else if (req.method === "POST" && action === "quote" && api.length === 4) out = commercial.quote(principal, api[1], { ...(await input()), requirePolicySafety: enforceCommercialPolicySafety });
        else if (req.method === "POST" && action === "jobs" && api.length === 4) out = commercial.confirm(principal, api[1], await input());
        else if (req.method === "POST" && action === "jobs" && api[5] === "redo" && api[6] === "quote" && api.length === 7) out = commercial.redoQuote(principal, api[1], jobId);
        else if (req.method === "POST" && action === "jobs" && api[5] === "redo" && api[6] === "jobs" && api.length === 7) out = commercial.confirmRedo(principal, api[1], jobId, await input());
        else if (req.method === "GET" && action === "jobs" && api.length === 5) out = commercial.get(principal, api[1], jobId);
        else if (req.method === "POST" && action === "jobs" && api[5] === "execute" && api.length === 6) out = await commercial.execute(principal, api[1], jobId);
        else if (req.method === "POST" && action === "jobs" && api[5] === "retry" && api.length === 6) out = commercial.retry(principal, api[1], jobId);
        else if (req.method === "POST" && action === "jobs" && api[5] === "cancel" && api.length === 6) out = commercial.cancel(principal, api[1], jobId);
        else throw new DomainError("NOT_FOUND", "commercial workbench route not found", 404);
      }
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "storyboard-batches" && api.length === 3) out = store.listStoryboardBatches(api[1], who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "storyboard-batches" && api.length === 3) out = store.createStoryboardBatch(api[1], await input(), who);
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "storyboard-batches" && api.length === 4) out = store.storyboardBatch(api[1], api[3], who);
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "storyboard-batches" && api[4] === "tick") out = store.tickStoryboardBatch(api[1], api[3], who);
      else if (req.method === "PUT" && api[0] === "projects" && api[2] === "timeline") out = store.upsertTimeline(api[1], await input(), who);
      else if (req.method === "GET" && api[0] === "projects" && api[2] === "exports" && api[3] === "manifest") { const state = store.snapshot(api[1], who), commercialRender = state.assets.find(asset => asset.role === "render" && asset.metadata?.identity?.schema === "openreel-revision-identity/v1"); if (commercialRender) requireCommercialRelease({ commercialJobs, ownerId: who, projectId: api[1], revisionIdentity: commercialRender.metadata.identity }); out = store.exportManifest(api[1], who); }
      else if (req.method === "POST" && api[0] === "projects" && api[2] === "exports" && api[3] === "render") { const state = store.snapshot(api[1], who), commercialRender = state.assets.find(asset => asset.role === "render" && asset.metadata?.identity?.schema === "openreel-revision-identity/v1"); if (commercialRender) { requireCommercialRelease({ commercialJobs, ownerId: who, projectId: api[1], revisionIdentity: commercialRender.metadata.identity }); throw new DomainError("COMMERCIAL_EXPORT_ASSET_REQUIRED", "commercial exports must use the byte-bound qualified render asset", 409); } out = store.renderProject(api[1], await input(), who); }
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "close") out = store.closeSession(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "nodes") out = store.createNode(api[1], await input(), who);
      else if (req.method === "PATCH" && api[0] === "nodes" && api.length === 2) out = store.updateNode(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "jobs") out = store.createJob(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "qwen-tts-jobs") out = store.createQwenTtsCanvasJob(api[1], await input(), who);
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "qwen-tts-run") { if (!qwenTtsService) throw new DomainError("QWEN_TTS_UNAVAILABLE", "Qwen TTS is not configured", 503); const job = store.qwenTtsCanvasJob(api[1], who); if (await authorizeQwenTts({ job, actorId: who, request: req }) !== true) throw new DomainError("QWEN_TTS_CALL_GATED", "a precise real-generation authorization is required", 403); const output = await qwenTtsService.synthesize({ input: job.prompt, response_format: "wav", ...(job.parameters.language && { language: job.parameters.language }), ...(job.parameters.audioSpec.voice && { voice: job.parameters.audioSpec.voice }), ...(job.parameters.instruct && { instruct: job.parameters.instruct }) }, { authorized: true }); out = store.reconcileQwenTtsCanvasJob(job.id, output, who); }
      else if (req.method === "POST" && api[0] === "sessions" && api[2] === "ark-jobs") { if (!arkService) throw new DomainError("ARK_UNAVAILABLE", "Ark inference is not configured", 503); const value = await input(), parameters = value.parameters || {}, providerInput = { prompt: value.prompt, ...parameters, ...(parameters.aspect ? { ratio: parameters.aspect } : {}), ...(parameters.audio !== undefined ? { generate_audio: parameters.audio } : {}) }, arkJob = await arkService.submit({ kind: "account", accountId: who }, { model: value.model, capability: value.capability, input: providerInput, idempotencyKey: value.idempotencyKey }); out = store.createArkCanvasJob(api[1], value, arkJob, who); }
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "ark-poll") { if (!arkService) throw new DomainError("ARK_UNAVAILABLE", "Ark inference is not configured", 503); const billing = { kind: "account", accountId: who }, local = store.arkCanvasJob(api[1], who), arkJob = await arkService.poll(billing, local.arkJobId), output = arkJob.status === "succeeded" ? await arkService.download(billing, arkJob.id) : null; out = store.reconcileArkCanvasJob(local.id, arkJob, output, who); }
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "tick") out = store.tickJob(api[1], who);
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "cancel") out = store.transitionJob(api[1], "canceled", {}, who);
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "retry") out = store.retryJob(api[1], await input(), who);
      else if (req.method === "GET" && api[0] === "jobs" && api[2] === "progress") out = store.progress(api[1], url.searchParams.get("afterSeq") ?? 0, who);
      else if (versioned && req.method === "POST" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[5] === "references") { const mime = req.headers["content-type"]?.split(";", 1)[0], policy = ASSET_POLICY[mime]; if (!policy) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "unsupported reference media type", 415, { allowed: Object.keys(ASSET_POLICY) }); const bytes = await binaryBody(req, policy.maxBytes); if (!bytes.length) throw new DomainError("EMPTY_ASSET", "asset bytes are required"); if (sniffMime(bytes) !== mime) throw new DomainError("MEDIA_SIGNATURE_MISMATCH", "media signature does not match content-type", 415); out = store.uploadReference(api[1], api[3], { mimeType: mime, filename: uploadFilename(req.headers["x-filename"], policy.extension), bytes }, who); }
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api[4] === "manifest") out = store.assetManifest(api[1], api[3], undefined, who);
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api[4] === "content") { const a = store.assetContent(api[1], api[3], undefined, who); if (a.manifest.role === "render" && a.manifest.metadata?.identity?.schema === "openreel-revision-identity/v1") requireCommercialRelease({ commercialJobs, ownerId: who, projectId: api[1], assetId: a.manifest.id, assetSha256: a.manifest.metadata.sha256, revisionIdentity: a.manifest.metadata.identity }); res.writeHead(200, { "content-type": a.manifest.mimeType, "content-length": a.bytes.length, "content-disposition": `attachment; filename="${a.manifest.filename}"`, "x-content-type-options": "nosniff" }); return res.end(a.bytes); }
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
  const arkProvider = createArkService({ config: arkConfig, platform, transport: transports.request, assetTransport: transports.asset, store: backend.arkJobs });
  const comfyUiProvider = createComfyUiService({ config: loadComfyUiConfig(), platform });
  const arkService = createInferenceRouter([arkProvider && Object.assign(Object.create(arkProvider), { id: "ark" }), comfyUiProvider]);
  const qwenTtsService = createQwenTtsClient({ config: loadQwenTtsConfig() });
  const googleOAuthNames = ["OPENREEL_GOOGLE_OAUTH_CLIENT_ID", "OPENREEL_GOOGLE_OAUTH_CLIENT_SECRET", "OPENREEL_GOOGLE_OAUTH_REDIRECT_URI", "OPENREEL_PUBLISHING_MASTER_KEY", "OPENREEL_PUBLISHING_STATE"], googleOAuthValues = googleOAuthNames.map(name => process.env[name]);
  if (googleOAuthValues.slice(0, 3).some(Boolean) && !googleOAuthValues.every(Boolean)) throw new Error(`YouTube publishing OAuth configuration must provide ${googleOAuthNames.join(", ")}`);
  const publishingRequest = createPublishingRequest(process.env.OPENREEL_PUBLISHING_PROXY_URL || "");
  const tiktokOAuthNames = ["OPENREEL_TIKTOK_CLIENT_KEY", "OPENREEL_TIKTOK_CLIENT_SECRET", "OPENREEL_TIKTOK_REDIRECT_URI", "OPENREEL_PUBLISHING_MASTER_KEY", "OPENREEL_PUBLISHING_STATE"], tiktokOAuthValues = tiktokOAuthNames.map(name => process.env[name]);
  if (tiktokOAuthValues.slice(0, 3).some(Boolean) && !tiktokOAuthValues.every(Boolean)) throw new Error(`TikTok publishing OAuth configuration must provide ${tiktokOAuthNames.join(", ")}`);
  const providers = {}, masterKey = process.env.OPENREEL_PUBLISHING_MASTER_KEY ? Buffer.from(process.env.OPENREEL_PUBLISHING_MASTER_KEY, "base64url") : null, stateRoot = process.env.OPENREEL_PUBLISHING_STATE;
  if (googleOAuthValues.every(Boolean)) providers.youtube_shorts = createGooglePublishingOAuth({ clientId: googleOAuthValues[0], clientSecret: googleOAuthValues[1], redirectUri: googleOAuthValues[2], masterKey, stateFile: join(stateRoot, "oauth.json"), request: publishingRequest });
  if (tiktokOAuthValues.every(Boolean)) providers.tiktok = createTikTokPublishingOAuth({ clientKey: tiktokOAuthValues[0], clientSecret: tiktokOAuthValues[1], redirectUri: tiktokOAuthValues[2], masterKey, stateFile: join(stateRoot, "oauth-tiktok.json"), request: publishingRequest });
  const publishingOAuth = Object.keys(providers).length ? createPublishingOAuthRouter(providers) : null, databaseStore = createDatabaseStore(backend);
  const commercialJobStore = createFileCommercialJobStore(process.env.OPENREEL_COMMERCIAL_JOBS || join(dirname(config.databaseFile), "commercial-jobs.json"));
  const publishingOrchestrator = publishingOAuth ? createProductionPublishingRuntime({ stateRoot, store: databaseStore, oauth: publishingOAuth, commercialJobs: commercialJobStore, request: publishingRequest }) : null;
  const audioMaxCostCny = Number(process.env.OPENREEL_COMMERCIAL_AUDIO_MAX_CNY || 0), evaluationMaxCostCnyPerCall = Number(process.env.OPENREEL_COMMERCIAL_EVALUATION_MAX_CNY_PER_CALL || 0), cnyPerUsd = Number(process.env.OPENREEL_CNY_PER_USD || 7.2), imageModel = process.env.OPENREEL_COMMERCIAL_IMAGE_MODEL || arkService?.models().find(item => item.capability === "image")?.name, videoModel = process.env.OPENREEL_COMMERCIAL_VIDEO_MODEL || arkService?.models().find(item => item.capability === "video")?.name;
  let commercialLifecycle = null, commercialEstimate = null;
  if (arkService && qwenTtsService && audioMaxCostCny > 0 && imageModel && videoModel) {
    const musicService = createSeedAudioMusicService();
    const artifactReader = (principal, projectId, assetId) => databaseStore.assetContent(projectId, assetId, undefined, principal.accountId);
    const perceptualEvaluator = createArkCommercialPerceptualEvaluator({ arkService, artifactReader, model: process.env.OPENREEL_COMMERCIAL_EVALUATION_MODEL, maximumCostCnyPerCall: evaluationMaxCostCnyPerCall, cnyPerUsd });
    const qualityInspector = createCommercialQualityInspector({ artifactReader, perceptualEvaluator });
    const commercialOrchestrator = createCommercialProviderOrchestrator({ arkService, qwenTtsService, musicService, qualityInspector, audioMaxCostCny, audioSettledCny: 0, cnyPerUsd, maxPolls: Number(process.env.OPENREEL_COMMERCIAL_MAX_POLLS || 120), wait: () => new Promise(resolve => setTimeout(resolve, 2_000)), artifactSink: (principal, artifact) => databaseStore.retainCommercialArtifact(artifact.projectId, artifact, principal.accountId), referenceArtifactSource: (principal, request) => request.assetIds.map(assetId => { const content = databaseStore.assetContent(request.projectId, assetId, undefined, principal.accountId); return { ...content.manifest, bytes: content.bytes }; }), preservedArtifactSource: (principal, request) => request.assetIds.map(assetId => databaseStore.assetContent(request.projectId, assetId, undefined, principal.accountId).manifest), productionArtifactSource: (principal, request) => request.assetIds.map(assetId => databaseStore.assetContent(request.projectId, assetId, undefined, principal.accountId).manifest), compositionSink: (principal, composition) => databaseStore.composeCommercialProject(composition.projectId, composition, principal.accountId) });
    commercialLifecycle = createCommercialJobLifecycle({ orchestrator: commercialOrchestrator, store: commercialJobStore });
    commercialLifecycle.recover();
    commercialEstimate = ({ shotCount, production }) => { const catalog = new Map(arkService.models().map(item => [item.name, item])), maximum = name => { const item = catalog.get(name), rate = item?.currency === "CNY" ? 1 : item?.currency === "USD" ? cnyPerUsd : NaN; return Number(item?.maxCostMicros) / Number(item?.unitScale) * rate; }, musicMaximum = production?.musicGeneration ? musicService.route.maximumCostCny : 0, evaluationModel = process.env.OPENREEL_COMMERCIAL_EVALUATION_MODEL, evaluationMaximum = evaluationMaxCostCnyPerCall * (shotCount + 1), generationMaximum = shotCount * (maximum(imageModel) + maximum(videoModel)) + audioMaxCostCny + musicMaximum; return { estimatedCny: generationMaximum + evaluationMaximum, generationEstimatedCny: generationMaximum, evaluationEstimatedCny: evaluationMaximum, models: { image: imageModel, video: videoModel, evaluation: evaluationModel }, music: { enabled: musicService.enabled, model: musicService.route.model, maximumCostCny: musicMaximum } }; };
  }
  const agentFilmStore = createFileAgentFilmStore(process.env.OPENREEL_AGENT_FILMS || join(dirname(config.databaseFile), "agent-films.json"));
  const server = createOpenReelServer(databaseStore, platform, { production, secureCookies: production, readiness: backend.health, logger, adminToken: process.env.OPENREEL_ADMIN_KEY || null, adminPasswordHash: process.env.OPENREEL_ADMIN_PASSWORD_HASH || null, arkService, workbenchPlanningModel: process.env.OPENREEL_WORKBENCH_TEXT_MODEL || null, qwenTtsService, commercialLifecycle, commercialJobs: commercialJobStore, commercialEstimate, agentFilmStore, publishingOAuth, publishingOrchestrator, publishingAccounts: publishingOAuth ? input => publishingOAuth.accounts(input) : () => [] });
  server.on("error", error => { logger("startup_error", { error: error.message }); process.exitCode = 1; });
  server.listen(config.port, config.host, () => logger("service_started", { host: config.host, port: config.port }));
}
