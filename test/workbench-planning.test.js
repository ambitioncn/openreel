import test from "node:test";
import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";
import { parsePlanningResult, planningPrompt } from "../src/workbench-planning.js";

const result = JSON.stringify({ title: "海滩舞蹈", synopsis: "一段全新的海滩舞蹈", hooks: ["迎着海风起舞", "浪花就是节拍", "定格夕阳一刻"], selectedHook: 0, shots: [{ title: "开场", line: "舞蹈开始", visual: "9:16 wide shot of a dancer on a beach", broll: "Waves", duration: 10 }, { title: "收尾", line: "定格最后姿态", visual: "9:16 medium shot at sunset", broll: "", duration: 5 }] });
const englishResult = JSON.stringify({ title: "Beach dance", synopsis: "A new beach dance", hooks: ["One", "Two", "Three"], selectedHook: 0, shots: [{ title: "Opening", line: "Dance begins", visual: "9:16 wide shot of a dancer on a beach", broll: "Waves", duration: 10 }, { title: "Finish", line: "Final pose", visual: "9:16 medium shot at sunset", broll: "", duration: 5 }] });

test("planning contract rejects malformed or duration-mismatched model output", () => {
  assert.match(planningPrompt({ brief: "美女在海滩跳舞", type: "story", duration: 15 }), /Return JSON only/);
  assert.match(planningPrompt({ brief: "美女在海滩跳舞", type: "story", duration: 15 }), /must remain in Chinese/);
  assert.throws(() => parsePlanningResult("not json", 15), error => error.code === "MODEL_OUTPUT_INVALID");
  assert.throws(() => parsePlanningResult(result, 14), error => error.code === "MODEL_OUTPUT_INVALID");
  assert.equal(parsePlanningResult(result, 15).shots.length, 2);
  assert.equal(parsePlanningResult(result.replace('"selectedHook":0', '"selectedHook":2'), 15).selectedHook, 2);
  assert.throws(() => parsePlanningResult(result.replace('"selectedHook":0', '"selectedHook":3'), 15), error => error.code === "MODEL_OUTPUT_INVALID");
  assert.throws(() => parsePlanningResult(result.replace('"舞蹈开始"', '""'), 15), error => error.code === "MODEL_OUTPUT_INVALID" && error.status === 502);
  assert.throws(() => parsePlanningResult(result.replace('"duration":10', '"duration":1'), 6), error => error.code === "MODEL_OUTPUT_INVALID");
});

test("15-second product planning requires three five-second shots", () => {
  const prompt = planningPrompt({ brief: "A premium bottle ad", type: "product", duration: 15 });
  assert.match(prompt, /Exactly three shots of 5 seconds each: reveal, detail, and final hold/);
});

test("Chinese brief rejects English user-facing planning text", () => {
  assert.throws(() => parsePlanningResult(englishResult, 15, "zh-Hans"), error => error.code === "MODEL_OUTPUT_INVALID" && /Chinese brief/.test(error.message));
  assert.equal(parsePlanningResult(result, 15, "zh-Hans").shots[0].line, "舞蹈开始");
});

test("workbench planning repairs English output for a Chinese brief once", async t => {
  const calls = [], arkService = {
    models: () => [{ name: "seed-2.1-pro", capability: "text" }],
    submit: async (_principal, request) => { calls.push(request); return { id: `language-repair-${calls.length}`, model: request.model, capability: "text", status: "succeeded", result: { content: calls.length === 1 ? englishResult : result }, updatedAt: "2026-08-25T00:00:00.000Z" }; }
  };
  const server = createOpenReelServer(undefined, undefined, { arkService });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, send = async (path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
  const project = (await send("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Language repair" }) })).body;
  const planned = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "美女在海滩跳舞", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "language-repair" }) });
  assert.equal(planned.status, 201); assert.equal(planned.body.planning.attempts, 2); assert.equal(planned.body.story.scenes[0].summary, "舞蹈开始");
  assert.match(calls[1].input.prompt, /Chinese brief requires Chinese user-facing planning text/); assert.equal(calls[1].input.temperature, 0);
});

test("authenticated workbench planning uses a real model job and binds the result versions", async t => {
  const calls = [], arkService = {
    models: () => [{ name: "seed-2.1-pro", capability: "text" }],
    submit: async (principal, request) => { calls.push({ principal, request }); return { id: "ark-plan-1", model: request.model, capability: "text", status: "succeeded", result: { content: result }, usage: { inputTokens: 50, outputTokens: 80, costMicros: 7, currency: "CNY", unitScale: 1_000_000, pricingVersion: "2026-08" }, updatedAt: "2026-08-21T00:00:00.000Z" }; }
  };
  const server = createOpenReelServer(undefined, undefined, { arkService });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, send = async (path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
  const project = (await send("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "New work" }) })).body;
  const planned = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "美女在海滩跳舞", sourceContext: "美女在海滩跳舞", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "plan-1" }) });
  assert.equal(planned.status, 201); assert.equal(planned.body.planning.model, "seed-2.1-pro"); assert.equal(planned.body.planning.cost.costMicros, 7); assert.equal(planned.body.binding.projectId, project.id); assert.equal(planned.body.binding.storyVersion, 1); assert.equal(planned.body.binding.storyboardVersion, 1);
  assert.match(calls[0].request.input.prompt, new RegExp(`projectId=${project.id}`));
  assert.equal(calls[0].request.input.disableThinking, true);
  const stale = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "x", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "plan-2" }) });
  assert.equal(stale.status, 409); assert.equal(calls.length, 1);
});

