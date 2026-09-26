import assert from "node:assert/strict";
import test from "node:test";
import { app } from "../server/index.js";

let server;
let base;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test("node hello route responds", async () => {
  const res = await fetch(`${base}/api/node/hello`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.from, "node");
});

test("api index lists endpoints", async () => {
  const res = await fetch(`${base}/api`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "cumbuff");
  assert.ok(Array.isArray(body.endpoints.node));
});

test("placeholder generates a png", async () => {
  const res = await fetch(`${base}/api/node/image/placeholder?width=120&height=80`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100);
});

test("resize transforms an uploaded image", async () => {
  const source = await fetch(`${base}/api/node/image/placeholder?width=200&height=120`);
  const input = Buffer.from(await source.arrayBuffer());
  const res = await fetch(
    `${base}/api/node/image/resize?width=100&height=100&fit=cover&position=attention&format=webp&animated=false&withoutEnlargement=true`,
    { method: "POST", headers: { "Content-Type": "image/png" }, body: input },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.equal(res.headers.get("x-image-format"), "webp");
});

test("og image is generated", async () => {
  const res = await fetch(`${base}/og.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
});

test("security headers are present", async () => {
  const res = await fetch(`${base}/api`);
  assert.ok(res.headers.get("content-security-policy"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("x-request-id"));
});

test("liveness stays ok even without the sidecar", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.services.node, "up");
});

test("python routes 503 with Retry-After when the sidecar is down", async () => {
  const res = await fetch(`${base}/api/py/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  assert.equal(res.status, 503);
  assert.ok(res.headers.get("retry-after"));
});

test("unknown api route is json 404", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "not_found");
});
