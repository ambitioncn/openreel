import test from "node:test";
import assert from "node:assert/strict";
import { createProductUrlFetcher, extractProductPage } from "../src/product-url.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const response = (status, headers = {}, chunks = []) => ({ status, headers: { get: name => headers[String(name).toLowerCase()] ?? null }, body: (async function* () { for (const chunk of chunks) yield Buffer.from(chunk); })() });

test("product page extraction returns bounded text and ignores executable content", () => {
  const value = extractProductPage('<html><head><title>  Demo &amp; Shop </title><meta name="description" content="Useful item"></head><body><script>steal()</script><h1>Buy now</h1></body></html>');
  assert.deepEqual(value, { title: "Demo & Shop", description: "Useful item", text: "Demo & Shop Buy now" });
});

test("product URL fetch validates every redirect target and records byte provenance", async () => {
  const calls = [], fetcher = createProductUrlFetcher({ resolver: publicResolver, now: () => "2026-08-20T00:00:00.000Z", request: async url => { calls.push(url.href); return calls.length === 1 ? response(302, { location: "/item" }) : response(200, { "content-type": "text/html; charset=utf-8" }, ["<title>Item</title><p>Details</p>"]); } });
  const value = await fetcher({ url: "https://shop.example/landing#offer" });
  assert.deepEqual(calls, ["https://shop.example/landing", "https://shop.example/item"]);
  assert.equal(value.extracted.title, "Item"); assert.equal(value.source.redirects.length, 1); assert.equal(value.source.byteLength, 33); assert.match(value.source.sha256, /^[a-f0-9]{64}$/);
});

test("product URL fetch rejects unsafe schemes, credentials, ports, IPs and private DNS before transport", async () => {
  let calls = 0; const request = async () => { calls += 1; return response(200); };
  for (const url of ["http://shop.example/item", "https://user:pass@shop.example/item", "https://shop.example:8443/item", "https://127.0.0.1/item", "https://localhost/item"]) await assert.rejects(createProductUrlFetcher({ resolver: publicResolver, request })({ url }), error => error.code === "PRODUCT_URL_REJECTED");
  const privateFetcher = createProductUrlFetcher({ resolver: async () => [{ address: "10.0.0.2", family: 4 }], request });
  await assert.rejects(privateFetcher({ url: "https://shop.example/item" }), error => error.code === "PRODUCT_URL_DNS_REJECTED"); assert.equal(calls, 0);
});

test("product URL fetch rejects DNS rebinding and unsafe redirect destinations", async () => {
  let resolutions = 0; const rebound = createProductUrlFetcher({ resolver: async () => [{ address: ++resolutions % 2 ? "93.184.216.34" : "93.184.216.35", family: 4 }], request: async () => response(200) });
  await assert.rejects(rebound({ url: "https://shop.example/item" }), error => error.code === "PRODUCT_URL_DNS_REJECTED");
  const redirected = createProductUrlFetcher({ resolver: publicResolver, request: async () => response(302, { location: "https://127.0.0.1/secret" }) });
  await assert.rejects(redirected({ url: "https://shop.example/item" }), error => error.code === "PRODUCT_URL_REJECTED");
});

test("product URL fetch enforces MIME, declared size and streamed byte limits", async () => {
  const mime = createProductUrlFetcher({ resolver: publicResolver, request: async () => response(200, { "content-type": "application/json" }, ["{}"]), maxBytes: 8 });
  await assert.rejects(mime({ url: "https://shop.example/item" }), error => error.code === "PRODUCT_URL_MIME_REJECTED");
  const declared = createProductUrlFetcher({ resolver: publicResolver, request: async () => response(200, { "content-type": "text/html", "content-length": "9" }, []), maxBytes: 8 });
  await assert.rejects(declared({ url: "https://shop.example/item" }), error => error.code === "PRODUCT_URL_TOO_LARGE");
  const streamed = createProductUrlFetcher({ resolver: publicResolver, request: async () => response(200, { "content-type": "text/html" }, ["1234", "56789"]), maxBytes: 8 });
  await assert.rejects(streamed({ url: "https://shop.example/item" }), error => error.code === "PRODUCT_URL_TOO_LARGE");
});