test("production can pin a reviewed workbench planning model instead of selecting catalog order", async t => {
  const calls = [], arkService = {
    models: () => [{ name: "seed-2.1-turbo", capability: "text" }, { name: "seed-2.1-pro", capability: "text" }],
    submit: async (principal, request) => { calls.push(request.model); return { id: "ark-plan-pinned", model: request.model, capability: "text", status: "succeeded", result: { content: result }, usage: { inputTokens: 1, outputTokens: 1, costMicros: 1, currency: "USD", unitScale: 10_000, pricingVersion: "2026-08" }, updatedAt: "2026-08-22T00:00:00.000Z" }; }
  };
  const server = createOpenReelServer(undefined, undefined, { arkService, workbenchPlanningModel: "seed-2.1-pro" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, send = async (path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
  const project = (await send("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Pinned planning" }) })).body;
  const planned = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "美女在海滩跳舞", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "pinned-plan" }) });
  assert.equal(planned.status, 201);
  assert.deepEqual(calls, ["seed-2.1-pro"]);
  assert.equal(planned.body.planning.model, "seed-2.1-pro");
});

test("workbench planning repairs one invalid model response with a bounded deterministic attempt", async t => {
  const calls = [], arkService = {
    models: () => [{ name: "seed-2.1-pro", capability: "text" }],
    submit: async (_principal, request) => { calls.push(request); return { id: `repair-${calls.length}`, model: request.model, capability: "text", status: "succeeded", result: { content: calls.length === 1 ? "not json" : result }, usage: { costMicros: 1, currency: "CNY", unitScale: 1_000_000 }, updatedAt: "2026-08-22T00:00:00.000Z" }; }
  };
  const server = createOpenReelServer(undefined, undefined, { arkService });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, send = async (path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
  const project = (await send("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Repair" }) })).body;
  const planned = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "美女在海滩跳舞", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "repair-plan" }) });
  assert.equal(planned.status, 201); assert.equal(planned.body.planning.attempts, 2); assert.equal(calls.length, 2);
  assert.equal(calls[1].input.temperature, 0); assert.match(calls[1].input.prompt, /text model did not return valid planning JSON/); assert.match(calls[1].input.prompt, /totaling exactly 15 seconds/);
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
});

test("workbench planning repair identifies a duration-total mismatch", async t => {
  const calls = [], mismatched = result.replace('"duration":5', '"duration":10');
  const arkService = { models: () => [{ name: "seed-2.1-pro", capability: "text" }], submit: async (_principal, request) => { calls.push(request); return { id: `duration-repair-${calls.length}`, model: request.model, capability: "text", status: "succeeded", result: { content: calls.length === 1 ? mismatched : result }, updatedAt: "2026-08-23T00:00:00.000Z" }; } };
  const server = createOpenReelServer(undefined, undefined, { arkService });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, send = async (path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
  const project = (await send("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Duration repair" }) })).body;
  const planned = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "美女在海滩跳舞", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "duration-repair" }) });
  assert.equal(planned.status, 201); assert.equal(planned.body.planning.attempts, 2);
  assert.match(calls[1].input.prompt, /shot durations do not match the requested duration/); assert.match(calls[1].input.prompt, /totaling exactly 15 seconds/);
});

test("workbench planning stops after two invalid model responses", async t => {
  let calls = 0; const arkService = { models: () => [{ name: "seed-2.1-pro", capability: "text" }], submit: async request => { calls += 1; return { id: `invalid-${calls}`, model: request.model, status: "succeeded", result: { content: "still not json" } }; } };
  const server = createOpenReelServer(undefined, undefined, { arkService });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, send = async (path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
  const project = (await send("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Bounded" }) })).body;
  const planned = await send(`/api/v1/projects/${project.id}/workbench-plan`, { method: "POST", body: JSON.stringify({ brief: "美女在海滩跳舞", type: "story", duration: 15, projectVersion: project.version, idempotencyKey: "bounded-plan" }) });
  assert.equal(planned.status, 502); assert.equal(planned.body.error.code, "MODEL_OUTPUT_INVALID"); assert.equal(calls, 2);
});
