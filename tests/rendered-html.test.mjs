import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Aruma and Mizuki writing workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Aruma Editor · 把想法写成文章<\/title>/i);
  assert.match(html, /Aruma/);
  assert.match(html, /Mizuki/);
  assert.match(html, /写下今天的故事/);
  assert.match(html, /新草稿/);
  assert.match(html, /检查并发布/);
  assert.match(html, /管理博客连接/);
  assert.match(html, /版本历史/);
  assert.match(html, /Frontmatter/);
  assert.match(html, /所见即所得/);
  assert.match(html, /点击正文直接编辑/);
  assert.match(html, /可粘贴多个/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("removes disposable starter assets and metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /serializeDraft/);
  assert.match(page, /showDirectoryPicker/);
  assert.match(page, /src\/content\/posts/);
  assert.match(page, /preparePublish/);
  assert.doesNotMatch(page, /const publishedArticle = \{[\s\S]{0,120}draft: false/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(packageJson, /"name": "aruma-editor"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});
