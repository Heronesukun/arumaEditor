/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const WORKSPACE_VERSION = 2;
const trustedConnections = new Map();

function workspaceFile() {
  return path.join(app.getPath("userData"), "workspace.json");
}

function previousWorkspaceFile() {
  return path.join(app.getPath("userData"), "workspace.previous.json");
}

function workspaceBackupsDirectory() {
  return path.join(app.getPath("userData"), "workspace-backups");
}

function emptyWorkspace() {
  return {
    version: WORKSPACE_VERSION,
    drafts: [],
    activeId: null,
    isDark: false,
    blogs: [],
    activeBlogId: null,
    history: [],
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  const previous = previousWorkspaceFile();
  const targetExists = await exists(target);
  if (targetExists) {
    await fs.unlink(previous).catch(() => {});
    await fs.rename(target, previous);
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (targetExists && (await exists(previous))) {
      await fs.rename(previous, target).catch(() => {});
    }
    throw error;
  }
  if (targetExists) await archiveWorkspaceBackup(previous);
}

async function archiveWorkspaceBackup(previous) {
  try {
    const directory = workspaceBackupsDirectory();
    await fs.mkdir(directory, { recursive: true });
    const backups = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((a, b) => b.name.localeCompare(a.name));
    const newest = backups[0]
      ? await fs.stat(path.join(directory, backups[0].name))
      : null;
    if (!newest || Date.now() - newest.mtimeMs >= 5 * 60 * 1000) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.copyFile(previous, path.join(directory, `workspace-${stamp}.json`));
      for (const backup of backups.slice(11)) {
        await fs.unlink(path.join(directory, backup.name)).catch(() => {});
      }
    }
  } catch {
    // A failed archival backup must not interrupt normal autosave.
  }
}

