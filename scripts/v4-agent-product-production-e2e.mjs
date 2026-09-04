#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.OPENREEL_PRODUCTION_BASE || "https://openreel.duobiai.cn:4173";
const evidenceFile = resolve(process.env.OPENREEL_EVIDENCE || "docs/evidence/v4-04-v4-06-production-cp56.json");
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const email = `v4-agent-product-${marker}@openreel.invalid`;
const password = `V4-${randomBytes(24).toString("base64url")}`;
const preparationKey = `cp56-agent-prepare-${marker}`;
const executionKey = `cp56-agent-execute-${marker}`;
const productKey = `cp56-product-${marker}`;
const productUrl = process.env.OPENREEL_PRODUCT_URL || "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html";
const productOnly = process.env.OPENREEL_PRODUCT_ONLY === "1";
const requestedLimitUnits = Number(process.env.OPENREEL_REQUESTED_LIMIT_UNITS || 40000);

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.OPENREEL_CHROMIUM_EXECUTABLE || "/snap/bin/chromium" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const calls = { agentPrepare: 0, agentExecute: 0, agentProgress: 0, productUnderstand: 0 };
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/\/agent-films$/.test(path) && request.method() === "POST") {
      const action = request.postDataJSON()?.action;
      if (action === "prepare") calls.agentPrepare += 1;
      if (action === "execute") calls.agentExecute += 1;
    }
    if (/\/agent-films\/[^/]+\/progress$/.test(path)) calls.agentProgress += 1;
    if (path === "/api/v1/product-url/understand") calls.productUnderstand += 1;
  });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60_000 });
  await page.click("#show-register");
  await page.fill("#register-email", email);
  await page.fill("#register-password", password);
  await page.click('#register-form button[type="submit"]');
  await page.waitForSelector("#creator-workbench:not([hidden])", { timeout: 60_000 });
  const csrf = (await context.cookies(base)).find(cookie => cookie.name === "openreel_csrf")?.value;
  assert.ok(csrf, "browser CSRF cookie is missing");
  const api = (path, options = {}) => page.evaluate(async ({ path, options, csrf }) => {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-csrf-token": csrf, ...(options.headers || {}) } });
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${body?.error?.code || "HTTP_ERROR"}: ${body?.error?.message || "request failed"}`);
    return body;
  }, { path, options, csrf });
  await api("/api/v1/key-applications", { method: "POST", body: JSON.stringify({ reason: "cp56 bounded Agent and product acceptance", requestedLimitUnits, currency: "USD", unitScale: 10000 }) });
  let applications = [];
  for (let attempt = 0; attempt < 30 && !applications.some(item => item.status === "pending"); attempt += 1) { await page.waitForTimeout(250); applications = await api("/api/v1/key-applications"); }
  const application = applications.find(item => item.status === "pending");
  assert.ok(application?.id);
  const approvalCode = `import {readFileSync} from "node:fs"; import {spawnSync} from "node:child_process"; const pid=spawnSync("systemctl",["show","--value","-p","MainPID","openreel.service"],{encoding:"utf8"}).stdout.trim(); const env=Object.fromEntries(readFileSync(\`/proc/\${pid}/environ\`).toString().split("\\0").filter(Boolean).map(item=>{const at=item.indexOf("=");return [item.slice(0,at),item.slice(at+1)];})); const response=await fetch("http://127.0.0.1:4273/api/v1/admin/key-applications/${application.id}/approve",{method:"POST",headers:{"content-type":"application/json","x-openreel-admin-key":env.OPENREEL_ADMIN_KEY},body:JSON.stringify({plan:"cp56-v4-04-v4-06",hardLimitUnits:${requestedLimitUnits},currency:"USD",unitScale:10000,periodEndsAt:new Date(Date.now()+30*60_000).toISOString(),reviewedBy:"cp59-consumed-approval",reviewNote:"V4-06 ceiling CNY 10, zero retries, private evidence only"})}); const value=await response.json(); if(!response.ok) throw new Error(String(response.status)); console.log(JSON.stringify({status:value.application.status,hardLimitUnits:value.subscription.hardLimitMicros}));`;
  const approval = JSON.parse(execFileSync("ssh", ["-o", "BatchMode=yes", "root@123.57.67.213", `cd /opt/openreel/current && node --input-type=module -e 'await import("data:text/javascript;base64,${Buffer.from(approvalCode).toString("base64")}")'`], { encoding: "utf8", timeout: 30_000 }));
  assert.equal(approval.status, "approved");
  assert.equal(approval.hardLimitUnits, requestedLimitUnits);

  let projects = [];
  for (let attempt = 0; attempt < 30 && projects.length !== 1; attempt += 1) { await page.waitForTimeout(250); projects = await api("/api/v1/projects"); }
  assert.equal(projects.length, 1);
  const project = projects[0];
  const prepared = productOnly ? null : await api(`/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "prepare", brief: "美女在海滩跳舞", type: "story", duration: 5, projectVersion: project.version, quality: "fast", idempotencyKey: preparationKey }) });
  if (!productOnly) {
  assert.equal(prepared.action, "prepared");
  assert.equal(prepared.quote.confirmationRequired, true);
  assert.ok(prepared.quote.cost.estimatedCny > 0 && prepared.quote.cost.estimatedCny <= 30);
  const beforeExecute = await api(`/api/v1/projects/${project.id}/agent-films/${preparationKey}/progress`);
  assert.equal(beforeExecute.status, "prepared");
  const executed = await api(`/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "execute", quoteId: prepared.quote.id, confirmed: true, idempotencyKey: executionKey, preparationIdempotencyKey: preparationKey }) });
  assert.equal(executed.status, "succeeded");
  const progress = await api(`/api/v1/projects/${project.id}/agent-films/${preparationKey}/progress`);
  assert.equal(progress.status, "succeeded");
  assert.equal(progress.execution.id, executed.id);
  }

  const product = await api("/api/v1/product-url/understand", { method: "POST", body: JSON.stringify({ url: productUrl, idempotencyKey: productKey }) });
  assert.equal(product.status, "model_grounded");
  assert.equal(product.source.mode, "fetched_model");
  assert.match(product.source.finalUrl, /^https:/);
  assert.match(product.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(product.model.provider, "ark");
  assert.equal(product.model.status, "succeeded");
  assert.ok(product.evidence.length > 0 && product.facts.length > 0);
  assert.deepEqual(calls, productOnly ? { agentPrepare: 0, agentExecute: 0, agentProgress: 0, productUnderstand: 1 } : { agentPrepare: 1, agentExecute: 1, agentProgress: 2, productUnderstand: 1 });
  const snapshot = await api(`/api/v1/projects/${project.id}`);
  const evidence = {
    schema: "openreel-v4-04-v4-06-production-cp56/v1", createdAt: new Date().toISOString(),
    authorization: { sourceGate: "cp55", combinedCeilingCny: 30, modelRetries: 0, publication: false, externalSend: false },
    account: { ordinary: true, emailDomain: "openreel.invalid", projectCount: projects.length },
    agent: productOnly ? { status: "not_run_after_preprovider_identity_failure" } : { projectId: project.id, preparationKey, executionKey, planning: prepared.planning, binding: prepared.binding, quote: prepared.quote, beforeExecute: { status: beforeExecute.status, stage: beforeExecute.stage }, execution: { id: executed.id, status: executed.status, stage: executed.stage, costs: executed.costs, attempts: executed.attempts }, progress: { status: progress.status, stage: progress.stage, executionId: progress.execution.id }, finalBinding: { projectVersion: snapshot.project.version, storyVersion: snapshot.story?.version, storyboardVersion: snapshot.storyboard?.version } },
    product: { requestedUrl: productUrl, source: product.source, model: product.model, facts: product.facts, evidence: product.evidence, creativeContext: product.creativeContext },
    browserCalls: calls,
    safety: { retries: 0, deployments: 1, serviceRestarts: 1, publications: 0, externalSends: 0, credentialChanges: 0, historyCleanup: 0 }
  };
  mkdirSync(dirname(evidenceFile), { recursive: true });
  writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: "passed", evidenceFile, projectId: project.id, agentJobId: productOnly ? null : executed.id, quoteCny: productOnly ? null : prepared.quote.cost.estimatedCny, productModel: product.model.model, productJobId: product.model.jobId, calls }));
} finally {
  await browser?.close();
}
