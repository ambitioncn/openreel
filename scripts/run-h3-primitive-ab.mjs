import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const baseUrl = "http://100.66.206.27:8188";
const workflowName = "MiniMax-H3-Q5-Turbo-960x544-5s.json";
const outputDir = resolve(process.argv[2] || "artifacts/h3-primitive-ab-20260901");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

const scenes = [
  {
    id: "rigid-cup-micro-turn",
    firstFrame: resolve("artifacts/h3-object-only-static-acceptance-20260831/blue-ceramic-cup-reference.png"),
    legacy: "Premium studio product shot of the same blue ceramic cup. Begin exactly from the supplied first frame. Rotate the cup slowly clockwise, then ease to a stop. Keep the camera locked and preserve the cup, handle, tabletop, background, glaze, lighting, reflections and contact shadow. No people, text, cuts, floating, deformation, duplication or new elements.",
    candidate: "Same first-frame blue cup. ONE ACTION: a barely perceptible clockwise micro-turn, then stillness. END ANCHOR: handle stays at 3 o'clock on image-right and its opening stays nearly the same width as frame one. LOCK: camera, cup support, silhouette, glaze highlight, tabletop, background and shadow do not change. Never add, lift, tilt, deform, duplicate or cross the handle over the cup center."
  },
  {
    id: "graphic-subject-dolly-in",
    firstFrame: resolve("artifacts/cdqi2-11-cp84-lost-scarf-media/identity-reference.png"),
    legacy: "Create a clean five-second commercial shot from this first frame. Slowly push the camera toward the same centered blue subject while keeping the subject recognizable and the beige background clean. Preserve colors, shapes and composition. No cuts, text, logos, morphing, duplication or new elements.",
    candidate: "Same first-frame centered blue subject on beige. ONE ACTION: one shallow, steady camera dolly-in; subject remains perfectly still. END ANCHOR: finish only slightly closer, with the full blue body and peach circular head still inside frame. LOCK: exact shapes, colors, center alignment, flat edges and background. No pan, orbit, tilt, roll, subject motion, morph, duplication, cut, text or new element."
  }
];
const seeds = [260901154135, 260901154136];
const hardLimitCny = 100;
const estimatedCallCny = 0;
const plannedCalls = scenes.length * seeds.length * 2;
if (plannedCalls * estimatedCallCny > hardLimitCny) throw new Error("planned spend exceeds hard limit");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(options.timeout || 30_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
}

function verify(workflow) {
  if (workflow?.["1"]?.inputs?.unet_name !== "MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf" || workflow?.["5"]?.inputs?.lora_name !== "minimax_h3_turbo_v4_step600_ema.safetensors" || workflow?.["6"]?.inputs?.width !== 960 || workflow?.["6"]?.inputs?.height !== 544 || workflow?.["6"]?.inputs?.length !== 124) throw new Error("workflow drift");
}

async function generate({ scene, seed, pathName, prompt, workflowTemplate, uploadedName }) {
  const workflow = structuredClone(workflowTemplate);
  workflow["6"].inputs.prompt = prompt;
  workflow["6"].inputs.first_frame = ["16", 0];
  workflow["16"] = { class_type: "LoadImage", inputs: { image: uploadedName } };
  workflow["7"].inputs.noise_seed = seed;
  const submittedAt = new Date().toISOString();
  const promptId = (await (await request("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `openreel-primitive-ab-${pathName}` }) })).json()).prompt_id;
  if (!promptId) throw new Error(`${pathName}: missing prompt id`);
  for (let poll = 0; poll < 240; poll += 1) {
    await wait(5_000);
    const history = (await (await request(`/history/${encodeURIComponent(promptId)}`)).json())[promptId];
    if (history?.status?.status_str === "error") throw new Error(`${pathName}: provider error ${JSON.stringify(history.status.messages || [])}`);
    const output = history?.outputs?.["15"]?.videos?.[0] || history?.outputs?.["15"]?.images?.find(item => /\.(mp4|webm)$/i.test(item.filename || ""));
    if (!output?.filename) continue;
    const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || "", type: output.type || "output" });
    const bytes = Buffer.from(await (await request(`/view?${query}`, { timeout: 120_000 })).arrayBuffer());
    const assetPath = join(outputDir, `${pathName}.mp4`);
    await writeFile(assetPath, bytes);
    return { sceneId: scene.id, variant: pathName.endsWith("candidate") ? "candidate" : "legacy", seed, prompt, promptSha256: sha256(prompt), promptId, submittedAt, completedAt: new Date().toISOString(), workflowSha256: sha256(JSON.stringify(workflow)), assetPath, assetBytes: bytes.length, assetSha256: sha256(bytes), providerCost: { currency: "CNY", settledCny: 0, pricingVersion: "tailnet-local-compute/v1" } };
  }
  throw new Error(`${pathName}: timed out; no retry submitted`);
}

await mkdir(outputDir, { recursive: true });
const workflow = await (await request(`/api/userdata/workflows%2F${encodeURIComponent(workflowName)}`)).json();
verify(workflow);
const manifest = { schema: "openreel-h3-primitive-ab/v1", startedAt: new Date().toISOString(), model: "minimax-h3-fl2va-q5-turbo-v4", workflowName, parameters: { width: 960, height: 544, lengthFrames: 124, durationSeconds: 5, audio: true }, strategy: "one dominant short-action primitive plus visible end anchor and explicit locks", qualification: { scenes: scenes.map(item => item.id), seeds, plannedCalls, promotionRule: "candidate must materially improve aggregate commercial quality, win or tie every paired cell, and introduce no critical identity or geometry artifact" }, budget: { currency: "CNY", hardLimitCny, estimatedCallCny, submittedCalls: 0, retries: 0, settledCny: 0 }, firstFrames: [], results: [] };
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const scene of scenes) {
  const bytes = await readFile(scene.firstFrame);
  const uploadedFilename = `openreel-primitive-${scene.id}-${sha256(bytes).slice(0, 12)}.png`;
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: "image/png" }), uploadedFilename);
  form.set("overwrite", "true");
  const upload = await (await request("/upload/image", { method: "POST", body: form })).json();
  manifest.firstFrames.push({ sceneId: scene.id, path: scene.firstFrame, filename: basename(scene.firstFrame), bytes: bytes.length, sha256: sha256(bytes) });
  for (const seed of seeds) {
    for (const variant of ["legacy", "candidate"]) {
      const result = await generate({ scene, seed, pathName: `${scene.id}-seed-${seed}-${variant}`, prompt: scene[variant], workflowTemplate: workflow, uploadedName: upload.name || uploadedFilename });
      manifest.results.push(result);
      manifest.budget.submittedCalls += 1;
      await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
}
manifest.completedAt = new Date().toISOString();
manifest.budget.remainingCny = hardLimitCny - manifest.budget.settledCny;
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputDir, submittedCalls: manifest.budget.submittedCalls, budget: manifest.budget })}\n`);