async function parseWorkspaceFile(target) {
  const parsed = JSON.parse(await fs.readFile(target, "utf8"));
  return {
    ...emptyWorkspace(),
    ...parsed,
    version: WORKSPACE_VERSION,
    drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
    blogs: Array.isArray(parsed.blogs) ? parsed.blogs : [],
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

async function readWorkspace() {
  const candidates = [workspaceFile(), previousWorkspaceFile()];
  try {
    const backups = await fs.readdir(workspaceBackupsDirectory());
    candidates.push(
      ...backups
        .filter((name) => name.endsWith(".json"))
        .sort((a, b) => b.localeCompare(a))
        .map((name) => path.join(workspaceBackupsDirectory(), name)),
    );
  } catch {
    // There may be no archived backups on a first run.
  }
  for (const candidate of candidates) {
    try {
      return await parseWorkspaceFile(candidate);
    } catch {
      // Continue with the next recovery candidate.
    }
  }
  return emptyWorkspace();
}

function sanitizeWorkspace(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    version: WORKSPACE_VERSION,
    drafts: Array.isArray(source.drafts) ? source.drafts : [],
    activeId: typeof source.activeId === "string" ? source.activeId : null,
    isDark: Boolean(source.isDark),
    blogs: Array.isArray(source.blogs) ? source.blogs : [],
    activeBlogId:
      typeof source.activeBlogId === "string" ? source.activeBlogId : null,
    history: Array.isArray(source.history) ? source.history.slice(0, 120) : [],
  };
}

function rememberConnection(connection) {
  if (connection && typeof connection.id === "string") {
    trustedConnections.set(connection.id, connection);
  }
  return connection;
}

function trustedConnection(input) {
  const id = input && typeof input.id === "string" ? input.id : "";
  const connection = trustedConnections.get(id);
  if (!connection) throw new Error("博客连接未经过授权，请重新连接");
  return connection;
}

function sanitizeSavedBlogs(blogs) {
  if (!Array.isArray(blogs)) return [];
  return blogs.flatMap((blog) => {
    const trusted = trustedConnections.get(blog?.id);
    if (!trusted) return [];
    return [
      {
        ...trusted,
        name:
          typeof blog.name === "string" && blog.name.trim()
            ? blog.name.trim().slice(0, 100)
            : trusted.name,
        articleCount: Number.isFinite(blog.articleCount)
          ? Math.max(0, Math.trunc(blog.articleCount))
          : trusted.articleCount,
        lastConnectedAt: Number.isFinite(blog.lastConnectedAt)
          ? blog.lastConnectedAt
          : trusted.lastConnectedAt,
        lastSyncedAt: Number.isFinite(blog.lastSyncedAt)
          ? blog.lastSyncedAt
          : trusted.lastSyncedAt,
      },
    ];
  });
}

async function resolveBlogDirectory(selectedPath) {
  const selected = path.resolve(selectedPath);
  const selectedName = path.basename(selected).toLowerCase();
  const candidates = [
    {
      rootPath: selected,
      postPath: path.join(selected, "src", "content", "post"),
      blogType: "aruma",
    },
    {
      rootPath: selected,
      postPath: path.join(selected, "src", "content", "posts"),
      blogType: "mizuki",
    },
  ];

  if (selectedName === "post" || selectedName === "posts") {
    candidates.unshift({
      rootPath: path.resolve(selected, "..", "..", ".."),
      postPath: selected,
      blogType: selectedName === "posts" ? "mizuki" : "aruma",
    });
  }

  for (const candidate of candidates) {
    if (await exists(candidate.postPath)) {
      const stat = await fs.stat(candidate.postPath);
      if (stat.isDirectory()) return candidate;
    }
  }
  throw new Error("所选目录中没有找到 src/content/post 或 src/content/posts");
}

function connectionId(rootPath) {
  return crypto
    .createHash("sha256")
    .update(rootPath.toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

async function validateConnection(connection) {
  if (!connection || typeof connection.postPath !== "string") {
    return { status: "missing", message: "连接信息不完整" };
  }
  try {
    const stat = await fs.stat(connection.postPath);
    if (!stat.isDirectory()) throw new Error("not-directory");
    return { status: "connected", message: "目录可读写" };
  } catch {
    return { status: "missing", message: "博客目录已移动或不可访问" };
  }
}

async function scanBlog(connection) {
  const validation = await validateConnection(connection);
  if (validation.status !== "connected") {
    return { connection: { ...connection, ...validation }, articles: [] };
  }

  const articles = [];
  const entries = await fs.readdir(connection.postPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !(entry.isFile() && /\.md$/i.test(entry.name))) {
      continue;
    }
    const relativeArticlePath = entry.isDirectory()
      ? `${entry.name}/index.md`
      : entry.name;
    const articlePath = path.join(connection.postPath, relativeArticlePath);
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(articlePath, "utf8"),
        fs.stat(articlePath),
      ]);
      articles.push({
        slug: entry.isDirectory()
          ? entry.name
          : entry.name.replace(/\.md$/i, ""),
        text,
        lastModified: stat.mtimeMs,
        articlePath: relativeArticlePath,
        contentHash: crypto.createHash("sha256").update(text).digest("hex"),
      });
    } catch {
      // A folder without index.md is not an article and can be ignored.
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
}

async function addBlog(window) {
  const result = await dialog.showOpenDialog(window, {
    title: "选择 Aruma 或 Mizuki 博客根目录",
    buttonLabel: "连接这个博客",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const resolved = await resolveBlogDirectory(result.filePaths[0]);
  const now = Date.now();
  const connection = {
    id: connectionId(resolved.rootPath),
    name: path.basename(resolved.rootPath),
    rootPath: resolved.rootPath,
    postPath: resolved.postPath,
    status: "connected",
    message: "目录可读写",
    articleCount: 0,
    lastConnectedAt: now,
    lastSyncedAt: now,
    blogType: resolved.blogType,
  };
  const scanned = await scanBlog(connection);
  rememberConnection(scanned.connection);
  return scanned;
}

function resolveArticleTarget(connection, slug, articlePath) {
  const postRoot = path.resolve(connection.postPath);
  const normalizedArticlePath = String(articlePath ?? "").replace(/\\/g, "/");
  const allowedPaths = new Set([`${slug}.md`, `${slug}/index.md`]);
  const targetRelative = allowedPaths.has(normalizedArticlePath)
    ? normalizedArticlePath
    : `${slug}/index.md`;
  const target = path.resolve(postRoot, ...targetRelative.split("/"));
  const relativeTarget = path.relative(postRoot, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error("文章路径超出博客目录");
  }
  return { target, targetRelative };
}

async function inspectArticle(request) {
  const { connection, slug, articlePath } = request ?? {};
  const validation = await validateConnection(connection);
  if (validation.status !== "connected") {
    throw new Error(validation.message);
  }
  if (typeof slug !== "string" || !/^[a-z0-9\u4e00-\u9fff_-]+$/u.test(slug)) {
    throw new Error("文章 slug 不合法");
  }
  const { target, targetRelative } = resolveArticleTarget(
    connection,
    slug,
    articlePath,
  );
  try {
    const [text, stat] = await Promise.all([
      fs.readFile(target, "utf8"),
      fs.stat(target),
    ]);
    return {
      exists: true,
      text,
      hash: crypto.createHash("sha256").update(text).digest("hex"),
      lastModified: stat.mtimeMs,
      target: targetRelative,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      exists: false,
      text: "",
      hash: null,
      lastModified: null,
      target: targetRelative,
    };
  }
}

async function backupArticle(connection, target, targetRelative) {
  try {
    const safeName = targetRelative.replace(/[\\/:*?"<>|]/g, "_");
    const directory = path.join(
      app.getPath("userData"),
      "article-backups",
      connection.id,
    );
    await fs.mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.copyFile(target, path.join(directory, `${stamp}-${safeName}`));
    const backups = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const backup of backups.slice(39)) {
      await fs.unlink(path.join(directory, backup.name)).catch(() => {});
    }
  } catch {
    // Version history remains available if an auxiliary file backup fails.
  }
}

async function publishArticle(request) {
  const {
    connection,
    slug,
    markdown,
    overwrite,
    articlePath,
    expectedHash,
  } = request ?? {};
  if (typeof markdown !== "string") throw new Error("文章内容为空");
  const inspection = await inspectArticle({ connection, slug, articlePath });
  const { target, targetRelative } = resolveArticleTarget(
    connection,
    slug,
    articlePath,
  );

  if (inspection.hash !== (expectedHash ?? null)) {
    return {
      ok: false,
      exists: inspection.exists,
      target: targetRelative,
      conflict: true,
      inspection,
    };
  }

  if (inspection.exists && !overwrite) {
    return { ok: false, exists: true, target };
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  if (inspection.exists) {
    await backupArticle(connection, target, targetRelative);
  }
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.tmp`,
  );
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(markdown, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const previous = `${target}.aruma-editor-previous`;
  if (inspection.exists) {
    await fs.unlink(previous).catch(() => {});
    await fs.rename(target, previous);
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (inspection.exists && (await exists(previous))) {
      await fs.rename(previous, target).catch(() => {});
    }
    throw error;
  }
  await fs.unlink(previous).catch(() => {});
  const stat = await fs.stat(target);
  return {
    ok: true,
    exists: inspection.exists,
    target: targetRelative,
    hash: crypto.createHash("sha256").update(markdown).digest("hex"),
    lastModified: stat.mtimeMs,
  };
}

async function runReliabilitySmoke() {
  const temporaryRoot = await fs.mkdtemp(
    path.join(app.getPath("temp"), "aruma-editor-reliability-"),
  );
  try {
    const postPath = path.join(temporaryRoot, "src", "content", "post");
    await fs.mkdir(postPath, { recursive: true });
    const connection = {
      id: "reliability-smoke",
      name: "Reliability smoke",
      rootPath: temporaryRoot,
      postPath,
      status: "connected",
      message: "目录可读写",
      articleCount: 0,
      lastConnectedAt: Date.now(),
      lastSyncedAt: Date.now(),
      blogType: "aruma",
    };
    const initial = await inspectArticle({
      connection,
      slug: "smoke",
      articlePath: "smoke/index.md",
    });
    const firstWrite = await publishArticle({
      connection,
      slug: "smoke",
      articlePath: "smoke/index.md",
      markdown: "---\ntitle: smoke\ndraft: true\n---\n\nfirst\n",
      overwrite: true,
      expectedHash: initial.hash,
    });
    await fs.writeFile(
      path.join(postPath, "smoke", "index.md"),
      "---\ntitle: external\n---\n\nchanged elsewhere\n",
      "utf8",
    );
    const conflict = await publishArticle({
      connection,
      slug: "smoke",
      articlePath: "smoke/index.md",
      markdown: "---\ntitle: stale\n---\n\nstale editor\n",
      overwrite: true,
      expectedHash: firstWrite.hash,
    });
    return firstWrite.ok && conflict.conflict === true;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function registerIpc(mainWindow) {
  ipcMain.handle("workspace:load", async () => {
    const workspace = await readWorkspace();
    workspace.blogs = await Promise.all(
      workspace.blogs.map(async (blog) =>
        rememberConnection({
          ...blog,
          ...(await validateConnection(blog)),
        }),
      ),
    );
    return workspace;
  });

  ipcMain.handle("workspace:save", async (_event, workspace) => {
    const sanitized = sanitizeWorkspace(workspace);
    sanitized.blogs = sanitizeSavedBlogs(sanitized.blogs);
    if (!sanitized.blogs.some((blog) => blog.id === sanitized.activeBlogId)) {
      sanitized.activeBlogId = null;
    }
    await writeJsonAtomic(workspaceFile(), sanitized);
    return { ok: true };
  });

  ipcMain.handle("blog:add", () => addBlog(mainWindow));
  ipcMain.handle("blog:scan", async (_event, connection) => {
    const scanned = await scanBlog(trustedConnection(connection));
    rememberConnection(scanned.connection);
    return scanned;
  });
  ipcMain.handle("blog:inspect", (_event, request) =>
    inspectArticle({
      ...request,
      connection: trustedConnection(request?.connection),
    }),
  );
  ipcMain.handle("blog:publish", (_event, request) =>
    publishArticle({
      ...request,
      connection: trustedConnection(request?.connection),
    }),
  );
  ipcMain.handle("blog:reveal", async (_event, connection) => {
    const trusted = trustedConnection(connection);
    const validation = await validateConnection(trusted);
    if (validation.status !== "connected") throw new Error(validation.message);
    return shell.openPath(trusted.rootPath);
  });
  ipcMain.handle("app:version", () => app.getVersion());
}

function createWindow() {
  const smokeTest = process.argv.includes("--smoke-test");
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#edf0f4",
    icon: path.join(__dirname, "..", "build-resources", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (smokeTest) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        const renderer = await mainWindow.webContents.executeJavaScript(`({
          hasRoot: Boolean(document.querySelector('#root')),
          hasEditor: document.body.innerText.includes('博客连接管理') ||
            document.body.innerText.includes('管理博客连接'),
          hasTitle: document.body.innerText.includes('写下今天的故事')
        })`);
        const smokeBlogPath = process.env.ARUMA_EDITOR_SMOKE_BLOG;
        let blogArticleCount = null;
        let blogType = null;
        const reliability = await runReliabilitySmoke();
        if (smokeBlogPath) {
          const resolved = await resolveBlogDirectory(smokeBlogPath);
          const scanned = await scanBlog({
            ...resolved,
            id: connectionId(resolved.rootPath),
            name: path.basename(resolved.rootPath),
            status: "connected",
            message: "目录可读写",
            articleCount: 0,
            lastConnectedAt: Date.now(),
            lastSyncedAt: Date.now(),
          });
          blogArticleCount = scanned.articles.length;
          blogType = resolved.blogType;
        }
        const result = { ...renderer, blogArticleCount, blogType, reliability };
        console.log(`DESKTOP_SMOKE ${JSON.stringify(result)}`);
        app.exit(
          result.hasRoot &&
            result.hasEditor &&
            result.hasTitle &&
            result.reliability &&
            (!smokeBlogPath || result.blogArticleCount > 0)
            ? 0
            : 1,
        );
      } catch (error) {
        console.error("DESKTOP_SMOKE_FAILED", error);
        app.exit(1);
      }
    });
  } else {
    mainWindow.once("ready-to-show", () => mainWindow.show());
  }
  void mainWindow.loadFile(
    path.join(__dirname, "..", "desktop-dist", "index.html"),
  );
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  registerIpc(mainWindow);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
