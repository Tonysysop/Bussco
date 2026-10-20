# Increment 3 — Member sessions (login, logout, current user)

Status: **planned**

## Scope
- `sessions` table and `Session` model, following the rules in
  [browser-foundations.md §6](browser-foundations.md#6-revocable-database-backed-auth-sessions-rules-table-built-in-increment-3).
- `Authentication` concern: `require_authentication`, `Current.session`, `Current.user`.
  It enforces idle expiry, absolute expiry and account status on every request.

## Exclusions
- Cookie middleware, CSRF and origin checks: done in increment 0, reused here.
- Admin login (increment 5) and password reset (increment 4).
- Membership-gated endpoints (dashboard, savings, loans). They'll use a separate
  `require_approved_membership` check when built.
- A "list/revoke my other sessions" UI.

## Proposed endpoint contract
All unsafe requests need an allowed `Origin` and `X-CSRF-Token` (increment 0).

`POST /api/v1/auth/session`
```json
{ "login": "ada@example.com or SAP ID", "password": "…" }
```
- `201` → `{ "user": { … }, "csrf_token": "…" }` plus `Set-Cookie: bussco_auth=…; HttpOnly; SameSite=Lax[; Secure]`
  and a rotated `_bussco_session`.
- `401` → `{ "error": "invalid_credentials" }`, the same for every failure cause,
  including a disabled account.

`DELETE /api/v1/auth/session`
- `200` → `{ "csrf_token": "…" }`. Deletes the row, clears `bussco_auth`, and
  rotates the Rails session.

`GET /api/v1/auth/me`
- `200` → `{ "user": { id, full_name, email, email_verified, membership_status } }`.
- `401` when there's no valid session, the session has expired, or the account
  is disabled.

## Business rules
- `login` matches the normalised email, or `sap_id` if one is linked. Unlinked
  SAP IDs never match.
- Applicants (not yet approved) may log in, and the response shows their
  membership status.
- Unverified emails may log in. The response shows `email_verified: false` so
  the UI can prompt them.
- Disabled accounts are rejected at login. Existing sessions for a disabled
  account fail on their next request, and disabling an account deletes all of
  that user's sessions.
- Idle timeout is 30 minutes and absolute lifetime is 12 hours (from increment 0).
  When either is exceeded, the row is deleted and the response is `401`.

## Security requirements
- Credentials are checked with a timing-safe method that does the password-hash
  work even for unknown logins (e.g. `User.authenticate_by`).
- On login: call `rotate_browser_session` (resets the Rails session and gives a
  new CSRF token), create a new `sessions` row, then set `bussco_auth`. Existing
  cookies are never reused (no session fixation).
- Logout deletes the row server-side; a replayed cookie gets `401`.
- `rate_limit` on create.
- Never log passwords or cookies.

## Acceptance criteria
Tests run with forgery protection enabled where CSRF is involved.
- Login by email and by linked SAP ID succeeds. A wrong password, unknown
  login, or disabled account gets an identical `401`.
- Login without a CSRF token, with an invalid token, or from a disallowed
  `Origin` → `403`, and no session row is created.
- After login, the pre-login CSRF token is rejected and the returned token works.
- `/me` works with the cookie and returns `401` without it, after logout, after
  the row is deleted, and after the user is disabled.
- Idle and absolute expiry tested with `travel`: `401`, and the row is deleted.
- `last_seen_at` is updated at most once per minute.
- The `bussco_auth` `Set-Cookie` has `HttpOnly`, `SameSite=Lax`, and no `Domain`.

## Dependencies
- 0 (cookies, CSRF, origin checks, rotation helper, session rules).
- 1 (`users`), 2 (`email_verified` flag).
