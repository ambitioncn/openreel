import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

const hash = value => createHash("sha256").update(value).digest("hex");

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
