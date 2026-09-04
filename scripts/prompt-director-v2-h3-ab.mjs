import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { compileH3ModelPrompt, normalizeH3CreativeSpec } from "../src/prompt-director-v2.js";

const baseUrl = "http://100.66.206.27:8188";
const workflowName = "MiniMax-H3-Q5-Turbo-960x544-5s.json";
const model = "minimax-h3-fl2va-q5-turbo-v4";
const baseModel = "MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf";
const lora = "minimax_h3_turbo_v4_step600_ema.safetensors";
const fixedSeed = 260901151637;
const positional = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const outputDir = resolve(positional[0] || "artifacts/prompt-director-v2-h3-ab-20260901");
const firstFramePath = resolve(positional[1] || "artifacts/h3-object-only-static-acceptance-20260831/blue-ceramic-cup-reference.png");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(options.timeout || 30_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
}

function verify(workflow) {
  const expected = [
    ["1", "UnetLoaderGGUF", "unet_name", baseModel],
    ["5", "MiniMaxH3TurboLoRA", "lora_name", lora],
    ["6", "MiniMaxH3ImageToVideo", "width", 960],
    ["6", "MiniMaxH3ImageToVideo", "height", 544],
    ["6", "MiniMaxH3ImageToVideo", "length", 124],
    ["9", "MiniMaxH3TurboSampler", null, null],
    ["15", "SaveVideo", null, null],
  ];
  for (const [id, type, field, value] of expected) {
    if (workflow?.[id]?.class_type !== type || (field && workflow[id].inputs?.[field] !== value)) throw new Error(`workflow drift at node ${id}`);
  }
}

const creativeSpec = normalizeH3CreativeSpec({
  first_frame_inheritance: "Start from the supplied first frame and preserve the exact same single blue ceramic cup, handle orientation, tabletop, background, framing, lighting, reflections, and contact shadow.",
  scene: "Premium studio product shot of the same unbranded blue ceramic cup on the same neutral tabletop.",
  subject: "The cup remains physically supported, fully visible, rigid, and unchanged.",
  action_beats: [
    { start: 0, end: 1, action: "hold the inherited opening pose perfectly still" },
    { start: 1, end: 3.8, action: "rotate smoothly about 15 degrees clockwise around the cup's vertical axis" },
    { start: 3.8, end: 5, action: "ease to a complete stable hero stop" },
  ],
  subject_motion: "Exactly one slow low-amplitude clockwise rotation; no translation, lift, tilt, deformation, or secondary action.",
  camera: { move: "locked", framing: "Keep the complete cup centered at the inherited scale.", motion: "No camera motion, reframing, focus pull, or cut." },
  ambient_motion: "No ambient motion and no new elements.",
  lighting_material_continuity: "Preserve the ceramic glaze, blue color, highlight shape, exposure, light direction, tabletop, reflections, and contact shadow continuously.",
  end_pose: "The unchanged cup is stable and readable for the final 1.2 seconds.",
  negative_constraints: ["people", "hands", "faces", "floating product", "extra products", "handle deformation", "camera motion"],
});

const v2Prompt = compileH3ModelPrompt(creativeSpec).model_prompt;
const legacyPrompt = "Premium studio product shot of the same unbranded blue ceramic cup on the same neutral tabletop. Begin exactly from the supplied first frame. Rotate the cup slowly and smoothly about 15 degrees clockwise around its vertical axis, then ease to a stable stop. Keep the camera locked and preserve the cup geometry, blue ceramic glaze, handle, tabletop, background, lighting, reflections and contact shadow. No people, hands, text, logos, cuts, zoom, pan, floating, deformation, duplication or new elements.";
const revisedV2Prompt = "5-second image-to-video product shot. Match the supplied first frame exactly. 0-1s: cup still. 1-3.5s: one subtle clockwise turn, maximum 5 degrees. 3.5-5s: cup completely still. VISUAL END-STATE: the handle stays on the image-right side for the entire shot and never reaches or crosses the cup's centerline. Locked camera. Preserve cup geometry, blue glaze, tabletop, background, lighting, reflection and contact shadow. No translation, lift, tilt, deformation, extra object, camera motion, cut, text or logo.";
const revisedV2Prompt2 = "5-second locked-camera product shot. Preserve the supplied first frame. The cup performs one barely perceptible clockwise micro-turn, then holds. Keep the handle at the 3 o'clock position on image-right throughout; keep the visible handle opening almost the same width as frame 1; the final frame should look nearly identical to frame 1. Cup, tabletop, background, glaze highlight, shadow and framing remain unchanged. No large rotation, handle crossing the cup center, translation, lift, tilt, deformation, camera motion, cut, text or new object.";

