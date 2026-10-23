# Increment 3 — Member sessions (login, logout, current user)

Status: **implemented**.

## Scope
- `sessions` table and `Session` model, following the rules in
  [browser-foundations.md §6](browser-foundations.md#6-revocable-database-backed-auth-sessions-rules-table-built-in-increment-3).
- Login by email + password, logout, current user.
- Automatic login after email verification, in the browser that registered.

## Exclusions
- Cookie middleware, CSRF and origin checks: done in increment 0, reused here.
- Admin login and the `admin` column (increment 6, now implemented: [admin-access.md](admin-access.md));
  password reset (increment 5).
- Login by SAP ID: nothing assigns `sap_id` yet. Add it when admins can link one.
- Membership-gated endpoints (dashboard, savings, loans). They'll use a separate
  `require_approved_membership` check when built.
- A "list/revoke my other sessions" UI. A `Current`/`Authentication` concern: the
  `BaseController` helpers (`require_authentication`, `authenticated_session`) are enough.
- Frontend screens.

## Endpoint contract
All unsafe requests need an allowed `Origin` and `X-CSRF-Token` (increment 0), otherwise
`403 { "error": "invalid_csrf_token" }` and no session row.

`POST /api/v1/auth/session` — `{ "email": "ada@example.com", "password": "…" }`
- `201` → `{ "user": { … }, "csrf_token": "…" }`, `Set-Cookie: bussco_auth=…; HttpOnly; SameSite=Strict[; Secure]`
  and a rotated `_bussco_session`. The client must switch to the returned CSRF token.
- `401 { "error": "invalid_credentials" }`: unknown email, wrong password, disabled account,
  or a blank/non-string password. One answer for all.
- `403 { "error": "email_not_verified" }`: only after the password is correct.
- `429 { "error": "rate_limited" }` + `Retry-After: 900`: 20 per IP, or 10 per submitted
  email (keyed whether or not the account exists), per 15 minutes.

`DELETE /api/v1/auth/session`
- `200 { "csrf_token": "…" }`, logged in or not. Deletes the row, clears `bussco_auth`,
  rotates the Rails session.

`GET /api/v1/auth/me`
- `200 { "user": { id, full_name, email, email_verified, account_status, membership_status } }`.
- `401 { "error": "unauthenticated" }` with no cookie, an unknown token, after logout,
  after expiry, or when the account is disabled.

`PATCH /api/v1/auth/email_verification` (increment 2) also signs in; see below.

## Credential
- `bussco_auth` holds `SecureRandom.urlsafe_base64(32)` (256 bits). Only its SHA-256
  hex digest is stored (`sessions.token_digest`, unique). A copied database row can't
  be replayed as a cookie. An unkeyed hash is enough because the token can't be guessed.
- Cookie: `httponly`, `same_site: :strict`, `secure` in production, host-only, no
  `expires`. Strict is safe because the frontend is served from the same origin as the API.
- The token never appears in a JSON response, a database column or the log
  (`filter_parameters` includes `:bussco_auth` and `:cookie`).

## Business rules
- Login matches the normalised email (`User.authenticate_by`).
- Applicants (not yet approved) may log in; the response shows their membership status.
- Unverified emails can't log in (`403 email_not_verified`), and only the right password
  reveals that.
- Disabled accounts are rejected at login. Disabling an account (`account_status` →
  `disabled` through the model) deletes all its sessions in the same transaction, and every
  request re-checks the status, so a change that skips callbacks still blocks the next request.
- Deleting a user deletes their sessions (`dependent: :delete_all` and `ON DELETE CASCADE`).
- Idle timeout 30 minutes, absolute lifetime 12 hours (`Session::IDLE_TIMEOUT`,
  `ABSOLUTE_LIFETIME`). Past either one, the row is deleted, the cookie is cleared and the
  response is `401`.
- Logging in again in the same browser (by login or OTP auto-login) first revokes that
  browser's current session, so its old cookie stops working. Sessions on other browsers and
  devices are untouched.
- Cleanup is opportunistic, not comprehensive: each new session deletes that user's expired
  rows (`Session.expired`). Rows of users who never sign in again stay until they do; there is
  no background job. Add a scheduled `Session.expired.delete_all` if the table grows.

### Automatic login after email verification
- Registration stores `session[:registered_user_id]` in the Rails session (`_bussco_session`).
  That is onboarding state, not authentication: on its own it opens nothing (`/me` → `401`).
- A successful `PATCH /auth/email_verification` also signs in only if that value matches the
  verified user and the account is active. The response is then
  `{ "email_verified": true, "user": { … }, "csrf_token": "…" }` with `bussco_auth`, and the
  Rails session is rotated, which drops `registered_user_id`.
- Verifying in any other browser (or for a disabled account) returns only
  `{ "email_verified": true }`. The user then logs in normally.
- All OTP rules from increment 2 still apply. The row lock lets only one request per code
  succeed, so concurrent submissions create at most one session.

### Concurrency
- `last_seen_at` is moved forward by one conditional `UPDATE … WHERE last_seen_at` is between
  `now - 30 min` and `now - 1 min`. So it's written at most once a minute, it only moves
  forward, and it never revives a row that has expired or been deleted.
- `created_at` is never written after insert, so nothing extends the 12-hour limit.

## Security requirements
- `authenticate_by` does the bcrypt work for unknown emails too (timing-safe).
- On login: revoke this browser's previous session, `rotate_browser_session` (new CSRF token),
  then a new row and a new token. An existing cookie is never reused (no session fixation).
- Logout deletes the row server-side; a replayed cookie gets `401`.

## Tests
`test/controllers/api/v1/auth/sessions_controller_test.rb`,
`test/controllers/api/v1/auth/email_verifications_controller_test.rb` and
`test/integration/session_race_test.rb` (real threads, committed rows) cover:
- Cookie flags; only the digest stored; the token in no response or log.
- An identical `401` for a wrong password, an unknown email, a disabled account or a malformed
  password; `email_not_verified` only with the right password.
- CSRF rotation on login; a missing/invalid token or a foreign/missing Origin → `403`, no row.
- Logout → a replayed cookie gets `401`; `/me` → `401` for no cookie, a forged token or a
  deleted row.
- Idle and absolute expiry with `travel`: `401` and the row deleted; `last_seen_at` written
  at most once a minute.
- Disabling the account (with and without callbacks) and deleting the user.
- Login deletes the user's expired rows but keeps live ones and other users'. Logging in again
  in the same browser kills the old cookie, the new one works, another device's session
  survives, and logout still revokes the current one.
- Per-IP and per-email rate limits.
- OTP auto-login in the registering browser; none in another browser, for a disabled account
  or on replay; `registered_user_id` alone authenticates nothing.
- Concurrency: four parallel right codes → one session; parallel touches → one write; parallel
  resumes of an expired session → all `nil` and the row deleted.

## Dependencies
- 0 (cookies, CSRF, origin checks, rotation helper, session rules).
- 1 (`users`), 2 (`email_verified` flag).
