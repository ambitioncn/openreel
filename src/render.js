import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { DomainError } from "./core.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const renderFailure = (message, result) => {
  const stderr = result.stderr?.toString().trim() || "";
  const rendererDiagnostic = /decod|inflate|invalid data/i.test(stderr) ? "RENDER_INPUT_DECODE_FAILED" : "RENDER_EXECUTION_FAILED";
  return new DomainError("RENDER_FAILED", message, 500, { rendererDiagnostic, stderrSha256: hash(stderr) });
};
const validatePng = bytes => {
  try {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("signature");
    const data = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString("ascii"), end = offset + 12 + length;
      if (end > bytes.length) throw new Error("chunk");
      if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset = end;
    }
    if (!data.length) throw new Error("idat");
    inflateSync(Buffer.concat(data));
  } catch {
    throw new DomainError("RENDER_FAILED", "commercial source-media composition failed", 500, { rendererDiagnostic: "RENDER_INPUT_DECODE_FAILED", stderrSha256: hash("png inflate failed") });
  }
};

export function renderTimelineVideo(timeline, duration, { ffmpeg = "ffmpeg" } = {}) {
  const videoClips = timeline.tracks.filter(track => track.kind === "video").flatMap(track => track.clips);
  if (!videoClips.length) throw new DomainError("VIDEO_TRACK_REQUIRED", "render requires at least one video clip", 409);
  const seconds = Math.max(0.1, duration);
  const filters = videoClips.map((clip, index) => {
    const color = hash(clip.assetId).slice(0, 6);
    const x = (index * 97) % 480, y = (index * 53) % 240;
    const end = clip.start + clip.outPoint - clip.inPoint;
    return `drawbox=x=${x}:y=${y}:w=160:h=120:color=#${color}:t=fill:enable=between(t\\,${clip.start}\\,${end})`;
  });
  const audioClips = timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips);
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=#111827:s=640x360:r=25:d=${seconds}`];
  if (audioClips.length) {
    const frequency = 220 + Number.parseInt(hash(audioClips.map(clip => clip.assetId).join(",")).slice(0, 4), 16) % 440;
    args.push("-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`);
  }
  args.push("-vf", filters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "25", "-g", "25", "-threads", "1");
  if (audioClips.length) args.push("-c:a", "aac", "-b:a", "96k", "-shortest");
  else args.push("-an");
  args.push("-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
  const result = spawnSync(ffmpeg, args, { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") throw new DomainError("RENDERER_UNAVAILABLE", "local ffmpeg is unavailable", 503);
  if (result.status !== 0) throw new DomainError("RENDER_FAILED", "local ffmpeg render failed", 500, { stderr: result.stderr.toString().trim() });
  return { bytes: result.stdout, sha256: hash(result.stdout), hasAudio: audioClips.length > 0, renderer: "ffmpeg" };
}

export function renderCommercialMedia({ videos, audio, captions = [], music = null, duration }, { ffmpeg = "ffmpeg" } = {}) {
  if (!Array.isArray(videos) || !videos.length || videos.some(video => !Buffer.isBuffer(video.bytes) || !video.bytes.length || !["video/mp4", "video/webm"].includes(video.mimeType))) throw new DomainError("COMMERCIAL_COMPOSITION_INVALID", "commercial composition requires byte-backed video sources", 422);
  if (!audio || !Buffer.isBuffer(audio.bytes) || !audio.bytes.length || !["audio/wav", "audio/mpeg"].includes(audio.mimeType)) throw new DomainError("COMMERCIAL_COMPOSITION_INVALID", "commercial composition requires a byte-backed audio source", 422);
  if (!Array.isArray(captions) || captions.some(caption => !Buffer.isBuffer(caption.bytes) || !caption.bytes.length || caption.mimeType !== "image/png" || !Number.isFinite(caption.start) || !Number.isFinite(caption.end) || caption.start < 0 || caption.end <= caption.start)) throw new DomainError("COMMERCIAL_COMPOSITION_INVALID", "commercial captions require timed byte-backed PNG sources", 422);
  if (music && (!Buffer.isBuffer(music.bytes) || !music.bytes.length || !["audio/wav", "audio/mpeg"].includes(music.mimeType))) throw new DomainError("COMMERCIAL_COMPOSITION_INVALID", "commercial music requires a byte-backed audio source", 422);
  captions.forEach(caption => validatePng(caption.bytes));
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new DomainError("COMMERCIAL_COMPOSITION_INVALID", "commercial composition duration is invalid", 422);
  const directory = mkdtempSync(join(tmpdir(), "openreel-commercial-compose-"));
  try {
    const args = ["-hide_banner", "-loglevel", "error"];
    videos.forEach((video, index) => {
      const file = join(directory, `video-${index}.${video.mimeType === "video/webm" ? "webm" : "mp4"}`);
      writeFileSync(file, video.bytes);
      args.push("-i", file);
    });
    const audioFile = join(directory, `voice.${audio.mimeType === "audio/mpeg" ? "mp3" : "wav"}`);
    writeFileSync(audioFile, audio.bytes);
    args.push("-i", audioFile);
    if (music) { const musicFile = join(directory, `music.${music.mimeType === "audio/mpeg" ? "mp3" : "wav"}`); writeFileSync(musicFile, music.bytes); args.push("-stream_loop", "-1", "-i", musicFile); }
    captions.forEach((caption, index) => { const file = join(directory, `caption-${index}.png`); writeFileSync(file, caption.bytes); args.push("-loop", "1", "-i", file); });
    const sharedThreeMicroShot = videos.length === 3 && videos.every(video => video.bytes.equals(videos[0].bytes));
    const sourceStarts = [0, 1.6, 3.3], zooms = [1, 1.18, 1.08];
    const filters = videos.map((video, index) => {
      const sourceStart = sharedThreeMicroShot ? sourceStarts[index] : Number(video.sourceStart || 0), zoom = sharedThreeMicroShot ? zooms[index] : Number(video.digitalZoom || 1);
      const crop = zoom > 1 ? `,crop=iw/${zoom}:ih/${zoom}:(iw-iw/${zoom})/2:(ih-ih/${zoom})/2,scale=640:360` : "";
      return `[${index}:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,trim=start=${sourceStart}:duration=${video.duration},setpts=PTS-STARTPTS${crop}[v${index}]`;
    });
    filters.push(`${videos.map((_, index) => `[v${index}]`).join("")}concat=n=${videos.length}:v=1:a=0[base]`);
    let videoLabel = "base", captionInput = videos.length + 1 + (music ? 1 : 0);
    captions.forEach((caption, index) => { const next = index === captions.length - 1 ? "outv" : `captioned${index}`; filters.push(`[${captionInput + index}:v]scale=500:-1[caption${index}]`); filters.push(`[${videoLabel}][caption${index}]overlay=x=(W-w)/2:y=H-h-36:enable='between(t,${caption.start},${caption.end})'[${next}]`); videoLabel = next; });
    if (!captions.length) filters.push("[base]null[outv]");
    let audioLabel = `${videos.length}:a:0`;
    if (music) { filters.push(`[${videos.length}:a]volume=-3dB[voice]`); filters.push(`[${videos.length + 1}:a]volume=-18dB[music]`); filters.push("[voice][music]amix=inputs=2:duration=first:dropout_transition=0[outa]"); audioLabel = "[outa]"; }
    args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-map", audioLabel, "-t", String(seconds), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");
    const result = spawnSync(ffmpeg, args, { encoding: null, maxBuffer: 64 * 1024 * 1024 });
    if (result.error?.code === "ENOENT") throw new DomainError("RENDERER_UNAVAILABLE", "local ffmpeg is unavailable", 503);
    if (result.status !== 0) throw renderFailure("commercial source-media composition failed", result);
    return { bytes: result.stdout, sha256: hash(result.stdout), hasAudio: true, hasCaptions: captions.length > 0, hasMusic: Boolean(music), renderer: "ffmpeg-source-media" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
