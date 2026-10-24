# Authentication — index

Status: increments 0–3, 5 and 6 (browser foundations, registration, email verification, member
sessions, password recovery, admin authentication) are **implemented**; password change is
**planned**. Members can register, verify their email (which signs in the registering
browser), log in, log out and reset a forgotten password by emailed code. Increment 4 is the
membership application ([../membership/application.md](../membership/application.md)).

Read only the spec for the increment you are implementing.

| # | Increment | Spec | Depends on |
|---|-----------|------|------------|
| 0 | Browser foundations: cookies, CSRF, origin checks, session rules (**implemented**) | [browser-foundations.md](browser-foundations.md) | Scaffold |
| 1 | Registration + DB constraints (**implemented**) | [registration.md](registration.md) | 0 |
| 2 | Email verification by six-digit code (**implemented**) | [email-verification.md](email-verification.md) | 0, 1 |
| 3 | Member sessions (login, logout, current user) (**implemented**) | [sessions.md](sessions.md) | 0, 1, 2 |
| 5 | Password recovery by six-digit code (**implemented**) | [password-recovery.md](password-recovery.md) | 0, 1, 2, 3 |
| 6 | Admin login + controlled provisioning (A1.1, **implemented**), Super Admin role management (A1.4, **implemented**), members directory (A1.5, **implemented**) | [admin-access.md](admin-access.md) | 0, 2, 3, 5 |
| 7 | Password change (authenticated) | see "Password change" below | 0, 1, 3, 5 |

Each increment ships with its migrations, tests and doc updates, and leaves
the app working on its own.

## Shared direction

- Browser-only, same-origin, cookie-based auth. Nothing auth-related is
  stored in `localStorage`/`sessionStorage`, and the browser uses no bearer tokens.
- Every unsafe request (registration, verification, login, logout, password
  recovery/change, admin login) needs an allowed `Origin` and a valid CSRF
  token. GET requests never change state. See
  [browser-foundations.md](browser-foundations.md).
- Auth sessions are revocable PostgreSQL rows with idle and absolute expiry.
  They are separate from the Rails session that holds the CSRF secret.
- Prefer built-in Rails over gems. Candidate primitives, to be picked per
  increment only where they fit: `has_secure_password`, `authenticate_by`,
  `generates_token_for`, `normalizes`, `rate_limit`,
  `ActiveSupport::MessageVerifier`. The Rails 8 authentication generator is a
  reference to borrow from, not something we must run.
- Never log passwords, verification codes, reset tokens, CSRF tokens or cookies.

## Password change (planned)
`PATCH /api/v1/auth/password` (authenticated) `{ "current_password": "…", "password": "…" }`
→ `200` · `422`. Requires `current_password`; same password rules as registration. Deletes all
of the user's `sessions` rows in the same transaction as the update, then starts a new session
and calls `rotate_browser_session`, so the user stays logged in with a new auth cookie and CSRF
token. Wrong `current_password` → `422`, no change; the pre-change CSRF token is rejected after.
