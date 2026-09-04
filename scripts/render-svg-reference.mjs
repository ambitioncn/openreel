import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length);
}

const input = option("input");
const output = option("output");
const width = Number(option("width") || 960);
const height = Number(option("height") || 544);
if (!input || !output) throw new Error("--input and --output are required");
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("invalid dimensions");

const svg = await readFile(resolve(input), "utf8");
if (!/^\s*<svg\b/i.test(svg)) throw new Error("input is not SVG");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`, { waitUntil: "load" });
  const rendered = await page.locator("svg").evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, text: node.textContent?.trim() || "" }));
  if (rendered.width !== width || rendered.height !== height) throw new Error(`rendered dimensions drifted: ${rendered.width}x${rendered.height}`);
  if (rendered.text) throw new Error("reference SVG contains text content");
  await page.screenshot({ path: resolve(output), clip: { x: 0, y: 0, width, height }, animations: "disabled" });
} finally {
  await browser.close();
}
