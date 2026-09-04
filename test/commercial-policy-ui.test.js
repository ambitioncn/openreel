import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { byteBackedIdentityReference, commercialDeclarations } from "../src/commercial-policy-ui.js";

test("builds policy declarations only from explicit confirmations", () => {
  assert.deepEqual(commercialDeclarations({ rights: true, performer: "fictional_adult", noBrands: true, noPublicFigures: true }), { referenceRights: "owned_or_licensed", performer: "fictional_adult", brands: "none", publicFigures: "none" });
  assert.throws(() => commercialDeclarations({ rights: false, performer: "fictional_adult", noBrands: true, noPublicFigures: true }), /确认/);
});

test("derives identity evidence from fetched bytes and decoded dimensions", async () => {
  const bytes = Buffer.from("real-image-bytes");
  const value = await byteBackedIdentityReference({ kind: "image", role: "reference", mimeType: "image/png", downloadUrl: "/asset" }, { fetchBytes: async () => ({ ok: true, arrayBuffer: async () => bytes }), digest: async value => createHash("sha256").update(Buffer.from(value)).digest(), dimensions: async () => ({ width: 1024, height: 768 }) });
  assert.deepEqual(value, { width: 1024, height: 768, sha256: createHash("sha256").update(bytes).digest("hex") });
});

test("rejects non-reference, unreadable, empty and undersized evidence", async () => {
  const deps = { fetchBytes: async () => ({ ok: true, arrayBuffer: async () => Buffer.from("x") }), digest: async value => createHash("sha256").update(Buffer.from(value)).digest(), dimensions: async () => ({ width: 1, height: 1 }) };
  await assert.rejects(() => byteBackedIdentityReference({ kind: "video", role: "reference", downloadUrl: "/asset" }, deps), /图片参考/);
  await assert.rejects(() => byteBackedIdentityReference({ kind: "image", role: "reference", mimeType: "image/png", downloadUrl: "/asset" }, deps), /256/);
});
