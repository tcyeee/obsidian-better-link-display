# AccessToken 接口使用说明

## 这是什么
AccessToken 是一种与你的账号登录会话（satoken）完全隔离的只读凭证，专供浏览器插件 / 自动化脚本 / AI 助手调用，
用于查询任意网页的标题与图标。泄露该 token 不会影响你的书签、分享等账号数据，只能用于这一个只读接口。

## 鉴权方式
每次请求在 HTTP 请求头中携带：

  X-Extension-Token: <你的 AccessToken 明文>

注意：
- token 只在生成时展示一次，请妥善保存；一旦丢失只能撤销后重新生成。
- 不要把 token 放进 URL 查询参数，避免出现在日志或浏览器历史中。
- 只应通过 HTTPS 调用。

## 接口

### 查询网站标题与图标
GET http://127.0.0.1:8001/extension/site-info?url=<目标网页URL>

Header:
  X-Extension-Token: <token>

curl 示例：
  curl -H "X-Extension-Token: YOUR_TOKEN" "http://127.0.0.1:8001/extension/site-info?url=https://example.com"

成功响应：
  {
    "code": 0,
    "msg": "success",
    "data": { "title": "Example Domain", "favicon": "data:image/png;base64,..." },
    "ok": true
  }
  favicon 为 base64 data URL，可能为空。

失败响应（token 无效或已被撤销）：
  {
    "code": 125,
    "msg": "插件访问令牌无效或已被撤销",
    "data": null,
    "ok": false
  }

限流：该接口有基础限流（约 300ms 一次），请勿高频轮询同一 token。

## 令牌管理接口（走正常登录会话，非本 token 鉴权，仅供参考不建议 AI 直接调用）
POST /user/access-token/create   body { "name": "备注" } → 一次性返回明文 token
GET  /user/access-token/list                              → 查看自己名下全部令牌（不含明文）
POST /user/access-token/revoke?id=<id>                     → 撤销令牌

## 安全边界
- 该 token 仅能访问 /extension/site-info 一个接口，无法读写书签、分享或账号信息。
- 请勿将 token 硬编码进公开代码仓库或分享给他人。