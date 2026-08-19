"use client";

import {
  Archive,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Columns2,
  Download,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  FolderHeart,
  GitCompare,
  Hash,
  HardDrive,
  Heading2,
  History,
  Image as ImageIcon,
  Italic,
  Keyboard as KeyboardIcon,
  Link2,
  List,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelRightClose,
  PenLine,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  appendDraftRevision,
  buildLineDiff,
  collectBlogCategories,
  collectBlogTags,
  hashText,
  mergeArticleFrontmatter,
  parseMarkdownSource,
  serializeArticleSource,
} from "../lib/article-document.mjs";
import {
  appendTrailingEditorLine,
  resolveEditorShortcut,
} from "../lib/editor-commands.mjs";
import {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ViewMode = "write" | "split" | "preview";
type ArticleSource = "draft" | "imported" | "published";
type BlogType = "aruma" | "mizuki" | "compatible";
type RevisionReason = "自动备份" | "手动保存" | "发布前" | "恢复前";
type DiffType = "equal" | "add" | "remove";
type EditorCommand =
  | "undo"
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bold"
  | "italic"
  | "strike"
  | "link"
  | "image"
  | "quote"
  | "bullet-list"
  | "ordered-list"
  | "code"
  | "horizontal-rule";

type TagPickerState = {
  draftId: string;
  selected: string[];
};

type UndoState = {
  snapshots: string[];
  lastCapturedAt: number;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function safeMarkdownUrl(value: string) {
  const url = value.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^(#|\/|\.\/|\.\.\/)/.test(url)) return url;
  return "";
}

const previewRenderer = new marked.Renderer();

previewRenderer.html = ({ text }) => escapeHtml(text);
previewRenderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const safeHref = safeMarkdownUrl(href);
  if (!safeHref) return label;
  const titleAttribute = title
    ? ` title="${escapeHtml(title)}"`
    : "";
  return `<a href="${escapeHtml(safeHref)}"${titleAttribute} rel="noreferrer noopener">${label}</a>`;
};
previewRenderer.image = ({ href, title, text }) => {
  const safeHref = safeMarkdownUrl(href);
  if (!safeHref) return escapeHtml(text);
  const titleAttribute = title
    ? ` title="${escapeHtml(title)}"`
    : "";
  return `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text)}"${titleAttribute}>`;
};

function trailingLineCount(value: string) {
  return Math.min(2, value.match(/\n+$/)?.[0].length ?? 0);
}

function renderMarkdown(value: string) {
  const html = marked.parse(value, {
    breaks: true,
    gfm: true,
    renderer: previewRenderer,
  }) as string;
  return `${html}${'<p data-trailing-editor-line="true"><br></p>'.repeat(
    trailingLineCount(value),
  )}`;
}

const markdownConverter = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  headingStyle: "atx",
  strongDelimiter: "**",
});
markdownConverter.use(gfm);

function countTrailingVisualLines(editor: HTMLElement) {
  let count = 0;
  let element = editor.lastElementChild;
  while (
    element &&
    count < 2 &&
    element.matches("p, div") &&
    !element.textContent?.trim() &&
    !element.querySelector("img, hr, table, pre, ul, ol, blockquote")
  ) {
    count += 1;
    element = element.previousElementSibling;
  }
  return count;
}

function isVisualCaretAtEnd(editor: HTMLElement) {
  const selection = window.getSelection();
  if (
    !selection?.rangeCount ||
    !selection.isCollapsed ||
    !selection.anchorNode ||
    !editor.contains(selection.anchorNode)
  ) {
    return false;
  }

  if (selection.anchorNode === editor) {
    return selection.anchorOffset >= editor.childNodes.length;
  }

  let topLevelNode: Node = selection.anchorNode;
  while (topLevelNode.parentNode && topLevelNode.parentNode !== editor) {
    topLevelNode = topLevelNode.parentNode;
  }
  if (topLevelNode !== editor.lastElementChild) return false;

  const tail = document.createRange();
  tail.selectNodeContents(editor);
  tail.setStart(selection.anchorNode, selection.anchorOffset);
  const fragment = tail.cloneContents();
  return (
    !(fragment.textContent ?? "").trim() &&
    !fragment.querySelector("img, hr, table, pre, ul, ol, blockquote")
  );
}

