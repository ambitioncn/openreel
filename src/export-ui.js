export const LOCAL_EXPORT_LIMITS = Object.freeze({ maxClips: 100, maxDuration: 600 });

export function reviewedExportSelection(input = {}) {
  if (!input.reviewed) throw new Error("Review the timeline before rendering");
  if (input.format !== "mp4" || input.quality !== "preview-360p") throw new Error("Local export supports only MP4 at preview 360p");
  return { format: "mp4", quality: "preview-360p" };
}

export function exportSuccessMessage(result) {
  return `Success: ${result.replayed ? "reused" : "rendered"} ${result.format} ${result.quality} preview · ${result.duration}s · ${result.asset.byteLength} bytes.`;
}
