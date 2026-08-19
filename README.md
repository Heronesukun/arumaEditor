# Aruma Editor

> 一张安静、离线优先的 Markdown 写作桌，连接你的 Aruma 或 Mizuki 博客，把草稿直接送回内容仓库。

[![Windows Release](https://img.shields.io/github/v/release/Heronesukun/arumaEditor?label=Windows%20Release)](https://github.com/Heronesukun/arumaEditor/releases/latest)
[![Release build](https://github.com/Heronesukun/arumaEditor/actions/workflows/release.yml/badge.svg)](https://github.com/Heronesukun/arumaEditor/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-f6a8bd.svg)](./LICENSE)

![Aruma Editor 社交预览](./public/og.png)

Aruma Editor 是为个人博客日常写作准备的本地桌面编辑器。它保留了 Aruma 的粉色、半透明卡片和轻盈排版，同时将草稿管理、Markdown 预览、Frontmatter 表单、多博客连接、安全差异检查和本地发布放进一个界面。文章不会经过第三方服务，也不会被上传到编辑器自己的服务器。

## 下载与使用

前往 [Releases](https://github.com/Heronesukun/arumaEditor/releases/latest) 下载最新的 `ArumaEditor-*-win-x64.exe`，双击即可运行。

- 支持 Windows x64
- 便携单文件，不需要安装 Node.js
- 可以放在桌面、工具目录或移动硬盘中
- 更新可执行文件不会删除已有草稿

Windows 首次运行未签名的个人应用时，SmartScreen 可能要求额外确认。请只从本仓库的 Release 页面下载，并在需要时核对 Release 中的文件来源。

## 支持的博客

编辑器会根据内容目录自动识别博客类型，不需要手动选择模板。

| 博客 | 内容目录 | 可读取的文章结构 | 发布行为 |
| --- | --- | --- | --- |
| [Aruma](https://github.com/Heronesukun/Aruma) | `src/content/post` | `slug/index.md` | 新文章写入 `slug/index.md` |
| [Mizuki](https://github.com/Heronesukun/Mizuki) | `src/content/posts` | `slug/index.md`、`slug.md` | 已有单文件保持原路径；新文章写入 `slug/index.md` |

你可以选择博客项目根目录，也可以直接选择 `src/content/post` 或 `src/content/posts`。其他 Astro 博客只要使用相同目录和 Frontmatter 约定，也可能兼容，但目前正式验证的目标是 Aruma 与 Mizuki。

### 通用 Frontmatter

编辑器维护以下常用字段：

```yaml
title: 文章标题
published: 2026-08-12
pubDate: 2026-08-12
description: 一句话摘要
tags:
  - 随笔
author: 拾音
category: 日常
pinned: false
draft: false
heroImage: ./cover.webp
image: ./cover.webp
```

新文章会同时写入 `published` / `pubDate` 与 `image` / `heroImage`，分别适配 Mizuki 和 Aruma。编辑已有文章时会沿用它原本使用的字段命名，两种命名都能识别。

已有文章中的其他字段会继续保留。例如 Mizuki 的 `encrypted`、`password`、`alias`、`permalink`、`lang`、`sourceLink` 和授权信息不会因为使用编辑器修改正文而丢失。

## 核心功能

- Markdown 写作、实时预览、分栏和纯预览模式
- 所见即所得内容块编辑：点击预览中的段落即可修改对应 Markdown
- 标题、日期、分类、作者、摘要、头图、标签等可视化 Frontmatter 表单
- 从当前博客复用已有标签，支持搜索、使用次数和批量选择
- 一次粘贴多个以逗号或换行分隔的标签
- 本地草稿自动保存，重启后继续写作
- 同时管理多个博客连接，每篇草稿独立绑定发布目标
- 同步博客现有文章，并从编辑器继续修改
- 发布前展示 Markdown 与 Frontmatter 差异
- 检测外部工具造成的文件变化，避免覆盖较新的磁盘版本
- 每篇文章保留最多 20 个本地历史版本，可随时恢复
- 导入、导出标准 Markdown 文件
- 发布前检查 slug，覆盖现有文件前二次确认
- 深色模式、字数与阅读时间统计、`Ctrl/Cmd + S` 保存提示
- 桌面版与 Chrome / Edge 网页模式共用同一套编辑界面

## 推荐工作流

1. 打开左下角的“管理博客连接”。
2. 选择 Aruma 或 Mizuki 的项目根目录。
3. 新建草稿，或同步并打开博客中的已有文章。
4. 在右侧“草稿绑定”中确认目标博客。
5. 编辑正文和文章信息，点击顶部“检查并发布”。
6. 查看目标文件、草稿状态和增删差异，再确认写入。
7. 回到博客仓库运行预览，确认页面效果后再提交 Git 变更。

Aruma Editor 只负责编辑内容文件，不会自动运行博客构建、执行 `git commit` 或推送博客仓库。这让每次发布仍然经过你自己的预览和版本管理流程。

## 草稿、连接与文件安全

- 桌面版将草稿、主题和连接信息保存在当前 Windows 用户的数据目录中。
- 网页版将草稿保存在 `localStorage`，目录句柄保存在 IndexedDB。
- 只有你通过目录选择器授权过的博客路径才允许写入。
- 桌面主进程会再次检查 slug 和目标路径，阻止越界写入。
- 发布使用磁盘文件哈希作为写入条件，确认后发生的新变化不会被覆盖。
- 工作区保留上一份完整文件和定期轮换备份；覆盖文章前还会保存文件副本。
- 停止编辑 15 秒会创建自动历史版本，`Ctrl/Cmd + S` 会立即保存并建立手动版本。
- Markdown 预览会转义原始 HTML，并拦截危险链接协议。
- 移除博客连接只清理编辑器关联，不会删除博客文件。
- 删除已同步文章只会将它从编辑器列表移除，不会删除原文。
- 覆盖已有 `.md` 文件前始终需要确认。

重要文章仍建议交由博客仓库的 Git 历史长期保存。

## 从源码运行

需要 Node.js 22.13 或更高版本。

```bash
git clone https://github.com/Heronesukun/arumaEditor.git
cd arumaEditor
npm ci
npm run dev
```

桌面开发模式：

```bash
npm run desktop:start
```

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动网页开发环境 |
| `npm run build` | 构建网页版本 |
| `npm test` | 构建并执行服务端渲染测试 |
| `npm run lint` | 运行代码检查 |
| `npm run desktop:build` | 构建桌面渲染层 |
| `npm run desktop:smoke` | 验证 Electron 渲染、条件写入和冲突阻止 |
| `npm run release:win` | 在 `release/` 生成 Windows x64 便携版 |

## 项目结构

```text
app/                 Web 页面、编辑器逻辑与样式
desktop/             Electron 主进程、预加载脚本和桌面入口
public/              品牌图片与社交预览图
tests/               服务端渲染测试
.github/workflows/   Windows Release 自动构建
build-resources/     桌面应用图标
```

## 发布新版本

项目使用 `v*` Git 标签驱动 GitHub Actions。推送标签后，工作流会在 Windows 环境中安装依赖、运行测试与代码检查、生成便携版，并自动创建 GitHub Release。

```bash
git tag -a v0.4.0 -m "Aruma Editor 0.4.0"
git push origin main
git push origin v0.4.0
```

## 已知边界

- 当前桌面 Release 只构建 Windows x64。
- 编辑器专注 Markdown；MDX 可以作为文本编辑，但不会在预览区执行组件。
- 博客主题的最终渲染效果应以 Aruma 或 Mizuki 自身的本地预览为准。
- 网页模式依赖 File System Access API，推荐 Chrome 或 Edge；完整体验优先使用桌面版。

## License

源代码采用 [MIT License](./LICENSE)。仓库中的背景与头像素材来自 Heronesukun 的 Aruma 博客，二次使用时请同时遵守原素材的授权范围。
