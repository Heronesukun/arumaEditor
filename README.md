# Aruma Editor

一个为 [Aruma](https://github.com/Heronesukun/Aruma) 博客工作流设计的本地优先 Markdown 写作台。它沿用 Aruma 的粉色强调色、半透明卡片、背景图与排版气质，同时把日常写作需要的 Frontmatter、草稿、预览和发布动作收进一个界面里。

## 功能

- Markdown 编辑、实时预览与分栏模式
- 标题、日期、分类、作者、摘要、头图、标签等 Frontmatter 表单
- 草稿自动保存到浏览器本机，支持深色模式
- 导入已有 Markdown，导出符合 Aruma 内容结构的 `.md` 文件
- 在 Chrome / Edge 中授权连接 Aruma 根目录，读取 `src/content/post` 下的文章
- 将当前文章直接写入 `src/content/post/{slug}/index.md`
- 响应式布局、键盘保存快捷键与基础无障碍支持

## 本地运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开终端显示的本地地址。草稿默认只保存在当前浏览器中，不会自动上传到任何服务。

## 推荐工作流

1. 点击左下角“连接 Aruma 博客”，选择 `Aruma` 项目根目录。
2. 新建文章或从已读取的博客文章继续编辑。
3. 在右侧维护文章信息，在中间编辑正文并实时预览。
4. 点击“发布到 Aruma”，文章会写入对应 slug 的 `index.md`。
5. 回到 Aruma 仓库预览、检查并自行提交 Git 变更。

如果浏览器不支持目录访问，使用“导出 Markdown”并手动放入 Aruma 内容目录即可。为了安全，覆盖已有 slug 前会再次确认；编辑器不会删除博客中的文件。

## 常用命令

```bash
npm run dev      # 启动开发预览
npm run build    # 生产构建
npm test         # 构建并执行渲染测试
npm run lint     # 代码检查
```

## 数据与隐私

- 草稿通过 `localStorage` 保存在当前浏览器配置中。
- 博客目录权限只在你点击连接并通过浏览器授权后获得。
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
