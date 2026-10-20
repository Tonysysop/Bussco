# Increment 0 — Browser authentication foundations

Status: **implemented** (session middleware, CSRF, Origin checks, `GET /api/v1/csrf`,
`rotate_browser_session`). The database-backed auth session rules in §6 are
built in increment 3.

## Scope
- Cookie and Rails session middleware for the API.
- CSRF protection and Origin checks for every unsafe API request.
- A CSRF token endpoint usable before login.
- Shared conventions the later increments rely on: the session-rotation hook
  and the cookie/expiry rules for the database-backed auth session (built in
  increment 3).

## What this is not
These are **browser request-integrity controls**. They prove a request came
from our own page in a browser that holds our session cookie. They do **not**
say who the user is or what they may do:
- Authentication (identity, login, the `bussco_auth` session): increments 1–3.
- Admin access: increment 5.
- Authorization (membership gates, admin roles, financial approvals): not designed
  yet; financial approval permissions are explicitly undefined (`design.md`).

A request that passes every check here is still anonymous.

**Browser-facing controllers only.** These checks live in
`Api::V1::BaseController`, which is the base for endpoints the BUSSCO browser
app calls. A future machine-to-machine integration (e.g. payroll import) is not
a browser: it can't hold this session or send a meaningful `Origin`. Give it its
own base controller (inheriting `ApplicationController`) with an authentication
scheme designed for it at that time. Don't weaken these checks or call
`skip_forgery_protection` on browser controllers to make room for it.

## Exclusions
- Users, the `sessions` table, login: increments 1–3.
- CORS: React and Rails share one origin (see `design.md`), so there is no CORS middleware.
- Bearer tokens and `localStorage`/`sessionStorage` storage: not used.

## Two sessions, two jobs

| | Rails session (CSRF) | Authentication session |
|---|---|---|
| Purpose | Holds the CSRF secret (`session[:_csrf_token]`, managed by Rails) | Proves who is logged in |
| Storage | `ActionDispatch::Session::CookieStore`, encrypted cookie `_bussco_session` | `sessions` table row; signed cookie `bussco_auth` holds only the row id |
| Exists | From the first token request, logged in or not | Only after login |
| Revocation | `reset_session` | Delete the row (server-side) |

The Rails session stores nothing except what Rails' forgery protection puts
there. No user ids or other state go in it.

## Design

### 1. Cookie and session middleware (`config/application.rb`)
API-only apps leave these middlewares out (Rails 8.1 adds `Cookies` and the
session store only when `api_only` is false), so we add them back:

```ruby
config.session_store :cookie_store, key: "_bussco_session",
  httponly: true, same_site: :lax, secure: Rails.env.production?
config.middleware.use ActionDispatch::Cookies
config.middleware.use config.session_store, config.session_options
```

`secure:` is set explicitly: Rails' automatic "secure session cookie under
`force_ssl`" lives in the same non-API branch, so API apps don't get it.
The cookie is written only when the session is used, so `GET /up` and
`GET /api/v1/health/ready` set no cookies.

`Api::V1::BaseController` includes `ActionController::Cookies` and
`ActionController::RequestForgeryProtection`.

### 2. CSRF token storage and validation
`Api::V1::BaseController`:

```ruby
self.forgery_protection_origin_check = true
protect_from_forgery with: :exception
rescue_from ActionController::InvalidAuthenticityToken do
  render json: { error: "invalid_csrf_token" }, status: :forbidden
end
```

- **Rails 8.1 note:** a controller that includes `RequestForgeryProtection`
  itself (as API controllers must) gets the module's defaults, not
  `config.action_controller.*`. So `forgery_protection_origin_check` is `false`
  unless set on the controller, and `allow_forgery_protection` is `true` even in
  the test environment (where `test.rb` sets it `false` only for
  `ActionController::Base`).
- Storage: Rails' default (`session[:_csrf_token]` in the encrypted
  `_bussco_session` cookie). We don't override Rails' token storage or token
  verification.
- Delivery: `GET /api/v1/csrf` → `200 { "csrf_token": form_authenticity_token }`
  with `Cache-Control: no-store`. The value is masked per response; any token
  issued for the current Rails session is valid.
