/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arumaDesktop", {
  platform: process.platform,
  loadWorkspace: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (workspace) => ipcRenderer.invoke("workspace:save", workspace),
  addBlog: () => ipcRenderer.invoke("blog:add"),
  scanBlog: (connection) => ipcRenderer.invoke("blog:scan", connection),
  inspectArticle: (request) => ipcRenderer.invoke("blog:inspect", request),
  publishArticle: (request) => ipcRenderer.invoke("blog:publish", request),
  revealBlog: (connection) => ipcRenderer.invoke("blog:reveal", connection),
  getVersion: () => ipcRenderer.invoke("app:version"),
});
