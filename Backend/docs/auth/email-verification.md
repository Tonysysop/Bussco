# Increment 2 — Email verification

Status: **planned**

## Scope
- Send a verification code on registration and on request.
- Verify the code and set `users.email_verified_at`.

## Exclusions
- Login (increment 3). Until then, verification is identified by email + code.
- Any employment or membership check — verification proves email ownership only.

## Proposed endpoint contract

`POST /api/v1/auth/email_verifications` — send/resend
```json
{ "email": "ada@example.com" }
```
→ `202 Accepted` always (no account enumeration).

`PATCH /api/v1/auth/email_verification`
```json
{ "email": "ada@example.com", "code": "123456" }
```
→ `200 OK` `{ "email_verified": true }` · `422` invalid/expired code.

## Business rules
- 6-digit numeric code, expires after 15 minutes, single use.
- New code invalidates earlier codes for that user.
- Already-verified users: send nothing, still `202`.
- Mail sent via `UserMailer#email_verification` with `deliver_later`.

## Security requirements
- All requests here are unsafe: they need an allowed `Origin` and a valid `X-CSRF-Token` (increment 0).
- Verification is never done by a GET link. An emailed link opens a frontend page, which submits the `PATCH`.
- Store only a digest of the code (e.g. HMAC-SHA256 with a secret), never the code.
- Max attempts per code (e.g. 5), then invalidate.
- `rate_limit` on both actions.
- Codes never logged; mailer previews/tests must not print them to logs.
- Comparison with `ActiveSupport::SecurityUtils.secure_compare`.

## Acceptance criteria
- Registration enqueues one verification email (`assert_enqueued_emails`).
- Correct code sets `email_verified_at`; second use fails.
- Expired, wrong, or over-attempt codes → 422, no change.
- Unknown email → 202, no email sent.
- With forgery protection enabled: missing/invalid CSRF token or disallowed `Origin` → 403, no code sent or consumed.

## Dependencies
- 0 (CSRF/origin protection), 1 (`users` table, registration).
- Development writes mail to `tmp/mails/` (`:file` delivery); test uses `:test` delivery.
