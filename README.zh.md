# Bookmarkify

[English](README.md)

一个 Obsidian 插件，自动为笔记中的裸链接（链接文本即网址本身）补全网站图标与标题，让链接以更美观的书签形式展示。

## 功能说明

在阅读视图渲染笔记时，Bookmarkify 会扫描其中的"裸链接"——即显示文字与网址完全相同的链接，例如：

```
https://example.com
```

对于每一个这样的链接，插件会向本地 Bookmarkify 服务查询该网页的标题与图标，并将纯文本链接替换为带图标的标题：

```
🌐 Example Domain
```

链接本身指向的地址不会改变，只是显示形式被增强了。

请求会串行发出并保持间隔，以避免触发服务端限流；查询成功的结果会在会话内缓存，相同链接只查询一次。因服务未启动或令牌错误导致的失败**不会**被缓存——问题修好后，下次渲染即可生效。

## 依赖条件

- Obsidian 桌面端（本插件仅支持桌面端）。
- 一个提供 `/extension/site-info` 接口的 Bookmarkify 服务。默认地址为 `http://127.0.0.1:8001`，可在设置中修改。
- 一个从该服务生成的 **AccessToken**，用于请求鉴权。

接口约定详见 [api.md](api.md)（`GET /extension/site-info?url=...`，请求头 `X-Extension-Token`）。

## 使用步骤

1. 在 Obsidian 中安装并启用本插件。
2. 在 Bookmarkify 网页端的令牌管理页面生成一个 AccessToken。
3. 打开 **设置 → Bookmarkify**，将令牌粘贴到 **Access token** 字段。若服务不在默认地址上运行，同时填写 **Server URL**。
4. 打开（或重新渲染）一篇包含裸链接的笔记，即可看到链接被自动补全。

该 AccessToken 是只读凭证，仅能用于查询任意网页的标题与图标，无法读写你的书签或账号数据。

## 已知限制

- 仅增强阅读视图；实时预览（Live Preview）和源码模式下仍显示原始网址。
- 仅当服务返回 `data:` 形式的图标时才会渲染，以确保打开笔记时不会向第三方主机发起任何请求。

## 开发

```bash
npm install
npm run dev      # 使用 esbuild 进行监听构建
npm run build    # 类型检查 + 生产构建
```

构建产物为 `main.js`，与 `manifest.json`、`styles.css` 一起被 Obsidian 加载为插件。

## 许可证

MIT
