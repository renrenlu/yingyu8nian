import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the English learning system", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>八上英语 U1–U8 互动学习系统<\/title>/i);
  assert.match(html, /八上英语学习舱/);
  assert.match(html, /203/);
  assert.match(html, /Sonia \/ 美音 Jenny \/ 中文 Xiaoxiao Neural/);
});

test("ships every generated Neural TTS file in the manifest", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../app/audio-manifest.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.voices["en-GB"].name, "en-GB-SoniaNeural");
  assert.equal(manifest.voices["en-US"].name, "en-US-JennyNeural");
  assert.equal(manifest.voices["zh-CN"].name, "zh-CN-XiaoxiaoNeural");
  assert.ok(Object.keys(manifest.entries["en-GB"]).length >= 300);
  assert.deepEqual(manifest.entries["en-GB"], manifest.entries["en-US"]);

  for (const [locale, entries] of Object.entries(manifest.entries)) {
    for (const filename of Object.values(entries)) {
      const info = await stat(new URL(`../public/audio/${locale}/${filename}`, import.meta.url));
      assert.ok(info.size >= 1024, `${locale}/${filename} is incomplete`);
    }
  }
});
