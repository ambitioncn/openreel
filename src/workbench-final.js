export function publishingDraft(story = {}, projectName = "OpenReel 作品") {
  const hook = story.hooks?.[story.selectedHook] || story.synopsis || projectName;
  const title = (story.title || projectName).trim().slice(0, 80);
  const summary = String(story.synopsis || hook).trim().replace(/\s+/g, " ").slice(0, 180);
  return { title, copy: `${hook}\n\n${summary}\n\n#短视频 #OpenReel`.slice(0, 1000) };
}

export function finalPreview(snapshot = {}) {
  const renders = (snapshot.assets || []).filter(asset => asset.role === "render" && asset.mimeType === "video/mp4");
  return { asset: renders.at(-1) || null, canExport: (snapshot.timeline?.tracks || []).some(track => track.clips?.length) };
}
