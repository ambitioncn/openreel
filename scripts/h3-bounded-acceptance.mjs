#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.OPENREEL_BASE || "https://123.57.67.213:4173";
const referencePath = process.env.OPENREEL_REFERENCE || "/tmp/openreel-reference.png";
const referenceBytes = readFileSync(referencePath);
assert.equal(referenceBytes.subarray(1, 4).toString("ascii"), "PNG", "reference must be a PNG");
const referenceWidth = referenceBytes.readUInt32BE(16), referenceHeight = referenceBytes.readUInt32BE(20);
assert.ok(referenceWidth >= 256 && referenceHeight >= 256, "reference must be at least 256x256");
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
let browser, applicationId;
const remoteAdmin = code => execFileSync("ssh", ["-o", "BatchMode=yes", "root@123.57.67.213", `cd /opt/openreel/current && node --input-type=module -e 'await import("data:text/javascript;base64,${Buffer.from(code).toString("base64")}")'`], { encoding: "utf8", timeout: 60_000 });
const adminCall = (path, body) => remoteAdmin(`const {readFileSync}=await import("node:fs");const {spawnSync}=await import("node:child_process");const pid=spawnSync("systemctl",["show","--value","-p","MainPID","openreel.service"],{encoding:"utf8"}).stdout.trim();const env=Object.fromEntries(readFileSync(\`/proc/\${pid}/environ\`).toString().split("\\0").filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)]}));const r=await fetch("http://127.0.0.1:4273${path}",{method:"POST",headers:{"content-type":"application/json","x-openreel-admin-key":env.OPENREEL_ADMIN_KEY},body:JSON.stringify(${JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw new Error(r.status+" "+(v.error?.code||"HTTP"));console.log(JSON.stringify(v));`);

