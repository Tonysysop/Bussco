# Authentication — index

Status: increments 0 (browser foundations) and 1 (registration) are **implemented**;
increments 2–5 are **planned**. Users can register, but nobody can log in yet.

Read only the spec for the increment you are implementing.

| # | Increment | Spec | Depends on |
|---|-----------|------|------------|
| 0 | Browser foundations: cookies, CSRF, origin checks, session rules (**implemented**) | [browser-foundations.md](browser-foundations.md) | Scaffold |
| 1 | Registration + DB constraints (**implemented**) | [registration.md](registration.md) | 0 |
| 2 | Email verification | [email-verification.md](email-verification.md) | 0, 1 |
| 3 | Member sessions (login, logout, current user) | [sessions.md](sessions.md) | 0, 1, 2 |
| 4 | Password recovery + password change | [password-recovery.md](password-recovery.md) | 0, 1, 3 |
| 5 | Admin login + controlled provisioning | [admin-access.md](admin-access.md) | 0, 2, 3 |

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
