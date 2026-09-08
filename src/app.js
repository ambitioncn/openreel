import { currentLocale, initializeI18n, localeCode } from "./i18n.js";
import { NODE_TYPES } from "./model.js";
import { tutorialProgress } from "./tutorials.js";
import { tutorialForLocale, tutorialsForLocale } from "./tutorial-locales.js";
import { activeStoryboardJob, retryableStoryboardJob, storyboardBatchView } from "./storyboard-batch-ui.js";
import { modelControlView, selectedModelControls } from "./model-controls.js";
import { collaborationConflictView } from "./collaboration-ui.js";
import { reviewedExportSelection, exportSuccessMessage } from "./export-ui.js";
import { isQwenTtsModel, prepareQwenTtsJob, qwenTtsPreparedMessage } from "./qwen-tts-ui.js";
import { routeWorkbenchModels, workbenchRouteSummary } from "./workbench-model-router.js";
import { workbenchTimeline, workbenchCostHint } from "./workbench-timeline.js";
import { clearWorkbenchDraft, recoverWorkbenchDraft, saveWorkbenchDraft } from "./workbench-draft.js";
import { finalPreview, publishingDraft } from "./workbench-final.js";
import { assertCreativeTargetCurrent, planCreativeTarget } from "./workbench-project-boundary.js";
import { directorPerceptualUiRows, directorRuntimeUiState, directorRuntimeUiSummary } from "./director-runtime-ui.js";
import { byteBackedIdentityReference, commercialDeclarations } from "./commercial-policy-ui.js";

const icons = { text: "T", image: "▧", video: "▶", audio: "♪", script: "≡" };
let snapshot = { nodes: [], edges: [], groups: [] }, models = [], selected = [], selectedGraph = null, storyboardBatch = null, selectedWorkbenchAsset = null, commercialQuote = null, commercialJob = null, view = { x: 0, y: 0, scale: 1 }, projectId, sessionId, csrfToken = "", workspaceStarted = false, workspacePage = "home";
const $ = selector => document.querySelector(selector), viewport = $("#viewport"), canvas = $("#canvas"), nodeForm = $("#node-form"), graphForm = $("#graph-form");
initializeI18n();

function refreshWorkbenchModelRoute() {
  const preference = document.querySelector('input[name="workbench-quality"]:checked')?.value || "fast";
  const route = routeWorkbenchModels(models, preference);
  $("#workbench-route-state").textContent = workbenchRouteSummary(route);
}
document.querySelectorAll('input[name="workbench-quality"]').forEach(input => input.onchange = () => { refreshWorkbenchModelRoute(); if (!$("#storyboard-editor").hidden) renderSimpleTimeline(); });

