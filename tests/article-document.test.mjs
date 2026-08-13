import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDraftRevision,
  buildLineDiff,
  hashText,
  parseMarkdownSource,
  serializeArticleSource,
} from "../lib/article-document.mjs";

const baseArticle = {
  title: "新的标题",
  published: "2026-08-13",
  description: "新的摘要",
  tags: ["随笔", "测试"],
  author: "Heronesukun",
  category: "日常",
  pinned: true,
  draft: true,
  heroImage: "./new-cover.webp",
  content: "## 正文\n\n保留草稿状态。",
};

test("preserves unknown Mizuki frontmatter fields during round trip", () => {
  const original = `---
title: 旧标题
published: 2025-01-02
description: 旧摘要
image: ./old.webp
encrypted: true
password: "123456"
alias: secret-note
permalink: /private/note/
lang: zh_CN
sourceLink: https://example.com/source
licenseName: CC BY-NC-SA 4.0
customNested:
  enabled: true
---

旧正文
`;
  const parsed = parseMarkdownSource(original);
  const output = serializeArticleSource({
    ...baseArticle,
    frontmatter: parsed.frontmatter,
  });
  const roundTrip = parseMarkdownSource(output).frontmatter;

  assert.equal(roundTrip.title, "新的标题");
  assert.equal(String(roundTrip.published).slice(0, 10), "2026-08-13");
  assert.equal(roundTrip.draft, true);
  assert.equal(roundTrip.image, "./new-cover.webp");
  assert.equal("heroImage" in roundTrip, false);
  assert.equal(roundTrip.encrypted, true);
  assert.equal(roundTrip.password, "123456");
  assert.equal(roundTrip.alias, "secret-note");
  assert.equal(roundTrip.permalink, "/private/note/");
  assert.equal(roundTrip.lang, "zh_CN");
  assert.equal(roundTrip.sourceLink, "https://example.com/source");
  assert.equal(roundTrip.licenseName, "CC BY-NC-SA 4.0");
  assert.deepEqual(roundTrip.customNested, { enabled: true });
});

test("writes compatibility aliases for a new article", () => {
  const output = serializeArticleSource({ ...baseArticle, frontmatter: {} });
  const metadata = parseMarkdownSource(output).frontmatter;

  assert.equal(String(metadata.published).slice(0, 10), "2026-08-13");
  assert.equal(String(metadata.pubDate).slice(0, 10), "2026-08-13");
  assert.equal(metadata.image, "./new-cover.webp");
  assert.equal(metadata.heroImage, "./new-cover.webp");
  assert.equal(metadata.draft, true);
});

test("builds a readable line diff", () => {
  const diff = buildLineDiff("one\ntwo\nthree", "one\nchanged\nthree");
  assert.deepEqual(
    diff.filter((line) => line.type !== "equal").map((line) => [line.type, line.text]),
    [
      ["add", "changed"],
      ["remove", "two"],
    ],
  );
});

test("hashes identical content deterministically", async () => {
  assert.equal(await hashText("same"), await hashText("same"));
  assert.notEqual(await hashText("same"), await hashText("different"));
});

test("deduplicates and caps local draft history", () => {
  const draft = {
    ...baseArticle,
    id: "draft-history",
    slug: "history",
    blogId: null,
    articlePath: null,
    frontmatter: {},
  };
  const first = appendDraftRevision([], draft, "自动备份", 3, 10);
  assert.equal(first.length, 1);
  assert.equal(appendDraftRevision(first, draft, "自动备份", 3, 10), first);

  let history = first;
  for (let index = 1; index <= 5; index += 1) {
    history = appendDraftRevision(
      history,
      { ...draft, content: `version ${index}` },
      "自动备份",
      3,
      10,
    );
  }
  assert.equal(history.length, 3);
  assert.equal(history[0].snapshot.content, "version 5");
});
