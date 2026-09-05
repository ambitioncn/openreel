import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("workspace exposes English and Simplified Chinese with English first", async () => {
  const [html, app, i18n] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /data-language-selector/);
  assert.match(html, /<option value="en">English<\/option><option value="zh-CN">简体中文<\/option>/);
  assert.match(app, /initializeI18n\(\)/);
  assert.match(app, /toLocaleString\(localeCode\(\)\)/);
  assert.match(i18n, /localStorage\.getItem\(STORAGE_KEY\).*: "en"/);
  assert.match(i18n, /MutationObserver/);
  assert.match(i18n, /document\.documentElement\.lang = locale/);
});