const WORKSPACE_PAGES = new Set(["home", "creator", "projects", "connections", "canvas", "tutorials"]);
const ui = (english, chinese) => currentLocale() === "en" ? english : chinese;
function routeFromHash() { const route = location.hash.slice(1); return WORKSPACE_PAGES.has(route) ? route : "home"; }
function setWorkspacePage(page, { replace = false } = {}) {
  workspacePage = WORKSPACE_PAGES.has(page) ? page : "home";
  const canvasMode = workspacePage === "canvas";
  $("#workspace-shell").classList.toggle("workbench-mode", !canvasMode);
  $("#creator-workbench").hidden = canvasMode;
  document.querySelectorAll("[data-workspace-page]").forEach(panel => { panel.hidden = panel.dataset.workspacePage !== workspacePage; });
  if (workspacePage === "creator") $("#short-video-flow").hidden = false;
  if (workspacePage === "tutorials" && projectId) renderTutorialList();
  document.querySelectorAll("[data-route]").forEach(button => {
    const active = button.dataset.route === workspacePage;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  const hash = `#${workspacePage}`;
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"]({}, "", hash);
}
document.querySelectorAll("[data-route]").forEach(button => { button.onclick = () => setWorkspacePage(button.dataset.route); });
window.addEventListener("hashchange", () => { if (workspaceStarted) setWorkspacePage(routeFromHash(), { replace: true }); });
window.addEventListener("openreel:localechange", () => {
  setIntakeSource(document.querySelector('input[name="intake-source"]:checked')?.value || "idea");
  if (workspacePage === "tutorials" && projectId) renderTutorialList();
});
$("#toggle-new-project").onclick = () => { $("#new-project-form").hidden = false; $("#new-project-name").focus(); };
$("#cancel-new-project").onclick = () => { $("#new-project-form").hidden = true; };
function draftState(project) { if (project.status === "archived") return "已归档"; if (!project.story) return "空白草稿"; if (!project.storyboard?.shots?.length) return "脚本草稿"; return `${project.storyboard.shots.length} 镜 · 编辑中`; }
async function refreshProjectShelf() {
  const projects = await api("/api/v1/projects"), details = await Promise.all(projects.map(project => api(`/api/v1/projects/${project.id}`)));
  $("#workbench-projects").replaceChildren(...details.map(detail => { const project = detail.project, card = document.createElement("article"); card.classList.toggle("current", project.id === projectId); card.innerHTML = `<button class="project-open" type="button"><strong></strong><span></span><small></small></button><div><button class="project-rename" type="button">重命名</button><button class="project-archive" type="button"></button></div>`; card.querySelector("strong").textContent = project.name; card.querySelector("span").textContent = draftState({ ...project, story: detail.story, storyboard: detail.storyboard }); card.querySelector("small").textContent = `更新于 ${new Date(project.updatedAt).toLocaleString(localeCode())}`; card.querySelector(".project-open").onclick = () => openProject(project.id); card.querySelector(".project-rename").onclick = () => renameWorkbenchProject(project); const archive = card.querySelector(".project-archive"); archive.textContent = project.status === "archived" ? "恢复" : "归档"; archive.onclick = () => setProjectStatus(project, project.status === "archived" ? "active" : "archived"); return card; }));
  $("#project-shelf-state").textContent = details.length ? `共 ${details.length} 个作品` : "还没有作品，创建第一个空白草稿。";
}
async function renameWorkbenchProject(project) { const name = prompt("作品名称", project.name); if (!name?.trim()) return; await api(`/api/v1/projects/${project.id}`, json("PATCH", { name: name.trim(), version: project.version })); if (project.id === projectId) await refresh(); await refreshProjectShelf(); }
async function setProjectStatus(project, status) { await api(`/api/v1/projects/${project.id}`, json("PATCH", { status, version: project.version })); if (project.id === projectId && status === "archived") { const next = (await api("/api/v1/projects?status=active")).find(item => item.id !== project.id); if (next) await openProject(next.id); } await refreshProjectShelf(); }
$("#new-project-form").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const project = await api("/api/v1/projects", json("POST", { name: $("#new-project-name").value.trim() })); event.currentTarget.reset(); event.currentTarget.hidden = true; await openProject(project.id); } finally { button.disabled = false; } });
$("#start-short-video").onclick = () => {
  setWorkspacePage("creator");
  $("#short-video-flow").hidden = false;
  $("#short-video-flow").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#short-video-brief").focus();
};
function refreshCreativeTarget() {
  const current = document.querySelector('input[name="creative-target"]:checked')?.value === "current";
  $("#creative-current-confirm-field").hidden = !current;
  if (!current) $("#creative-current-confirm").checked = false;
}
document.querySelectorAll('input[name="creative-target"]').forEach(input => input.onchange = refreshCreativeTarget);
function renderScriptStoryboard(story, storyboard) {
  $("#script-editor").hidden = false; $("#storyboard-editor").hidden = false; $("#short-video-script").value = story.synopsis || "";
  const production = story.production || { voice: "natural", captions: true, music: "light", safeZone: "tiktok" }; $("#workbench-voice").value = production.voice; $("#workbench-music").value = production.music; $("#workbench-safe-zone").value = production.safeZone; $("#workbench-captions").checked = production.captions;
  $("#hook-options").replaceChildren(Object.assign(document.createElement("legend"), { textContent: "3 个开场 Hook" }), ...(story.hooks || []).map((hook, index) => { const label = document.createElement("label"), input = document.createElement("input"); input.type = "radio"; input.name = "short-video-hook"; input.value = String(index); input.checked = index === story.selectedHook; label.append(input, hook); return label; }));
  $("#storyboard-shots").replaceChildren(...story.scenes.map((scene, index) => { const shot = storyboard.shots[index], article = document.createElement("article"); article.dataset.sceneId = scene.id; article.dataset.shotId = shot.id; article.innerHTML = `<header><b>镜头 ${index + 1}</b><span>${scene.title}</span></header><label>本镜台词<textarea class="shot-line" rows="3" maxlength="1200"></textarea></label><label>画面描述<textarea class="shot-visual" rows="3" maxlength="1200"></textarea></label><label>风格连续性锁定<textarea class="shot-style" rows="2" maxlength="500" placeholder="例如：暖金色高端产品广告，柔光，统一颗粒与色调"></textarea></label><label>B-roll 建议<textarea class="shot-broll" rows="3" maxlength="1200" placeholder="可选：本镜头需要的辅助画面"></textarea></label><label>时长（秒）<input class="shot-duration" type="number" min="1" max="60" step="1"></label><button class="redo-shot" type="button">局部重做此镜头</button><small class="redo-state">保留其他镜头，只清除此镜头的生成结果</small>`; article.querySelector(".shot-line").value = scene.summary || ""; article.querySelector(".shot-visual").value = shot.prompt; article.querySelector(".shot-style").value = shot.styleContinuity || ""; article.querySelector(".shot-broll").value = shot.broll || ""; article.querySelector(".shot-duration").value = shot.duration; article.querySelector(".redo-shot").onclick = () => redoWorkbenchShot(shot.id); return article; }));
  snapshot.story = story; snapshot.storyboard = storyboard; updateStoryboardDuration(); refreshAssetShotTargets(); $("#script-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}
function refreshCommercialPolicyReferences() {
  const select = $("#commercial-identity-reference"), previous = select.value;
  const referenced = new Set((snapshot.storyboard?.shots || []).flatMap(shot => shot.referenceAssetIds || []));
  const assets = (snapshot.assets || []).filter(asset => asset.kind === "image" && asset.role === "reference" && referenced.has(asset.id));
  select.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "选择分镜已绑定的参考图" }), ...assets.map(asset => Object.assign(document.createElement("option"), { value: asset.id, textContent: asset.filename })));
  if (previous && assets.some(asset => asset.id === previous)) select.value = previous;
}
async function commercialPolicySafety() {
  const asset = snapshot.assets.find(item => item.id === $("#commercial-identity-reference").value);
  const identityReference = await byteBackedIdentityReference(asset, {
    fetchBytes: fetch,
    digest: bytes => crypto.subtle.digest("SHA-256", bytes),
    dimensions: async blob => { const bitmap = await createImageBitmap(blob); try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); } }
  });
  const declarations = commercialDeclarations({ rights: $("#commercial-reference-rights").checked, performer: $("#commercial-performer").value, noBrands: $("#commercial-no-brands").checked, noPublicFigures: $("#commercial-no-public-figures").checked });
  return { identityReference, declarations };
}
function editorStoryboard() { return { shots: [...document.querySelectorAll("#storyboard-shots article")].map((card, index) => ({ ...snapshot.storyboard.shots[index], duration: Number(card.querySelector(".shot-duration").value) || 0 })) }; }
function editorDraft() {
  const cards = [...document.querySelectorAll("#storyboard-shots article")];
  return { storyVersion: snapshot.story.version, storyboardVersion: snapshot.storyboard.version, selectedHook: Number(document.querySelector('input[name="short-video-hook"]:checked')?.value || 0), synopsis: $("#short-video-script").value, shots: cards.map(card => ({ line: card.querySelector(".shot-line").value, visual: card.querySelector(".shot-visual").value, broll: card.querySelector(".shot-broll").value, duration: card.querySelector(".shot-duration").value })) };
}
function restoreEditorDraft() {
  const draft = recoverWorkbenchDraft(localStorage, projectId, { storyVersion: snapshot.story.version, storyboardVersion: snapshot.storyboard.version });
  if (!draft) return;
  const hook = document.querySelector(`input[name="short-video-hook"][value="${draft.selectedHook}"]`); if (hook) hook.checked = true;
  $("#short-video-script").value = draft.synopsis;
  [...document.querySelectorAll("#storyboard-shots article")].forEach((card, index) => { const shot = draft.shots[index]; if (!shot) return; card.querySelector(".shot-line").value = shot.line; card.querySelector(".shot-visual").value = shot.visual; card.querySelector(".shot-broll").value = shot.broll; card.querySelector(".shot-duration").value = shot.duration; });
  updateStoryboardDuration(); $("#editor-state").textContent = "已恢复上次未保存的编辑。";
}
let draftSaveTimer;
function scheduleEditorDraftSave() { clearTimeout(draftSaveTimer); draftSaveTimer = setTimeout(() => { if (projectId && snapshot.story && snapshot.storyboard) { saveWorkbenchDraft(localStorage, projectId, editorDraft()); $("#editor-state").textContent = "未保存编辑已在此设备临时恢复点中保留。"; } }, 300); }
function renderSimpleTimeline() { const board = editorStoryboard(), timeline = workbenchTimeline(board), preference = document.querySelector('input[name="workbench-quality"]:checked')?.value || "fast", cost = workbenchCostHint(board, preference); $("#simple-timeline-track").replaceChildren(...timeline.map(item => Object.assign(document.createElement("li"), { textContent: `镜头 ${item.order} · ${item.start}s–${item.end}s` }))); $("#workbench-cost-hint").textContent = `预计 ¥${cost.estimatedCny.toFixed(2)} · ${cost.seconds} 秒`; }
function updateStoryboardDuration() { const total = [...document.querySelectorAll(".shot-duration")].reduce((sum, input) => sum + (Number(input.value) || 0), 0); $("#storyboard-duration").textContent = `总时长 ${total} 秒`; if (!$("#storyboard-editor").hidden) renderSimpleTimeline(); }
async function redoWorkbenchShot(shotId) { const target = snapshot.storyboard.shots.find(shot => shot.id === shotId); if (!target) return; $("#editor-state").textContent = "正在保存局部重做请求（不会调用付费模型）…"; const shots = snapshot.storyboard.shots.map(shot => shot.id === shotId ? { ...shot, generatedAssetId: null } : shot); try { const storyboard = await api(`/api/v1/projects/${projectId}/storyboard`, json("PUT", { shots })); await refresh(); renderScriptStoryboard(snapshot.story, storyboard); $("#editor-state").textContent = "已保留其他镜头并清除此镜头的生成结果，可在确认后单独重做。"; } catch (error) { $("#editor-state").textContent = `局部重做失败：${error.message}`; } }
$("#short-video-flow").addEventListener("input", event => { if (event.target.closest("#script-editor, #storyboard-editor")) scheduleEditorDraftSave(); });
$("#storyboard-shots").addEventListener("input", updateStoryboardDuration);
function setIntakeSource(source) { const url = source === "url", asset = source === "asset"; $("#product-url-field").hidden = !url; $("#intake-asset-field").hidden = !asset; $("#short-video-url").required = url; $("#short-video-asset").required = asset; $("#short-video-brief-label").firstChild.textContent = source === "copy" ? ui("Existing script or copy", "已有脚本或文案") : source === "url" ? ui("Product benefits or creative direction", "商品卖点或创作要求") : source === "asset" ? ui("Asset notes", "素材说明") : ui("Video topic", "视频主题"); }
document.querySelectorAll('input[name="intake-source"]').forEach(input => input.onchange = () => setIntakeSource(input.value));
$("#short-video-brief-form").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.submitter, brief = $("#short-video-brief").value.trim();
  submit.disabled = true;
  $("#short-video-state").textContent = "正在创建可审阅的脚本与分镜方案…";
  try {
    const target = planCreativeTarget({ mode: document.querySelector('input[name="creative-target"]:checked')?.value, currentProject: snapshot.project, confirmedCurrent: $("#creative-current-confirm").checked, brief });
    if (target.requiresCreate) { const created = await api("/api/v1/projects", json("POST", { name: target.name })); await openProject(created.id); }
    else assertCreativeTargetCurrent(target, snapshot.project);
    const duration = Number($("#short-video-duration").value), type = $("#short-video-type").value, source = document.querySelector('input[name="intake-source"]:checked').value, url = $("#short-video-url").value.trim(), file = $("#short-video-asset").files?.[0], understanding = source === "url" ? await api("/api/v1/product-url/understand", json("POST", { url, idempotencyKey: crypto.randomUUID() })) : null, sourceContext = understanding ? JSON.stringify({ userBrief: brief, verifiedProductContext: understanding.creativeContext, sourceSha256: understanding.source.sha256, model: understanding.model.model, modelJobId: understanding.model.jobId, modelOutputSha256: understanding.model.outputSha256 }) : brief, reference = file ? await uploadReference(file) : null;
    const planned = await api(`/api/v1/projects/${projectId}/workbench-plan`, json("POST", { brief, sourceContext, type, duration, projectVersion: snapshot.project.version, referenceAssetIds: reference ? [reference.id] : [], idempotencyKey: crypto.randomUUID() }));
    const { story, storyboard } = planned;
    snapshot.story = story; snapshot.storyboard = storyboard;
    $("#short-video-flow").hidden = false; renderScriptStoryboard(story, storyboard); renderFinalWorkbench(); await refreshWorkbenchAssets(); await refreshProjectShelf(); $("#short-video-state").textContent = `${target.requiresCreate ? "已创建独立作品" : "已确认继续当前作品"}：${understanding ? `商品页已由 ${understanding.model.model} 基于抓取证据理解；` : ""}真实文本模型 ${planned.planning.model} 已生成 ${duration} 秒方案，费用已记录。`;
  } catch (error) {
    $("#short-video-state").textContent = `创建失败：${error.message}`;
  } finally { submit.disabled = false; }
});
$("#save-script-storyboard").onclick = async event => {
  const button = event.currentTarget, cards = [...document.querySelectorAll("#storyboard-shots article")]; button.disabled = true; $("#editor-state").textContent = "正在保存脚本与逐镜分镜…";
  try {
    const selectedHook = Number(document.querySelector('input[name="short-video-hook"]:checked')?.value || 0), current = snapshot.story;
    const production = { voice: $("#workbench-voice").value, captions: $("#workbench-captions").checked, music: $("#workbench-music").value, safeZone: $("#workbench-safe-zone").value };
    const story = await api(`/api/v1/projects/${projectId}/story`, json("PUT", { version: current.version, title: current.title, synopsis: $("#short-video-script").value.trim(), hooks: current.hooks, selectedHook, production, scenes: cards.map((card, index) => ({ id: card.dataset.sceneId, title: current.scenes[index].title, summary: card.querySelector(".shot-line").value.trim() })) }));
    const storyboard = await api(`/api/v1/projects/${projectId}/storyboard`, json("PUT", { version: snapshot.storyboard.version, shots: cards.map((card, index) => ({ id: card.dataset.shotId, sceneId: story.scenes[index].id, prompt: card.querySelector(".shot-visual").value.trim(), styleContinuity: card.querySelector(".shot-style").value.trim(), broll: card.querySelector(".shot-broll").value.trim(), duration: Number(card.querySelector(".shot-duration").value) })) }));
    clearWorkbenchDraft(localStorage, projectId); await refresh(); renderScriptStoryboard(story, storyboard); $("#generation-workbench").hidden = false; $("#editor-state").textContent = `已保存 · 脚本 v${story.version} · 分镜 v${storyboard.version}`;
  } catch (error) { $("#editor-state").textContent = `保存失败：${error.message}`; } finally { button.disabled = false; }
};

$("#node-tools").replaceChildren(...NODE_TYPES.map(type => button(type, async () => {
  const rect = viewport.getBoundingClientRect(), position = { x: (rect.width / 2 - view.x) / view.scale - 120, y: (rect.height / 2 - view.y) / view.scale - 70 };
  const node = await api(`/api/v1/sessions/${sessionId}/nodes`, json("POST", { type, position })); await refresh(node.id);
})));

