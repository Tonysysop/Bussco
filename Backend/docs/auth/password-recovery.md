# Increment 4 — Password recovery and password change

Status: **planned**

## Scope
- Request a reset email; reset with a token.
- Authenticated password change.

## Exclusions
- Admin-initiated resets; MFA.

## Proposed endpoint contract

`POST /api/v1/auth/password_resets` `{ "email": "…" }` → `202` always.

`PATCH /api/v1/auth/password_reset` `{ "token": "…", "password": "…" }` → `200` · `422` invalid/expired token or weak password.
(Token in the body, not the path: Rails logs request paths unfiltered.)

`PATCH /api/v1/auth/password` (authenticated) `{ "current_password": "…", "password": "…" }` → `200` · `422`.

## Business rules
- Reset token via `generates_token_for :password_reset, expires_in: 15.minutes { password_salt.last(10) }`
  so it becomes invalid once the password changes (single use).
- A successful reset or change deletes all of the user's `sessions` rows in the
  same transaction as the password update.
- A reset doesn't log the user in. A change deletes the current session too,
  then creates a new row and calls `rotate_browser_session`, so the user stays
  logged in with a new auth cookie and CSRF token (returned as `csrf_token`).
- Same password rules as registration.

## Security requirements
- All requests here are unsafe: they need an allowed `Origin` and a valid `X-CSRF-Token` (increment 0).
- Reset tokens are submitted by `PATCH` from the frontend page; the emailed GET link never changes state.
- No account enumeration on request.
- Tokens never logged; token appears only in the email link (frontend route
  that calls the API).
- `rate_limit` on request and reset.
- Change requires `current_password`.

## Acceptance criteria
- Request for known email enqueues one mail; unknown → 202, none.
- Valid token resets password; reused/expired token → 422.
- Other sessions revoked after reset/change.
- Wrong `current_password` → 422, no change.
- With forgery protection enabled: missing/invalid CSRF token or disallowed `Origin` → 403 on all three endpoints, no state change.
- After a password change, the pre-change CSRF token is rejected.

## Dependencies
- 0 (CSRF/origin, rotation helper), 1 (users), 3 (sessions, for revocation and authenticated change).