function placeCaretAtEnd(element: HTMLElement) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function visualHtmlToMarkdown(editor: HTMLElement) {
  const trailingLines = countTrailingVisualLines(editor);
  const markdown = markdownConverter
    .turndown(editor.innerHTML)
    .replace(/\u00a0/g, " ")
    .replace(/^(\s*[-+*]) {2,}/gm, "$1 ")
    .replace(/^(\s*\d+\.) {2,}/gm, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return `${markdown}${"\n".repeat(trailingLines)}`;
}

type Draft = {
  id: string;
  title: string;
  slug: string;
  published: string;
  description: string;
  tags: string[];
  author: string;
  category: string;
  pinned: boolean;
  draft: boolean;
  heroImage: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  source: ArticleSource;
  blogId: string | null;
  articlePath: string | null;
  frontmatter: Record<string, unknown>;
  sourceHash: string | null;
  sourceModifiedAt: number | null;
  externalConflict: boolean;
};

type DraftRevision = {
  id: string;
  draftId: string;
  createdAt: number;
  reason: RevisionReason;
  snapshot: Draft;
};

type BlogStatus = "connected" | "permission" | "missing";

type BlogConnection = {
  id: string;
  name: string;
  rootPath: string;
  postPath: string;
  status: BlogStatus;
  message: string;
  articleCount: number;
  lastConnectedAt: number;
  lastSyncedAt: number;
  blogType?: BlogType;
};

type BlogArticle = {
  slug: string;
  text: string;
  lastModified: number;
  articlePath: string;
  contentHash: string;
};

type BlogScanResult = {
  connection: BlogConnection;
  articles: BlogArticle[];
};

type WorkspaceSnapshot = {
  version: number;
  drafts: Draft[];
  activeId: string | null;
  isDark: boolean;
  blogs: BlogConnection[];
  activeBlogId: string | null;
  history: DraftRevision[];
};

type ArticleInspection = {
  exists: boolean;
  text: string;
  hash: string | null;
  lastModified: number | null;
  target: string;
};

type PublishResult = {
  ok: boolean;
  exists: boolean;
  target: string;
  hash?: string;
  lastModified?: number;
  conflict?: boolean;
  inspection?: ArticleInspection;
};

type DiffLine = {
  type: DiffType;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

type PublishPreview = {
  connection: BlogConnection;
  article: Draft;
  markdown: string;
  articlePath: string;
  inspection: ArticleInspection;
  conflict: boolean;
  diff: DiffLine[];
};

type DesktopBridge = {
  platform: string;
  loadWorkspace: () => Promise<WorkspaceSnapshot>;
  saveWorkspace: (workspace: WorkspaceSnapshot) => Promise<{ ok: boolean }>;
  addBlog: () => Promise<BlogScanResult | null>;
  scanBlog: (connection: BlogConnection) => Promise<BlogScanResult>;
  inspectArticle: (request: {
    connection: BlogConnection;
    slug: string;
    articlePath: string | null;
  }) => Promise<ArticleInspection>;
  publishArticle: (request: {
    connection: BlogConnection;
    slug: string;
    markdown: string;
    overwrite: boolean;
    articlePath: string | null;
    expectedHash: string | null;
  }) => Promise<PublishResult>;
  revealBlog: (connection: BlogConnection) => Promise<string>;
  getVersion: () => Promise<string>;
};

type DirectoryHandleLike = {
  kind: "directory";
  name: string;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<DirectoryHandleLike>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<{
    getFile: () => Promise<File>;
    createWritable: () => Promise<{
      write: (data: string | Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<string>;
  queryPermission?: (options: { mode: "readwrite" }) => Promise<string>;
  values?: () => AsyncIterable<DirectoryEntryHandleLike>;
};

type FileHandleLike = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{
    write: (data: string | Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type DirectoryEntryHandleLike = DirectoryHandleLike | FileHandleLike;

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<DirectoryHandleLike>;
    arumaDesktop?: DesktopBridge;
  }
}

const STORAGE_KEY = "aruma-editor:drafts:v1";
const ACTIVE_KEY = "aruma-editor:active:v1";
const THEME_KEY = "aruma-editor:theme:v1";
const BLOGS_KEY = "aruma-editor:blogs:v1";
const ACTIVE_BLOG_KEY = "aruma-editor:active-blog:v1";
const HISTORY_KEY = "aruma-editor:history:v1";
const HANDLE_DATABASE = "aruma-editor-handles";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createDraft(blogId: string | null = null): Draft {
  const now = Date.now();
  return {
    id: `draft-${now}`,
    title: "写下今天的故事",
    slug: `note-${today()}`,
    published: today(),
    description: "给这篇文章写一句轻轻的摘要吧。",
    tags: ["随笔"],
    author: "拾音",
    category: "日常",
    pinned: false,
    draft: true,
    heroImage: "",
    content: `## 从这里开始\n\n今天想记录的是……\n\n> 不必一次写完，想法会在停留中慢慢长出形状。\n\n### 一个小标题\n\n- 此刻想到的事\n- 想留给未来的话\n`,
    createdAt: now,
    updatedAt: now,
    source: "draft",
    blogId,
    articlePath: null,
    frontmatter: {},
    sourceHash: null,
    sourceModifiedAt: null,
    externalConflict: false,
  };
}

// The server can keep this module alive for minutes, while the browser evaluates
// it at navigation time. Keep the hydration draft fully deterministic and only
// create a dated draft after the client has mounted.
const starterDraft: Draft = {
  id: "starter-draft",
  title: "写下今天的故事",
  slug: "new-article",
  published: "",
  description: "给这篇文章写一句轻轻的摘要吧。",
  tags: ["随笔"],
  author: "拾音",
  category: "日常",
  pinned: false,
  draft: true,
  heroImage: "",
  content: `## 从这里开始\n\n今天想记录的是……\n\n> 不必一次写完，想法会在停留中慢慢长出形状。\n\n### 一个小标题\n\n- 此刻想到的事\n- 想留给未来的话\n`,
  createdAt: 0,
  updatedAt: 0,
  source: "draft",
  blogId: null,
  articlePath: null,
  frontmatter: {},
  sourceHash: null,
  sourceModifiedAt: null,
  externalConflict: false,
};

function cleanDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? today());
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : today();
}

function parseMarkdownDocument(
  text: string,
  fileName = "article.md",
  blogId: string | null = null,
): Draft {
  const now = Date.now();
  const parsed = parseMarkdownSource(text);
  const data = parsed.frontmatter as Record<string, unknown>;
  const content = parsed.content;

  const fileSlug = fileName.replace(/\.(md|markdown)$/i, "");
  return {
    id: `import-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title: String(data.title ?? fileSlug ?? "导入的文章"),
    slug: String(data.slug ?? fileSlug ?? `article-${today()}`),
    published: cleanDate(data.published ?? data.pubDate ?? data.date),
    description: String(data.description ?? ""),
    tags: Array.isArray(data.tags)
      ? data.tags.map(String)
      : String(data.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
    author: String(data.author ?? "拾音"),
    category: String(data.category ?? "日常"),
    pinned: Boolean(data.pinned),
    draft: data.draft === undefined ? true : Boolean(data.draft),
    heroImage: String(data.heroImage ?? data.image ?? ""),
    content,
    createdAt: now,
    updatedAt: now,
    source: "imported",
    blogId,
    articlePath: null,
    frontmatter: data,
    sourceHash: null,
    sourceModifiedAt: null,
    externalConflict: false,
  };
}

function normalizeDraft(value: Draft): Draft {
  return {
    ...value,
    blogId: value.blogId ?? null,
    articlePath: value.articlePath ?? null,
    frontmatter:
      value.frontmatter && typeof value.frontmatter === "object"
        ? value.frontmatter
        : {},
    sourceHash: value.sourceHash ?? null,
    sourceModifiedAt: value.sourceModifiedAt ?? null,
    externalConflict: value.externalConflict ?? false,
  };
}

function openHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("handles")) {
        request.result.createObjectStore("handles");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(id: string, handle: DirectoryHandleLike) {
  const database = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("handles", "readwrite");
    transaction.objectStore("handles").put(handle, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function loadDirectoryHandle(id: string) {
  const database = await openHandleDatabase();
  const handle = await new Promise<DirectoryHandleLike | null>((resolve, reject) => {
    const request = database.transaction("handles", "readonly").objectStore("handles").get(id);
    request.onsuccess = () => resolve((request.result as DirectoryHandleLike) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return handle;
}

async function deleteDirectoryHandle(id: string) {
  const database = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("handles", "readwrite");
    transaction.objectStore("handles").delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function serializeDraft(article: Draft) {
  return serializeArticleSource(article);
}

function appendRevision(
  revisions: DraftRevision[],
  draft: Draft,
  reason: RevisionReason,
) {
  return appendDraftRevision(revisions, draft, reason) as DraftRevision[];
}

function diffSummary(lines: DiffLine[]) {
  return lines.reduce(
    (summary, line) => {
      if (line.type === "add") summary.added += 1;
      if (line.type === "remove") summary.removed += 1;
      return summary;
    },
    { added: 0, removed: 0 },
  );
}

function compactDiff(lines: DiffLine[], context = 3) {
  const visible = new Set<number>();
  lines.forEach((line, index) => {
    if (line.type === "equal") return;
    for (
      let nearby = Math.max(0, index - context);
      nearby <= Math.min(lines.length - 1, index + context);
      nearby += 1
    ) {
      visible.add(nearby);
    }
  });
  if (!visible.size) return lines.slice(0, 12);
  const compacted: DiffLine[] = [];
  let previous = -2;
  for (const index of [...visible].sort((a, b) => a - b)) {
    if (index > previous + 1) {
      compacted.push({
        type: "equal",
        text: "… 未变化的内容 …",
        oldLine: null,
        newLine: null,
      });
    }
    compacted.push(lines[index]);
    previous = index;
  }
  return compacted;
}

function relativeTime(timestamp: number) {
  if (timestamp === 0) return "新草稿";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

function wordCount(text: string) {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

function readingMinutes(text: string) {
  return Math.max(1, Math.ceil(wordCount(text) / 350));
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function existingArticlePath(articlePath: string | null, slug: string) {
  if (articlePath === `${slug}.md` || articlePath === `${slug}/index.md`) {
    return articlePath;
  }
  return `${slug}/index.md`;
}

export default function Home() {
  const [drafts, setDrafts] = useState<Draft[]>([starterDraft]);
  const [activeId, setActiveId] = useState(starterDraft.id);
  const [hydrated, setHydrated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [search, setSearch] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [tagPicker, setTagPicker] = useState<TagPickerState | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPickerDraftId, setCategoryPickerDraftId] = useState<
    string | null
  >(null);
  const [isDark, setIsDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(true);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [cursorLine, setCursorLine] = useState(1);
  const [toast, setToast] = useState("");
  const [blogs, setBlogs] = useState<BlogConnection[]>([]);
  const [activeBlogId, setActiveBlogId] = useState<string | null>(null);
  const [connectionManagerOpen, setConnectionManagerOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [syncingBlogId, setSyncingBlogId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [history, setHistory] = useState<DraftRevision[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PublishPreview | null>(
    null,
  );
  const [isInspecting, setIsInspecting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const visualEditorRef = useRef<HTMLElement>(null);
  const visualDraftIdRef = useRef<string | null>(null);
  const visualComposingRef = useRef(false);
  const undoStateRef = useRef(new Map<string, UndoState>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blogHandlesRef = useRef(new Map<string, DirectoryHandleLike>());

  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0];
  const activeBlog = blogs.find((blog) => blog.id === activeBlogId) ?? null;
  const draftBlog = blogs.find((blog) => blog.id === active?.blogId) ?? null;
  const assetRoot =
    typeof window !== "undefined" && window.arumaDesktop ? "." : "";

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkspace() {
      try {
        let restoredDrafts: Draft[] = [];
        let restoredActiveId: string | null = null;
        let restoredBlogs: BlogConnection[] = [];
        let restoredActiveBlogId: string | null = null;
        let restoredTheme = false;
        let restoredHistory: DraftRevision[] = [];

        if (window.arumaDesktop) {
          const workspace = await window.arumaDesktop.loadWorkspace();
          restoredDrafts = workspace.drafts.map(normalizeDraft);
          restoredActiveId = workspace.activeId;
          restoredBlogs = workspace.blogs;
          restoredActiveBlogId = workspace.activeBlogId;
          restoredTheme = workspace.isDark;
          restoredHistory = Array.isArray(workspace.history)
            ? workspace.history
            : [];
        } else {
          const storedDrafts = localStorage.getItem(STORAGE_KEY);
          const storedBlogs = localStorage.getItem(BLOGS_KEY);
          restoredDrafts = storedDrafts
            ? (JSON.parse(storedDrafts) as Draft[]).map(normalizeDraft)
            : [];
          restoredActiveId = localStorage.getItem(ACTIVE_KEY);
          restoredActiveBlogId = localStorage.getItem(ACTIVE_BLOG_KEY);
          restoredTheme = localStorage.getItem(THEME_KEY) === "dark";
          const storedHistory = localStorage.getItem(HISTORY_KEY);
          restoredHistory = storedHistory
            ? (JSON.parse(storedHistory) as DraftRevision[])
            : [];

          const blogMetadata = storedBlogs
            ? (JSON.parse(storedBlogs) as BlogConnection[])
            : [];
          restoredBlogs = await Promise.all(
            blogMetadata.map(async (blog) => {
              try {
                const handle = await loadDirectoryHandle(blog.id);
                if (!handle) {
                  return {
                    ...blog,
                    status: "permission" as const,
                    message: "需要重新授权目录",
                  };
                }
                blogHandlesRef.current.set(blog.id, handle);
                const permission = handle.queryPermission
                  ? await handle.queryPermission({ mode: "readwrite" })
                  : "prompt";
                return {
                  ...blog,
                  status: permission === "granted" ? "connected" : "permission",
                  message:
                    permission === "granted" ? "目录可读写" : "需要重新授权目录",
                } as BlogConnection;
              } catch {
                return {
                  ...blog,
                  status: "permission" as const,
                  message: "需要重新授权目录",
                };
              }
            }),
          );
        }

        if (cancelled) return;
        const firstBlogId =
          restoredBlogs.find((blog) => blog.id === restoredActiveBlogId)?.id ??
          restoredBlogs[0]?.id ??
          null;
        const nextDrafts = restoredDrafts.length
          ? restoredDrafts
          : [createDraft(firstBlogId)];
        const nextActiveId = nextDrafts.some(
          (draft) => draft.id === restoredActiveId,
        )
          ? restoredActiveId
          : nextDrafts[0].id;

        // Restore external device state after the asynchronous load completes.
        setDrafts(nextDrafts);
        setActiveId(nextActiveId as string);
        setBlogs(restoredBlogs);
        setActiveBlogId(firstBlogId);
        setIsDark(restoredTheme);
        setHistory(restoredHistory);
      } catch {
        if (cancelled) return;
        const firstDraft = createDraft();
        setDrafts([firstDraft]);
        setActiveId(firstDraft.id);
        setToast("工作区恢复失败，已创建安全的新草稿");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void hydrateWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistWorkspace = useCallback(
    async (historyOverride: DraftRevision[] = history) => {
      const workspace: WorkspaceSnapshot = {
        version: 2,
        drafts,
        activeId,
        isDark,
        blogs,
        activeBlogId,
        history: historyOverride,
      };
      if (window.arumaDesktop) {
        await window.arumaDesktop.saveWorkspace(workspace);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
        localStorage.setItem(ACTIVE_KEY, activeId);
        localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
        localStorage.setItem(BLOGS_KEY, JSON.stringify(blogs));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(historyOverride));
        if (activeBlogId) {
          localStorage.setItem(ACTIVE_BLOG_KEY, activeBlogId);
        } else {
          localStorage.removeItem(ACTIVE_BLOG_KEY);
        }
      }
    }, [activeBlogId, activeId, blogs, drafts, history, isDark],
  );

  useEffect(() => {
    if (!hydrated) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        await persistWorkspace();
        setSaveState("saved");
      } catch {
        setToast("工作区保存失败，请先导出重要草稿");
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [hydrated, persistWorkspace]);

  useEffect(() => {
    if (!hydrated || !active || active.updatedAt === 0) return;
    const snapshot = structuredClone(active);
    const timer = window.setTimeout(() => {
      setHistory((current) => appendRevision(current, snapshot, "自动备份"));
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [active, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const nextHistory = active
          ? appendRevision(history, active, "手动保存")
          : history;
        setHistory(nextHistory);
        setSaveState("saving");
        void persistWorkspace(nextHistory)
          .then(() => {
            setSaveState("saved");
            setToast("草稿与历史版本已保存到本机");
          })
          .catch(() => setToast("保存失败，请先导出重要草稿"));
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [active, history, persistWorkspace]);

  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return drafts;
    return drafts.filter((draft) =>
      [draft.title, draft.description, draft.category, ...draft.tags]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [drafts, search]);

  const tagBlogId = active?.blogId ?? activeBlogId;
  const tagBlog = blogs.find((blog) => blog.id === tagBlogId) ?? null;
  const blogTags = useMemo(
    () => collectBlogTags(drafts, tagBlogId),
    [drafts, tagBlogId],
  );
  const filteredBlogTags = useMemo(() => {
    const query = tagSearch.trim().toLocaleLowerCase();
    return blogTags.filter((tag: { name: string; count: number }) =>
      query ? tag.name.toLocaleLowerCase().includes(query) : true,
    );
  }, [blogTags, tagSearch]);
  const blogCategories = useMemo(
    () => collectBlogCategories(drafts, tagBlogId),
    [drafts, tagBlogId],
  );
  const filteredBlogCategories = useMemo(() => {
    const query = categorySearch.trim().toLocaleLowerCase();
    return blogCategories.filter((category: { name: string; count: number }) =>
      query ? category.name.toLocaleLowerCase().includes(query) : true,
    );
  }, [blogCategories, categorySearch]);

  const updateActive = useCallback(
    (patch: Partial<Draft>) => {
      if (!active) return;
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === active.id
            ? { ...draft, ...patch, updatedAt: Date.now() }
            : draft,
        ),
      );
    },
    [active],
  );

  const updateActiveContent = useCallback(
    (content: string, forceSnapshot = false) => {
      if (!active || content === active.content) return;

      const now = Date.now();
      const undoState = undoStateRef.current.get(active.id) ?? {
        snapshots: [],
        lastCapturedAt: 0,
      };
      if (
        forceSnapshot ||
        !undoState.lastCapturedAt ||
        now - undoState.lastCapturedAt >= 700
      ) {
        if (undoState.snapshots.at(-1) !== active.content) {
          undoState.snapshots.push(active.content);
          undoState.snapshots = undoState.snapshots.slice(-100);
        }
        undoState.lastCapturedAt = now;
      }
      undoStateRef.current.set(active.id, undoState);
      updateActive({ content });
    },
    [active, updateActive],
  );

  const undoContent = useCallback(() => {
    if (!active) return;
    const undoState = undoStateRef.current.get(active.id);
    const previous = undoState?.snapshots.pop();
    if (previous === undefined) {
      setToast("没有可撤回的正文修改");
      return;
    }

    undoState.lastCapturedAt = 0;
    updateActive({ content: previous });
    const editor = visualEditorRef.current;
    if (editor && viewMode !== "write") {
      editor.innerHTML = renderMarkdown(previous);
      window.requestAnimationFrame(() => {
        editor.focus();
        placeCaretAtEnd(editor);
      });
    }
    setToast("已撤回上一次正文修改");
  }, [active, updateActive, viewMode]);

  const showMessage = (message: string) => setToast(message);

  const addDraft = () => {
    const next = createDraft(activeBlogId);
    const duplicateCount = drafts.filter((item) =>
      item.slug.startsWith(next.slug),
    ).length;
    if (duplicateCount) next.slug = `${next.slug}-${duplicateCount + 1}`;
    setDrafts((current) => [next, ...current]);
    setActiveId(next.id);
    setSidebarOpen(false);
    showMessage("新草稿准备好了");
  };

  const removeDraft = () => {
    if (!active) return;
    const label = active.source === "published" ? "从编辑器列表移除" : "删除草稿";
    if (!window.confirm(`${label}“${active.title}”？博客中的文件不会被删除。`)) {
      return;
    }
    setDrafts((current) => {
      const remaining = current.filter((draft) => draft.id !== active.id);
      if (remaining.length) {
        setActiveId(remaining[0].id);
        return remaining;
      }
      const fresh = createDraft(activeBlogId);
      setActiveId(fresh.id);
      return [fresh];
    });
  };

  useEffect(() => {
    const editor = visualEditorRef.current;
    if (!editor || !active) return;

    const draftChanged = visualDraftIdRef.current !== active.id;
    if (draftChanged || document.activeElement !== editor) {
      const html = renderMarkdown(active.content);
      if (editor.innerHTML !== html) editor.innerHTML = html;
    }
    visualDraftIdRef.current = active.id;
  }, [active, viewMode]);

  const insertSourceMarkdown = (
    before: string,
    after = "",
    placeholder = "在这里输入文字",
  ) => {
    if (!active) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = active.content.slice(start, end) || placeholder;
    const next =
      active.content.slice(0, start) +
      before +
      selection +
      after +
      active.content.slice(end);
    updateActiveContent(next, true);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selection.length,
      );
    });
  };

  const applySourceBlockStyle = (command: EditorCommand) => {
    const textarea = textareaRef.current;
    if (!textarea || !active) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = active.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextBreak = active.content.indexOf("\n", end);
    const lineEnd = nextBreak < 0 ? active.content.length : nextBreak;
    const selectedLines = active.content.slice(lineStart, lineEnd).split("\n");
    const stripped = selectedLines.map((line) =>
      line.replace(/^(\s*)(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/, "$1"),
    );
    const replacement = stripped
      .map((line, index) => {
        if (/^h[1-6]$/.test(command)) {
          return `${"#".repeat(Number(command.slice(1)))} ${line}`;
        }
        if (command === "quote") return `> ${line}`;
        if (command === "bullet-list") return `- ${line}`;
        if (command === "ordered-list") return `${index + 1}. ${line}`;
        return line;
      })
      .join("\n");
    updateActiveContent(
      active.content.slice(0, lineStart) +
        replacement +
        active.content.slice(lineEnd),
      true,
    );
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + replacement.length);
    });
  };

  const runSourceCommand = (command: EditorCommand) => {
    if (/^h[1-6]$/.test(command) || command === "paragraph") {
      applySourceBlockStyle(command);
      return;
    }
    if (command === "quote" || command.endsWith("-list")) {
      applySourceBlockStyle(command);
      return;
    }
    if (command === "bold") insertSourceMarkdown("**", "**", "粗体文字");
    if (command === "italic") insertSourceMarkdown("*", "*", "斜体文字");
    if (command === "strike") insertSourceMarkdown("~~", "~~", "删除线文字");
    if (command === "code") insertSourceMarkdown("`", "`", "code");
    if (command === "link") insertSourceMarkdown("[", "](https://)", "链接文字");
    if (command === "image") {
      insertSourceMarkdown("![", "](./image.webp)", "图片说明");
    }
    if (command === "horizontal-rule") insertSourceMarkdown("\n---\n", "", "");
  };

  const syncVisualEditor = useCallback(
    (canonicalize = false, forceSnapshot = false) => {
      const editor = visualEditorRef.current;
      if (!editor || !active || visualComposingRef.current) return;
      const markdown = visualHtmlToMarkdown(editor);
      if (markdown !== active.content) {
        updateActiveContent(markdown, forceSnapshot);
      }
      if (canonicalize) editor.innerHTML = renderMarkdown(markdown);
    },
    [active, updateActiveContent],
  );

  const updateVisualCursorLine = () => {
    const editor = visualEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.anchorNode) return;
    if (!editor.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    setCursorLine(Math.max(1, range.toString().split("\n").length));
  };

  const runVisualCommand = (command: EditorCommand) => {
    const editor = visualEditorRef.current;
    if (!editor) return;
    editor.focus();

    if (/^h[1-6]$/.test(command)) {
      document.execCommand("formatBlock", false, command);
    } else if (command === "paragraph") {
      document.execCommand("formatBlock", false, "p");
    } else if (command === "bold") {
      document.execCommand("bold");
    } else if (command === "italic") {
      document.execCommand("italic");
    } else if (command === "strike") {
      document.execCommand("strikeThrough");
    } else if (command === "quote") {
      document.execCommand("formatBlock", false, "blockquote");
    } else if (command === "bullet-list") {
      document.execCommand("insertUnorderedList");
    } else if (command === "ordered-list") {
      document.execCommand("insertOrderedList");
    } else if (command === "horizontal-rule") {
      document.execCommand("insertHorizontalRule");
    } else if (command === "link") {
      const selected = window.getSelection()?.toString() || "链接文字";
      document.execCommand(
        "insertHTML",
        false,
        `<a href="https://">${escapeHtml(selected)}</a>`,
      );
    } else if (command === "image") {
      document.execCommand(
        "insertHTML",
        false,
        '<img src="./image.webp" alt="图片说明">',
      );
    } else if (command === "code") {
      const selected = window.getSelection()?.toString() || "code";
      document.execCommand(
        "insertHTML",
        false,
        `<code>${escapeHtml(selected)}</code>`,
      );
    }

    window.requestAnimationFrame(() => {
      syncVisualEditor(false, true);
      updateVisualCursorLine();
    });
  };

  const runEditorCommand = (command: EditorCommand) => {
    if (command === "undo") {
      undoContent();
      return;
    }
    const visualEditor = visualEditorRef.current;
    const shouldUseVisualEditor =
      visualEditor &&
      (document.activeElement === visualEditor || viewMode === "preview");
    if (shouldUseVisualEditor) runVisualCommand(command);
    else runSourceCommand(command);
  };

  const runShortcut = (event: KeyboardEvent<HTMLElement>) => {
    const command = resolveEditorShortcut(event) as EditorCommand | null;
    if (!command) return false;
    event.preventDefault();
    runEditorCommand(command);
    return true;
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (runShortcut(event)) return;
    if (
      event.key === "ArrowDown" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd &&
      event.currentTarget.selectionEnd === event.currentTarget.value.length
    ) {
      const next = appendTrailingEditorLine(event.currentTarget.value);
      if (next !== null) {
        event.preventDefault();
        updateActiveContent(next, true);
        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          textarea?.focus();
          textarea?.setSelectionRange(next.length, next.length);
        });
        return;
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      insertSourceMarkdown("  ", "", "");
    }
  };

  const handleVisualEditorKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (runShortcut(event)) return;
    if (
      event.key !== "ArrowDown" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const editor = visualEditorRef.current;
    if (
      !editor ||
      !isVisualCaretAtEnd(editor) ||
      countTrailingVisualLines(editor) >= 2
    ) {
      return;
    }

    event.preventDefault();
    const line = document.createElement("p");
    line.dataset.trailingEditorLine = "true";
    line.append(document.createElement("br"));
    editor.append(line);
    placeCaretAtEnd(line);
    window.requestAnimationFrame(() => {
      syncVisualEditor(false, true);
      updateVisualCursorLine();
    });
  };

  const handleVisualPaste = (event: ClipboardEvent<HTMLElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    document.execCommand("insertHTML", false, renderMarkdown(text));
    window.requestAnimationFrame(() => syncVisualEditor());
  };

  const handleVisualInput = () => {
    syncVisualEditor();
    updateVisualCursorLine();
  };

  const addTag = () => {
    const values = tagInput
      .split(/[,，\n]+/)
      .map((value) => value.trim().replace(/^#+/, "").trim())
      .filter(Boolean);
    if (!values.length) return;
    updateActive({ tags: [...new Set([...active.tags, ...values])] });
    setTagInput("");
  };

  const toggleTagPicker = () => {
    setTagSearch("");
    setCategoryPickerDraftId(null);
    setTagPicker((current) =>
      current?.draftId === active.id
        ? null
        : { draftId: active.id, selected: [] },
    );
  };

  const toggleCategoryPicker = () => {
    setCategorySearch("");
    setTagPicker(null);
    setCategoryPickerDraftId((current) =>
      current === active.id ? null : active.id,
    );
  };

  const selectBlogCategory = (name: string) => {
    updateActive({ category: name });
    setCategoryPickerDraftId(null);
    showMessage(`已选择分类「${name}」`);
  };

  const toggleSuggestedTag = (name: string) => {
    setTagPicker((current) => {
      if (!current || current.draftId !== active.id) return current;
      return {
        ...current,
        selected: current.selected.includes(name)
          ? current.selected.filter((tag) => tag !== name)
          : [...current.selected, name],
      };
    });
  };

  const selectVisibleTags = () => {
    const selectable = filteredBlogTags
      .map((tag: { name: string }) => tag.name)
      .filter((tag: string) => !active.tags.includes(tag));
    setTagPicker((current) =>
      current && current.draftId === active.id
        ? { ...current, selected: [...new Set([...current.selected, ...selectable])] }
        : current,
    );
  };

  const applySelectedTags = () => {
    if (!tagPicker || tagPicker.draftId !== active.id) return;
    const selected = tagPicker.selected.filter(
      (tag) => !active.tags.includes(tag),
    );
    if (!selected.length) return;
    updateActive({ tags: [...active.tags, ...selected] });
    setTagPicker(null);
    showMessage(`已添加 ${selected.length} 个标签`);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseMarkdownDocument(
      await file.text(),
      file.name,
      activeBlogId,
    );
    setDrafts((current) => [parsed, ...current]);
    setActiveId(parsed.id);
    event.target.value = "";
    showMessage("Markdown 已导入为本地草稿");
  };

  const downloadMarkdown = () => {
    if (!active) return;
    const blob = new Blob([serializeDraft(active)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${active.slug || "article"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    showMessage("Markdown 已导出");
  };

  const resolvePostDirectory = async (root: DirectoryHandleLike) => {
    if (root.name === "post" || root.name === "posts") {
      return {
        directory: root,
        postPath: `src/content/${root.name}`,
        blogType: (root.name === "posts" ? "mizuki" : "aruma") as BlogType,
      };
    }
    const src = await root.getDirectoryHandle("src");
    const content = await src.getDirectoryHandle("content");
    try {
      return {
        directory: await content.getDirectoryHandle("post"),
        postPath: "src/content/post",
        blogType: "aruma" as BlogType,
      };
    } catch {
      return {
        directory: await content.getDirectoryHandle("posts"),
        postPath: "src/content/posts",
        blogType: "mizuki" as BlogType,
      };
    }
  };

  const scanBrowserBlog = async (
    postDirectory: DirectoryHandleLike,
    connection: BlogConnection,
  ): Promise<BlogScanResult> => {
    if (!postDirectory.values) {
      return { connection, articles: [] };
    }
    const articles: BlogArticle[] = [];
    for await (const entry of postDirectory.values()) {
      try {
        let file: File;
        let slug: string;
        let articlePath: string;
        if (entry.kind === "file") {
          if (!/\.md$/i.test(entry.name)) continue;
          file = await entry.getFile();
          slug = entry.name.replace(/\.md$/i, "");
          articlePath = entry.name;
        } else {
          const articleFile = await entry.getFileHandle("index.md");
          file = await articleFile.getFile();
          slug = entry.name;
          articlePath = `${entry.name}/index.md`;
        }
        articles.push({
          slug,
          text: await file.text(),
          lastModified: file.lastModified,
          articlePath,
          contentHash: "",
        });
      } catch {
        // Ignore non-article folders.
      }
    }
    await Promise.all(
      articles.map(async (article) => {
        article.contentHash = await hashText(article.text);
      }),
    );
    articles.sort((a, b) => b.lastModified - a.lastModified);
    return {
      connection: {
        ...connection,
        status: "connected",
        message: "目录可读写",
        articleCount: articles.length,
        lastSyncedAt: Date.now(),
      },
      articles,
    };
  };

  const mergeScannedArticles = (
    connection: BlogConnection,
    articles: BlogArticle[],
  ) => {
    const incoming = articles.map((article) => {
      const parsed = parseMarkdownDocument(
        article.text,
        `${article.slug}.md`,
        connection.id,
      );
      parsed.id = `blog-${connection.id}-${article.slug}`;
      parsed.slug = article.slug;
      parsed.source = "published";
      parsed.createdAt = article.lastModified;
      parsed.updatedAt = article.lastModified;
      parsed.articlePath = article.articlePath;
      parsed.sourceHash = article.contentHash;
      parsed.sourceModifiedAt = article.lastModified;
      parsed.externalConflict = false;
      return parsed;
    });

    setDrafts((current) => {
      const existing = new Map(
        current
          .filter(
            (draft) =>
              draft.source === "published" && draft.blogId === connection.id,
          )
          .map((draft) => [draft.slug, draft]),
      );
      const otherDrafts = current.filter(
        (draft) =>
          draft.source !== "published" || draft.blogId !== connection.id,
      );
      const incomingSlugs = new Set(incoming.map((draft) => draft.slug));
      const missingOnDisk = [...existing.values()]
        .filter((draft) => !incomingSlugs.has(draft.slug))
        .map((draft) => ({ ...draft, externalConflict: true }));
      const synced = incoming.map((draft) => {
        const local = existing.get(draft.slug);
        if (!local) return draft;
        if (local.sourceHash && local.sourceHash !== draft.sourceHash) {
          return { ...local, externalConflict: true };
        }
        return {
          ...local,
          sourceHash: draft.sourceHash,
          sourceModifiedAt: draft.sourceModifiedAt,
          articlePath: draft.articlePath,
          externalConflict: false,
        };
      });
      return [...otherDrafts, ...synced, ...missingOnDisk];
    });
  };

  const registerScan = (result: BlogScanResult, replacedId?: string) => {
    const connection = result.connection;
    if (replacedId && replacedId !== connection.id) {
      setDrafts((current) =>
        current.map((draft) =>
          draft.blogId === replacedId
            ? { ...draft, blogId: connection.id }
            : draft,
        ),
      );
    }
    setBlogs((current) => {
      const withoutReplaced = current.filter(
        (blog) => blog.id !== connection.id && blog.id !== replacedId,
      );
      return [...withoutReplaced, connection];
    });
    setActiveBlogId(connection.id);
    mergeScannedArticles(connection, result.articles);
  };

  const connectBlog = async (replacedId?: string) => {
    setIsConnecting(true);
    try {
      let result: BlogScanResult | null = null;
      if (window.arumaDesktop) {
        result = await window.arumaDesktop.addBlog();
      } else {
        if (!window.showDirectoryPicker) {
          showMessage("当前浏览器不支持目录连接，请使用 Chrome 或 Edge");
          return null;
        }
        const root = await window.showDirectoryPicker({
          id: "compatible-blog",
          mode: "readwrite",
        });
        const resolved = await resolvePostDirectory(root);
        const id = replacedId ?? `web-${Date.now().toString(36)}`;
        const connection: BlogConnection = {
          id,
          name: root.name,
          rootPath: root.name,
          postPath: resolved.postPath,
          status: "connected",
          message: "目录可读写",
          articleCount: 0,
          lastConnectedAt: Date.now(),
          lastSyncedAt: Date.now(),
          blogType: resolved.blogType,
        };
        blogHandlesRef.current.set(id, resolved.directory);
        await saveDirectoryHandle(id, resolved.directory);
        result = await scanBrowserBlog(resolved.directory, connection);
      }

      if (!result) return null;
      registerScan(result, replacedId);
      showMessage(
        `已连接 ${result.connection.name}，读取到 ${result.articles.length} 篇文章`,
      );
      return result.connection;
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        showMessage(
          (error as Error).message ||
            "没有找到 src/content/post 或 src/content/posts",
        );
      }
      return null;
    } finally {
      setIsConnecting(false);
    }
  };

  const syncBlog = async (connection: BlogConnection) => {
    setSyncingBlogId(connection.id);
    try {
      let result: BlogScanResult;
      if (window.arumaDesktop) {
        result = await window.arumaDesktop.scanBlog(connection);
      } else {
        let handle = blogHandlesRef.current.get(connection.id);
        if (!handle) {
          handle = (await loadDirectoryHandle(connection.id)) ?? undefined;
        }
        if (!handle) {
          await connectBlog(connection.id);
          return;
        }
        const permission = handle.requestPermission
          ? await handle.requestPermission({ mode: "readwrite" })
          : "granted";
        if (permission !== "granted") {
          setBlogs((current) =>
            current.map((blog) =>
              blog.id === connection.id
                ? {
                    ...blog,
                    status: "permission",
                    message: "需要重新授权目录",
                  }
                : blog,
            ),
          );
          return;
        }
        blogHandlesRef.current.set(connection.id, handle);
        result = await scanBrowserBlog(handle, connection);
      }
      registerScan(result);
      showMessage(
        `${result.connection.name} 已同步，共 ${result.articles.length} 篇文章`,
      );
    } catch (error) {
      setBlogs((current) =>
        current.map((blog) =>
          blog.id === connection.id
            ? {
                ...blog,
                status: "missing",
                message: (error as Error).message || "博客目录不可访问",
              }
            : blog,
        ),
      );
      showMessage("同步失败，请检查博客目录");
    } finally {
      setSyncingBlogId(null);
    }
  };

  const removeBlog = async (connection: BlogConnection) => {
    if (
      !window.confirm(
        `移除“${connection.name}”连接？本地草稿会保留，博客文件不会被删除。`,
      )
    ) {
      return;
    }
    if (!window.arumaDesktop) {
      await deleteDirectoryHandle(connection.id).catch(() => {});
      blogHandlesRef.current.delete(connection.id);
    }
    setBlogs((current) => current.filter((blog) => blog.id !== connection.id));
    setDrafts((current) => {
      const remaining = current
        .filter(
          (draft) =>
            draft.source !== "published" || draft.blogId !== connection.id,
        )
        .map((draft) =>
          draft.blogId === connection.id
            ? { ...draft, blogId: null, source: "draft" as const }
            : draft,
        );
      if (!remaining.length) {
        const fresh = createDraft();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (!remaining.some((draft) => draft.id === activeId)) {
        setActiveId(remaining[0].id);
      }
      return remaining;
    });
    if (activeBlogId === connection.id) {
      setActiveBlogId(blogs.find((blog) => blog.id !== connection.id)?.id ?? null);
    }
    showMessage("博客连接已移除，文件未做任何改动");
  };

  const revealBlog = async (connection: BlogConnection) => {
    if (!window.arumaDesktop) return;
    try {
      await window.arumaDesktop.revealBlog(connection);
    } catch {
      showMessage("无法打开博客目录");
    }
  };

  const getBrowserBlogDirectory = async (connection: BlogConnection) => {
    let directory = blogHandlesRef.current.get(connection.id);
    if (!directory) {
      directory = (await loadDirectoryHandle(connection.id)) ?? undefined;
    }
    if (!directory) throw new Error("需要重新授权目标博客目录");
    const permission = directory.requestPermission
      ? await directory.requestPermission({ mode: "readwrite" })
      : "granted";
    if (permission !== "granted") throw new Error("需要写入权限才能发布到博客");
    blogHandlesRef.current.set(connection.id, directory);
    return directory;
  };

  const inspectBrowserArticle = async (
    directory: DirectoryHandleLike,
    slug: string,
    articlePath: string,
  ): Promise<ArticleInspection> => {
    try {
      const fileHandle =
        articlePath === `${slug}.md`
          ? await directory.getFileHandle(articlePath)
          : await (
              await directory.getDirectoryHandle(slug)
            ).getFileHandle("index.md");
      const file = await fileHandle.getFile();
      const text = await file.text();
      return {
        exists: true,
        text,
        hash: await hashText(text),
        lastModified: file.lastModified,
        target: articlePath,
      };
    } catch (error) {
      if ((error as Error).name !== "NotFoundError") throw error;
      return {
        exists: false,
        text: "",
        hash: null,
        lastModified: null,
        target: articlePath,
      };
    }
  };

  const preparePublish = async () => {
    if (!active || !active.slug.trim()) {
      showMessage("请先填写文章 slug");
      return;
    }
    const connection = draftBlog ?? activeBlog;
    if (!connection) {
      setConnectionManagerOpen(true);
      showMessage("请先连接博客并为草稿选择目标博客");
      return;
    }
    setIsInspecting(true);
    try {
      const safeSlug = normalizeSlug(active.slug);
      if (!safeSlug) {
        showMessage("slug 只能包含文字、数字、连字符或下划线");
        return;
      }
      const publishedArticle: Draft = {
        ...active,
        slug: safeSlug,
        blogId: connection.id,
      };
      const markdown = serializeDraft(publishedArticle);
      const articlePath = existingArticlePath(active.articlePath, safeSlug);
      let inspection: ArticleInspection;
      if (window.arumaDesktop) {
        inspection = await window.arumaDesktop.inspectArticle({
          connection,
          slug: safeSlug,
          articlePath,
        });
      } else {
        const directory = await getBrowserBlogDirectory(connection);
        inspection = await inspectBrowserArticle(
          directory,
          safeSlug,
          articlePath,
        );
      }
      const sameSourceTarget = active.articlePath === articlePath;
      const conflict =
        sameSourceTarget &&
        (active.externalConflict ||
          (active.sourceHash !== null && active.sourceHash !== inspection.hash));
      setPublishPreview({
        connection,
        article: publishedArticle,
        markdown,
        articlePath,
        inspection,
        conflict,
        diff: buildLineDiff(inspection.text, markdown) as DiffLine[],
      });
    } catch (error) {
      showMessage((error as Error).message || "无法读取目标文章");
    } finally {
      setIsInspecting(false);
    }
  };

  const confirmPublish = async () => {
    if (!publishPreview) return;
    const preview = publishPreview;
    setIsPublishing(true);
    setHistory((current) =>
      appendRevision(current, preview.article, "发布前"),
    );
    try {
      let result: PublishResult;
      if (window.arumaDesktop) {
        result = await window.arumaDesktop.publishArticle({
          connection: preview.connection,
          slug: preview.article.slug,
          markdown: preview.markdown,
          overwrite: true,
          articlePath: preview.articlePath,
          expectedHash: preview.inspection.hash,
        });
      } else {
        const directory = await getBrowserBlogDirectory(preview.connection);
        const latest = await inspectBrowserArticle(
          directory,
          preview.article.slug,
          preview.articlePath,
        );
        if (latest.hash !== preview.inspection.hash) {
          result = {
            ok: false,
            exists: latest.exists,
            target: preview.articlePath,
            conflict: true,
            inspection: latest,
          };
        } else {
          const isDirectFile =
            preview.articlePath === `${preview.article.slug}.md`;
          const fileHandle = isDirectFile
            ? await directory.getFileHandle(preview.articlePath, {
                create: true,
              })
            : await (
                await directory.getDirectoryHandle(preview.article.slug, {
                  create: true,
                })
              ).getFileHandle("index.md", { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(preview.markdown);
          await writable.close();
          result = {
            ok: true,
            exists: latest.exists,
            target: preview.articlePath,
            hash: await hashText(preview.markdown),
            lastModified: Date.now(),
          };
        }
      }

      if (result.conflict && result.inspection) {
        const inspection = result.inspection;
        setPublishPreview({
          ...preview,
          inspection,
          conflict: true,
          diff: buildLineDiff(inspection.text, preview.markdown) as DiffLine[],
        });
        showMessage("目标文件刚刚发生变化，差异已刷新，请重新确认");
        return;
      }
      if (!result.ok) throw new Error("文章写入失败");

      const nextFrontmatter = mergeArticleFrontmatter(
        preview.article.frontmatter,
        preview.article,
      ) as Record<string, unknown>;
      setActiveBlogId(preview.connection.id);
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === preview.article.id
            ? {
                ...preview.article,
                source: "published",
                articlePath: preview.articlePath,
                frontmatter: nextFrontmatter,
                sourceHash: result.hash ?? null,
                sourceModifiedAt: result.lastModified ?? Date.now(),
                externalConflict: false,
                updatedAt: Date.now(),
              }
            : draft,
        ),
      );
      setPublishPreview(null);
      showMessage(
        preview.article.draft
          ? `草稿已写入 ${preview.connection.name}，博客将保持隐藏`
          : `文章已写入 ${preview.connection.name}，可以预览或提交了`,
      );
    } catch (error) {
      showMessage((error as Error).message || "写入失败，请检查博客连接");
    } finally {
      setIsPublishing(false);
    }
  };

  const loadDiskVersion = () => {
    if (!publishPreview?.inspection.exists) return;
    const preview = publishPreview;
    setHistory((current) =>
      appendRevision(current, preview.article, "恢复前"),
    );
    const diskDraft = parseMarkdownDocument(
      preview.inspection.text,
      `${preview.article.slug}.md`,
      preview.connection.id,
    );
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === preview.article.id
          ? {
              ...diskDraft,
              id: draft.id,
              slug: preview.article.slug,
              createdAt: draft.createdAt,
              source: "published",
              articlePath: preview.articlePath,
              sourceHash: preview.inspection.hash,
              sourceModifiedAt: preview.inspection.lastModified,
              externalConflict: false,
            }
          : draft,
      ),
    );
    setPublishPreview(null);
    showMessage("已载入磁盘版本，恢复前内容保存在版本历史中");
  };

  const restoreRevision = (revision: DraftRevision) => {
    if (!active) return;
    setHistory((current) =>
      appendRevision(current, active, "恢复前"),
    );
    const restored = normalizeDraft(structuredClone(revision.snapshot));
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === active.id
          ? {
              ...restored,
              id: active.id,
              updatedAt: Date.now(),
            }
          : draft,
      ),
    );
    setHistoryOpen(false);
    showMessage("历史版本已恢复，恢复前内容也已备份");
  };

  const activeRevisions = history.filter(
    (revision) => revision.draftId === active?.id,
  );
  const publishChanges = publishPreview
    ? diffSummary(publishPreview.diff)
    : { added: 0, removed: 0 };
  const visiblePublishDiff = publishPreview
    ? compactDiff(publishPreview.diff)
    : [];

  if (!active) return null;

  return (
    <div className={isDark ? "app theme-dark" : "app"}>
      <div className="background" aria-hidden="true" />
      <div className="background-wash" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar-start">
          <button
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="打开草稿列表"
          >
            <Menu size={20} />
          </button>
          <button
            className="brand"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="切换草稿侧栏"
          >
            <span className="brand-mark">
              <PenLine size={18} />
            </span>
            <span>
              <strong>Aruma</strong>
              <small>EDITOR</small>
            </span>
          </button>
          <span className="topbar-divider" />
          <div className="document-title">
            <span>{active.title || "无标题文章"}</span>
            <small>
              {saveState === "saving" ? (
                "正在保存…"
              ) : (
                <>
                  <Check size={12} /> 已保存到本机
                </>
              )}
            </small>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className="icon-button"
            onClick={() => setIsDark((dark) => !dark)}
            aria-label={isDark ? "切换浅色主题" : "切换深色主题"}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="secondary-button compact" onClick={downloadMarkdown}>
            <Download size={16} />
            <span>导出</span>
          </button>
          <button
            className="publish-button"
            onClick={preparePublish}
            disabled={isPublishing || isInspecting}
          >
            <GitCompare size={16} />
            {isInspecting
              ? "正在检查…"
              : draftBlog
                ? `检查并发布到 ${draftBlog.name}`
                : "检查并发布"}
          </button>
          <button
            className="icon-button details-toggle"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-label="切换文章设置"
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? "is-open" : "is-closed"}`}>
          <div className="profile-card">
            {/* The desktop renderer bundles this local asset and does not need Next image optimization. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${assetRoot}/aruma-avatar.webp`}
              alt="Aruma 博客头像"
            />
            <div>
              <strong>To The Neri</strong>
              <span>没有梦想的拾音喵</span>
            </div>
            <button
              className="icon-button sidebar-collapse"
              onClick={() => setSidebarOpen(false)}
              aria-label="收起侧栏"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <button className="new-draft" onClick={addDraft}>
            <Plus size={18} /> 新建文章
            <span>⌘ N</span>
          </button>

          <label className="search-box">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索草稿…"
              aria-label="搜索草稿"
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="清空搜索">
                <X size={14} />
              </button>
            )}
          </label>

          <div className="list-heading">
            <span>最近文章</span>
            <small>{filteredDrafts.length}</small>
          </div>

          <div className="draft-list">
            {filteredDrafts.map((draft) => (
              <button
                key={draft.id}
                className={`draft-item ${draft.id === active.id ? "active" : ""}`}
                onClick={() => {
                  setActiveId(draft.id);
                  if (window.innerWidth < 900) setSidebarOpen(false);
                }}
              >
                <span className="draft-icon">
                  {draft.source === "published" ? (
                    <Archive size={17} />
                  ) : (
                    <FileText size={17} />
                  )}
                </span>
                <span className="draft-copy">
                  <strong>{draft.title || "无标题文章"}</strong>
                  <small>
                    {draft.category || "未分类"} ·{" "}
                    {blogs.find((blog) => blog.id === draft.blogId)?.name ?? "仅本地"}
                    {" · "}
                    {relativeTime(draft.updatedAt)}
                  </small>
                </span>
                {draft.externalConflict && (
                  <ShieldAlert
                    className="draft-conflict"
                    size={15}
                    aria-label="磁盘版本已变化"
                  />
                )}
                {draft.draft && <i className="draft-dot" title="草稿" />}
              </button>
            ))}
            {!filteredDrafts.length && (
              <div className="empty-list">
                <Search size={22} />
                <span>没有找到匹配的文章</span>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <button onClick={() => setConnectionManagerOpen(true)}>
              <FolderHeart size={17} />
              <span>
                <strong>{activeBlog?.name || "管理博客连接"}</strong>
                <small>
                  {blogs.length
                    ? `${blogs.length} 个博客 · ${activeBlog?.message ?? "选择当前博客"}`
                    : "连接后即可读取和发布文章"}
                </small>
              </span>
              <i
                className={
                  activeBlog?.status === "connected" ? "status online" : "status"
                }
              />
            </button>
            <button onClick={() => fileInputRef.current?.click()}>
              <Upload size={17} />
              <span>
                <strong>导入 Markdown</strong>
                <small>保留已有 Frontmatter</small>
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={importFile}
              hidden
            />
          </div>
        </aside>

        {!sidebarOpen && (
          <button
            className="reopen-panel reopen-left"
            onClick={() => setSidebarOpen(true)}
            aria-label="展开草稿列表"
          >
            <FileText size={17} />
          </button>
        )}

        <main className="editor-shell">
          <section className="editor-card">
            <div className="editor-heading">
              <input
                className="title-input"
                value={active.title}
                onChange={(event) => updateActive({ title: event.target.value })}
                placeholder="无标题文章"
                aria-label="文章标题"
              />
              <div className="editor-subline">
                <span>{active.published}</span>
                <span>·</span>
                <span>{wordCount(active.content)} 字</span>
                <span>·</span>
                <span>约 {readingMinutes(active.content)} 分钟阅读</span>
              </div>
            </div>

            <div className="editor-toolbar" role="toolbar" aria-label="Markdown 工具栏">
              <div
                className="format-actions"
                onMouseDown={(event) => event.preventDefault()}
              >
                <button onClick={() => runEditorCommand("undo")} title="撤回 · Ctrl / ⌘ + Z">
                  <RotateCcw size={17} />
                </button>
                <span />
                <button onClick={() => runEditorCommand("h2")} title="二级标题 · Ctrl / ⌘ + 2">
                  <Heading2 size={17} />
                </button>
                <button onClick={() => runEditorCommand("bold")} title="粗体 · Ctrl / ⌘ + B">
                  <Bold size={17} />
                </button>
                <button onClick={() => runEditorCommand("italic")} title="斜体 · Ctrl / ⌘ + I">
                  <Italic size={17} />
                </button>
                <span />
                <button onClick={() => runEditorCommand("link")} title="链接 · Ctrl / ⌘ + K">
                  <Link2 size={17} />
                </button>
                <button onClick={() => runEditorCommand("image")} title="图片">
                  <ImageIcon size={17} />
                </button>
                <button onClick={() => runEditorCommand("quote")} title="引用 · Ctrl / ⌘ + Shift + Q">
                  <Quote size={17} />
                </button>
                <button onClick={() => runEditorCommand("bullet-list")} title="无序列表 · Ctrl / ⌘ + Shift + 8">
                  <List size={17} />
                </button>
                <button onClick={() => runEditorCommand("code")} title="行内代码 · Ctrl / ⌘ + `">
                  <Code2 size={17} />
                </button>
                <button onClick={() => runEditorCommand("horizontal-rule")} title="分割线">
                  <MoreHorizontal size={17} />
                </button>
              </div>

              <div className="editor-toolbar-end">
                <details className="shortcut-help">
                  <summary title="查看快捷键">
                    <KeyboardIcon size={15} />
                    <span>快捷键</span>
                  </summary>
                  <div className="shortcut-popover">
                    <strong>常用编辑快捷键</strong>
                    <span><kbd>Ctrl / ⌘ + Z</kbd> 撤回正文修改</span>
                    <span><kbd>Ctrl / ⌘ + 1…6</kbd> 标题 1…6</span>
                    <span><kbd>Ctrl / ⌘ + 0</kbd> 正文段落</span>
                    <span><kbd>Ctrl / ⌘ + B</kbd> 加粗</span>
                    <span><kbd>Ctrl / ⌘ + I</kbd> 斜体</span>
                    <span><kbd>Ctrl / ⌘ + K</kbd> 链接</span>
                    <span><kbd>Ctrl / ⌘ + `</kbd> 行内代码</span>
                    <span><kbd>Ctrl / ⌘ + Shift + 7 / 8</kbd> 有序 / 无序列表</span>
                    <span><kbd>Ctrl / ⌘ + Shift + Q</kbd> 引用</span>
                    <span><kbd>Ctrl / ⌘ + Shift + X</kbd> 删除线</span>
                  </div>
                </details>

                <div className="view-switcher" aria-label="编辑视图">
                  <button
                    className={viewMode === "write" ? "active" : ""}
                    onClick={() => setViewMode("write")}
                    title="Markdown 源码"
                  >
                    <PenLine size={15} />
                    <span>源码</span>
                  </button>
                  <button
                    className={viewMode === "split" ? "active" : ""}
                    onClick={() => setViewMode("split")}
                    title="分栏"
                  >
                    <Columns2 size={15} />
                    <span>分栏</span>
                  </button>
                  <button
                    className={viewMode === "preview" ? "active" : ""}
                    onClick={() => setViewMode("preview")}
                    title="即时排版编辑"
                  >
                    <Eye size={15} />
                    <span>即时编辑</span>
                  </button>
                </div>
              </div>
            </div>

            <div className={`writing-area mode-${viewMode}`}>
              {viewMode !== "preview" && (
                <div className="source-pane">
                  <div className="pane-label">
                    <span>MARKDOWN</span>
                    <small>支持 Ctrl / ⌘ + S 保存</small>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={active.content}
                    onChange={(event) => updateActiveContent(event.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    onSelect={(event) =>
                      setCursorLine(
                        event.currentTarget.value
                          .slice(0, event.currentTarget.selectionStart)
                          .split("\n").length,
                      )
                    }
                    spellCheck={false}
                    aria-label="Markdown 正文"
                  />
                </div>
              )}
              {viewMode !== "write" && (
                <div className="preview-pane">
                  <div className="pane-label">
                    <span>INSTANT EDITOR</span>
                    <small>连续编辑 · 文末 ↓ 最多补两行</small>
                  </div>
                  <article
                    ref={visualEditorRef}
                    className="markdown-body typora-editor"
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-label="即时排版 Markdown 编辑器"
                    aria-multiline="true"
                    data-placeholder="从这里开始写作…"
                    onInput={handleVisualInput}
                    onKeyDown={handleVisualEditorKeyDown}
                    onKeyUp={updateVisualCursorLine}
                    onClick={updateVisualCursorLine}
                    onPaste={handleVisualPaste}
                    onCompositionStart={() => {
                      visualComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      visualComposingRef.current = false;
                      syncVisualEditor();
                    }}
                    onBlur={() => syncVisualEditor(true)}
                    spellCheck
                  />
                </div>
              )}
            </div>

            <div className="editor-statusbar">
              <span><Hash size={13} /> Markdown</span>
              <span>UTF-8</span>
              <span>Ln {cursorLine}</span>
              <span className="status-spacer" />
              <span className="autosave"><i /> 自动保存已开启</span>
            </div>
          </section>
        </main>

        <aside className={`details-panel ${detailsOpen ? "is-open" : "is-closed"}`}>
          <div className="details-header">
            <div>
              <strong>文章设置</strong>
              <span>Frontmatter</span>
            </div>
            <button
              className="icon-button"
              onClick={() => setDetailsOpen(false)}
              aria-label="收起文章设置"
            >
              <PanelRightClose size={18} />
            </button>
          </div>

          <div className="details-scroll">
            <div className="blog-binding-section">
              <div className="section-title-row">
                <span>草稿绑定</span>
                <small>{draftBlog ? "已连接" : "本地"}</small>
              </div>
              <label className="blog-select-label">
                <span>目标博客</span>
                <select
                  value={active.blogId ?? ""}
                  onChange={(event) => {
                    const blogId = event.target.value || null;
                    updateActive({ blogId });
                    if (blogId) setActiveBlogId(blogId);
                  }}
                  aria-label="当前草稿的目标博客"
                >
                  <option value="">仅保存在本地</option>
                  {blogs.map((blog) => (
                    <option key={blog.id} value={blog.id}>
                      {blog.name}
                      {blog.status === "connected" ? "" : "（需重连）"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="binding-summary">
                <HardDrive size={15} />
                <span>
                  <strong>{draftBlog?.name ?? "未绑定博客"}</strong>
                  <small>
                    {draftBlog?.rootPath ?? "发布前可以随时选择目标博客"}
                  </small>
                </span>
                <button onClick={() => setConnectionManagerOpen(true)}>
                  管理
                </button>
              </div>
            </div>

            <div className="details-divider" />

            <button
              className="section-heading"
              onClick={() => setMetadataOpen((open) => !open)}
            >
              <span>基础信息</span>
              <ChevronDown className={metadataOpen ? "rotated" : ""} size={16} />
            </button>

            {metadataOpen && (
              <div className="metadata-form">
                <label>
                  <span>文章路径 SLUG</span>
                  <input
                    value={active.slug}
                    onChange={(event) => updateActive({ slug: normalizeSlug(event.target.value) })}
                    placeholder="my-new-post"
                  />
                  <small>/post/{active.slug || "my-new-post"}/</small>
                </label>

                <div className="form-row">
                  <label>
                    <span>发布日期</span>
                    <input
                      type="date"
                      value={active.published}
                      onChange={(event) => updateActive({ published: event.target.value })}
                    />
                  </label>
                  <div className="category-field">
                    <label>
                      <span>分类</span>
                      <input
                        value={active.category}
                        onChange={(event) => updateActive({ category: event.target.value })}
                        placeholder="日常"
                      />
                    </label>
                    {tagBlog && (
                      <button
                        className="category-picker-trigger"
                        onClick={toggleCategoryPicker}
                        aria-expanded={categoryPickerDraftId === active.id}
                      >
                        <FolderHeart size={12} />
                        <span>从 {tagBlog.name} 选择</span>
                        <ChevronDown
                          className={categoryPickerDraftId === active.id ? "rotated" : ""}
                          size={12}
                        />
                      </button>
                    )}
                    {categoryPickerDraftId === active.id && (
                      <div className="category-picker-popover">
                        <label className="tag-picker-search">
                          <Search size={13} />
                          <input
                            value={categorySearch}
                            onChange={(event) => setCategorySearch(event.target.value)}
                            placeholder="搜索已有分类"
                            autoFocus
                          />
                          {categorySearch && (
                            <button
                              onClick={() => setCategorySearch("")}
                              aria-label="清空分类搜索"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </label>
                        <div className="category-suggestions">
                          {filteredBlogCategories.map(
                            (category: { name: string; count: number }) => (
                              <button
                                key={category.name}
                                className={active.category === category.name ? "active" : ""}
                                onClick={() => selectBlogCategory(category.name)}
                              >
                                <span>{category.name}</span>
                                <small>{category.count} 篇文章</small>
                              </button>
                            ),
                          )}
                          {!filteredBlogCategories.length && (
                            <div className="tag-picker-empty">
                              {blogCategories.length
                                ? "没有匹配的分类"
                                : "博客文章中还没有可复用的分类"}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <label>
                  <span>作者</span>
                  <input
                    value={active.author}
                    onChange={(event) => updateActive({ author: event.target.value })}
                    placeholder="拾音"
                  />
                </label>

                <label>
                  <span>文章摘要</span>
                  <textarea
                    value={active.description}
                    onChange={(event) => updateActive({ description: event.target.value })}
                    placeholder="一句话介绍这篇文章"
                    rows={3}
                    maxLength={180}
                  />
                  <small>{active.description.length} / 180</small>
                </label>

                <label>
                  <span>头图路径</span>
                  <input
                    value={active.heroImage}
                    onChange={(event) => updateActive({ heroImage: event.target.value })}
                    placeholder="./cover.webp（可选）"
                  />
                </label>
              </div>
            )}

            <div className="details-divider" />

            <div className="tag-section">
              <div className="section-title-row">
                <span>标签</span>
                <small>{active.tags.length}</small>
              </div>
              <div className="tag-list">
                {active.tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => updateActive({ tags: active.tags.filter((item) => item !== tag) })}
                    title="移除标签"
                  >
                    <Tag size={12} /> {tag} <X size={11} />
                  </button>
                ))}
              </div>
              <label className="tag-input">
                <Plus size={15} />
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder="可粘贴多个，以逗号分隔"
                />
              </label>
              {tagBlog && (
                <button
                  className="tag-picker-trigger"
                  onClick={toggleTagPicker}
                  aria-expanded={tagPicker?.draftId === active.id}
                >
                  <Tag size={14} />
                  <span>
                    <strong>从 {tagBlog.name} 选择</strong>
                    <small>{blogTags.length} 个已有标签</small>
                  </span>
                  <ChevronDown
                    className={tagPicker?.draftId === active.id ? "rotated" : ""}
                    size={14}
                  />
                </button>
              )}
              {tagPicker?.draftId === active.id && (
                <div className="tag-picker-popover">
                  <label className="tag-picker-search">
                    <Search size={13} />
                    <input
                      value={tagSearch}
                      onChange={(event) => setTagSearch(event.target.value)}
                      placeholder="搜索已有标签"
                      autoFocus
                    />
                    {tagSearch && (
                      <button
                        onClick={() => setTagSearch("")}
                        aria-label="清空标签搜索"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </label>
                  <div className="tag-picker-actions">
                    <button onClick={selectVisibleTags}>选择筛选结果</button>
                    <small>{tagPicker.selected.length} 个待添加</small>
                  </div>
                  <div className="tag-suggestions">
                    {filteredBlogTags.map(
                      (tag: { name: string; count: number }) => {
                        const isAdded = active.tags.includes(tag.name);
                        const isSelected = tagPicker.selected.includes(tag.name);
                        return (
                          <label
                            key={tag.name}
                            className={isAdded ? "is-added" : ""}
                          >
                            <input
                              type="checkbox"
                              checked={isAdded || isSelected}
                              disabled={isAdded}
                              onChange={() => toggleSuggestedTag(tag.name)}
                            />
                            <span>{tag.name}</span>
                            <small>
                              {isAdded ? "已添加" : `${tag.count} 篇文章`}
                            </small>
                          </label>
                        );
                      },
                    )}
                    {!filteredBlogTags.length && (
                      <div className="tag-picker-empty">
                        {blogTags.length
                          ? "没有匹配的标签"
                          : "博客文章中还没有可复用的标签"}
                      </div>
                    )}
                  </div>
                  <div className="tag-picker-footer">
                    <button onClick={() => setTagPicker(null)}>取消</button>
                    <button
                      className="primary"
                      onClick={applySelectedTags}
                      disabled={!tagPicker.selected.length}
                    >
                      添加 {tagPicker.selected.length} 个标签
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="details-divider" />

            <div className="switch-list">
              <label>
                <span>
                  <strong>置顶文章</strong>
                  <small>在博客首页优先展示</small>
                </span>
                <input
                  type="checkbox"
                  checked={active.pinned}
                  onChange={(event) => updateActive({ pinned: event.target.checked })}
                />
                <i />
              </label>
              <label>
                <span>
                  <strong>保留草稿状态</strong>
                  <small>发布时不在博客中展示</small>
                </span>
                <input
                  type="checkbox"
                  checked={active.draft}
                  onChange={(event) => updateActive({ draft: event.target.checked })}
                />
                <i />
              </label>
            </div>

            <div className="details-divider" />

            <div className="document-actions">
              <button onClick={() => setHistoryOpen(true)}>
                <History size={16} /> 版本历史
                <small>{activeRevisions.length}</small>
              </button>
              <button onClick={downloadMarkdown}>
                <FileDown size={16} /> 导出 Markdown
              </button>
              <button className="danger" onClick={removeDraft}>
                <Trash2 size={16} />
                {active.source === "published" ? "从列表移除" : "删除这篇草稿"}
              </button>
            </div>
          </div>
        </aside>

        {!detailsOpen && (
          <button
            className="reopen-panel reopen-right"
            onClick={() => setDetailsOpen(true)}
            aria-label="展开文章设置"
          >
            <Settings2 size={17} />
          </button>
        )}
      </div>

      {publishPreview && (
        <div className="modal-backdrop">
          <section
            className="publish-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-preview-title"
          >
            <header>
              <div>
                <span className="modal-kicker">SAFE PUBLISH</span>
                <h2 id="publish-preview-title">发布前检查</h2>
                <p>确认目标、草稿状态与文件差异后才会写入博客。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setPublishPreview(null)}
                aria-label="关闭发布前检查"
                disabled={isPublishing}
              >
                <X size={19} />
              </button>
            </header>

            <div className="publish-preview-body">
              <div
                className={`publish-safety-banner ${
                  publishPreview.conflict ? "is-conflict" : ""
                }`}
              >
                {publishPreview.conflict ? (
                  <ShieldAlert size={20} />
                ) : (
                  <Check size={20} />
                )}
                <div>
                  <strong>
                    {publishPreview.conflict
                      ? "检测到磁盘版本已在外部修改"
                      : publishPreview.inspection.exists
                        ? "目标文件已读取，可以安全覆盖"
                        : "这是一个新文章文件"}
                  </strong>
                  <span>
                    {publishPreview.conflict
                      ? "请查看差异；也可以载入磁盘版本，当前内容会先进入历史。"
                      : "写入时还会再次核验文件，防止确认后发生变化。"}
                  </span>
                </div>
              </div>

              <div className="publish-facts">
                <div>
                  <span>目标博客</span>
                  <strong>{publishPreview.connection.name}</strong>
                </div>
                <div>
                  <span>文件路径</span>
                  <strong>{publishPreview.articlePath}</strong>
                </div>
                <div>
                  <span>博客状态</span>
                  <strong>
                    {publishPreview.article.draft ? "草稿 · 不公开" : "正式发布"}
                  </strong>
                </div>
                <div>
                  <span>内容变化</span>
                  <strong>
                    <i className="diff-added">+{publishChanges.added}</i>{" "}
                    <i className="diff-removed">-{publishChanges.removed}</i>
                  </strong>
                </div>
              </div>

              <div className="diff-heading">
                <span>磁盘版本</span>
                <GitCompare size={15} />
                <span>编辑器版本</span>
              </div>
              <div className="diff-view" role="region" aria-label="发布差异">
                {visiblePublishDiff.map((line, index) => (
                  <div
                    className={`diff-line diff-${line.type}`}
                    key={`${index}-${line.type}`}
                  >
                    <span>{line.oldLine ?? ""}</span>
                    <span>{line.newLine ?? ""}</span>
                    <b>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</b>
                    <code>{line.text || " "}</code>
                  </div>
                ))}
              </div>
            </div>

            <footer>
              <div>
                {publishPreview.inspection.exists && (
                  <button
                    className="secondary-button"
                    onClick={loadDiskVersion}
                    disabled={isPublishing}
                  >
                    <RotateCcw size={15} /> 载入磁盘版本
                  </button>
                )}
              </div>
              <div>
                <button
                  className="secondary-button"
                  onClick={() => setPublishPreview(null)}
                  disabled={isPublishing}
                >
                  取消
                </button>
                <button
                  className={`publish-button ${
                    publishPreview.conflict ? "danger-publish" : ""
                  }`}
                  onClick={confirmPublish}
                  disabled={isPublishing}
                >
                  <Sparkles size={16} />
                  {isPublishing
                    ? "正在安全写入…"
                    : publishPreview.conflict
                      ? "确认覆盖磁盘版本"
                      : publishPreview.article.draft
                        ? "写入为博客草稿"
                        : "确认发布"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {historyOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHistoryOpen(false);
          }}
        >
          <section
            className="history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <header>
              <div>
                <span className="modal-kicker">LOCAL HISTORY</span>
                <h2 id="history-title">版本历史</h2>
                <p>每篇文章最多保留 20 个本地版本，恢复前会自动再备份一次。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setHistoryOpen(false)}
                aria-label="关闭版本历史"
              >
                <X size={19} />
              </button>
            </header>
            <div className="history-list">
              {activeRevisions.map((revision) => (
                <article key={revision.id}>
                  <span className="history-icon">
                    <History size={17} />
                  </span>
                  <div>
                    <strong>{revision.reason}</strong>
                    <span>
                      {new Intl.DateTimeFormat("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(revision.createdAt)}
                    </span>
                    <small>
                      {wordCount(revision.snapshot.content)} 字 · {revision.snapshot.slug}
                    </small>
                  </div>
                  <button onClick={() => restoreRevision(revision)}>
                    <RotateCcw size={14} /> 恢复
                  </button>
                </article>
              ))}
              {!activeRevisions.length && (
                <div className="history-empty">
                  <History size={28} />
                  <strong>还没有历史版本</strong>
                  <span>停止编辑 15 秒或按 Ctrl / Cmd + S 后会自动创建。</span>
                </div>
              )}
            </div>
            <footer>
              <span>历史仅保存在这台设备中，不会上传文章内容。</span>
              <button
                className="secondary-button"
                onClick={() => setHistoryOpen(false)}
              >
                完成
              </button>
            </footer>
          </section>
        </div>
      )}

      {connectionManagerOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConnectionManagerOpen(false);
            }
          }}
        >
          <section
            className="connection-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-manager-title"
          >
            <header>
              <div>
                <span className="modal-kicker">WORKSPACE</span>
                <h2 id="connection-manager-title">博客连接管理</h2>
                <p>一个草稿只绑定一个目标博客，移除连接不会删除任何文件。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setConnectionManagerOpen(false)}
                aria-label="关闭博客连接管理"
              >
                <X size={19} />
              </button>
            </header>

            <div className="connection-list">
              {blogs.map((blog) => (
                <article
                  key={blog.id}
                  className={`connection-card ${
                    activeBlogId === blog.id ? "is-current" : ""
                  }`}
                >
                  <div className="connection-card-main">
                    <span
                      className={`connection-icon status-${blog.status}`}
                      aria-hidden="true"
                    >
                      <FolderHeart size={20} />
                    </span>
                    <div>
                      <div className="connection-name-row">
                        <strong>{blog.name}</strong>
                        {activeBlogId === blog.id && <em>当前</em>}
                      </div>
                      <span className="connection-path">{blog.rootPath}</span>
                      <small>
                        {blog.message} · {blog.articleCount} 篇文章
                      </small>
                    </div>
                  </div>
                  <div className="connection-actions">
                    <button
                      onClick={() => {
                        setActiveBlogId(blog.id);
                        updateActive({ blogId: blog.id });
                        showMessage(`当前草稿已绑定到 ${blog.name}`);
                      }}
                    >
                      <Check size={14} /> 绑定当前草稿
                    </button>
                    <button
                      onClick={() => syncBlog(blog)}
                      disabled={syncingBlogId === blog.id}
                    >
                      <RefreshCw
                        size={14}
                        className={syncingBlogId === blog.id ? "spinning" : ""}
                      />
                      {syncingBlogId === blog.id ? "同步中" : "同步"}
                    </button>
                    {window.arumaDesktop && (
                      <button onClick={() => revealBlog(blog)}>
                        <FolderOpen size={14} /> 打开目录
                      </button>
                    )}
                    {blog.status !== "connected" && (
                      <button onClick={() => connectBlog(blog.id)}>
                        <FolderHeart size={14} /> 重连
                      </button>
                    )}
                    <button className="danger" onClick={() => removeBlog(blog)}>
                      <Trash2 size={14} /> 移除
                    </button>
                  </div>
                </article>
              ))}

              {!blogs.length && (
                <div className="connection-empty">
                  <FolderHeart size={30} />
                  <strong>还没有连接博客</strong>
                  <span>
                    选择 Aruma 或 Mizuki 根目录，编辑器会自动识别文章目录。
                  </span>
                </div>
              )}
            </div>

            <footer>
              <span>
                {window.arumaDesktop
                  ? "桌面版会在本机安全保存连接路径"
                  : "浏览器可能在重启后要求重新授权目录"}
              </span>
              <div>
                <button
                  className="secondary-button"
                  onClick={() => setConnectionManagerOpen(false)}
                >
                  完成
                </button>
                <button
                  className="publish-button"
                  onClick={() => connectBlog()}
                  disabled={isConnecting}
                >
                  <Plus size={16} />
                  {isConnecting ? "正在连接…" : "添加博客"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={17} /> {toast}
        </div>
      )}
    </div>
  );
}
