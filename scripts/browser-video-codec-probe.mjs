#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const executablePath = process.env.OPENREEL_BROWSER_EXECUTABLE_PATH?.trim();
const inputs = process.argv.slice(2).map(value => {
  const separator = value.indexOf("=");
  if (separator < 1) throw new Error("expected mime=path");
  return { mimeType: value.slice(0, separator), path: value.slice(separator + 1) };
});
if (!inputs.length) throw new Error("at least one mime=path input is required");

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"], ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  const results = [];
  for (const input of inputs) {
    const bytes = await readFile(input.path);
    const result = await page.evaluate(async ({ mimeType, base64 }) => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = `data:${mimeType};base64,${base64}`;
      document.body.replaceChildren(video);
      return await new Promise(resolve => {
        const finish = value => resolve({ mimeType, canPlayType: video.canPlayType(mimeType), ...value });
        const timer = setTimeout(() => finish({ loaded: false, reason: "timeout", mediaErrorCode: video.error?.code ?? null }), 15000);
        video.onloadedmetadata = () => { clearTimeout(timer); finish({ loaded: true, reason: null, mediaErrorCode: null, duration: video.duration, readyState: video.readyState }); };
        video.onerror = () => { clearTimeout(timer); finish({ loaded: false, reason: "media_error", mediaErrorCode: video.error?.code ?? null }); };
        video.load();
      });
    }, { mimeType: input.mimeType, base64: bytes.toString("base64") });
    results.push({ ...result, bytes: bytes.length });
  }
  process.stdout.write(JSON.stringify({ status: "complete", browser: "chromium", isolatedLocalFixtures: true, results }) + "\n");
} finally {
  await browser.close();
}
