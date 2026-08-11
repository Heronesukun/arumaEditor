# Aruma Editor

一个为 [Aruma](https://github.com/Heronesukun/Aruma) 博客工作流设计的本地优先 Markdown 写作台。它沿用 Aruma 的粉色强调色、半透明卡片、背景图与排版气质，同时把日常写作需要的 Frontmatter、草稿、预览和发布动作收进一个界面里。

## 功能

- Markdown 编辑、实时预览与分栏模式
- 标题、日期、分类、作者、摘要、头图、标签等 Frontmatter 表单
- 草稿自动保存，支持深色模式和跨次启动恢复
- 支持管理多个 Aruma 博客连接，并为每篇草稿单独绑定目标博客
- 可检查连接状态、重新授权、同步文章、打开目录或安全移除连接
- 导入已有 Markdown，导出符合 Aruma 内容结构的 `.md` 文件
- 在桌面版或 Chrome / Edge 中连接 Aruma 根目录，读取 `src/content/post` 下的文章
- 将当前文章直接写入 `src/content/post/{slug}/index.md`
- 响应式布局、键盘保存快捷键与基础无障碍支持

## 直接使用 Windows Release

从 Release 下载 `ArumaEditor-0.2.0-win-x64.exe` 后双击即可使用，不要求预装 Node.js，也不需要执行命令。它是便携版程序，可以放在桌面、工具目录或移动硬盘中。

桌面版会把草稿、主题和博客连接信息保存在当前 Windows 用户的数据目录中。移动或删除 `.exe` 不会连带删除草稿；移除博客连接也不会删除博客文件。

## 从源码运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开终端显示的本地地址。网页模式的草稿保存在当前浏览器中，不会自动上传到任何服务。

启动桌面版本：

```bash
npm run desktop:start
```

## 推荐工作流

1. 点击左下角“管理博客连接”，添加一个或多个 Aruma 根目录。
2. 在右侧“草稿绑定”中选择这篇文章对应的目标博客。
3. 新建文章或同步并打开博客中的已有文章。
4. 在右侧维护文章信息，在中间编辑正文并实时预览。
5. 点击顶部发布按钮，文章会写入所绑定博客的对应 slug 目录。
6. 回到 Aruma 仓库预览、检查并自行提交 Git 变更。

如果浏览器不支持目录访问，使用“导出 Markdown”并手动放入 Aruma 内容目录即可。为了安全，覆盖已有 slug 前会再次确认；编辑器不会删除博客中的文件。

## 常用命令

```bash
npm run dev      # 启动开发预览
npm run build    # 生产构建
npm test         # 构建并执行渲染测试
npm run lint     # 代码检查
npm run desktop:smoke  # 桌面版启动检查
npm run release:win    # 生成 Windows 便携版 Release
```

推送形如 `v0.2.0` 的 Git 标签后，仓库内的 GitHub Actions 工作流会自动复测、构建 Windows 便携版，并创建对应的 GitHub Release。

## 数据与隐私

- 桌面版草稿和连接信息保存在系统用户数据目录的 `workspace.json` 中。
- 网页版草稿使用 `localStorage`，目录授权句柄使用 IndexedDB 保存。
- 博客目录只在你主动选择后才会读取或写入。
- 覆盖已有 `index.md` 前始终会再次确认。
- 移除连接只清理编辑器中的关联，不会删除博客文件。
- 项目不包含分析脚本，也不会把文章内容发送到远端。
- 重要文章仍建议定期导出，并通过 Aruma 仓库的 Git 历史管理。

## GitHub

仓库已包含适用于 Node、Vinext、Cloudflare 本地状态与环境变量的忽略规则。创建 GitHub 仓库后可添加远端并推送：

```bash
git remote add origin <your-repository-url>
git push -u origin main
```

## License

项目代码可按 MIT License 使用。随项目复用的背景与头像来自你的 Aruma 博客，请按原素材授权范围使用。
