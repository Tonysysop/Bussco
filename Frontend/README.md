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
| `/` | redirects to `/signup` |
| `/signup` | registration (`POST /api/v1/auth/registrations`) |
| `/verify-email` | placeholder confirming registration; the OTP screen comes in a later increment |

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
  (bcrypt's limit). No complexity rules. `passwordRules` also drives the live password indicator —
  reuse it for the password-reset form.
