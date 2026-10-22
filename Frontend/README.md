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

Signed-in state comes only from `meQuery` (`GET /api/v1/auth/me`; a 401 resolves to `null`).

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
