import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_POLICY, createMemoryStore, createPersistentStore, DomainError } from "./src/core.js";
import { createPlatform } from "./src/platform.js";

const root = fileURLToPath(new URL("./", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".md": "text/markdown" };
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); if (!chunks.length) return {}; try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new DomainError("INVALID_JSON", "request body must be valid JSON"); } }
async function binaryBody(req, limit) { const chunks = []; let length = 0; for await (const c of req) { length += c.length; if (length > limit) throw new DomainError("ASSET_TOO_LARGE", "asset exceeds byte limit", 413, { maxBytes: limit, actualBytes: length }); chunks.push(c); } return Buffer.concat(chunks); }
function json(res, status, value) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); }
const actor = req => req.headers["x-openreel-user"] || "local-owner";

export function createOpenReelServer(store = createMemoryStore(), platform = createPlatform()) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost"), parts = url.pathname.split("/").filter(Boolean);
      const versioned = parts[0] === "api" && parts[1] === "v1", api = versioned ? parts.slice(2) : parts.slice(1), who = actor(req), input = async () => body(req);
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      let out;
      if (req.method === "POST" && api[0] === "users" && api.length === 1) out = store.createUser(await input());
      else if (req.method === "GET" && api[0] === "models" && api.length === 1) out = store.listModels();
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "register") out = platform.register(await input());
      else if (req.method === "POST" && api[0] === "auth" && api[1] === "login") out = platform.login(await input());
      else if (req.method === "GET" && api[0] === "auth" && api[1] === "me") out = platform.authenticate(token);
      else if (req.method === "POST" && api[0] === "teams" && api.length === 1) out = platform.createTeam(token, await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "invites") out = platform.invite(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "invites" && api[2] === "accept") out = platform.acceptInvite(token, api[1]);
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "quote") out = platform.quote(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "reserve") out = platform.reserve(token, api[1], await input());
      else if (req.method === "POST" && api[0] === "teams" && api[2] === "budget" && api[3] === "settle") { const value = await input(); out = platform.settle(token, api[1], value.reservationId, value); }
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
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "tick") out = store.tickJob(api[1]);
      else if (req.method === "POST" && api[0] === "jobs" && api[2] === "cancel") out = store.transitionJob(api[1], "canceled");
      else if (req.method === "GET" && api[0] === "jobs" && api[2] === "progress") out = store.progress(api[1], url.searchParams.get("afterSeq") ?? 0);
      else if (versioned && req.method === "POST" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[5] === "references") { const mime = req.headers["content-type"]?.split(";", 1)[0], policy = ASSET_POLICY[mime]; if (!policy) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "unsupported reference media type", 415, { allowed: Object.keys(ASSET_POLICY) }); out = store.uploadReference(api[1], api[3], { mimeType: mime, filename: req.headers["x-filename"], bytes: await binaryBody(req, policy.maxBytes) }, who); }
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api[4] === "manifest") out = store.assetManifest(api[1], api[3], undefined, who);
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "assets" && api[4] === "content") { const a = store.assetContent(api[1], api[3], undefined, who); res.writeHead(200, { "content-type": a.manifest.mimeType, "content-length": a.bytes.length, "content-disposition": `attachment; filename="${a.manifest.filename}"`, "x-content-type-options": "nosniff" }); return res.end(a.bytes); }
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[6] === "manifest") out = store.assetManifest(api[1], api[3], api[5], who);
      else if (versioned && req.method === "GET" && api[0] === "projects" && api[2] === "sessions" && api[4] === "assets" && api[6] === "content") { const a = store.assetContent(api[1], api[3], api[5], who); res.writeHead(200, { "content-type": a.manifest.mimeType, "content-length": a.bytes.length }); return res.end(a.bytes); }
      else if (url.pathname.startsWith("/api/")) throw new DomainError("NOT_FOUND", "route not found", 404);
      else return serveStatic(url.pathname, res);
      json(res, req.method === "POST" ? 201 : 200, out);
    } catch (e) { if (e instanceof DomainError) return json(res, e.status, { error: { code: e.code, message: e.message, ...(e.details && { details: e.details }) } }); console.error(e); json(res, 500, { error: { code: "INTERNAL_ERROR", message: "Internal server error" } }); }
  });
}
async function serveStatic(pathname, res) { const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^\/+/, ""), file = join(root, relative); if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new DomainError("NOT_FOUND", "file not found", 404); res.writeHead(200, { "content-type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8` }); res.end(await readFile(file)); }
if (process.argv[1] === fileURLToPath(import.meta.url)) { const port = Number(process.env.PORT || 4173), file = process.env.OPENREEL_DATA || join(root, ".data", "openreel.json"); createOpenReelServer(createPersistentStore(file), createPlatform({ file: `${file}.platform` })).listen(port, () => console.log(`OpenReel running at http://localhost:${port}`)); }
