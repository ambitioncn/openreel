const CONTROL_LABELS = Object.freeze({
  "ordered-references": "Preserve reference order",
  camera: "Camera controls",
  "generated-audio": "Generated audio",
  voice: "Voice controls",
  speed: "Voice speed",
  pitch: "Voice pitch",
  volume: "Voice volume",
  "sample-rate": "Audio sample rate",
  "audio-format": "Audio format"
});

export function modelControlView(schema = {}) {
  if (!Array.isArray(schema.controls)) return [];
  return [...new Set(schema.controls)]
    .filter(control => typeof control === "string" && CONTROL_LABELS[control])
    .map(control => Object.freeze({ id: control, label: CONTROL_LABELS[control] }));
}

export function selectedModelControls(schema, selected = []) {
  const allowed = new Set(modelControlView(schema).map(control => control.id));
  return Object.fromEntries([...new Set(selected)].filter(control => allowed.has(control)).map(control => [control, true]));
}