try {
  browser = await chromium.launch({ headless: true, executablePath: "/snap/bin/chromium" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const api = path => page.evaluate(async path => { const r = await fetch(path); const v = await r.json(); if (!r.ok) throw new Error(`${r.status} ${v.error?.code || "HTTP"}`); return v; }, path);
  await page.goto(base, { waitUntil: "networkidle", timeout: 60_000 });
  await page.click("#show-register");
  await page.fill("#register-email", `h3-low-motion-${marker}@openreel.invalid`);
  await page.fill("#register-password", `H3-${randomBytes(24).toString("base64url")}`);
  await page.click('#register-form button[type="submit"]');
  await page.waitForSelector("#creator-workbench:not([hidden])", { timeout: 60_000 });
  const csrf = (await context.cookies(base)).find(x => x.name === "openreel_csrf")?.value;
  applicationId = await page.evaluate(async csrf => { const r=await fetch("/api/v1/key-applications",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify({reason:"one three-shot H3 object-only commercial acceptance; zero retries; no publication",requestedLimitUnits:138889,currency:"USD",unitScale:10000})});const v=await r.json();if(!r.ok)throw new Error(v.error?.code||String(r.status));return v.id;}, csrf);
  adminCall(`/api/v1/admin/key-applications/${applicationId}/approve`, { plan: "h3-object-only-three-shot-acceptance", hardLimitUnits: 138889, currency: "USD", unitScale: 10000, periodEndsAt: new Date(Date.now()+30*60_000).toISOString(), reviewedBy: "standing-openreel-2026-08-19", reviewNote: "one bounded three-shot real commercial generation; CNY 100 ceiling; zero retries; no publication" });
  await page.click("#start-short-video");
  await page.fill("#short-video-brief", "三镜头纯物体产品展示：同一个无品牌蓝色陶瓷杯在稳定桌面上始终完全静止，杯柄、杯身和釉面绝不旋转或变形，节拍只由相机运动完成。镜头一是宽景并缓慢推进到中景，建立产品；镜头二硬切到极近景并缓慢横移，展示杯柄和釉面细节；镜头三硬切到明显的四十五度俯角中景并缓慢拉远到对称英雄构图，最后定格一秒。三次硬切前后的景别和角度必须明显不同；没有倒水、液体、蒸汽、手或人物；稳定桌面与一致灯光；无品牌或促销文字；允许平台依法添加的非广告性 AI 来源标识");
  await page.selectOption("#short-video-type", "product");
  await page.selectOption("#short-video-duration", "30");
  await page.click('#short-video-brief-form button[type="submit"]');
  await page.waitForFunction(() => /真实文本模型|创建失败/.test(document.querySelector("#short-video-state")?.textContent||""), null, { timeout: 360_000 });
  assert.doesNotMatch(await page.locator("#short-video-state").textContent(), /创建失败/);
  const projects = await api("/api/v1/projects"), project = projects.find(p => p.name.includes("蓝色陶瓷杯"));
  assert.ok(project);
  const shotPrompts = [
    "medium-close eye-level three-quarter establishing composition with the entire short wide cup and its single right-side handle clearly visible; concise 1.5-second establishing micro-beat with the rigid cup perfectly still and framing already settled",
    "eye-level three-quarter detail composition of the exact same short wide cup where the single right-side handle and perfectly smooth solid matte deep-blue glaze fill most of the frame; concise 1.4-second detail micro-beat with the rigid cup perfectly still and close framing already settled",
    "eye-level three-quarter medium composition of the exact same short wide cup and single right-side handle; concise 1.4-second payoff micro-beat, already settled in symmetrical hero framing with the rigid cup perfectly still"
  ];
  assert.ok(await page.locator("#storyboard-shots .shot-visual").count() >= 3, "planner must produce at least three shots before any paid commercial generation");
  await page.locator("#storyboard-shots .shot-visual").evaluateAll((fields,prompts) => fields.forEach((field,index) => { const prompt=prompts[Math.min(index,2)]; field.value = `object-only shot ${index+1} of a clear establish-detail-hero three-shot sequence: exactly one small rigid unbranded blue ceramic cup physically supported by a stable tabletop in an empty neutral studio; the cup has an invariant short wide cylindrical body, flat level rim, one rounded handle fixed on the right, and perfectly smooth solid matte deep-blue glaze; ${prompt}; preserve exactly identical short-wide body proportions, rim diameter, single right-side handle geometry, solid matte deep-blue color without texture or mottling, tabletop, background and lighting across all three shots; camera movement is the only motion and the cup must remain completely motionless: no cup rotation, no pouring, no liquid, no steam, no splashing, no people, no faces, no personal information, no hands, no brand or promotional text, no cloth, no floating, no deformation, and no new elements; a small platform-required non-promotional AI provenance label is allowed.`; field.dispatchEvent(new Event("input",{bubbles:true})); }), shotPrompts);
  await page.click("#save-script-storyboard");
  await page.waitForFunction(() => /已保存/.test(document.querySelector("#editor-state")?.textContent||""), null, { timeout: 60_000 });
  const snapshot = await api(`/api/v1/projects/${project.id}`), sessionId = snapshot.sessions[0].id;
  assert.ok(snapshot.storyboard.shots.length >= 3, "saved storyboard must retain at least three shots");
  const uploaded = await page.evaluate(async ({projectId,sessionId,bytes,csrf}) => { const r=await fetch(`/api/v1/projects/${projectId}/sessions/${sessionId}/assets/references`,{method:"POST",headers:{"content-type":"image/png","x-filename":"blue-ceramic-cup-reference.png","x-csrf-token":csrf},body:new Uint8Array(bytes)});const v=await r.json();if(!r.ok)throw new Error(`${r.status} ${v.error?.code||"HTTP"}`);return v; }, {projectId:project.id,sessionId,bytes:[...referenceBytes],csrf});
  const entities = await page.evaluate(async ({projectId,assetId,csrf}) => { const post=async body=>{const r=await fetch(`/api/v1/projects/${projectId}/continuity`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(String(r.status));return v;};return [await post({kind:"character",name:"unbranded blue ceramic cup",attributes:{identity:"one small rigid blue ceramic cup",material:"glazed ceramic",support:"stable tabletop"},lockedAttributes:["identity","material","support"],referenceAssetIds:[assetId]}),await post({kind:"scene",name:"controlled tabletop studio",attributes:{location:"empty neutral tabletop studio",camera:"locked-off frontal product shot",lighting:"soft stable studio lighting"},lockedAttributes:["location","camera","lighting"],referenceAssetIds:[assetId]})]; }, {projectId:project.id,assetId:uploaded.id,csrf});
  await page.evaluate(async ({projectId,shots,assetId,entityIds,csrf}) => { const styles=["eye-level medium-close three-quarter view of invariant short wide matte deep-blue cup with single right handle, short slow lateral camera slide, warm beige studio, natural commercial realism","eye-level close three-quarter detail of the same invariant short wide matte deep-blue cup and single right handle, slow lateral camera slide, warm beige studio, natural commercial realism","eye-level medium three-quarter view of the same invariant short wide matte deep-blue cup and single right handle, slow straight pull-back to symmetrical hero framing, warm beige studio, natural commercial realism"]; const r=await fetch(`/api/v1/projects/${projectId}/storyboard`,{method:"PUT",headers:{"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify({shots:shots.slice(0,3).map((s,index)=>({...s,duration:5,styleContinuity:styles[index],continuityEntityIds:entityIds,referenceAssetIds:[...new Set([...(s.referenceAssetIds||[]),assetId])]}))})});if(!r.ok)throw new Error(String(r.status)); }, {projectId:project.id,shots:snapshot.storyboard.shots,assetId:uploaded.id,entityIds:entities.map(x=>x.id),csrf});
  const current = await api(`/api/v1/projects/${project.id}`);
  assert.equal(current.storyboard.shots.length, 3, "commercial quote must bind exactly three shots");
  const identityReference = {width:referenceWidth,height:referenceHeight,sha256:createHash("sha256").update(referenceBytes).digest("hex")};
  const quote = await page.evaluate(async ({projectId,body,csrf})=>{const r=await fetch(`/api/v1/projects/${projectId}/commercial/quote`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(`${r.status} ${v.error?.code||"HTTP"}: ${v.error?.message||""}`);return v;},{projectId:project.id,csrf,body:{projectVersion:current.project.version,storyVersion:current.story.version,storyboardVersion:current.storyboard.version,quality:"fast",captionAssetIds:[],musicAssetId:null,musicGeneration:null,musicRightsConfirmation:null,identityReference,declarations:{referenceRights:"owned_or_licensed",performer:"object_only",brands:"none",publicFigures:"none"}}});
  const cny=quote.cost.estimatedCny; assert.ok(cny>0&&cny<=100);
  let job = await page.evaluate(async ({projectId,quoteId,csrf})=>{const r=await fetch(`/api/v1/projects/${projectId}/commercial/jobs`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify({quoteId,confirmed:true,idempotencyKey:crypto.randomUUID()})});const v=await r.json();if(!r.ok)throw new Error(`${r.status} ${v.error?.code||"HTTP"}`);return v;},{projectId:project.id,quoteId:quote.id,csrf});
  const jobId=job.id;
  const executeStatus = await page.evaluate(async ({projectId,jobId,csrf})=>{const r=await fetch(`/api/v1/projects/${projectId}/commercial/jobs/${jobId}/execute`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf},body:"{}"});if(!r.ok&&r.status!==504)throw new Error(String(r.status));return r.status;},{projectId:project.id,jobId,csrf});
  assert.ok([200,201,202,409,422,500,504].includes(executeStatus), `execute returned unexpected HTTP ${executeStatus}`);
  for(let i=0;i<240&&!['succeeded','failed','cancelled'].includes(job.status);i++){await page.waitForTimeout(5000);job=await api(`/api/v1/projects/${project.id}/commercial/jobs/${jobId}`);}
  assert.ok(['succeeded','failed'].includes(job.status));
  const state=`${job.stage} · ${job.status}`;
  const finalSnapshot = await api(`/api/v1/projects/${project.id}`);
  console.log(JSON.stringify({projectId:project.id,jobId,quoteCny:cny,executeStatus,browserState:state,status:job.status,error:job.error,result:job.result,cost:job.cost,assets:finalSnapshot.assets.map(a=>({id:a.id,kind:a.kind,role:a.role,mimeType:a.mimeType,byteLength:a.byteLength||a.metadata?.byteLength||null,sha256:a.sha256||a.metadata?.sha256||null}))}));
} finally {
  if (applicationId) { try { adminCall(`/api/v1/admin/key-applications/${applicationId}/stop`, { reviewNote: "bounded H3 acceptance ended; no retry and no publication" }); } catch {} }
  if (browser) await browser.close();
}