async function submitVariant({ id, prompt }, workflowTemplate, uploadedName) {
  const workflow = structuredClone(workflowTemplate);
  workflow["6"].inputs.prompt = prompt;
  workflow["6"].inputs.first_frame = ["16", 0];
  workflow["16"] = { class_type: "LoadImage", inputs: { image: uploadedName } };
  workflow["7"].inputs.noise_seed = fixedSeed;
  const submittedAt = new Date().toISOString();
  const submission = await request("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `openreel-pd2-ab-${id}` }) });
  const promptId = (await submission.json()).prompt_id;
  if (!promptId) throw new Error(`${id} submission did not return prompt_id`);
  let history;
  for (let poll = 0; poll < 240; poll += 1) {
    await wait(5_000);
    history = (await (await request(`/history/${encodeURIComponent(promptId)}`)).json())[promptId];
    if (history?.status?.status_str === "error") throw new Error(`${id} generation failed: ${JSON.stringify(history.status.messages || [])}`);
    const output = history?.outputs?.["15"]?.videos?.[0] || history?.outputs?.["15"]?.images?.find(item => /\.(mp4|webm)$/i.test(item.filename || ""));
    if (output?.filename) {
      const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || "", type: output.type || "output" });
      const bytes = Buffer.from(await (await request(`/view?${query}`, { timeout: 120_000 })).arrayBuffer());
      const assetPath = join(outputDir, `${id}.mp4`);
      await writeFile(assetPath, bytes);
      return { id, promptId, submittedAt, completedAt: new Date().toISOString(), prompt, promptSha256: sha256(prompt), workflowSha256: sha256(JSON.stringify(workflow)), fixedSeed, assetPath, assetBytes: bytes.length, assetSha256: sha256(bytes), providerCost: { currency: "CNY", settledCny: 0, pricingVersion: "tailnet-local-compute/v1" } };
    }
  }
  throw new Error(`${id} generation exceeded bounded polling window; no retry was submitted`);
}

const revisionOnly = process.argv.includes("--revision-only") || process.argv.includes("--revision-2-only");
await mkdir(outputDir, { recursive: true });
const firstFrame = await readFile(firstFramePath);
const workflow = await (await request(`/api/userdata/workflows%2F${encodeURIComponent(workflowName)}`)).json();
verify(workflow);
const form = new FormData();
const uploadedFilename = `openreel-pd2-ab-${sha256(firstFrame).slice(0, 16)}.png`;
form.set("image", new Blob([firstFrame], { type: "image/png" }), uploadedFilename);
form.set("overwrite", "true");
const upload = await (await request("/upload/image", { method: "POST", body: form })).json();
const uploadedName = upload.name || uploadedFilename;
const manifestPath = join(outputDir, "manifest.json");
const manifest = revisionOnly ? JSON.parse(await readFile(manifestPath, "utf8")) : {
  schema: "openreel-prompt-director-v2-h3-ab/v1",
  startedAt: new Date().toISOString(),
  taskBudget: { currency: "CNY", hardLimitCny: 100, submittedCalls: 0, settledCny: 0, retries: 0 },
  pairing: { firstFramePath, firstFrameFilename: basename(firstFramePath), firstFrameBytes: firstFrame.length, firstFrameSha256: sha256(firstFrame), model, workflowName, baseModel, lora, width: 960, height: 544, lengthFrames: 124, durationSeconds: 5, fixedSeed, audio: true, sameShotGoal: true },
  creativeSpec,
  variants: [],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const variants = process.argv.includes("--revision-2-only") ? [{ id: "v2-revision-2", prompt: revisedV2Prompt2 }] : revisionOnly ? [{ id: "v2-revision-1", prompt: revisedV2Prompt }] : [{ id: "legacy", prompt: legacyPrompt }, { id: "v2", prompt: v2Prompt }];
for (const variant of variants) {
  const result = await submitVariant(variant, workflow, uploadedName);
  manifest.variants.push(result);
  manifest.taskBudget.submittedCalls += 1;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
manifest.completedAt = new Date().toISOString();
manifest.taskBudget.remainingCny = manifest.taskBudget.hardLimitCny - manifest.taskBudget.settledCny;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
