export const NODE_TYPES = Object.freeze(["text", "image", "video", "audio", "script"]);

const defaults = {
  text: ["Text", "Write a note or prompt…"],
  image: ["Image", "Drop an image reference here"],
  video: ["Video", "Video source or generation brief"],
  audio: ["Audio", "Voice, music, or sound direction"],
  script: ["Script", "Scene 1 — describe the opening shot"]
};

export function createNode(type, position = { x: 0, y: 0 }, id = crypto.randomUUID()) {
  if (!NODE_TYPES.includes(type)) throw new TypeError(`Unsupported node type: ${type}`);
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("Node position must be finite");
  return { id, type, title: defaults[type][0], content: defaults[type][1], position: { x, y }, status: "draft" };
}

export function updateNode(nodes, id, patch) {
  return nodes.map((node) => node.id === id ? {
    ...node,
    ...patch,
    position: patch.position ? { ...node.position, ...patch.position } : node.position,
    id: node.id,
    type: node.type
  } : node);
}
