---
tags:
  - obsidian-better-link-display
created: 2026-11-09 17:41
---
# Extension API Reference

Read-only HTTP API for third-party consumers of Bookmarkify (书签鸭) — browser extensions,
scripts, or AI agents — to look up a website's title/icon while the user is browsing, before
(or instead of) saving it as a bookmark.

This API is **not** the same surface as the web app's own `/bookmark/**` endpoints. It uses a
separate authentication mechanism (a long-lived access token, below) specifically so a browser
extension never needs the user's login session/cookie.

## Base URL

| Environment | Base URL |
|---|---|
| Production | `https://bookmakify.cc/api` |
| Local dev | `http://localhost:8001` |

All paths below are relative to the base URL — e.g. in production, `GET /extension/site-info`
is requested as `GET https://bookmakify.cc/api/extension/site-info`.

## Authentication

Every `/extension/**` endpoint requires an **access token**, sent as a request header:

```
X-Extension-Token: bmk_ext_<hex>
```

This token is completely independent of the Sa-Token session cookie the web app and admin
panel use (`ExtensionTokenInterceptor` / `ExtensionAuthUtils`, separate from `StpKit`). There is
no anonymous access — a missing, malformed, or revoked token fails every call in this document
with `E125`.

### Obtaining a token

Tokens are issued through the regular, logged-in web session — **not** through this API — via
`/user/access-token/**` (Sa-Token `USER` realm, requires the user to already be logged into the
web app):

| Method & Path | Description |
|---|---|
| `POST /user/access-token/create` | Create a new token. Body: `{ "name": "Chrome Extension" }`. Response includes the **plaintext token, returned exactly once** — it is never retrievable again (only a SHA-256 hash is stored server-side). |
| `GET /user/access-token/list` | List the caller's own tokens (metadata only — no plaintext). |
| `POST /user/access-token/revoke?id=<tokenId>` | Revoke one of the caller's own tokens. |

A typical integration flow: the user logs into the Bookmarkify web app once, generates a token
from account settings, and pastes it into the extension's own settings UI. The extension then
uses only the `X-Extension-Token` header from then on — it never sees the user's password or
session cookie.

Token format: prefix `bmk_ext_` followed by 24 random bytes, hex-encoded. The token list UI
shows a truncated display prefix (prefix + 8 hex chars + `****`); the rest of the entropy is
never stored or displayed anywhere after creation.

## Endpoints

### `GET /extension/ping`

Verify that a configured `X-Extension-Token` is valid, without triggering a real website fetch.
Intended for an extension's own "test connection" / setup-time self-check.

**Headers**

| Header | Required | Description |
|---|---|---|
| `X-Extension-Token` | Yes | The access token to validate |