function button(label, action) { const element = document.createElement("button"); element.className = "tool"; element.innerHTML = `<span>${icons[label] || "+"}</span>${label}`; element.addEventListener("click", () => action().catch(showError)); return element; }
async function refresh(selectId) { snapshot = await api(`/api/v1/projects/${projectId}`); if (selectId) selected = [selectId]; render(); }
function render() {
  renderFinalWorkbench();
  renderCommercialJob();
  refreshCommercialPolicyReferences();
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("edges");
  for (const edge of snapshot.edges) { const from = snapshot.nodes.find(n => n.id === edge.fromNodeId), to = snapshot.nodes.find(n => n.id === edge.toNodeId); if (!from || !to) continue; const line = document.createElementNS(svg.namespaceURI, "line"); line.setAttribute("x1", from.position.x + 120); line.setAttribute("y1", from.position.y + 60); line.setAttribute("x2", to.position.x + 120); line.setAttribute("y2", to.position.y + 60); line.dataset.edgeId = edge.id; line.addEventListener("click", event => { event.stopPropagation(); selectedGraph = { kind: "edge", value: edge }; selected = []; render(); }); svg.append(line); }
  canvas.replaceChildren(...snapshot.groups.map(renderGroup), svg, ...snapshot.nodes.map(renderNode));
  const node = snapshot.nodes.find(item => item.id === selected.at(-1));
  $("#inspector-empty").hidden = Boolean(node || selectedGraph); nodeForm.hidden = !node; graphForm.hidden = !selectedGraph;
  if (node) { $("#node-title").value = node.title; $("#node-content").value = node.content; $("#node-meta").textContent = `${node.type} · ${Math.round(node.position.x)}, ${Math.round(node.position.y)} · ${node.status} · v${node.version}`; $("#generation-panel").hidden = !["image", "video", "audio"].includes(node.type); if (!$("#generation-panel").hidden) renderParameters(node.type); $("#node-history").replaceChildren(...node.runs.map(run => { const li = document.createElement("li"); li.textContent = `${run.state} · ${run.events.length} events · ${run.error?.code || run.assetId || "pending"}`; return li; }), ...node.resultVersions.map(result => { const li = document.createElement("li"); const link = document.createElement("a"); link.href = result.downloadUrl; link.textContent = `result ${result.id}`; li.append(link); return li; })); }
  if (selectedGraph) { $("#graph-title").value = selectedGraph.value.title || ""; $("#graph-meta").textContent = `${selectedGraph.kind} · v${selectedGraph.value.version}`; }
  $("#zoom-label").value = `${Math.round(view.scale * 100)}%`;
}
function publishingKey() { return `openreel:publishing:${projectId}`; }
function publishingBatchKey() { return `openreel:publishing-batch:${projectId}`; }
const publishingLabels = { tiktok: "TikTok", douyin: "抖音", instagram_reels: "Instagram Reels", youtube_shorts: "YouTube Shorts" };
let publishingAccountView = new Map();
function publishingOverrideControl(label, name, type = "checkbox") { const wrapper = document.createElement("label"), input = document.createElement("input"); input.type = type; input.name = name; wrapper.append(input, label); return { wrapper, input }; }
function renderPublishingOverrides() {
  const selected = [...document.querySelectorAll("#publishing-destinations input:checked")].map(input => input.value);
  $("#publishing-overrides").replaceChildren(...selected.map(platform => { const account = publishingAccountView.get(platform), capabilities = account?.capabilities || {}, section = document.createElement("fieldset"), legend = document.createElement("legend"); section.dataset.platform = platform; legend.textContent = `${publishingLabels[platform]} 发布设置`; section.append(legend);
    if (capabilities.privacyOptions?.length) { const label = document.createElement("label"), select = document.createElement("select"); select.name = "privacy"; for (const value of capabilities.privacyOptions) select.append(Object.assign(document.createElement("option"), { value, textContent: value })); label.append("可见范围", select); section.append(label); }
    if (capabilities.audienceRequired) { const control = publishingOverrideControl("内容面向儿童", "madeForKids"); section.append(control.wrapper); }
    if (platform === "tiktok") for (const [name, label] of [["allowComment", "允许评论"], ["allowDuet", "允许合拍"], ["allowStitch", "允许拼接"]]) { const control = publishingOverrideControl(label, name); control.input.checked = capabilities.interactions?.[name.slice(5).toLowerCase()] === true; control.input.disabled = capabilities.interactions?.[name.slice(5).toLowerCase()] !== true; section.append(control.wrapper); }
    if (platform === "instagram_reels") { const control = publishingOverrideControl("同时分享到动态", "shareToFeed"); section.append(control.wrapper); }
    return section; }));
}
function publishingMetadata(platform) { const section = document.querySelector(`#publishing-overrides [data-platform="${platform}"]`); if (!section) return {}; const metadata = {}; for (const input of section.querySelectorAll("input, select")) metadata[input.name] = input.type === "checkbox" ? input.checked : input.value; return metadata; }
function renderPublishingBatch(batch) {
  publishingBatchId = batch.id;
  localStorage.setItem(publishingBatchKey(), batch.id);
  $("#publishing-recover").hidden = false;
  $("#publishing-confirm").hidden = !batch.confirmationRequired;
  $("#publishing-confirm").disabled = true;
  $("#publishing-results").replaceChildren(...batch.destinations.map(item => { const row = document.createElement("li"), label = document.createElement("strong"), detail = document.createElement("span"), state = document.createElement("small"); label.textContent = publishingLabels[item.platform] || item.platform; state.textContent = item.error?.message ? `${item.state} · ${item.error.message}` : item.state; detail.append(state); if (item.retryable) detail.append(publishingAction("重试", "retry", item.platform)); if (item.state === "unknown_remote") detail.append(publishingAction("核对远端状态", "reconcile", item.platform)); row.append(label, detail); return row; }));
  let cancel = $("#publishing-cancel");
  if (!cancel) { cancel = Object.assign(document.createElement("button"), { id: "publishing-cancel", type: "button", textContent: "取消未完成发布" }); $("#publishing-results").after(cancel); cancel.onclick = () => runPublishingAction("cancel"); }
  cancel.hidden = !batch.canCancel;
  $("#publishing-progress").textContent = batch.confirmationRequired ? ui("Platform validation passed. Real publishing still requires explicit approval for the platforms, accounts, asset, and publishing copy.", "平台校验已通过。真实发布仍需主人针对平台、账号、资产和文案明确授权。") : batch.summary?.status === "attention_required" ? ui("Remote platform state is unknown. Review it before recovery.", "平台远端状态未知，需要人工核对后再恢复。") : ui("Batch recovered. Review each platform state.", "批次已恢复；请查看各平台状态。");
}
function publishingAction(label, action, platform) { const button = Object.assign(document.createElement("button"), { type: "button", textContent: label }); button.dataset.publishingAction = action; button.dataset.platform = platform; button.onclick = () => runPublishingAction(action, platform); return button; }
async function runPublishingAction(action, platform = null) { if (!publishingBatchId) return; const body = platform ? { platform } : {}; try { $("#publishing-progress").textContent = action === "reconcile" ? "正在只读核对平台远端状态…" : action === "retry" ? "正在重新进入校验流程…" : "正在取消尚未完成的发布…"; renderPublishingBatch(await api(`/api/v1/publishing/batches/${publishingBatchId}/${action}`, json("POST", body))); } catch (error) { $("#publishing-progress").textContent = `操作失败：${error.message}`; } }
function renderFinalWorkbench() {
  const section = $("#final-workbench"); section.hidden = !snapshot.story;
  if (section.hidden) return;
  $("#publishing-recover").hidden = !localStorage.getItem(publishingBatchKey());
  let publishing; try { publishing = JSON.parse(localStorage.getItem(publishingKey())) || null; } catch { publishing = null; }
  publishing ||= publishingDraft(snapshot.story, snapshot.project?.name);
  if (!section.contains(document.activeElement)) { $("#publishing-title").value = publishing.title; $("#publishing-copy").value = publishing.copy; }
  const preview = finalPreview(snapshot), video = $("#workbench-final-video"); video.hidden = !preview.asset; $("#workbench-final-empty").hidden = Boolean(preview.asset);
  if (preview.asset && video.src !== new URL(preview.asset.downloadUrl, location.href).href) video.src = preview.asset.downloadUrl;
  $("#workbench-export").disabled = !preview.canExport;
  $("#workbench-final-state").textContent = preview.canExport ? "时间线已就绪；检查后可导出本地 MP4 成片。" : "还没有可导出的时间线；此状态不会启动生成或付费调用。";
}
function commercialJobKey() { return `openreel:commercial-job:${projectId}`; }
let commercialRedoQuote = null;
let commercialMonitorJobId = null;
const commercialTerminalStatuses = new Set(["succeeded", "failed", "cancelled"]);
const commercialStageLabels = { prepare: "准备素材", images: "生成图片", videos: "生成视频", voice: "生成配音", compose: "合成成片", quality: "质量检查" };
function renderCommercialJob() {
  const section = $("#generation-workbench"); section.hidden = !snapshot.storyboard?.shots?.length;
  if (section.hidden) return;
  renderProductionAssetChoices();
  $("#commercial-retry").hidden = commercialJob?.status !== "failed" || commercialJob.retryable !== true;
  $("#commercial-redo-quote").hidden = commercialJob?.status !== "failed" || !(commercialJob.result?.shots || []).some(shot => shot.status === "failed");
  $("#commercial-cancel").hidden = !commercialJob || !["queued", "running"].includes(commercialJob.status);
  const stage = commercialJob?.stage ? ` · ${commercialStageLabels[commercialJob.stage] || commercialJob.stage}${commercialJob.stageDetail ? `：${commercialJob.stageDetail}` : ""}` : "";
  const qualification = commercialJob?.result ? ` · 生成 ${commercialJob.result.generationStatus || "未知"} · 质量 ${commercialJob.result.qualificationStatus || "未检查"} · 发布资格 ${commercialJob.result.releaseEligible === true ? "允许进入发布预检" : "禁止"}` : "";
  $("#commercial-job-state").textContent = !commercialJob ? "尚未创建生成任务。" : `任务 ${commercialJob.id} · ${commercialJob.status}${stage}${qualification} · 已尝试 ${commercialJob.attempts}/${commercialJob.maxAttempts}`;
  renderDirectorRuntime();
}
function renderDirectorRuntime() {
  const state = directorRuntimeUiState(commercialQuote, commercialJob);
  $("#director-runtime-state").textContent = directorRuntimeUiSummary(state);
  $("#commercial-perceptual-evidence").replaceChildren(...directorPerceptualUiRows(state).map(item => { const row = document.createElement("li"), label = document.createElement("strong"), detail = document.createElement("small"); label.textContent = `${item.accepted ? "通过" : "未通过"} · ${item.label}`; detail.textContent = item.detail; row.append(label, detail); return row; }));
}
function renderProductionAssetChoices() {
  const selectedCaptionIds = new Set([...$("#workbench-caption-assets").selectedOptions].map(option => option.value)), selectedMusicAssetId = $("#workbench-music-asset").value;
  const assets = snapshot.assets || [], captions = assets.filter(asset => asset.mimeType === "image/png" && asset.metadata?.reviewed === true && asset.metadata?.identity?.storyboardVersion === snapshot.storyboard?.version), music = assets.filter(asset => ["audio/wav", "audio/mpeg"].includes(asset.mimeType) && asset.metadata?.review?.status === "reviewed" && asset.metadata?.review?.sourceDeclaration);
  $("#workbench-caption-assets").replaceChildren(...captions.map(asset => new Option(asset.filename, asset.id, false, selectedCaptionIds.has(asset.id))));
  $("#workbench-music-asset").replaceChildren(new Option("不使用素材库音乐", ""), ...music.map(asset => new Option(asset.filename, asset.id)));
  if ([...$("#workbench-music-asset").options].some(option => option.value === selectedMusicAssetId)) $("#workbench-music-asset").value = selectedMusicAssetId;
  const selectedShot = $("#workbench-caption-shot").value; $("#workbench-caption-shot").replaceChildren(...(snapshot.storyboard?.shots || []).map((shot, index) => new Option(`镜头 ${index + 1}`, shot.id))); if (selectedShot && [...$("#workbench-caption-shot").options].some(option => option.value === selectedShot)) $("#workbench-caption-shot").value = selectedShot;
}
async function uploadProductionAsset(file, stage, fields) { const headers = { "content-type": file.type, "x-filename": file.name, "x-openreel-asset-stage": stage, "x-project-version": String(snapshot.project.version), "x-story-version": String(snapshot.story.version), "x-storyboard-version": String(snapshot.storyboard.version), ...(csrfToken ? { "x-csrf-token": csrfToken } : {}), ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeURIComponent(value)])) }, response = await fetch(`/api/v1/projects/${projectId}/commercial/production-assets`, { method: "POST", headers, body: file }), value = await response.json(); if (!response.ok) { const error = new Error(value.error?.message || "Upload failed"); error.code = value.error?.code; throw error; } await refresh(); renderProductionAssetChoices(); return value; }
$("#workbench-caption-upload").onchange = async event => { const input = event.currentTarget, file = input.files?.[0], shotId = $("#workbench-caption-shot").value, captionText = $("#workbench-caption-text").value.trim(); if (!file) return; $("#workbench-production-asset-state").textContent = `正在审核并上传 ${file.name}…`; try { await uploadProductionAsset(file, "caption", { "x-shot-id": shotId, "x-caption-text": captionText }); $("#workbench-production-asset-state").textContent = "字幕卡已绑定当前镜头与分镜版本。"; } catch (error) { $("#workbench-production-asset-state").textContent = `字幕卡上传失败：${error.message}`; } finally { input.value = ""; } };
$("#workbench-music-upload").onchange = async event => { const input = event.currentTarget, file = input.files?.[0], source = $("#workbench-music-source").value.trim(); if (!file) return; $("#workbench-production-asset-state").textContent = `正在审核并上传 ${file.name}…`; try { await uploadProductionAsset(file, "music", { "x-source-declaration": source }); $("#workbench-production-asset-state").textContent = "音乐已绑定当前作品版本；报价前仍需确认使用责任。"; } catch (error) { $("#workbench-production-asset-state").textContent = `音乐上传失败：${error.message}`; } finally { input.value = ""; } };
async function recoverCommercialJob() {
  const jobId = localStorage.getItem(commercialJobKey());
  if (!jobId) { commercialJob = null; renderCommercialJob(); return; }
  try { commercialJob = await api(`/api/v1/projects/${projectId}/commercial/jobs/${jobId}`); } catch (error) { if (error.status === 404) localStorage.removeItem(commercialJobKey()); commercialJob = null; }
  renderCommercialJob();
  if (commercialJob && !commercialTerminalStatuses.has(commercialJob.status)) void monitorCommercialJob(commercialJob.id);
}
async function monitorCommercialJob(jobId) {
  if (commercialMonitorJobId === jobId) return;
  const monitoredProjectId = projectId;
  commercialMonitorJobId = jobId;
  try {
    while (commercialMonitorJobId === jobId) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (projectId !== monitoredProjectId) return;
      commercialJob = await api(`/api/v1/projects/${monitoredProjectId}/commercial/jobs/${jobId}`);
      renderCommercialJob();
      if (commercialTerminalStatuses.has(commercialJob.status)) { await refresh(); return; }
    }
  } catch (error) {
    $("#commercial-job-state").textContent = `任务仍在后台运行；状态刷新暂时失败：${error.message}。可刷新页面继续查看。`;
  } finally { if (commercialMonitorJobId === jobId) commercialMonitorJobId = null; }
}
function executeCommercialJob(jobId) {
  const executionProjectId = projectId;
  void api(`/api/v1/projects/${executionProjectId}/commercial/jobs/${jobId}/execute`, json("POST", {})).catch(() => {});
  void monitorCommercialJob(jobId);
}
$("#commercial-quote").onclick = async event => {
  const button = event.currentTarget; button.disabled = true; commercialQuote = null; $("#commercial-confirmed").checked = false; $("#commercial-confirmed").disabled = true; $("#commercial-start").disabled = true; $("#commercial-quote-state").textContent = "正在检查当前版本与最高费用…";
  try { const quality = document.querySelector('input[name="workbench-quality"]:checked')?.value || "fast", captionAssetIds = [...$("#workbench-caption-assets").selectedOptions].map(option => option.value), generateMusic = $("#workbench-generate-music").checked, musicAssetId = generateMusic ? null : ($("#workbench-music-asset").value || null), musicGeneration = generateMusic ? { enabled: true, model: "seed-audio-1.0", prompt: $("#workbench-music-prompt").value, durationSeconds: Number($("#workbench-music-duration").value) } : null, musicRightsConfirmation = (musicAssetId || musicGeneration) && $("#workbench-music-rights").checked ? { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: new Date().toISOString(), sourceDeclaration: musicGeneration ? "provider-generated music" : "user-selected project asset" } : null, policySafety = await commercialPolicySafety(); commercialQuote = await api(`/api/v1/projects/${projectId}/commercial/quote`, json("POST", { projectVersion: snapshot.project.version, storyVersion: snapshot.story.version, storyboardVersion: snapshot.storyboard.version, quality, captionAssetIds, musicAssetId, musicGeneration, musicRightsConfirmation, ...policySafety })); $("#commercial-confirmed").disabled = commercialQuote.director?.ready !== true; const cost = commercialQuote.cost; $("#commercial-quote-state").textContent = commercialQuote.director?.ready === true ? `报价 ¥${cost.estimatedCny.toFixed(2)}（生成 ¥${cost.generationEstimatedCny.toFixed(2)} + 质量评估 ¥${cost.evaluationEstimatedCny.toFixed(2)}）· 单动作上限 ¥${cost.perActionLimitCny.toFixed(2)} · 每镜绑定完整；确认前未产生付费调用。` : `报价 ¥${cost.estimatedCny.toFixed(2)} 已生成（含质量评估 ¥${cost.evaluationEstimatedCny.toFixed(2)}），但尚不能执行：请补全每镜导演绑定。当前未产生付费调用。`; renderDirectorRuntime(); }
  catch (error) { $("#commercial-quote-state").textContent = `费用预检失败：${error.message}`; } finally { button.disabled = false; }
};
$("#commercial-confirmed").onchange = event => { $("#commercial-start").disabled = !commercialQuote || !event.currentTarget.checked; };
$("#commercial-start").onclick = async event => {
  const button = event.currentTarget; button.disabled = true; $("#commercial-job-state").textContent = "正在创建版本绑定任务…";
  try { commercialJob = await api(`/api/v1/projects/${projectId}/commercial/jobs`, json("POST", { quoteId: commercialQuote.id, confirmed: true, idempotencyKey: crypto.randomUUID() })); localStorage.setItem(commercialJobKey(), commercialJob.id); commercialQuote = null; $("#commercial-confirmed").checked = false; $("#commercial-confirmed").disabled = true; renderCommercialJob(); executeCommercialJob(commercialJob.id); }
  catch (error) { $("#commercial-job-state").textContent = `生成失败：${error.message}`; } finally { button.disabled = !commercialQuote || !$("#commercial-confirmed").checked; }
};
$("#commercial-retry").onclick = async event => {
  const button = event.currentTarget; button.disabled = true;
  try { commercialJob = await api(`/api/v1/projects/${projectId}/commercial/jobs/${commercialJob.id}/retry`, json("POST", {})); renderCommercialJob(); commercialJob = await api(`/api/v1/projects/${projectId}/commercial/jobs/${commercialJob.id}/execute`, json("POST", {})); renderCommercialJob(); await refresh(); }
  catch (error) { $("#commercial-job-state").textContent = `重试失败：${error.message}`; }
  finally { button.disabled = false; }
};
$("#commercial-redo-quote").onclick = async event => {
  const button = event.currentTarget; button.disabled = true; commercialRedoQuote = null; $("#commercial-redo-confirmed").checked = false; $("#commercial-redo-confirm-label").hidden = true; $("#commercial-redo-start").hidden = true; $("#commercial-redo-state").hidden = false; $("#commercial-redo-state").textContent = "正在核对失败镜头、当前版本与单独费用…";
  try { commercialRedoQuote = await api(`/api/v1/projects/${projectId}/commercial/jobs/${commercialJob.id}/redo/quote`, json("POST", {})); $("#commercial-redo-confirm-label").hidden = false; $("#commercial-redo-start").hidden = false; $("#commercial-redo-state").textContent = `仅重做 ${commercialRedoQuote.shotIds.length} 个失败镜头 · 报价 ¥${commercialRedoQuote.cost.estimatedCny.toFixed(2)} · 保留 ${commercialRedoQuote.preservedShotIds.length} 个成功镜头；确认前不会调用模型。`; }
  catch (error) { $("#commercial-redo-state").textContent = `单镜头费用预检失败：${error.message}`; }
  finally { button.disabled = false; }
};
$("#commercial-redo-confirmed").onchange = event => { $("#commercial-redo-start").disabled = !commercialRedoQuote || !event.currentTarget.checked; };
$("#commercial-redo-start").onclick = async event => {
  const button = event.currentTarget; button.disabled = true;
  try { commercialJob = await api(`/api/v1/projects/${projectId}/commercial/jobs/${commercialJob.id}/redo/jobs`, json("POST", { quoteId: commercialRedoQuote.id, confirmed: true, idempotencyKey: crypto.randomUUID() })); localStorage.setItem(commercialJobKey(), commercialJob.id); commercialRedoQuote = null; $("#commercial-redo-confirm-label").hidden = true; button.hidden = true; $("#commercial-redo-state").textContent = "重做任务已按当前版本安全排队；其他成功镜头保持不变。"; renderCommercialJob(); }
  catch (error) { $("#commercial-redo-state").textContent = `创建重做任务失败：${error.message}`; button.disabled = false; }
};
$("#commercial-cancel").onclick = async () => { commercialJob = await api(`/api/v1/projects/${projectId}/commercial/jobs/${commercialJob.id}/cancel`, json("POST", {})); renderCommercialJob(); };
function renderNode(node) { const element = document.createElement("article"); element.className = `node node-${node.type}${selected.includes(node.id) ? " selected" : ""}`; element.dataset.nodeId = node.id; element.style.transform = `translate(${node.position.x}px, ${node.position.y}px)`; const audio = node.resultVersions.find(result => result.mimeType?.startsWith("audio/")); element.innerHTML = `<header><span>${icons[node.type]}</span><strong>${escapeHtml(node.title)}</strong><small>${node.type}</small></header><p>${escapeHtml(node.content)}</p>${audio ? `<audio controls preload="metadata" src="${escapeHtml(audio.downloadUrl)}" aria-label="${escapeHtml(node.title)} preview"></audio>` : ""}<footer data-state="${node.status}"><i></i>${node.status}</footer>`; element.addEventListener("click", event => { event.stopPropagation(); selectedGraph = null; selected = event.shiftKey ? [...new Set([...selected, node.id])] : [node.id]; render(); }); element.addEventListener("pointerdown", event => { if (event.target.closest("audio")) return; dragNode(event, node); }); return element; }
function renderGroup(group) { const members = snapshot.nodes.filter(node => group.nodeIds.includes(node.id)); const element = document.createElement("section"); element.className = "graph-group"; element.dataset.groupId = group.id; const minX = Math.min(...members.map(n => n.position.x)) - 24, minY = Math.min(...members.map(n => n.position.y)) - 44, maxX = Math.max(...members.map(n => n.position.x + 240)) + 24, maxY = Math.max(...members.map(n => n.position.y + 120)) + 24; Object.assign(element.style, { transform: `translate(${minX}px, ${minY}px)`, width: `${maxX-minX}px`, height: `${maxY-minY}px` }); element.textContent = group.title; element.addEventListener("click", event => { event.stopPropagation(); selectedGraph = { kind: "group", value: group }; selected = []; render(); }); return element; }
function dragNode(event, node) { if (event.button !== 0) return; const start = { clientX: event.clientX, clientY: event.clientY, ...node.position }; const move = next => { node.position = { x: start.x + (next.clientX-start.clientX)/view.scale, y: start.y + (next.clientY-start.clientY)/view.scale }; render(); }; const end = async () => { window.removeEventListener("pointermove", move); await api(`/api/v1/nodes/${node.id}`, json("PATCH", { position: node.position, version: node.version })); await refresh(node.id); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); }