- Client: React stores the token in memory only and sends it as the
  `X-CSRF-Token` header on every unsafe request (POST/PUT/PATCH/DELETE).
- Rails verifies the token on every unsafe request. GET/HEAD are not
  verified, so **no GET endpoint may change state** (create, verify, log in,
  log out, send mail, reset).
- No auth controller calls `skip_forgery_protection`.

### 3. Anonymous / pre-login requests
`GET /api/v1/csrf` works without login. On first call it creates the
`_bussco_session` cookie. Registration, verification, login and password-reset
requests all need that token, the same as logged-in requests. Login CSRF is
blocked because login itself is protected.

### 4. Origin checks
An additional browser control on unsafe requests, layered on the CSRF token:

1. **Rails built-in check** (enabled on `BaseController`, see §2): the `Origin`
   header must equal `request.base_url` (scheme + host + port).
2. **Origin required:** Rails accepts a *missing* `Origin` for old user agents.
   Modern browsers send it on every non-GET fetch, so `BaseController`
   overrides the documented hook `valid_request_origin?` to also require it
   to be present.
3. **Which hosts can be `base_url`:** production sets
   `config.hosts = ENV.fetch("APP_HOSTS")` (comma-separated public hostnames;
   boot fails if unset). Host authorization rejects any other `Host`, so
   "same as `base_url`" means "one of our public origins". No separate origin
   allowlist is kept. No health-check exemption is configured; add one only
   when a deployment needs it.

| Unsafe request's `Origin` | Result |
|---|---|
| Missing | `403 { "error": "invalid_csrf_token" }` |
| `null` | `403 { "error": "invalid_csrf_token" }` |
| Different scheme/host/port from `request.base_url` | `403 { "error": "invalid_csrf_token" }` |
| Same as `request.base_url`, but token missing or invalid | `403 { "error": "invalid_csrf_token" }` |
| Same as `request.base_url`, valid token | Request proceeds |

Every failure gets the same code, so the response never says which check failed.

Behind any proxy, Rails' `request.base_url` must equal the origin the browser
is on, or every unsafe request is rejected.

**Development (Vite proxy).** Use the object form with `changeOrigin: false`:

```ts
server: { proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } } }
```

Vite's string shorthand (`"/api": "http://127.0.0.1:3000"`) silently sets
`changeOrigin: true` (Vite 8.3, `normalizeProxy`), which rewrites `Host` to
`127.0.0.1:3000`. Rails then sees `base_url` `http://127.0.0.1:3000`, which
never matches `Origin: http://localhost:5173`. Verified with real requests
through Vite 8.3.4. With the object form, `base_url` is `http://localhost:5173`:
same-origin requests with a valid token succeed, and a different host
(`127.0.0.1`), scheme (`https`) or port is rejected.

**Production requirements.**
- **HTTPS only.** TLS terminates at the reverse proxy. Production sets
  `assume_ssl` (Rails treats every request as HTTPS, so `base_url` starts with
  `https://`) and `force_ssl` (HSTS, secure cookies). The app port must be
  reachable **only** through the proxy, never directly.
- **Host preserved.** The proxy passes the browser's `Host` through unchanged,
  or sets `X-Forwarded-Host` to it. That host must be listed in `APP_HOSTS`.
  Don't rewrite `Host` to an internal name, and don't add a non-standard port.
  The browser's origin must be `https://<host>` on the default port.
- **No other proxy rewriting.** If a proxy sets `X-Forwarded-Host` or
  `X-Forwarded-Port`, Rails uses them for `base_url`, so they must describe the
  public origin.

### 5. Session rotation and CSRF renewal
A `BaseController` helper, `rotate_browser_session`, calls `reset_session`
(a documented Rails API). In Rails 8.1 that destroys the session and resets
the CSRF token, so every token issued before stops working. Then it returns a
fresh `form_authenticity_token`.

It's called on:
- Login (member and admin): before the auth cookie is set.
- Logout.
- Password reset and password change.

Those responses include `"csrf_token"`. The client swaps in the new token, and
the old one stops working.

