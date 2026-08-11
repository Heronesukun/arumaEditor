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
  Hash,
  HardDrive,
  Heading2,
  Image as ImageIcon,
  Italic,
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
  Search,
  Settings2,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { dump, load } from "js-yaml";
import { marked } from "marked";
import {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ViewMode = "write" | "split" | "preview";
type ArticleSource = "draft" | "imported" | "published";

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
};

type BlogArticle = {
  slug: string;
  text: string;
  lastModified: number;
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
};

type DesktopBridge = {
  platform: string;
  loadWorkspace: () => Promise<WorkspaceSnapshot>;
  saveWorkspace: (workspace: WorkspaceSnapshot) => Promise<{ ok: boolean }>;
  addBlog: () => Promise<BlogScanResult | null>;
  scanBlog: (connection: BlogConnection) => Promise<BlogScanResult>;
  publishArticle: (request: {
    connection: BlogConnection;
    slug: string;
    markdown: string;
    overwrite: boolean;
  }) => Promise<{ ok: boolean; exists: boolean; target: string }>;
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
  values?: () => AsyncIterable<DirectoryHandleLike>;
};

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
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  let data: Record<string, unknown> = {};
  let content = text;

  if (frontmatter) {
    try {
      data = (load(frontmatter[1]) as Record<string, unknown>) ?? {};
      content = text.slice(frontmatter[0].length);
    } catch {
      data = {};
    }
  }

  const fileSlug = fileName.replace(/\.(md|markdown)$/i, "");
  return {
    id: `import-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title: String(data.title ?? fileSlug ?? "导入的文章"),
    slug: String(data.slug ?? fileSlug ?? `article-${today()}`),
    published: cleanDate(data.published ?? data.pubDate),
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
    heroImage: String(data.heroImage ?? ""),
    content,
    createdAt: now,
    updatedAt: now,
    source: "imported",
    blogId,
  };
}

function normalizeDraft(value: Draft): Draft {
  return { ...value, blogId: value.blogId ?? null };
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
  const metadata: Record<string, unknown> = {
    title: article.title,
    published: article.published,
    pubDate: article.published,
    pinned: article.pinned,
    description: article.description,
    tags: article.tags,
    author: article.author,
    draft: article.draft,
    category: article.category,
  };
  if (article.heroImage.trim()) metadata.heroImage = article.heroImage.trim();

  const yaml = dump(metadata, {
    noRefs: true,
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  }).trim();
  return `---\n${yaml}\n---\n\n${article.content.trimEnd()}\n`;
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

export default function Home() {
  const [drafts, setDrafts] = useState<Draft[]>([starterDraft]);
  const [activeId, setActiveId] = useState(starterDraft.id);
  const [hydrated, setHydrated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [search, setSearch] = useState("");
  const [tagInput, setTagInput] = useState("");
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

        if (window.arumaDesktop) {
          const workspace = await window.arumaDesktop.loadWorkspace();
          restoredDrafts = workspace.drafts.map(normalizeDraft);
          restoredActiveId = workspace.activeId;
          restoredBlogs = workspace.blogs;
          restoredActiveBlogId = workspace.activeBlogId;
          restoredTheme = workspace.isDark;
        } else {
          const storedDrafts = localStorage.getItem(STORAGE_KEY);
          const storedBlogs = localStorage.getItem(BLOGS_KEY);
          restoredDrafts = storedDrafts
            ? (JSON.parse(storedDrafts) as Draft[]).map(normalizeDraft)
            : [];
          restoredActiveId = localStorage.getItem(ACTIVE_KEY);
          restoredActiveBlogId = localStorage.getItem(ACTIVE_BLOG_KEY);
          restoredTheme = localStorage.getItem(THEME_KEY) === "dark";

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

  useEffect(() => {
    if (!hydrated) return;
    // This status mirrors the delayed workspace synchronization below.
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const workspace: WorkspaceSnapshot = {
          version: 1,
          drafts,
          activeId,
          isDark,
          blogs,
          activeBlogId,
        };
        if (window.arumaDesktop) {
          await window.arumaDesktop.saveWorkspace(workspace);
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
          localStorage.setItem(ACTIVE_KEY, activeId);
          localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
          localStorage.setItem(BLOGS_KEY, JSON.stringify(blogs));
          if (activeBlogId) {
            localStorage.setItem(ACTIVE_BLOG_KEY, activeBlogId);
          } else {
            localStorage.removeItem(ACTIVE_BLOG_KEY);
          }
        }
        setSaveState("saved");
      } catch {
        setToast("工作区保存失败，请先导出重要草稿");
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [activeBlogId, activeId, blogs, drafts, hydrated, isDark]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSaveState("saved");
        setToast("草稿已保存到本机");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

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

  const previewHtml = useMemo(() => {
    return marked.parse(active?.content ?? "", {
      breaks: true,
      gfm: true,
      renderer: previewRenderer,
    }) as string;
  }, [active?.content]);

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

  const insertMarkdown = (
    before: string,
    after = "",
    placeholder = "在这里输入文字",
  ) => {
    const textarea = textareaRef.current;
    if (!textarea || !active) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = active.content.slice(start, end) || placeholder;
    const next =
      active.content.slice(0, start) +
      before +
      selection +
      after +
      active.content.slice(end);
    updateActive({ content: next });
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selection.length,
      );
    });
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      insertMarkdown("  ", "", "");
    }
  };

  const addTag = () => {
    const value = tagInput.trim().replace(/^#/, "");
    if (!value || active.tags.includes(value)) return;
    updateActive({ tags: [...active.tags, value] });
    setTagInput("");
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
    if (root.name === "post") return root;
    const src = await root.getDirectoryHandle("src");
    const content = await src.getDirectoryHandle("content");
    return content.getDirectoryHandle("post");
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
      if (entry.kind !== "directory") continue;
      try {
        const articleFile = await entry.getFileHandle("index.md");
        const file = await articleFile.getFile();
        articles.push({
          slug: entry.name,
          text: await file.text(),
          lastModified: file.lastModified,
        });
      } catch {
        // Ignore non-article folders.
      }
    }
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
      const synced = incoming.map((draft) => existing.get(draft.slug) ?? draft);
      return [...otherDrafts, ...synced];
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
          id: "aruma-blog",
          mode: "readwrite",
        });
        const postDirectory = await resolvePostDirectory(root);
        const id = replacedId ?? `web-${Date.now().toString(36)}`;
        const connection: BlogConnection = {
          id,
          name: root.name,
          rootPath: root.name,
          postPath: "src/content/post",
          status: "connected",
          message: "目录可读写",
          articleCount: 0,
          lastConnectedAt: Date.now(),
          lastSyncedAt: Date.now(),
        };
        blogHandlesRef.current.set(id, postDirectory);
        await saveDirectoryHandle(id, postDirectory);
        result = await scanBrowserBlog(postDirectory, connection);
      }

      if (!result) return null;
      registerScan(result, replacedId);
      showMessage(
        `已连接 ${result.connection.name}，读取到 ${result.articles.length} 篇文章`,
      );
      return result.connection;
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        showMessage((error as Error).message || "没有找到 Aruma 博客目录");
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

  const publishToBlog = async () => {
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
    setIsPublishing(true);
    try {
      const safeSlug = normalizeSlug(active.slug);
      if (!safeSlug) {
        showMessage("slug 只能包含文字、数字、连字符或下划线");
        return;
      }
      const publishedArticle = {
        ...active,
        draft: false,
        slug: safeSlug,
        blogId: connection.id,
      };
      const markdown = serializeDraft(publishedArticle);

      if (window.arumaDesktop) {
        let result = await window.arumaDesktop.publishArticle({
          connection,
          slug: safeSlug,
          markdown,
          overwrite: false,
        });
        if (result.exists) {
          if (!window.confirm(`“${safeSlug}”已存在，确定覆盖 index.md 吗？`)) {
            return;
          }
          result = await window.arumaDesktop.publishArticle({
            connection,
            slug: safeSlug,
            markdown,
            overwrite: true,
          });
        }
        if (!result.ok) return;
      } else {
        let directory = blogHandlesRef.current.get(connection.id);
        if (!directory) {
          directory = (await loadDirectoryHandle(connection.id)) ?? undefined;
        }
        if (!directory) {
          showMessage("需要重新授权目标博客目录");
          setConnectionManagerOpen(true);
          return;
        }
        const permission = directory.requestPermission
          ? await directory.requestPermission({ mode: "readwrite" })
          : "granted";
        if (permission !== "granted") {
          showMessage("需要写入权限才能发布到博客");
          return;
        }
        try {
          await directory.getDirectoryHandle(safeSlug);
          if (!window.confirm(`“${safeSlug}”已存在，确定覆盖 index.md 吗？`)) {
            return;
          }
        } catch {
          // A new article is expected not to exist yet.
        }
        const articleDirectory = await directory.getDirectoryHandle(safeSlug, {
          create: true,
        });
        const fileHandle = await articleDirectory.getFileHandle("index.md", {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(markdown);
        await writable.close();
      }

      setActiveBlogId(connection.id);
      updateActive({
        draft: false,
        slug: safeSlug,
        source: "published",
        blogId: connection.id,
      });
      showMessage(`文章已写入 ${connection.name}，可以预览或提交了`);
    } catch (error) {
      showMessage((error as Error).message || "写入失败，请检查博客连接");
    } finally {
      setIsPublishing(false);
    }
  };

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
            onClick={publishToBlog}
            disabled={isPublishing}
          >
            <Sparkles size={16} />
            {isPublishing
              ? "正在写入…"
              : draftBlog
                ? `发布到 ${draftBlog.name}`
                : "发布到博客"}
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
              <div className="format-actions">
                <button onClick={() => insertMarkdown("## ", "", "小标题")} title="二级标题">
                  <Heading2 size={17} />
                </button>
                <button onClick={() => insertMarkdown("**", "**", "粗体文字")} title="粗体">
                  <Bold size={17} />
                </button>
                <button onClick={() => insertMarkdown("*", "*", "斜体文字")} title="斜体">
                  <Italic size={17} />
                </button>
                <span />
                <button onClick={() => insertMarkdown("[", "](https://)", "链接文字")} title="链接">
                  <Link2 size={17} />
                </button>
                <button onClick={() => insertMarkdown("![", "](./image.webp)", "图片说明")} title="图片">
                  <ImageIcon size={17} />
                </button>
                <button onClick={() => insertMarkdown("> ", "", "引用内容")} title="引用">
                  <Quote size={17} />
                </button>
                <button onClick={() => insertMarkdown("- ", "", "列表项")} title="无序列表">
                  <List size={17} />
                </button>
                <button onClick={() => insertMarkdown("`", "`", "code")} title="行内代码">
                  <Code2 size={17} />
                </button>
                <button onClick={() => insertMarkdown("\n---\n", "", "")} title="分割线">
                  <MoreHorizontal size={17} />
                </button>
              </div>

              <div className="view-switcher" aria-label="编辑视图">
                <button
                  className={viewMode === "write" ? "active" : ""}
                  onClick={() => setViewMode("write")}
                  title="仅编辑"
                >
                  <PenLine size={15} />
                  <span>编辑</span>
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
                  title="仅预览"
                >
                  <Eye size={15} />
                  <span>预览</span>
                </button>
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
                    onChange={(event) => updateActive({ content: event.target.value })}
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
                    <span>ARUMA PREVIEW</span>
                    <small>实时渲染</small>
                  </div>
                  <article
                    className="markdown-body"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
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
                  <label>
                    <span>分类</span>
                    <input
                      value={active.category}
                      onChange={(event) => updateActive({ category: event.target.value })}
                      placeholder="日常"
                    />
                  </label>
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
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder="添加标签后回车"
                />
              </label>
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
                  <span>选择 Aruma 根目录后，编辑器会自动识别文章目录。</span>
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
