# Increment 5 — Password recovery by six-digit code

Status: **implemented**.

## Scope
- Request a password reset code by email (Resend), verify it, then set a new password.

## Exclusions
- Authenticated password change (planned: [README](README.md), "Password change").
- Admin-initiated resets; MFA. Verifying a reset code never signs anyone in, never marks an
  email verified and never changes account status, membership status, SAP ID or a membership application.

## Endpoint contract

One controller, `Api::V1::Auth::PasswordResetsController`. Every action is an unsafe request:
allowed `Origin` + valid `X-CSRF-Token` (increment 0), otherwise `403`, with no state change.

`POST /api/v1/auth/password_resets` `{ "email": "…" }`
→ `202`, empty body, **always**: unknown, disabled, inside the cooldown, or sent.

`POST /api/v1/auth/password_resets/verify` `{ "email": "…", "code": "123456" }`
→ `200 {}` and the reset authorization is stored in this browser's Rails session cookie
(`_bussco_session`: encrypted, HttpOnly). No `bussco_auth` cookie, no login.
→ `422 { "error": "invalid_code" }` for every failure: unknown email, wrong, expired, used,
superseded, five attempts used, disabled account.

`PATCH /api/v1/auth/password_resets` `{ "password": "…" }` (the authorization comes from the session cookie)
→ `200 { "csrf_token": "…" }`. All logins are revoked, this browser's included; the browser
session is rotated (use the new CSRF token) and the user must log in again.
→ `422 { "error": "invalid_reset_token" }`: none, expired, used, superseded, or account disabled.
→ `422 { "errors": { "password": [ … ] } }`: same rules as registration (12+ characters,
72 bytes max). Nothing changes and the authorization stays usable.

| Other cases | Response |
|---|---|
| Rate limited | `429 { "error": "rate_limited" }` + `Retry-After` |
| Unparseable JSON | `400 { "error": "bad_request" }` |
| Non-string or NUL params | treated as blank → `202` / `422`, never `500` |

## Business rules
- **Codes**: same rules and mechanics as email verification ([email-verification.md](email-verification.md)):
  CSPRNG six digits, 10-minute expiry from issue, 5 attempts, single use, 60-second resend
  cooldown, generated inside the delivery job. Stored on their own `users.password_reset_*`
  columns with an HMAC key of their own purpose ("user password reset code"), so a reset code
  never works as a verification code or the other way round. Only active accounts get codes.
- **Reset authorization**: `generates_token_for :password_reset, expires_in: 10.minutes`, embedding
  `password_salt.last(10)` and `password_reset_generation`. It is invalid once the password
  changes (single use) or a new code is requested (superseded). It is never returned in a response.
- **Reset**: one transaction locks the user row (`User.lock.find_by_token_for`), saves the new
  password with the `password_reset` validation context (rejects `""`, which `has_secure_password`
  would otherwise ignore), bumps the generation (voiding outstanding codes and pending delivery
  jobs), clears the code columns and deletes every `sessions` row. A parallel request with the
  same authorization waits on the lock, reloads the new salt and gets `422`.
- **Login during a reset**: login starts its session under the same row lock
  (`User#with_password_unchanged`) and only if the password hash is the one bcrypt checked, so a
  login with the old password that overlaps a reset can't leave a session behind.
- After commit: `terminate_session`, `rotate_browser_session`, and a "password was changed"
  email (no code, no password).

## Rate limits
Shared Solid Cache store (`BaseController::RATE_LIMIT_STORE`, fail-open).
- **Per IP: 60 / 15 min** across all three actions. A flood ceiling sized for an office behind
  one NAT address, not brute-force protection.
- **Per submitted email**, whether or not the account exists (a `429` reveals nothing):
  5 code requests / hour (`Retry-After: 3600`), 10 verifications / 15 min (`900`).
- **Per code (database)**: 5 attempts, so guessing is bounded even if the limiter fails open.

## Database
`AddPasswordResetToUsers`: `password_reset_code_digest`, `password_reset_code_issued_at`,
`password_reset_requested_at`, `password_reset_generation` (default 0), `password_reset_attempts`
(default 0, check `BETWEEN 0 AND 5`).

## Logging
`email`, `code`, `password` and the session are filtered parameters; job arguments hold only the
user GlobalID and generation; Action Mailer's logger is off. Tests assert codes, the
authorization and the new password never reach the log.

## Acceptance criteria (covered by tests)
- Known email → one code email; unknown/disabled → `202`, none; inside cooldown → none.
- Right code → `200`, no session; wrong → `422`, attempt +1; 5 wrong then right → `422`;
  expired, used and superseded codes → `422`; reset codes and verification codes don't cross.
- Reset → `200`; old password fails, new one logs in; every session revoked; confirmation email
  without secrets; verification, statuses, SAP ID and membership application unchanged.
- Authorization reused, replayed from an old cookie, expired, superseded or missing → `422`.
- Weak/empty/non-string password → `422`, nothing changed, authorization still works.
- CSRF or Origin missing/foreign → `403` on all three, no state change.
- 61st request per IP, 6th code request and 11th verification per email (known or not) → `429`.
- Concurrency: one success from 4 parallel right codes and from 4 parallel resets with one
  authorization; attempts stop at 5; one generation from 4 parallel requests.

## Manual testing (Thunder Client)
1. `GET /api/v1/csrf` → keep the cookie and `csrf_token`.
2. `POST /api/v1/auth/password_resets` with `Origin` + `X-CSRF-Token` → read the code from the
   email (or `tmp/mails/` without `RESEND_API_KEY`).
3. `POST /api/v1/auth/password_resets/verify`, then `PATCH /api/v1/auth/password_resets` in the
   same cookie jar.
