# Service contract

Better Link Display resolves page titles and icons through one read-only HTTP
endpoint on the hosted service at `https://bookmarkify.cc/api`. The address is
fixed — there is nothing to configure beyond the access token.

## Authentication

Every request carries the access token in a header:

```
X-Extension-Token: <token>
```

The token is read-only and scoped to this single endpoint — it cannot read or
modify bookmarks or account data. Because it is a bearer credential it belongs
in the header, never in a query parameter where it would reach server logs and
browser history, and it should only travel over HTTPS.

## Look up a page's title and icon

```
GET https://bookmarkify.cc/api/extension/site-info?url=<url-encoded page URL>
```

On the hosted service nginx forwards `/api/` to the backend and strips the
prefix, so the backend itself sees `/extension/site-info`.

The **Test** button in settings calls this same endpoint with a fixed probe URL
and only inspects the authentication outcome: a page the service cannot resolve
still proves the token is valid.

```bash
curl -H "X-Extension-Token: YOUR_TOKEN" \
  "https://bookmarkify.cc/api/extension/site-info?url=https://example.com"
```

### Success

```json
{
  "code": 0,
  "msg": "success",
  "data": { "title": "Example Domain", "favicon": "https://cdn.example/…" },
  "ok": true
}
```

`favicon` may be empty, a `data:image/…` URL, or an HTTPS URL. The hosted
service returns a signed CDN link that expires after about an hour, so the
plugin downloads the image at format time and inlines it rather than storing the
link. A response is only treated as a success when `ok` is `true` and `data`
carries both `title` and `favicon` as strings.

### Invalid token

```json
{
  "code": 125,
  "msg": "access token is invalid or has been revoked",
  "data": null,
  "ok": false
}
```

Code `125`, or an HTTP `401`/`403`, is reported to the user as an
authentication failure. Any other non-`200` status is reported as a server
error, and a well-formed response that does not describe a page is reported as
an unresolved page. These are kept apart because the user's next action differs
in each case.

### Rate limit

Roughly one request per 300 ms per token. The plugin issues requests serially
with at least 350 ms between them, and abandons any lookup that has not answered
within 10 seconds.
