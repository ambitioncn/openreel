export class AdapterGateError extends Error {
  constructor(code, message) { super(message); this.name = "AdapterGateError"; this.code = code; }
}

export function createAdapterRegistry(adapters = [localAdapter]) {
  const entries = new Map(adapters.map(adapter => [adapter.id, adapter]));
  return Object.freeze({
    list: () => [...entries.values()].map(({ execute, ...schema }) => structuredClone(schema)),
    schema: id => { const adapter = entries.get(id); if (!adapter) throw new AdapterGateError("ADAPTER_NOT_FOUND", `adapter ${id} is not registered`); const { execute, ...schema } = adapter; return structuredClone(schema); },
    execute: (id, request, context = {}) => { const adapter = entries.get(id); if (!adapter) throw new AdapterGateError("ADAPTER_NOT_FOUND", `adapter ${id} is not registered`); if (adapter.requiresCredential && !context.credential) throw new AdapterGateError("CREDENTIAL_REQUIRED", `${id} requires an explicit credential`); if (adapter.costed && context.approvedBudgetCents == null) throw new AdapterGateError("COST_APPROVAL_REQUIRED", `${id} requires an approved budget`); validateCapability(adapter, request); const result = adapter.execute(request, context); if (!result || result.adapterId !== id || result.kind !== request.kind) throw new AdapterGateError("INVALID_ADAPTER_RESULT", `${id} returned an invalid result`); return result; }
  });
}

export function validateCapability(adapter, request) {
  if (!Object.keys(adapter.capabilities || {}).length) return;
  const schema = adapter.capabilities?.[request.kind];
  if (!schema) throw new AdapterGateError("UNSUPPORTED_CAPABILITY", `${adapter.id} does not support ${request.kind}`);
  const mode = request.mode || `text-to-${request.kind}`;
  for (const [field, allowed] of [["mode", schema.modes], ["aspect", schema.aspects], ["resolution", schema.resolutions], ["duration", schema.durations]]) {
    const value = field === "mode" ? mode : request[field];
    if (value !== undefined && allowed && !allowed.includes(value)) throw new AdapterGateError("INCOMPATIBLE_PARAMETERS", `${field} is incompatible with ${adapter.id}`, { field, value, allowed });
  }
  if (request.audio !== undefined && schema.audio !== undefined && request.audio !== schema.audio) throw new AdapterGateError("INCOMPATIBLE_PARAMETERS", `audio=${request.audio} is incompatible with ${adapter.id}`);
  if ((request.referenceAssetIds?.length || 0) > (schema.maxReferences ?? 0)) throw new AdapterGateError("INCOMPATIBLE_PARAMETERS", `reference count exceeds ${schema.maxReferences}`);
}

export const localAdapter = Object.freeze({
  id: "local-deterministic",
  provider: "local",
  requiresCredential: false,
  costed: false,
  capabilities: {
    image: { modes: ["text-to-image"], aspects: ["16:9", "1:1"], resolutions: ["640x360", "512x512"], maxReferences: 4 },
    video: { modes: ["text-to-video"], aspects: ["16:9"], resolutions: ["160x90"], durations: [0.5], audio: true, maxReferences: 2 },
    audio: { modes: ["text-to-audio"], durations: [1, 2, 4], maxReferences: 1 }
  },
  execute(request = {}) { if (!this.capabilities[request.kind] || !request.prompt?.trim()) throw new AdapterGateError("INVALID_ADAPTER_REQUEST", "supported kind and prompt are required"); return { adapterId: "local-deterministic", kind: request.kind, deterministic: true, prompt: request.prompt.trim() }; }
});

export function optionalProviderAdapter({ id, provider, execute = () => ({}) }) {
  return Object.freeze({ id, provider, requiresCredential: true, costed: true, capabilities: {}, execute });
}
