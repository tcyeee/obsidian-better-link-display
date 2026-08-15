# Better Link Display

[English](README.md)

一个 Obsidian 插件：编辑笔记时把外链一键"格式化"成带网站名称与图标的书签。

## 功能说明

在编辑模式下把鼠标悬停到一个外链上，链接上方会浮出一个 **Format** 按钮。支持裸链接、Markdown 外链和自动链接：

```
https://example.com
[Example](https://example.com)
<https://example.com>
```

点击后，该链接进入加载状态——底色带呼吸效果、文字变淡——最多持续 10 秒，期间插件向 Bookmarkify 服务查询该网页的标题与图标。查询成功后，笔记源码就地改写为 Markdown 链接，网站图标直接内嵌在里面：

```
[![](data:image/png;base64,iVBORw0…) Example Domain](https://example.com)
```

若查询失败或超过 10 秒仍无结果，链接会短暂标红并弹出提示，笔记内容保持原样。

命令面板里还有一个等价的 **Format link under cursor** 命令，不依赖鼠标，也是在移动端使用本插件的方式。

图标存在笔记里，而不是缓存里：把这篇笔记复制到别的库、别的应用、或者一个纯 Markdown 文件里，书签照样显示——不需要插件，也不需要联网。写进笔记的是纯粹的标准 Markdown，不夹带任何插件私有标记，所以禁用或卸载插件后已格式化的链接依然完好。

图标统一重编码为 48×48（即 3 倍像素密度，高分屏下依然锐利，显示时仍与正文字号齐平）。实测几个真实站点的图标，每个约占 1300 至 4800 个 base64 字符。

不点按钮就什么都不会发生：打开笔记不会发出任何请求。

## 依赖条件

- Obsidian 1.0 及以上版本。移动端没有 hover，请使用命令而非悬浮按钮。
- 能访问 Bookmarkify 线上服务 `https://bookmarkify.cc/api`，由它负责解析页面标题与图标。
- 一个从该服务生成的 **AccessToken**，用于请求鉴权。

接口约定详见 [api.md](api.md)（`GET /extension/site-info?url=...`，请求头 `X-Extension-Token`）。

服务返回的图标是有效期约一小时的签名 CDN 链接，因此插件在格式化时把图片下载下来内联保存。这是它唯一一次向该服务之外的主机发请求。

## 使用步骤

1. 在 Obsidian 中安装并启用本插件。
2. 在 Bookmarkify 网页端的令牌管理页面生成一个 AccessToken。
3. 打开 **设置 → Better Link Display**，将令牌粘贴到 **访问令牌** 字段，然后点 **测试** 确认服务能接受它。
4. 在编辑模式下打开一篇笔记，把鼠标悬停到外链上点击 **格式化**；或者把光标放在链接上，执行 **格式化光标处的链接** 命令。

**通用 → 语言** 可以在中文和 English 之间切换插件自己的设置与提示，默认跟随 Obsidian 的界面语言。命令名称要重启 Obsidian 后才会跟着变。

该 AccessToken 是只读凭证，仅能用于查询任意网页的标题与图标，无法读写你的书签或账号数据。

## 已知限制

- 只能在编辑模式（实时预览或源码模式）下格式化；代码块、frontmatter 和外部图片嵌入不会触发。
- 内嵌的 base64 会让源码模式下那一行变得很长。这是「笔记走到哪都能渲染」的代价；实时预览和阅读视图里只看得到图标和标题。
- 含括号的裸链接（如 `https://en.wikipedia.org/wiki/Foo_(bar)`）不会给出按钮，因为 Markdown 无法判断这种 URL 在哪里结束。用 `<…>` 包起来或写成 `[文字](…)` 之后即可格式化。
- 只下载 `https:` 图标，且必须能解码为图片，避免配置异常的服务端把笔记变成追踪像素。
- 没有「取消格式化」操作：原来的裸链接已被网站标题取代，还原时无法知道这一行原本长什么样。

## 开发

```bash
npm install
npm run dev      # 使用 esbuild 进行监听构建
npm run build    # 类型检查 + 生产构建
```

构建产物为 `main.js`，与 `manifest.json`、`styles.css` 一起被 Obsidian 加载为插件。

## 许可证

MIT
