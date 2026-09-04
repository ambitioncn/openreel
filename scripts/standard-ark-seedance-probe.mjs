import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
const SAFE_PARAM = /^[A-Za-z0-9_.[\]-]{1,120}$/;
const SENSITIVE = /(?:bearer\s+|api[_ -]?key|secret|token|authorization|request[ _-]?id|ark-[A-Za-z0-9_-]{8,}|https?:\/\/)/i;

function safeText(value, pattern, maximum) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maximum && pattern.test(normalized) ? normalized : null;
}

export function safeArkFailure({ status, headers, bodyText }) {
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
  const requestId = ["x-request-id", "request-id", "x-tt-logid"]
    .map(name => headers?.get?.(name))
    .find(value => typeof value === "string" && value.length > 0);
  let source = null;
  try {
    const parsed = JSON.parse(typeof bodyText === "string" && bodyText.length <= 32_768 ? bodyText : "");
    source = parsed?.error && typeof parsed.error === "object" ? parsed.error : parsed;
  } catch {}
  const providerCode = safeText(source?.code, SAFE_CODE, 80);
  const providerParam = safeText(source?.param, SAFE_PARAM, 120);
  const candidateMessage = safeText(source?.message, /^[^\r\n]+$/, 240);
  const providerMessage = candidateMessage && !SENSITIVE.test(candidateMessage) ? candidateMessage : null;
  return {
    outcome: "failed",
    classification: httpStatus === 401 || httpStatus === 403 ? "provider_auth_error" : "provider_http_error",
    httpStatus,
    ...(providerCode ? { providerCode } : {}),
    ...(providerParam ? { providerParam } : {}),
    ...(providerMessage ? { providerMessage } : {}),
    ...(requestId ? { providerRequestIdHash: createHash("sha256").update(requestId).digest("hex").slice(0, 16) } : {})
  };
}

export async function runStandardArkProbe({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (env.OPENREEL_STANDARD_ARK_PROBE_CONFIRM !== "SUBMIT_ONE_STANDARD_ARK_PROBE") {
    return { outcome: "not_submitted", classification: "confirmation_missing", submissions: 0 };
  }
  const endpoint = env.OPENREEL_STANDARD_ARK_SEEDANCE_ENDPOINT;
  const apiKey = env.OPENREEL_STANDARD_ARK_API_KEY;
  const model = env.OPENREEL_STANDARD_ARK_SEEDANCE_MODEL;
  if (!endpoint || !apiKey || !model) return { outcome: "not_submitted", classification: "configuration_missing", submissions: 0 };
  const response = await fetchImpl(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, content: [{ type: "text", text: "A folded abstract scarf gently moves onto an empty wall hook." }], duration: 5, resolution: "480p", ratio: "16:9", generate_audio: false })
  });
  const bodyText = await response.text();
  if (!response.ok) return { submissions: 1, ...safeArkFailure({ status: response.status, headers: response.headers, bodyText }) };
  let payload;
  try { payload = JSON.parse(bodyText); } catch { return { outcome: "failed", classification: "invalid_provider_response", httpStatus: response.status, submissions: 1 }; }
  const taskId = safeText(payload?.id ?? payload?.task_id, /^[A-Za-z0-9_.:-]+$/, 160);
  return { outcome: "accepted", classification: "provider_task_created", httpStatus: response.status, submissions: 1, ...(taskId ? { providerTaskIdHash: createHash("sha256").update(taskId).digest("hex").slice(0, 16) } : {}) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runStandardArkProbe().then(result => process.stdout.write(`${JSON.stringify(result)}\n`), error => {
    process.stdout.write(`${JSON.stringify({ outcome: "failed", classification: "transport_error", submissions: 0 })}\n`);
    process.exitCode = 1;
  });
}
