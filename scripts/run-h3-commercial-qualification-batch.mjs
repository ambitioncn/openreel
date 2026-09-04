import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { compileH3PrimitivePrompt, createH3CreativeSpec, createH3EvidenceRecord } from "../src/prompt-director-v2.js";
import { acquireQualificationBatchGuard } from "../src/h3-qualification-batch-guard.js";

const baseUrl = "http://100.66.206.27:8188";
const workflowName = "MiniMax-H3-Q5-Turbo-960x544-5s.json";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
function option(name, fallback) { const prefix = `--${name}=`; return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback; }
async function request(path, options = {}) { const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(options.timeout || 30_000) }); if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`); return response; }

const scenario = option("scenario", "product_hero");
const cameraAction = option("camera-action", "locked");
const strategyRef = option("strategy-ref", "");
const promptSuffix = option("prompt-suffix", "").trim();
const seeds = option("seeds", "37,73,109").split(",").map(Number);
const reservations = option("reservations", "").split(",").filter(Boolean);
if (reservations.length !== seeds.length) throw new Error("one action reservation is required per seed");
const objectOnlyOption = option("object-only", "auto");
if (!["auto", "true", "false"].includes(objectOnlyOption)) throw new Error("--object-only must be auto, true, or false");
const peopleScenarios = new Set(["lifestyle_use", "testimonial", "fashion_beauty"]);
const objectOnly = objectOnlyOption === "auto" ? !peopleScenarios.has(scenario) : objectOnlyOption === "true";
const outputDir = resolve(option("output", `artifacts/prompt-director-v2-h3-coverage/runs/${scenario}-${cameraAction}`));
const ledgerPath = resolve("artifacts/prompt-director-v2-h3-coverage/evidence-ledger.jsonl");
const firstFramePath = resolve(option("first-frame", "artifacts/h3-object-only-static-acceptance-20260831/blue-ceramic-cup-reference.png"));
const lastFrameOption = option("last-frame", "").trim();
const lastFramePath = lastFrameOption ? resolve(lastFrameOption) : null;
const caseIds = seeds.map(seed => `${scenario}:${cameraAction}:seed-${seed}`);
const guard = await acquireQualificationBatchGuard({ outputDir, ledgerPath, caseIds, reservationIds: reservations, owner: { scenario, cameraAction, seeds, reservations } });
try {
const firstFrame = await readFile(firstFramePath);
const lastFrame = lastFramePath ? await readFile(lastFramePath) : null;
const spec = createH3CreativeSpec({ shot: { prompt: "same supplied first-frame subject" }, directorShot: { style: "controlled premium studio light", commercialScenario: scenario, cameraAction }, objectOnly });
const primitive = cameraAction === "locked" ? "static_hold" : cameraAction;
const basePrompt = compileH3PrimitivePrompt(spec, primitive).model_prompt;
const prompt = promptSuffix ? `${basePrompt} ${promptSuffix}` : basePrompt;
const workflow = await (await request(`/api/userdata/workflows%2F${encodeURIComponent(workflowName)}`)).json();
if (workflow?.[6]?.class_type !== "MiniMaxH3ImageToVideo" || workflow[6].inputs?.width !== 960 || workflow[6].inputs?.height !== 544 || workflow[6].inputs?.length !== 124) throw new Error("workflow drift");
await mkdir(outputDir, { recursive: true });
async function uploadFrame(bytes, role) {
  const form = new FormData();
  const uploadName = `pd2h3-${role}-${sha256(bytes).slice(0, 16)}.png`;
  form.set("image", new Blob([bytes], { type: "image/png" }), uploadName); form.set("overwrite", "true");
  const uploaded = await (await request("/upload/image", { method: "POST", body: form })).json();
  return uploaded.name || uploadName;
}
const uploadedFirstFrame = await uploadFrame(firstFrame, "first");
const uploadedLastFrame = lastFrame ? await uploadFrame(lastFrame, "last") : null;
const firstFrameCopy = join(outputDir, basename(firstFramePath));
await writeFile(firstFrameCopy, firstFrame);
const lastFrameCopy = lastFrame ? join(outputDir, basename(lastFramePath)) : null;
if (lastFrame) await writeFile(lastFrameCopy, lastFrame);
const manifest = { schema: "openreel-h3-commercial-qualification-batch/v1", scenario, cameraAction, primitive, strategyRef: strategyRef || null, objectOnly, modelConfiguration: "minimax-h3-fl2va-q5-turbo-v4", firstFrame: firstFrameCopy, firstFrameSha256: sha256(firstFrame), lastFrame: lastFrameCopy, lastFrameSha256: lastFrame ? sha256(lastFrame) : null, prompt, promptSha256: sha256(prompt), seeds, startedAt: new Date().toISOString(), calls: [] };
await writeFile(join(outputDir, "prompt.txt"), `${prompt}\n`);
for (let index = 0; index < seeds.length; index += 1) {
  const seed = seeds[index], reservation = reservations[index], graph = structuredClone(workflow);
  graph[6].inputs.prompt = prompt; graph[6].inputs.first_frame = ["16", 0]; graph[16] = { class_type: "LoadImage", inputs: { image: uploadedFirstFrame } };
  if (uploadedLastFrame) { graph[6].inputs.last_frame = ["17", 0]; graph[17] = { class_type: "LoadImage", inputs: { image: uploadedLastFrame } }; }
  else delete graph[6].inputs.last_frame;
  graph[7].inputs.noise_seed = seed;
  const workflowBytes = Buffer.from(JSON.stringify(graph));
  const submitted = await (await request("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: `openreel-pd2h3-${scenario}-${cameraAction}-${seed}` }) })).json();
  if (!submitted.prompt_id) throw new Error(`seed ${seed} returned no prompt id`);
  let output;
  for (let poll = 0; poll < 240 && !output; poll += 1) {
    await wait(5_000);
    const history = (await (await request(`/history/${submitted.prompt_id}`)).json())[submitted.prompt_id];
    if (history?.status?.status_str === "error") throw new Error(`seed ${seed} failed`);
    output = history?.outputs?.["15"]?.videos?.[0] || history?.outputs?.["15"]?.images?.find(item => /\.(mp4|webm)$/i.test(item.filename || ""));
  }
  if (!output?.filename) throw new Error(`seed ${seed} exceeded polling window`);
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || "", type: output.type || "output" });
  const video = Buffer.from(await (await request(`/view?${query}`, { timeout: 120_000 })).arrayBuffer());
  const videoPath = join(outputDir, `seed-${seed}.mp4`); await writeFile(videoPath, video);
  const evidence = createH3EvidenceRecord({ caseId: `${scenario}:${cameraAction}:seed-${seed}`, seed, prompt, firstFrame: firstFrameCopy, video: videoPath, parameters: { width: 960, height: 544, lengthFrames: 124, durationSeconds: 5, workflowName, workflowSha256: sha256(workflowBytes), conditioning: lastFrame ? "first_and_last_frame" : "first_frame", lastFrame: lastFrameCopy, lastFrameSha256: lastFrame ? sha256(lastFrame) : null }, sha256: { prompt: sha256(prompt), firstFrame: sha256(firstFrame), video: sha256(video) }, actionReservationId: reservation, costCny: 0, qualificationVerdict: "pending_visual_review", changedStrategyRef: strategyRef || null });
  manifest.calls.push({ promptId: submitted.prompt_id, completedAt: new Date().toISOString(), bytes: video.length, evidence });
  await appendFile(ledgerPath, `${JSON.stringify(evidence)}\n`);
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
manifest.completedAt = new Date().toISOString();
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputDir, calls: manifest.calls.length, videos: manifest.calls.map(call => call.evidence.video) })}\n`);
} finally {
  await guard.release();
}
