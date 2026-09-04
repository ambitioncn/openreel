import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/run-h3-commercial-qualification-batch.mjs", import.meta.url), "utf8");

test("qualification runner supports optional last-frame conditioning with replay evidence", () => {
  assert.match(source, /option\("last-frame", ""\)/);
  assert.match(source, /graph\[6\]\.inputs\.last_frame = \["17", 0\]/);
  assert.match(source, /graph\[17\] = \{ class_type: "LoadImage"/);
  assert.match(source, /conditioning: lastFrame \? "first_and_last_frame" : "first_frame"/);
  assert.match(source, /lastFrameSha256: lastFrame \? sha256\(lastFrame\) : null/);
});

test("qualification runner removes stale workflow last-frame input when none is supplied", () => {
  assert.match(source, /else delete graph\[6\]\.inputs\.last_frame/);
});