**Response** — `AccessTokenVO` (the token's own metadata; never the plaintext token):

| Field | Type | Description |
|---|---|---|
| `id` | string | Token ID |
| `name` | string | User-assigned label (e.g. "Chrome Extension") |
| `tokenPrefix` | string | Truncated display form, e.g. `bmk_ext_a1b2c3d4****` |
| `lastUsedAt` | datetime \| null | Last time this token passed verification (best-effort; a failed update does not fail the call) |
| `createTime` | datetime | When the token was created |

**Errors**: `E125` if the token is missing, malformed, or revoked.

```bash
curl -s https://bookmakify.cc/api/extension/ping \
  -H "X-Extension-Token: bmk_ext_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### `GET /extension/site-info`

Scrape a URL live and return its title, small/big icon, and short app name — for an extension
to show a preview or pre-fill a save dialog while the user is on that page. This triggers a real
(synchronous) fetch through the scraping pipeline each call; it is not backed by Bookmarkify's
own saved-bookmark database, so it works for **any** URL, bookmarked or not.

**Headers**

| Header | Required | Description |
|---|---|---|
| `X-Extension-Token` | Yes | The access token |

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | The page URL to look up (URL-encoded) |

**Response** — `ExtensionSiteInfoVO`. One call returns both display scenarios at once; use
whichever pair of fields matches the current UI:

| Field | Type | Description |
|---|---|---|
| `title` | string \| null | Page title |
| `favicon` | string \| null | **Small-icon scenario.** Favicon-first, falls back to the brand logo if no favicon exists |
| `logo` | string \| null | **Big-icon scenario.** Brand logo-first, falls back to the favicon if no logo exists |
| `appName` | string \| null | Short app/site name for the big-icon scenario (from the page's web manifest `short_name`; falls back to `title` if absent) |

Any of the four fields may be `null` when the underlying data isn't available (e.g. the target
site has neither a favicon nor a logo, or the fetch itself failed in a way that still yields a
response rather than an error — see Errors below).

Icon URLs, when present, point at Bookmarkify's own object storage (signed, time-limited) or —
only when the image was not uploaded — the source site's own direct URL. Do not assume a fixed
domain or a permanently valid link; always use the URL as returned, fresh per call.

**Errors**:
- `E125` — invalid/missing/revoked token.
- `E304` — target site unreachable (DNS failure, connection refused, timeout, 5xx, or a
  confirmed 404/410).
- `E308` — target rejected by Bookmarkify's own policy (not a real domain — localhost, bare IP —
  or blocked by SSRF protection).
- `E307` — Bookmarkify's own scraping service is temporarily unavailable; retry later.

```bash
curl -s "https://bookmakify.cc/api/extension/site-info?url=https%3A%2F%2Fgithub.com" \
  -H "X-Extension-Token: bmk_ext_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

```json
{
  "ok": true,
  "code": 0,
  "data": {
    "title": "GitHub: Let's build from here",
    "favicon": "https://<oss-domain>/<signed-path-to-favicon>",
    "logo": "https://<oss-domain>/<signed-path-to-logo>",
    "appName": "GitHub"
  }
}
```

(`<oss-domain>` is Bookmarkify's configured object storage domain — a real response contains a
fully-qualified, directly-fetchable, signed URL; the exact domain is a deployment detail and may
change, so don't hardcode it in the extension.)

## Response envelope

Every response — success or error — is wrapped the same way, with HTTP status always `200`:

```json
{ "ok": true, "code": 0, "data": { /* ... */ }, "msg": null }
```

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` on success |
| `code` | int | `0` on success; otherwise an error code (see below) |
| `data` | any \| null | The endpoint's response body on success |
| `msg` | string \| null | Human-readable error message; omitted on success |

On failure, `data` is absent and `msg` explains what went wrong:

```json
{ "ok": false, "code": 125, "msg": "插件访问令牌无效或已被撤销" }
```

## Error codes

| Code | Meaning |
|---|---|
| `107` | Rate limited — see Rate limiting below |
| `124` | Access token does not exist, or does not belong to the calling user (token management endpoints) |
| `125` | Extension token invalid, missing, or revoked |
| `304` | Target site unreachable |
| `307` | Bookmarkify's own scraping service is temporarily unavailable |
| `308` | Target rejected by policy (not a public domain, or blocked by SSRF protection) |

## Rate limiting

Both `/extension/site-info` and `/extension/ping` are throttled to **one call every 300ms**,
keyed by the calling token's user id (falling back to client IP if that can't be resolved).
Exceeding it returns `E107` with a message naming how many seconds remain.

## Notes

- `/extension/**` and `/user/access-token/**` use two different auth mechanisms by design: the
  extension itself only ever holds the long-lived `X-Extension-Token`; issuing and revoking that
  token happens through the ordinary logged-in web session, so a leaked extension token cannot
  be used to mint further tokens or touch anything outside these read-only endpoints.
- Every successful `/extension/site-info` call is recorded in Bookmarkify's user behavior log
  (`QUERY_BY_TOKEN`) against the token owner's user id, with the requested URL — this is separate
  from, and does not create, a saved bookmark.
