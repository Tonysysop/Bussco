# BUSSCO frontend

React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui (`base-nova`), TanStack Query, React Router, Zod.

## Development

```sh
# in Backend/
bin/rails s            # API on http://127.0.0.1:3000

# here
npm install
npm run dev            # http://localhost:5173 — /api is proxied to Rails
```

Open the app at the Vite origin (`http://localhost:5173`). The proxy keeps the browser's `Host`
(`changeOrigin: false`), so Rails' Origin check compares against the Vite origin; the string shorthand
`"/api": "http://..."` would turn on `changeOrigin` and every POST would get 403
(`Backend/docs/auth/browser-foundations.md` §4).

```sh
npm test               # Vitest + Testing Library
npm run lint
npm run typecheck
npm run build
```

## Routes

| Path | Page |
|------|------|
| `/` | redirects to `/login` |
| `/login` | sign in (`POST /api/v1/auth/session`); a signed-in member goes to `/apply` |
| `/signup` | registration (`POST /api/v1/auth/registrations`); a signed-in member goes to `/apply` |
| `/verify-email` | six-digit email verification code, with resend |
| `/forgot-password` | request a password reset code (`POST /api/v1/auth/password_resets`, always 202) |
| `/reset-code` | verify the reset code (`POST …/password_resets/verify`); needs the email in router state |
| `/reset-password` | set a new password (`PATCH …/password_resets`); Rails' session cookie, not the router, authorizes it |
| `/apply` | signed-in placeholder; signed out goes to `/login` |
| `/admin/login` | admin sign-in (`POST /api/v1/admin/auth/session`); a signed-in admin goes to the safe `next` or `/admin` |
| `/admin` | signed-in admin placeholder (who is signed in, Change password, Sign out); every `/admin/*` page needs an admin session |
| `/admin/password` | change the admin password; the only page for an admin with a temporary password |

Signed-in state comes only from `meQuery` (`GET /api/v1/auth/me`; a 401 resolves to `null`).

## Admin portal (A1.2)

Separate from member auth everywhere: its own cookie (`bussco_admin`, set by Rails), its own query
(`adminMeQuery`, key `["admin","me"]`, `GET /api/v1/admin/auth/me`, a 401 resolves to `null`) and its
own pages (`src/pages/admin-*`, shell in `src/components/admin-layout.tsx`). Admin code never reads
`meQuery`, so a member session never counts as an admin one. The role shown comes from Rails and is
display only; Rails authorizes every admin request, and the route guard is a convenience.

- **Sign-in:** client validation (the design's messages), then the `POST`, then a confirming
  `GET /admin/auth/me`. One generic message for every rejected sign-in. If the confirming check gets no
  answer, the page offers **Try again**, which repeats only the check, never the sign-in.
- **`RequireAdmin`** guards `/admin/*`: no admin session goes to `/admin/login?next=…`. `next` is
  honoured only for same-origin `/admin…` paths (`safeAdminPath`), else `/admin`. Rails is re-asked
  on each route change and window focus once the cached answer is 30 s old; an admin who turns into
  "no session" (expired, revoked, disabled) is sent back with `reason=expired`, which shows the
  "Your session has expired" notice.
- **Password (`/admin/password`, A1.3):** an admin whose `must_change_password` is true (the Super Admin's
  temporary password) is kept on this page by `RequireAdmin` and the login redirect; Rails also refuses
  every other admin endpoint (`403 password_change_required`). `PATCH /api/v1/admin/auth/password` ends
  every session and returns a fresh one with a rotated CSRF token, which `send()` adopts. Other admins
  reach the same form as a voluntary change from `/admin`.
- **Sign out:** `DELETE /api/v1/admin/auth/session`, then `forgetAdminSession` (drops every `["admin"]`
  query). Member state is untouched; Rails keeps the two sessions apart.
- **Design:** `design-reference/bussco-admin-login-…` (Main.dc.html, tokens.json). Newsreader and
  Instrument Sans load only from `admin-layout.tsx` and apply only inside `AdminLayout`. Four layouts
  at <360, 360+, 600+ and 1024+ px; font sizes in rem so browser text scaling applies.

## API client (`src/lib/api.ts`)

- Every request sends `credentials: "include"` and `Accept: application/json`.
- Unsafe requests send `X-CSRF-Token`, fetched once from `GET /api/v1/csrf` and kept **in memory only**;
  a 403 drops it so the next request fetches a fresh one. Nothing auth-related goes in
  `localStorage`/`sessionStorage`; the session cookies are HttpOnly and set by Rails.
- Non-2xx responses throw `ApiError` (`status`, parsed `body`, `retryAfter` seconds).

## Validation (`src/lib/validation.ts`)

Zod schemas mirror the Rails model rules so users get errors before a round trip; Rails stays
authoritative and its 422 errors are shown under the matching fields.

- Full name: trimmed, 1–120 characters. Email: trimmed, lowercased, valid, ≤ 254 characters.
- Password: at least 12 characters (Unicode code points, as Ruby counts) and at most 72 UTF-8 bytes
  (bcrypt's limit). No complexity rules. `passwordRules` drives the live indicator
  (`PasswordRuleHints`) on signup and password reset; `resetPasswordSchema` adds the confirmation
  match, which the reset page also uses for its live "Passwords match" feedback.
