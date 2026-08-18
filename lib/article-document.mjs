import { dump, load } from "js-yaml";

const DATE_KEYS = ["published", "pubDate", "date"];
const IMAGE_KEYS = ["heroImage", "image"];

export function parseMarkdownSource(text) {
  const frontmatterMatch = text.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/,
  );
  if (!frontmatterMatch) {
    return { frontmatter: {}, content: text, hasFrontmatter: false };
  }

  try {
    const parsed = load(frontmatterMatch[1]);
    return {
      frontmatter:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {},
      content: text.slice(frontmatterMatch[0].length),
      hasFrontmatter: true,
    };
  } catch {
    return { frontmatter: {}, content: text, hasFrontmatter: true };
  }
}

export function collectBlogTags(drafts, blogId) {
  if (!blogId || !Array.isArray(drafts)) return [];

  const catalog = new Map();
  for (const draft of drafts) {
    if (draft?.blogId !== blogId || !Array.isArray(draft.tags)) continue;

    const seenInArticle = new Set();
    for (const rawTag of draft.tags) {
      const name = String(rawTag ?? "")
        .trim()
        .replace(/^#+/, "")
        .trim();
      if (!name) continue;

      const key = name.toLocaleLowerCase();
      if (seenInArticle.has(key)) continue;
      seenInArticle.add(key);

      const existing = catalog.get(key);
      catalog.set(key, {
        name: existing?.name ?? name,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  return [...catalog.values()].sort(
    (left, right) =>
      right.count - left.count || left.name.localeCompare(right.name, "zh-CN"),
  );
}

function updateAliases(metadata, original, keys, value, defaults) {
  const present = keys.filter((key) =>
    Object.prototype.hasOwnProperty.call(original, key),
  );
  const targets = present.length ? present : defaults;
  for (const key of targets) metadata[key] = value;
}

export function mergeArticleFrontmatter(original, article) {
  const source =
    original && typeof original === "object" && !Array.isArray(original)
      ? original
      : {};
  const metadata = { ...source };

  metadata.title = article.title;
  updateAliases(metadata, source, DATE_KEYS, article.published, [
    "published",
    "pubDate",
  ]);
  metadata.pinned = article.pinned;
  metadata.description = article.description;
  metadata.tags = article.tags;
  metadata.author = article.author;
  metadata.draft = article.draft;
  metadata.category = article.category;

  const image = String(article.heroImage ?? "").trim();
  if (image) {
    updateAliases(metadata, source, IMAGE_KEYS, image, IMAGE_KEYS);
  } else {
    for (const key of IMAGE_KEYS) delete metadata[key];
  }
  return metadata;
}

export function serializeArticleSource(article) {
  const metadata = mergeArticleFrontmatter(article.frontmatter, article);
  const yaml = dump(metadata, {
    noRefs: true,
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  }).trim();
  return `---\n${yaml}\n---\n\n${String(article.content ?? "").trimEnd()}\n`;
}

function draftFingerprint(draft) {
  return JSON.stringify({
    markdown: serializeArticleSource(draft),
    slug: draft.slug,
    blogId: draft.blogId,
    articlePath: draft.articlePath,
  });
}

export function appendDraftRevision(
  revisions,
  draft,
  reason,
  maxPerDraft = 20,
  maxTotal = 120,
) {
  const latest = revisions.find((revision) => revision.draftId === draft.id);
  if (
    latest &&
    draftFingerprint(latest.snapshot) === draftFingerprint(draft) &&
    reason !== "恢复前"
  ) {
    return revisions;
  }
  const revision = {
    id: `revision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    draftId: draft.id,
    createdAt: Date.now(),
    reason,
    snapshot: structuredClone(draft),
  };
  const sameDraft = revisions.filter(
    (item) => item.draftId === draft.id,
  );
  const expiredIds = new Set(
    sameDraft.slice(maxPerDraft - 1).map((item) => item.id),
  );
  return [revision, ...revisions.filter((item) => !expiredIds.has(item.id))].slice(
    0,
    maxTotal,
  );
}

export async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildLineDiff(before, after) {
  const oldLines = String(before).replace(/\r\n/g, "\n").split("\n");
  const newLines = String(after).replace(/\r\n/g, "\n").split("\n");

  // Bound memory for unusually large posts while keeping a useful preview.
  if (oldLines.length * newLines.length > 240_000) {
    return [
      ...oldLines.map((text, index) => ({
        type: "remove",
        text,
        oldLine: index + 1,
        newLine: null,
      })),
      ...newLines.map((text, index) => ({
        type: "add",
        text,
        oldLine: null,
        newLine: index + 1,
      })),
    ];
  }

  const rows = oldLines.length + 1;
  const columns = newLines.length + 1;
  const table = Array.from({ length: rows }, () =>
    new Uint32Array(columns),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(
              table[oldIndex + 1][newIndex],
              table[oldIndex][newIndex + 1],
            );
    }
  }

  const result = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      result.push({
        type: "equal",
        text: oldLines[oldIndex],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex === oldLines.length ||
        table[oldIndex][newIndex + 1] >=
          table[oldIndex + 1][newIndex])
    ) {
      result.push({
        type: "add",
        text: newLines[newIndex],
        oldLine: null,
        newLine: newIndex + 1,
      });
      newIndex += 1;
    } else {
      result.push({
        type: "remove",
        text: oldLines[oldIndex],
        oldLine: oldIndex + 1,
        newLine: null,
      });
      oldIndex += 1;
    }
  }
  return result;
}
