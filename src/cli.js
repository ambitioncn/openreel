import { readFile, writeFile } from "node:fs/promises";

export async function runCli(argv, io = {}) {
  const out = io.out || (value => process.stdout.write(`${JSON.stringify(value)}\n`));
  const base = flag(argv, "--base") || process.env.OPENREEL_URL || "http://127.0.0.1:4173";
  const args = argv.filter((v, i) => v !== "--base" && argv[i - 1] !== "--base");
  const [resource, action, id] = args;
  if (!resource || resource === "help" || args.includes("--help")) return out({ cli: "openreel", usage: "openreel <resource> <action> [id] [flags]", resources: { workspace:["info"], project:["create","list","create-session"], canvas:["get","group"], node:["create","update"], edge:["create","update"], run:["create","tick","progress","cancel","render"], "model-schema":["list"], upload:["--project --session --file --mime"], download:["--url --out"] } });
  const request = async (path, options = {}) => { const response = await fetch(`${base}${path}`, options); if (!response.ok) { let detail; try { detail = await response.json(); } catch { detail = {}; } const error = new Error(detail.error?.message || `HTTP ${response.status}`); error.code = detail.error?.code || "HTTP_ERROR"; error.status = response.status; throw error; } const type = response.headers.get("content-type") || ""; return type.includes("json") ? response.json() : Buffer.from(await response.arrayBuffer()); };
  let value;
  if (resource === "workspace" && action === "info") value = { api: "v1", base };
  else if (resource === "project" && action === "create") value = await request("/api/v1/projects", jsonOptions("POST", { name: requiredFlag(args, "--name") }));
  else if (resource === "project" && action === "list") value = await request("/api/v1/projects");
  else if (resource === "project" && action === "create-session") value = await request(`/api/v1/projects/${id}/sessions`, jsonOptions("POST", { name: requiredFlag(args, "--name") }));
  else if ((resource === "project" || resource === "canvas") && action === "get") value = await request(`/api/v1/projects/${id}`);
  else if (resource === "node" && action === "create") value = await request(`/api/v1/sessions/${requiredFlag(args, "--session")}/nodes`, jsonOptions("POST", { type: requiredFlag(args, "--type"), title: flag(args, "--title"), content: flag(args, "--content"), position: { x: Number(flag(args, "--x") || 0), y: Number(flag(args, "--y") || 0) } }));
  else if (resource === "node" && action === "update") value = await request(`/api/v1/nodes/${id}`, jsonOptions("PATCH", { title: flag(args, "--title"), content: flag(args, "--content"), version: numberFlag(args, "--version") }));
  else if (resource === "edge" && action === "create") value = await request(`/api/v1/projects/${requiredFlag(args, "--project")}/edges`, jsonOptions("POST", { fromNodeId: requiredFlag(args, "--from"), toNodeId: requiredFlag(args, "--to") }));
  else if (resource === "edge" && action === "update") value = await request(`/api/v1/edges/${id}`, jsonOptions("PATCH", { title: flag(args, "--title"), version: numberFlag(args, "--version") }));
  else if (resource === "canvas" && action === "group") value = await request(`/api/v1/projects/${requiredFlag(args, "--project")}/groups`, jsonOptions("POST", { title: requiredFlag(args, "--title"), nodeIds: requiredFlag(args, "--nodes").split(",").filter(Boolean) }));
  else if (resource === "run" && action === "create") value = await request(`/api/v1/sessions/${requiredFlag(args, "--session")}/jobs`, jsonOptions("POST", { nodeId: requiredFlag(args, "--node"), prompt: requiredFlag(args, "--prompt"), modelId: flag(args, "--model") }));
  else if (resource === "run" && action === "tick") value = await request(`/api/v1/jobs/${id}/tick`, jsonOptions("POST", {}));
  else if (resource === "run" && action === "progress") value = await request(`/api/v1/jobs/${id}/progress?afterSeq=${flag(args, "--after") || 0}`);
  else if (resource === "run" && action === "cancel") value = await request(`/api/v1/jobs/${id}/cancel`, jsonOptions("POST", {}));
  else if (resource === "run" && action === "render") value = await request(`/api/v1/projects/${requiredFlag(args, "--project")}/exports/render`, jsonOptions("POST", {}));
  else if (resource === "model-schema" && action === "list") value = await request("/api/v1/models");
  else if (resource === "upload") { const file = requiredFlag(args, "--file"); value = await request(`/api/v1/projects/${requiredFlag(args, "--project")}/sessions/${requiredFlag(args, "--session")}/assets/references`, { method: "POST", headers: { "content-type": requiredFlag(args, "--mime"), "x-filename": file.split("/").at(-1) }, body: await readFile(file) }); }
  else if (resource === "download") { const bytes = await request(requiredFlag(args, "--url")); await writeFile(requiredFlag(args, "--out"), bytes); value = { byteLength: bytes.length }; }
  else { const error = new Error(`unknown command: ${args.join(" ")}`); error.code = "INVALID_COMMAND"; throw error; }
  out(value); return value;
}
const flag = (args, name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const requiredFlag = (args, name) => { const value = flag(args, name); if (!value) { const error = new Error(`${name} is required`); error.code = "INVALID_ARGUMENT"; throw error; } return value; };
const numberFlag = (args, name) => { const value = requiredFlag(args, name), number = Number(value); if (!Number.isFinite(number)) { const error = new Error(`${name} must be a number`); error.code = "INVALID_ARGUMENT"; throw error; } return number; };
const jsonOptions = (method, value) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