**Limit of rotation.** `_bussco_session` is a cookie store: the session (and its
CSRF secret) lives in the encrypted cookie, not on the server. `reset_session`
replaces the browser's cookie, but anyone holding a copy of the old cookie can
still use it with the old token. Rotation therefore protects against session
fixation and stale tokens in the normal browser, not against a stolen cookie.
Revoking access server-side is the job of the database-backed `bussco_auth`
session (§6, increment 3). A test pins this behaviour so it isn't mistaken for
a revocation guarantee.

### 6. Revocable database-backed auth sessions (rules; table built in increment 3)
- `sessions` row: `user_id`, `created_at`, `last_seen_at`, `ip_address`,
  `user_agent`, `admin` (boolean, default false).
- Cookie `bussco_auth`: `cookies.signed`, `httponly: true`, `same_site: :lax`,
  `secure` in production, host-only (no `domain`), and no `expires`, so it lasts
  as long as the browser session. Expiry is enforced on the server, never by the
  cookie.
- On every authenticated request, the session is valid only if:
  - the row exists;
  - `last_seen_at` is within the **idle timeout**;
  - `created_at` is within the **absolute lifetime**;
  - the user's account status is active.

  Otherwise the row is deleted, the cookie cleared, and the response is `401`.
- Timeouts (constants in one place):

  | | Idle | Absolute |
  |---|---|---|
  | Member/applicant | 30 min | 12 h |
  | Admin | 15 min | 8 h |

- `last_seen_at` is written at most once a minute, to avoid a write on every request.
- Revocation is deleting rows: logout deletes one. Password reset/change and
  disabling an account delete all of a user's rows, in the same transaction as
  the change.

## Tradeoffs
- **Two cookies.** Keeping the CSRF session separate from the auth session
  means anonymous requests get CSRF protection without a DB row. Auth sessions
  stay revocable and listable server-side, and each has its own lifecycle. The
  cost is a second cookie and the need to rotate both on login.
  Putting the auth session id inside the Rails session would save a cookie but
  tie revocation to cookie lifetime.
- **Token endpoint vs. readable cookie.** A `GET /csrf` call costs one extra
  request per page load. In return the token isn't readable by any script on the
  origin through `document.cookie`, and we stay on Rails' default token storage
  without custom code.
- **Requiring `Origin`.** Non-browser clients (curl, scripts) must send a
  matching `Origin` to call unsafe endpoints. That's fine because this API serves
  the browser app only. Modern browsers send `Origin` on every non-GET fetch.
- **`config.hosts` instead of an origin allowlist.** One list (`APP_HOSTS`)
  bounds both the accepted `Host` and, through Rails' check, the accepted
  `Origin`. A second list would have to be kept in sync for no extra protection.
- **SameSite=Lax** blocks most cross-site cookie sending already. CSRF tokens
  and Origin checks are kept as defence in depth, and as cover for older browsers
  and same-site subdomains.

## Security requirements
- Never log the CSRF token, `_bussco_session`, or `bussco_auth`. The existing
  `filter_parameters` entries `:token` and `:session` cover `csrf_token`,
  `authenticity_token` and `_bussco_session`; add `bussco_auth` in increment 3.
  Don't log request headers.
- Failure responses carry only an error code, never the reason a token failed.

## Tests
`test/controllers/api/v1/csrf_controller_test.rb`,
`test/controllers/api/v1/base_controller_test.rb` (a test-only controller
mounted with `with_routing`, so no placeholder route ships) and
`test/controllers/api/v1/health_controller_test.rb`. Forgery protection is
already on for these controllers in the test environment; nothing toggles it.

- `GET /api/v1/csrf` → 200 with a token, `Cache-Control: no-store`, and a
  `Set-Cookie` for `_bussco_session` with `HttpOnly` and `SameSite=Lax`
  (`Secure` in production only).
- Unsafe request with same Origin + valid token → 2xx.
- Missing token → 403 `invalid_csrf_token`.
- Forged token → 403.
- Missing `Origin`, `Origin: null`, cross-site `Origin` (each with a valid token) → 403.
- GET needs neither token nor `Origin`.
- A token from before `rotate_browser_session` is rejected afterwards; the new one works.
- A replayed copy of the pre-rotation cookie still validates its own old token
  (documents the cookie-store limit above).
- `GET /up` and `GET /api/v1/health/ready` still work and set no cookies.

## Dependencies
- Scaffold only.
