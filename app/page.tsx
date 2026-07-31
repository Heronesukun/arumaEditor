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
  FolderHeart,
  Hash,
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
import Image from "next/image";
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
  values?: () => AsyncIterable<DirectoryHandleLike>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<DirectoryHandleLike>;
  }
}

const STORAGE_KEY = "aruma-editor:drafts:v1";
const ACTIVE_KEY = "aruma-editor:active:v1";
const THEME_KEY = "aruma-editor:theme:v1";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createDraft(): Draft {
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
};

function cleanDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? today());
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : today();
}

function parseMarkdownDocument(text: string, fileName = "article.md"): Draft {
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
  };
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
  const [blogHandle, setBlogHandle] = useState<DirectoryHandleLike | null>(null);
  const [blogName, setBlogName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0];

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const storedActive = localStorage.getItem(ACTIVE_KEY);
      const storedTheme = localStorage.getItem(THEME_KEY);
      let restoredDrafts = false;
      if (stored) {
        const parsed = JSON.parse(stored) as Draft[];
        if (Array.isArray(parsed) && parsed.length) {
          restoredDrafts = true;
          // Restoring browser-owned state is the purpose of this mount effect.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setDrafts(parsed);
          setActiveId(
            parsed.some((item) => item.id === storedActive)
              ? (storedActive as string)
              : parsed[0].id,
          );
        }
      }
      if (!restoredDrafts) {
        const firstDraft = createDraft();
        setDrafts([firstDraft]);
        setActiveId(firstDraft.id);
      }
      setIsDark(storedTheme === "dark");
    } catch {
      // A corrupted local draft should never prevent the editor from opening.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // This status mirrors the delayed localStorage synchronization below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
        localStorage.setItem(ACTIVE_KEY, activeId);
        setSaveState("saved");
      } catch {
        setToast("本地空间不足，请先导出重要草稿");
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [activeId, drafts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  }, [hydrated, isDark]);

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
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(active?.content ?? "") as string;
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
    const next = createDraft();
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
      const fresh = createDraft();
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
    const parsed = parseMarkdownDocument(await file.text(), file.name);
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

  const scanBlog = async (postDirectory: DirectoryHandleLike) => {
    if (!postDirectory.values) return [];
    const found: Draft[] = [];
    for await (const entry of postDirectory.values()) {
      if (entry.kind !== "directory") continue;
      try {
        const articleFile = await entry.getFileHandle("index.md");
        const file = await articleFile.getFile();
        const parsed = parseMarkdownDocument(await file.text(), `${entry.name}.md`);
        parsed.id = `blog-${entry.name}`;
        parsed.slug = entry.name;
        parsed.source = "published";
        parsed.createdAt = file.lastModified;
        parsed.updatedAt = file.lastModified;
        found.push(parsed);
      } catch {
        // Ignore non-article folders.
      }
    }
    return found.sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const connectBlog = async () => {
    if (!window.showDirectoryPicker) {
      showMessage("当前浏览器不支持目录连接，请使用 Chrome 或 Edge");
      return null;
    }
    setIsConnecting(true);
    try {
      const root = await window.showDirectoryPicker({
        id: "aruma-blog",
        mode: "readwrite",
      });
      const postDirectory = await resolvePostDirectory(root);
      const published = await scanBlog(postDirectory);
      setBlogHandle(postDirectory);
      setBlogName(root.name);
      setDrafts((current) => {
        const publishedIds = new Set(published.map((item) => item.id));
        const local = current.filter((item) => !publishedIds.has(item.id));
        return [...local, ...published];
      });
      showMessage(`已连接 ${root.name}，读取到 ${published.length} 篇文章`);
      return postDirectory;
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        showMessage("没有找到 Aruma 的 src/content/post 目录");
      }
      return null;
    } finally {
      setIsConnecting(false);
    }
  };

  const publishToBlog = async () => {
    if (!active || !active.slug.trim()) {
      showMessage("请先填写文章 slug");
      return;
    }
    setIsPublishing(true);
    try {
      const directory = blogHandle ?? (await connectBlog());
      if (!directory) return;
      if (directory.requestPermission) {
        const permission = await directory.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") {
          showMessage("需要写入权限才能发布到博客");
          return;
        }
      }
      const safeSlug = normalizeSlug(active.slug);
      if (!safeSlug) {
        showMessage("slug 只能包含文字、数字、连字符或下划线");
        return;
      }
      if (active.source !== "published") {
        try {
          await directory.getDirectoryHandle(safeSlug);
          if (!window.confirm(`“${safeSlug}”已存在，确定覆盖 index.md 吗？`)) return;
        } catch {
          // A new article is expected not to exist yet.
        }
      }
      const articleDirectory = await directory.getDirectoryHandle(safeSlug, {
        create: true,
      });
      const fileHandle = await articleDirectory.getFileHandle("index.md", {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      const publishedArticle = { ...active, draft: false, slug: safeSlug };
      await writable.write(serializeDraft(publishedArticle));
      await writable.close();
      updateActive({ draft: false, slug: safeSlug, source: "published" });
      showMessage("文章已写入 Aruma，可以去预览或提交了");
    } catch {
      showMessage("写入失败，请重新连接博客目录后再试");
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
            {isPublishing ? "正在写入…" : "发布到 Aruma"}
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
            <Image
              src="/aruma-avatar.webp"
              alt="Aruma 博客头像"
              width={42}
              height={42}
              priority
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
                    {draft.category || "未分类"} · {relativeTime(draft.updatedAt)}
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
            <button onClick={connectBlog} disabled={isConnecting}>
              <FolderHeart size={17} />
              <span>
                <strong>{blogName || "连接 Aruma 博客"}</strong>
                <small>{blogName ? "目录已授权" : "读取文章并直接写入"}</small>
              </span>
              <i className={blogName ? "status online" : "status"} />
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

      {toast && (
        <div className="toast" role="status">
          <Check size={17} /> {toast}
        </div>
      )}
    </div>
  );
}