$("#create-edge").addEventListener("click", async () => { if (selected.length !== 2) return showError(new Error("Select exactly two nodes (Shift-click)")); await api(`/api/v1/projects/${projectId}/edges`, json("POST", { fromNodeId: selected[0], toNodeId: selected[1] })); await refresh(); });
$("#create-group").addEventListener("click", async () => { if (selected.length < 1) return showError(new Error("Select one or more nodes")); await api(`/api/v1/projects/${projectId}/groups`, json("POST", { title: "New group", nodeIds: selected })); await refresh(); });
nodeForm.addEventListener("change", async event => { if (!event.target.matches("#node-title, #node-content")) return; const node = snapshot.nodes.find(item => item.id === selected.at(-1)); if (!node) return; await api(`/api/v1/nodes/${node.id}`, json("PATCH", { title: $("#node-title").value, content: $("#node-content").value, version: node.version })); await refresh(node.id); });
graphForm.addEventListener("change", async () => { const graph = selectedGraph; await api(`/api/v1/${graph.kind}s/${graph.value.id}`, json("PATCH", { title: $("#graph-title").value, version: graph.value.version })); snapshot = await api(`/api/v1/projects/${projectId}`); selectedGraph = { kind: graph.kind, value: snapshot[`${graph.kind}s`].find(item => item.id === graph.value.id) }; render(); });
$("#delete-node").onclick = async () => {
  const node = snapshot.nodes.find(item => item.id === selected.at(-1));
  if (!node || !confirm(ui(`Delete “${node.title}” from this canvas? Generated assets and run history will be preserved.`, `从画布删除“${node.title}”？已生成素材和运行历史会保留。`))) return;
  await api(`/api/v1/nodes/${node.id}`, json("DELETE", { version: node.version }));
  selected = []; await refresh();
  $("#workflow-state").textContent = ui("Node deleted. Run history and generated assets were preserved.", "节点已删除；运行历史与已生成素材已保留。");
};

viewport.addEventListener("pointerdown", event => { if (event.target !== viewport && event.target !== canvas) return; selected = []; selectedGraph = null; const start = { clientX: event.clientX, clientY: event.clientY, ...view }; const move = next => { view.x = start.x + next.clientX-start.clientX; view.y = start.y + next.clientY-start.clientY; render(); }; const end = () => window.removeEventListener("pointermove", move); window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true }); render(); });
viewport.addEventListener("wheel", event => { event.preventDefault(); setScale(view.scale * (event.deltaY < 0 ? 1.1 : .9)); }, { passive: false });
$("#zoom-in").onclick = () => setScale(view.scale + .1); $("#zoom-out").onclick = () => setScale(view.scale - .1); function setScale(scale) { view.scale = Math.min(2, Math.max(.4, scale)); render(); }
$("#reload-collaboration").onclick = async () => { await refresh(); $("#collaboration-conflict").hidden = true; };
$("#rename-project").onclick = () => renameWorkbenchProject(snapshot.project).catch(showError);
$("#archive-project").onclick = () => setProjectStatus(snapshot.project, "archived").catch(showError);
$("#api-access").onclick = async () => { $("#api-access-dialog").showModal(); await refreshKeyApplications(); };
function renderTutorialList() {
  $("#tutorial-detail").hidden = true; $("#tutorial-list").hidden = false;
  $("#tutorial-list").replaceChildren(...tutorialsForLocale(currentLocale()).map(tutorial => {
    const card = document.createElement("button"); card.type = "button"; card.className = "tutorial-card";
    card.innerHTML = `<span>${escapeHtml(tutorial.category)} · ${escapeHtml(tutorial.level)}</span><strong>${escapeHtml(tutorial.title)}</strong><small>${escapeHtml(tutorial.duration)} · ${escapeHtml(tutorial.calls)}</small><p>${escapeHtml(tutorial.outcome)}</p>`;
    card.onclick = () => renderTutorial(tutorial.id); return card;
  }));
}
async function renderTutorial(id) {
  const tutorial = tutorialForLocale(id, currentLocale()), detail = $("#tutorial-detail"); $("#tutorial-list").hidden = true; detail.hidden = false;
  const key = `openreel:tutorial:${projectId}:${tutorial.id}:v${tutorial.version}`; let saved = [];
  try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch { localStorage.removeItem(key); }
  try { tutorialProgress(tutorial.id, saved); } catch { localStorage.removeItem(key); saved = []; }
  let progress = await api(`/api/v1/projects/${projectId}/tutorials/${tutorial.id}/progress`);
  if (saved.length && !progress.completedSteps.length) { progress = await api(`/api/v1/projects/${projectId}/tutorials/${tutorial.id}/progress`, json("PUT", { completedSteps: saved })); localStorage.removeItem(key); }
  const references = snapshot.assets.filter(asset => asset.sessionId === sessionId && asset.kind === "image" && asset.role === "reference"), shortcuts = (await api("/api/v1/workflow-shortcuts")).templates;
  detail.innerHTML = `<button class="tutorial-back" type="button">← ${ui("All tutorials", "全部教程")}</button><p class="eyebrow">${escapeHtml(tutorial.category)} · ${escapeHtml(tutorial.level)}</p><h2>${escapeHtml(tutorial.title)}</h2><p class="tutorial-outcome">${escapeHtml(tutorial.outcome)}</p><div class="tutorial-meta"><span>${escapeHtml(tutorial.duration)}</span><span>${escapeHtml(tutorial.calls)}</span><span>${tutorial.nodes.length} ${ui("nodes", "个节点")}</span><span>v${tutorial.version}</span></div><h3>${ui("Steps", "操作步骤")}</h3><ol class="tutorial-steps">${tutorial.steps.map((step, index) => `<li><label><input type="checkbox" value="${index}"${progress.completedSteps.includes(index) ? " checked" : ""}>${escapeHtml(step)}</label></li>`).join("")}</ol><p class="tutorial-progress" role="status">${progress.completedCount}/${progress.totalSteps} ${ui("steps complete", "步完成")} · ${progress.status}</p><h3>${ui("Acceptance checklist", "验收清单")}</h3><ul>${tutorial.checks.map(check => `<li>${escapeHtml(check)}</li>`).join("")}</ul><section class="tutorial-shortcut"><h3>${ui("Reviewed shortcut", "经审查的快捷模板")}</h3><label>${ui("Template", "模板")}<select>${shortcuts.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("")}</select></label><label>${ui("Reference image", "参考图")}<select class="tutorial-reference"><option value="">${ui("Choose an uploaded reference image", "选择已上传参考图")}</option>${references.map(asset => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.filename)}</option>`).join("")}</select></label><label>${ui("Creative direction", "创作要求")}<textarea rows="3"></textarea></label><button type="button"${references.length ? "" : " disabled"}>${ui("Create reviewable node", "创建待审阅节点")}</button><p role="status">${references.length ? ui("No generation or cost occurs automatically.", "不会自动生成或产生费用。") : ui("Upload an image reference first.", "请先上传一张图片参考素材。")}</p></section><p class="tutorial-safety">${ui("Starting a tutorial only creates and connects nodes. It never submits a model job or incurs cost. Review models, parameters, and limits before generation.", "开始教程只会创建并连接节点，不会提交模型任务或产生费用。请在生成前检查模型、参数和管理员额度。")}</p><button class="tutorial-start" type="button">${ui("Add tutorial blueprint to canvas", "把教程蓝图放到当前画布")}</button>`;
  detail.querySelector(".tutorial-back").onclick = renderTutorialList;
  detail.querySelector(".tutorial-steps").onchange = async () => { const completedSteps = [...detail.querySelectorAll(".tutorial-steps input:checked")].map(input => Number(input.value)), next = await api(`/api/v1/projects/${projectId}/tutorials/${tutorial.id}/progress`, json("PUT", { completedSteps })); detail.querySelector(".tutorial-progress").textContent = `${next.completedCount}/${next.totalSteps} ${ui("steps complete", "步完成")} · ${next.status}`; };
  detail.querySelector(".tutorial-shortcut button").onclick = async event => { const section = event.currentTarget.closest(".tutorial-shortcut"), shortcutId = section.querySelector("select").value, referenceAssetId = section.querySelector(".tutorial-reference").value, prompt = section.querySelector("textarea").value; event.currentTarget.disabled = true; try { const node = await api(`/api/v1/projects/${projectId}/sessions/${sessionId}/workflow-shortcuts/${shortcutId}/apply`, json("POST", { prompt, referenceAssetIds: [referenceAssetId] })); await refresh(node.id); section.querySelector("[role=status]").textContent = "待审阅节点已创建；尚未运行。"; } finally { event.currentTarget.disabled = false; } };
  detail.querySelector(".tutorial-start").onclick = event => startTutorial(tutorial, event.currentTarget).catch(showError);
}
async function startTutorial(tutorial, trigger) {
  trigger.disabled = true;
  try {
    const created = [];
    for (const spec of tutorial.nodes) {
      const node = await api(`/api/v1/sessions/${sessionId}/nodes`, json("POST", { type: spec.type, position: spec.position }));
      created.push(await api(`/api/v1/nodes/${node.id}`, json("PATCH", { title: spec.title, content: spec.content, version: node.version })));
    }
    for (let index = 1; index < created.length; index += 1) await api(`/api/v1/projects/${projectId}/edges`, json("POST", { fromNodeId: created[index - 1].id, toNodeId: created[index].id }));
    await api(`/api/v1/projects/${projectId}/groups`, json("POST", { title: `Tutorial · ${tutorial.title}`, nodeIds: created.map(node => node.id) }));
    await refresh(created[0].id); setWorkspacePage("canvas"); $("#workflow-state").textContent = `Tutorial ready: ${tutorial.title}. Review each prompt before generating.`;
  } finally { trigger.disabled = false; }
}
$("#create-api-key").onclick = async () => { const issued = await api("/api/v1/api-keys", json("POST", { name: "primary" })); $("#issued-key").textContent = `Copy now — this external API key will not be shown again: ${issued.key}`; await refreshKeyApplications(); };
async function refreshKeyApplications() { const keys = await api("/api/v1/api-keys"); $("#key-application-state").textContent = "USD 200 trial allowance active after registration."; $("#key-issue-panel").hidden = false; $("#api-key-list").replaceChildren(...keys.map(key => { const li = document.createElement("li"); li.textContent = `${key.name} · ${key.prefix}… · ${key.status}`; return li; })); }
function money(units, currency = "CNY", scale = 1_000_000) { return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(units || 0) / scale); }
$("#generate").onclick = async () => { const node = snapshot.nodes.find(item => item.id === selected.at(-1)), chosen = models.find(x => x.id === $("#generation-model").value), value = id => $(id).value || undefined, selectedControls = [...document.querySelectorAll("#generation-controls input:checked")].map(input => input.value), audioSpec = node.type === "audio" ? { intent: value("#audio-intent"), ...(value("#audio-intent") === "voice" && value("#audio-voice") ? { voice: value("#audio-voice"), speed: Number(value("#audio-speed")), pitch: Number(value("#audio-pitch")), volume: Number(value("#audio-volume")) } : {}), sampleRate: Number(value("#audio-sample-rate")), format: value("#audio-format") } : undefined, parameters = { mode: value("#generation-mode"), aspect: value("#generation-aspect"), resolution: value("#generation-resolution"), duration: value("#generation-duration") ? Number(value("#generation-duration")) : undefined, audio: chosen.schema.audio === undefined ? undefined : $("#generation-audio").checked, controls: selectedModelControls(chosen.schema, selectedControls), ...(audioSpec && { audioSpec, reviewed: $("#audio-reviewed").checked }) }; let job; if (isQwenTtsModel(chosen)) { job = await api(`/api/v1/sessions/${sessionId}/qwen-tts-jobs`, json("POST", prepareQwenTtsJob({ nodeId: node.id, prompt: $("#generation-prompt").value, duration: parameters.duration, audioSpec, reviewed: parameters.reviewed, language: value("#audio-language"), instruct: value("#audio-instruct"), idempotencyKey: crypto.randomUUID() }))); $("#generation-state").textContent = qwenTtsPreparedMessage(job); } else if (chosen.adapterId === "ark") { job = await api(`/api/v1/sessions/${sessionId}/ark-jobs`, json("POST", { nodeId: node.id, prompt: $("#generation-prompt").value, model: chosen.id, capability: node.type, parameters, idempotencyKey: crypto.randomUUID() })); while (!["succeeded","failed"].includes(job.state)) { await new Promise(resolve => setTimeout(resolve, 1000)); job = await api(`/api/v1/jobs/${job.id}/ark-poll`, json("POST", {})); } } else { job = await api(`/api/v1/sessions/${sessionId}/jobs`, json("POST", { nodeId: node.id, prompt: $("#generation-prompt").value, adapterId: chosen.adapterId, ...parameters, outcome: $("#simulate-failure").checked ? "failed" : "succeeded" })); while (!["succeeded","failed","canceled"].includes(job.state)) job = await api(`/api/v1/jobs/${job.id}/tick`, json("POST", {})); } await refresh(node.id); await refreshLibrary(); };
function options(select, values = []) { select.replaceChildren(...values.map(value => { const option = document.createElement("option"); option.value = value; option.textContent = value; return option; })); select.closest("label").hidden = !values.length; }
function renderParameters(kind) { $("#audio-spec-fields").hidden = kind !== "audio"; if (kind !== "audio") $("#audio-reviewed").checked = false; const select = $("#generation-model"), available = models.filter(x => x.kind === kind), previous = select.dataset.initialized === "true" ? select.value : "", current = available.find(x => x.id === previous) || available.find(x => x.adapterId === "ark") || available[0]; options(select, available.map(x => x.id)); select.dataset.initialized = "true"; if (!current) return; select.value = current.id; for (const [field, values] of [["mode", current.schema.modes], ["aspect", current.schema.aspects], ["resolution", current.schema.resolutions], ["duration", current.schema.durations]]) options($(`#generation-${field}`), values); $("#generation-audio").checked = current.schema.audio === true; $("#generation-audio").disabled = current.schema.audio === undefined; const controls = modelControlView(current.schema), container = $("#generation-controls"); container.hidden = !controls.length; container.replaceChildren(...controls.map(control => { const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.value = control.id; label.append(input, control.label); return label; })); $("#reference-limit").textContent = `Up to ${current.schema.maxReferences} references`; const qwen = isQwenTtsModel(current); $("#qwen-fields").hidden = !qwen; $("#generate").textContent = qwen ? "Prepare Qwen voice job" : "Generate locally"; $("#generation-safety").textContent = qwen ? "Preparation stores a queued job only. It cannot call Qwen TTS; execution requires a separate server-side authorization." : "Ark generation uses your signed-in account's approved USD allowance. No platform key is required in the workspace."; }
$("#generation-model").onchange = () => renderParameters(snapshot.nodes.find(x => x.id === selected.at(-1)).type);
async function refreshLibrary() { const query = new URLSearchParams({ search: $("#library-search").value, kind: $("#library-kind").value }), [assets, history] = await Promise.all([api(`/api/v1/projects/${projectId}/assets?${query}`), api(`/api/v1/projects/${projectId}/history?${query}`)]); $("#asset-library").replaceChildren(...assets.map(asset => { const li = document.createElement("li"); li.append(`${asset.kind} · ${asset.filename} · ${asset.metadata?.provenance?.operation || asset.role}`); if (asset.mimeType?.startsWith("audio/")) { const audio = document.createElement("audio"); audio.controls = true; audio.preload = "metadata"; audio.src = asset.downloadUrl; audio.setAttribute("aria-label", `${asset.filename} preview`); li.append(audio); } return li; }), ...history.map(run => { const li = document.createElement("li"); li.textContent = `run · ${run.kind} · ${run.state} · ${run.prompt}`; return li; })); }
async function refreshWorkbenchAssets() {
  const kind = $("#workbench-asset-kind").value, assets = await api(`/api/v1/projects/${projectId}/assets?${new URLSearchParams({ kind })}`); if (!assets.some(asset => asset.id === selectedWorkbenchAsset)) selectedWorkbenchAsset = null;
  $("#workbench-assets").replaceChildren(...assets.map(asset => { const card = document.createElement("article"), preview = asset.kind === "image" ? document.createElement("img") : asset.kind === "video" ? document.createElement("video") : asset.kind === "audio" ? document.createElement("audio") : document.createElement("div"); card.classList.toggle("selected", asset.id === selectedWorkbenchAsset); preview.src = asset.downloadUrl; preview.preload = "metadata"; if (["video", "audio"].includes(asset.kind)) preview.controls = true; if (asset.kind === "image") { preview.alt = asset.filename; preview.loading = "lazy"; } const title = document.createElement("strong"), meta = document.createElement("span"), choose = document.createElement("button"), download = document.createElement("a"); title.textContent = asset.filename; meta.textContent = `${asset.kind} · ${asset.byteLength} bytes`; choose.type = "button"; choose.textContent = asset.id === selectedWorkbenchAsset ? "已选择" : "选择"; choose.onclick = () => { selectedWorkbenchAsset = asset.id; refreshWorkbenchAssets().catch(showError); }; download.href = asset.downloadUrl; download.download = asset.filename; download.textContent = "下载"; card.append(preview, title, meta, choose, download); return card; }));
  $("#workbench-asset-state").textContent = assets.length ? `${assets.length} 个素材${selectedWorkbenchAsset ? " · 已选择 1 个" : ""}` : "当前作品还没有素材，可从上方安全上传。"; $("#bind-workbench-asset").disabled = !selectedWorkbenchAsset || !$("#asset-shot-target").value;
}
function refreshAssetShotTargets() { const select = $("#asset-shot-target"), previous = select.value; select.replaceChildren(...(snapshot.storyboard?.shots || []).map((shot, index) => { const option = document.createElement("option"); option.value = shot.id; option.textContent = `镜头 ${index + 1} · ${snapshot.story.scenes[index]?.title || "未命名"}`; return option; })); if (previous && [...select.options].some(option => option.value === previous)) select.value = previous; $("#bind-workbench-asset").disabled = !selectedWorkbenchAsset || !select.value; }
$("#workbench-asset-kind").onchange = () => refreshWorkbenchAssets().catch(showError);
$("#asset-shot-target").onchange = () => { $("#bind-workbench-asset").disabled = !selectedWorkbenchAsset || !$("#asset-shot-target").value; };
$("#library-refresh").onclick = () => refreshLibrary().catch(showError);
async function uploadReference(file) {
  const response = await fetch(`/api/v1/projects/${projectId}/sessions/${sessionId}/assets/references`, { method: "POST", headers: { "content-type": file.type, "x-filename": file.name, ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) }, body: file });
  const value = await response.json(); if (!response.ok) { const error = new Error(value.error?.message || "Upload failed"); error.code = value.error?.code; throw error; } return value;
}
$("#workbench-asset-upload").onchange = async event => { const input = event.currentTarget, file = input.files?.[0]; if (!file) return; $("#workbench-asset-state").textContent = `正在上传 ${file.name}…`; try { const asset = await uploadReference(file); selectedWorkbenchAsset = asset.id; await Promise.all([refresh(), refreshLibrary()]); await refreshWorkbenchAssets(); $("#workbench-asset-state").textContent = `已安全上传并选择：${asset.filename}`; } catch (error) { $("#workbench-asset-state").textContent = `上传失败：${error.message}`; } finally { input.value = ""; } };
$("#bind-workbench-asset").onclick = async event => { const button = event.currentTarget, shotId = $("#asset-shot-target").value; if (!selectedWorkbenchAsset || !shotId) return; button.disabled = true; $("#workbench-asset-state").textContent = "正在绑定素材到分镜…"; try { const shots = snapshot.storyboard.shots.map(shot => ({ ...shot, referenceAssetIds: shot.id === shotId ? [...new Set([...(shot.referenceAssetIds || []), selectedWorkbenchAsset])] : shot.referenceAssetIds })); const storyboard = await api(`/api/v1/projects/${projectId}/storyboard`, json("PUT", { shots })); await refresh(); renderScriptStoryboard(snapshot.story, storyboard); $("#workbench-asset-state").textContent = "素材已绑定到指定分镜。"; } catch (error) { $("#workbench-asset-state").textContent = `绑定失败：${error.message}`; } finally { button.disabled = false; } };
$("#reference-upload").onchange = async event => {
  const input = event.currentTarget, file = input.files?.[0];
  if (!file) return;
  const state = $("#upload-state");
  state.textContent = `Uploading ${file.name}…`;
  try {
    const value = await uploadReference(file);
    state.textContent = `Uploaded: ${value.filename} · ${value.kind} · ${value.byteLength} bytes`;
    await refresh();
    await refreshLibrary();
  } catch (error) {
    state.textContent = `Error: ${error.code ? `${error.code}: ` : ""}${error.message}`;
  } finally {
    input.value = "";
  }
};
$("#build-story").onclick = async () => { const story = await api(`/api/v1/projects/${projectId}/story`, json("PUT", { title: "Local demo", scenes: [{ title: "Opening" }] })); await api(`/api/v1/projects/${projectId}/storyboard`, json("PUT", { shots: [{ sceneId: story.scenes[0].id, prompt: "Opening", duration: 1 }] })); $("#workflow-state").textContent = "Success: story and shot persisted."; };
function renderStoryboardBatch() { const value = storyboardBatchView(storyboardBatch); $("#storyboard-batch").hidden = !storyboardBatch; $("#storyboard-batch-state").textContent = value.summary; $("#storyboard-batch-jobs").replaceChildren(...value.jobs.map(job => { const item = document.createElement("li"); item.dataset.state = job.state; item.textContent = `Shot ${job.order} · ${job.state} · ${job.prompt}`; return item; })); $("#advance-storyboard-batch").disabled = !value.canAdvance; $("#cancel-storyboard-batch").disabled = !value.canCancel; $("#retry-storyboard-batch").disabled = !value.canRetry; }
async function reloadStoryboardBatch() { if (storyboardBatch) storyboardBatch = await api(`/api/v1/projects/${projectId}/storyboard-batches/${storyboardBatch.id}`); renderStoryboardBatch(); await refresh(); }
$("#start-storyboard-batch").onclick = async () => { storyboardBatch = await api(`/api/v1/projects/${projectId}/storyboard-batches`, json("POST", { sessionId, idempotencyKey: crypto.randomUUID() })); renderStoryboardBatch(); await refresh(); };
$("#advance-storyboard-batch").onclick = async () => { storyboardBatch = await api(`/api/v1/projects/${projectId}/storyboard-batches/${storyboardBatch.id}/tick`, json("POST", {})); renderStoryboardBatch(); await refresh(); };
$("#cancel-storyboard-batch").onclick = async () => { const job = activeStoryboardJob(storyboardBatch); if (job) await api(`/api/v1/jobs/${job.id}/cancel`, json("POST", {})); await reloadStoryboardBatch(); };
$("#retry-storyboard-batch").onclick = async () => { const job = retryableStoryboardJob(storyboardBatch); if (job) await api(`/api/v1/jobs/${job.id}/retry`, json("POST", { idempotencyKey: crypto.randomUUID() })); await reloadStoryboardBatch(); };
$("#export-edl").onclick = async () => { const value = await api(`/api/v1/projects/${projectId}/exports/manifest`); $("#export-download").href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)])); $("#export-download").hidden = false; };
$("#render-export").onclick = async () => { const selection = reviewedExportSelection({ format: $("#render-format").value, quality: $("#render-quality").value, reviewed: $("#render-reviewed").checked }); $("#workflow-state").textContent = "Loading: rendering local MP4 preview…"; const result = await api(`/api/v1/projects/${projectId}/exports/render`, json("POST", selection)); $("#render-download").href = result.asset.downloadUrl; $("#render-download").download = result.asset.filename; $("#render-download").hidden = false; $("#workflow-state").textContent = exportSuccessMessage(result); };
$("#publishing-form").onsubmit = event => { event.preventDefault(); const publishing = { title: $("#publishing-title").value.trim(), copy: $("#publishing-copy").value.trim() }; if (!publishing.title || !publishing.copy) return; localStorage.setItem(publishingKey(), JSON.stringify(publishing)); $("#workbench-final-state").textContent = "标题与发布文案已保存到当前作品的设备草稿。"; };
async function refreshPublishingAccounts() {
  const view = await api("/api/v1/publishing/accounts");
  publishingAccountView = new Map(view.platforms.map(item => [item.platform, item]));
  $("#publishing-destinations").replaceChildren(Object.assign(document.createElement("legend"), { textContent: "发布目标" }), ...view.platforms.map(item => { const label = document.createElement("label"), input = document.createElement("input"), small = document.createElement("small"); input.type = "checkbox"; input.value = item.platform; input.dataset.accountId = item.accountId || ""; input.disabled = !item.canPublish; input.onchange = renderPublishingOverrides; small.textContent = item.canPublish ? item.displayName || "已绑定" : item.status === "connected" ? "暂无发布权限" : "未绑定账号"; label.append(input, publishingLabels[item.platform], small); return label; }));
  const youtube = publishingAccountView.get("youtube_shorts"), accountAction = $("#youtube-publishing-account-action");
  $("#youtube-publishing-account-state").textContent = youtube?.canPublish ? `已绑定 · ${youtube.displayName || "当前频道"}` : youtube?.status === "connected" ? "已连接，但暂无发布权限" : "尚未绑定账号";
  accountAction.textContent = youtube?.canPublish ? "解除绑定" : "连接账号";
  accountAction.disabled = false;
  const tiktok = publishingAccountView.get("tiktok"), tiktokAction = $("#tiktok-publishing-account-action");
  $("#tiktok-publishing-account-state").textContent = tiktok?.canPublish ? `已绑定 · ${tiktok.displayName || "当前账号"}` : tiktok?.status === "connected" ? "已连接，但暂无发布权限" : "尚未绑定账号";
  tiktokAction.textContent = tiktok?.canPublish ? "解除绑定" : "连接账号";
  tiktokAction.disabled = false;
  renderPublishingOverrides();
  const usable = view.platforms.filter(item => item.canPublish).length; $("#publishing-preflight").disabled = usable === 0; $("#publishing-progress").textContent = usable ? `已有 ${usable} 个平台账号可选；发布前仍需逐平台校验与最终确认。` : "尚无具备发布权限的绑定账号；不会自动授权或对外发布。";
}
$("#youtube-publishing-account-action").onclick = async event => { const action = event.currentTarget, account = publishingAccountView.get("youtube_shorts"); action.disabled = true; try { if (account?.canPublish) { if (!window.confirm(`确认解除 YouTube 账号 ${account.displayName || "当前频道"} 的绑定？`)) return; await api(`/api/v1/publishing/accounts/${account.accountId}`, json("DELETE", {})); await refreshPublishingAccounts(); $("#publishing-account-progress").textContent = "YouTube Shorts 账号已解除绑定。"; } else { const oauth = await api("/api/v1/publishing/oauth/youtube_shorts/begin", json("POST", { returnPath: "/" })); window.location.assign(oauth.authorizationUrl); } } catch (error) { $("#publishing-account-progress").textContent = `账号操作失败：${error.message}`; } finally { action.disabled = false; } };
$("#tiktok-publishing-account-action").onclick = async event => { const action = event.currentTarget, account = publishingAccountView.get("tiktok"); action.disabled = true; try { if (account?.canPublish) { if (!window.confirm(`确认解除 TikTok 账号 ${account.displayName || "当前账号"} 的绑定？`)) return; await api(`/api/v1/publishing/accounts/${account.accountId}`, json("DELETE", {})); await refreshPublishingAccounts(); $("#publishing-account-progress").textContent = "TikTok 账号已解除绑定。"; } else { const oauth = await api("/api/v1/publishing/oauth/tiktok/begin", json("POST", { returnPath: "/" })); window.location.assign(oauth.authorizationUrl); } } catch (error) { $("#publishing-account-progress").textContent = `账号操作失败：${error.message}`; } finally { action.disabled = false; } };
let publishingBatchId = null;
$("#publishing-preflight").onclick = async event => {
  const button = event.currentTarget, preview = finalPreview(snapshot), destinations = [...document.querySelectorAll("#publishing-destinations input:checked")].map(input => ({ platform: input.value, accountId: input.dataset.accountId, metadata: publishingMetadata(input.value) })), title = $("#publishing-title").value.trim(), copy = $("#publishing-copy").value.trim();
  if (!preview.asset || !destinations.length || !title || !copy) { $("#publishing-progress").textContent = "请选择已绑定目标，并确保 MP4、标题和发布文案均已就绪。"; return; }
  button.disabled = true; $("#publishing-progress").textContent = "正在创建批次并逐平台校验（不会发布）…";
  try { const created = await api("/api/v1/publishing/batches", json("POST", { projectId, assetId: preview.asset.id, assetSha256: preview.asset.metadata?.sha256, intentKey: `reviewed:${preview.asset.id}:${title}`, title, copy, destinations })); const checked = await api(`/api/v1/publishing/batches/${created.id}/validate`, json("POST", {})); renderPublishingBatch(checked); }
  catch (error) { publishingBatchId = null; $("#publishing-progress").textContent = `预检失败：${error.message}`; button.disabled = false; }
};
$("#publishing-recover").onclick = async () => { const id = publishingBatchId || localStorage.getItem(publishingBatchKey()); if (!id) return; try { $("#publishing-progress").textContent = "正在恢复最近批次…"; renderPublishingBatch(await api(`/api/v1/publishing/batches/${id}`)); } catch (error) { $("#publishing-progress").textContent = `恢复失败：${error.message}`; } };
$("#workbench-export").onclick = async event => { const button = event.currentTarget; button.disabled = true; try { const selection = reviewedExportSelection({ format: "mp4", quality: "preview-360p", reviewed: $("#workbench-export-reviewed").checked }); $("#workbench-final-state").textContent = "正在渲染本地 MP4 成片…"; const result = await api(`/api/v1/projects/${projectId}/exports/render`, json("POST", selection)); $("#workbench-download").href = result.asset.downloadUrl; $("#workbench-download").download = result.asset.filename; $("#workbench-download").hidden = false; await refresh(); $("#workbench-final-state").textContent = `MP4 已就绪 · ${result.duration} 秒 · ${result.asset.byteLength} bytes`; } catch (error) { $("#workbench-final-state").textContent = `导出失败：${error.message}`; } finally { button.disabled = !finalPreview(snapshot).canExport; } };
async function openProject(nextProjectId) {
  projectId = nextProjectId; selected = []; selectedGraph = null; selectedWorkbenchAsset = null; commercialQuote = null; commercialJob = null; snapshot = await api(`/api/v1/projects/${projectId}`);
  localStorage.setItem("openreel:current-project", projectId);
  let session = snapshot.sessions.find(item => item.status === "active");
  if (!session) {
    session = await api(`/api/v1/projects/${projectId}/sessions`, json("POST", { name: "Main canvas" }));
    snapshot = await api(`/api/v1/projects/${projectId}`);
  }
  sessionId = session.id;
  storyboardBatch = (await api(`/api/v1/projects/${projectId}/storyboard-batches`))[0] || null; $("#project-name").textContent = `/ ${snapshot.project.name}`;
  $("#creative-current-project").textContent = snapshot.project.name; $("#creative-current-confirm").checked = false; refreshCreativeTarget();
  $("#short-video-flow").hidden = !snapshot.story?.hooks?.length; $("#script-editor").hidden = true; $("#storyboard-editor").hidden = true;
  renderStoryboardBatch(); render(); if (snapshot.story?.hooks?.length && snapshot.storyboard?.shots?.length) { renderScriptStoryboard(snapshot.story, snapshot.storyboard); restoreEditorDraft(); }
  refreshAssetShotTargets(); renderCommercialJob(); await Promise.all([refreshLibrary(), refreshWorkbenchAssets(), refreshProjectShelf(), recoverCommercialJob()]); $("#workflow-state").textContent = `Ready: ${models.filter(model => model.adapterId === "ark").length} Ark models available.`;
}
async function bootstrap() { $("#workflow-state").textContent = "Loading: recovering workspace…"; [models] = await Promise.all([api("/api/v1/models"), refreshPublishingAccounts()]); refreshWorkbenchModelRoute(); const projects = await api("/api/v1/projects"), remembered = localStorage.getItem("openreel:current-project"); const project = projects.find(item => item.id === remembered && item.status === "active") || projects.find(item => item.status === "active") || await api("/api/v1/projects", json("POST", { name: "Local demo" })); await openProject(project.id); }
function showAuth(mode = "login", message = "") { $("#auth-shell").hidden = false; $("#workspace-shell").hidden = true; $("#login-form").hidden = mode !== "login"; $("#register-form").hidden = mode !== "register"; $("#show-login").classList.toggle("active", mode === "login"); $("#show-register").classList.toggle("active", mode === "register"); $("#auth-state").textContent = message || (mode === "login" ? "Sign in to continue." : "Create an account to start a workspace."); }
async function showWorkspace() { $("#auth-shell").hidden = true; $("#workspace-shell").hidden = false; if (!workspaceStarted) { workspaceStarted = true; try { await bootstrap(); } catch (error) { workspaceStarted = false; throw error; } } setWorkspacePage(routeFromHash(), { replace: true }); }
async function establishSession(email, password) { const value = await api("/api/v1/auth/login", json("POST", { email, password })); csrfToken = value.csrfToken; await showWorkspace(); }
$("#show-login").onclick = () => showAuth("login");
$("#show-register").onclick = () => showAuth("register");
$("#product-feedback").onclick = () => { $("#feedback-state").textContent = ""; $("#feedback-dialog").showModal(); };
$("#feedback-form").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { await api("/api/v1/feedback", json("POST", { category: $("#feedback-category").value, rating: Number($("#feedback-rating").value), comment: $("#feedback-comment").value.trim() })); event.currentTarget.reset(); $("#feedback-state").textContent = "已收到，谢谢你的反馈。"; } catch (error) { $("#feedback-state").textContent = `提交失败：${error.message}`; } finally { button.disabled = false; } });
$("#login-form").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { await establishSession($("#login-email").value, $("#login-password").value); } catch (error) { showAuth("login", error.message); } finally { button.disabled = false; } });
$("#register-form").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter, email = $("#register-email").value, password = $("#register-password").value; button.disabled = true; try { await api("/api/v1/auth/register", json("POST", { email, password })); await establishSession(email, password); } catch (error) { showAuth("register", error.message); } finally { button.disabled = false; } });
$("#logout").onclick = async () => { try { await api("/api/v1/auth/logout", json("POST", {})); } finally { csrfToken = ""; workspaceStarted = false; projectId = sessionId = undefined; showAuth("login", "Signed out."); } };
async function bootstrapAuth() { try { await api("/api/v1/auth/me"); csrfToken = (await api("/api/v1/auth/csrf")).csrfToken; await showWorkspace(); } catch { showAuth("login"); } }
async function api(path, options = {}) { const method = options.method || "GET", headers = { "content-type": "application/json", ...(options.headers || {}) }; if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method) && csrfToken) headers["x-csrf-token"] = csrfToken; const response = await fetch(path, { ...options, headers }); const contentType = response.headers.get("content-type") || "", value = contentType.includes("json") ? await response.json() : null; if (!response.ok) { const error = new Error(value?.error?.message || `请求失败（HTTP ${response.status}）`); error.code = value?.error?.code || "HTTP_ERROR"; error.status = response.status; error.details = value?.error?.details; throw error; } if (value === null) { const error = new Error("服务器返回了无法识别的响应"); error.code = "INVALID_RESPONSE"; error.status = response.status; throw error; } return value; }
const json = (method, body) => ({ method, body: JSON.stringify(body) }); const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]); const showError = error => { const conflict = collaborationConflictView(error); if (conflict) { $("#collaboration-conflict-title").textContent = conflict.title; $("#collaboration-conflict-message").textContent = conflict.message; $("#reload-collaboration").textContent = conflict.action; $("#collaboration-conflict").hidden = false; } $("#workflow-state").textContent = `Error: ${error.code ? `${error.code}: ` : ""}${error.message}`; };
bootstrapAuth().catch(showError);
