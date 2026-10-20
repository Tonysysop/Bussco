# Increment 1 — Registration and database constraints

Status: **planned**

## Scope
- `users` table with constraints, and a `User` model using `has_secure_password`.
- `POST /api/v1/auth/registrations`, with rate limiting.

## Exclusions
- Sending or verifying email (increment 2). Registration sends no mail.
- Creating an authenticated session. Registration never logs the user in (increment 3).
- Membership review, SAP ID linking, admin provisioning.

## Initial account state

| Field | Value on registration |
|-------|-----------------------|
| `email_verified_at` | `null` |
| `account_status` | `"active"` |
| `membership_status` | `"not_started"` |
| `sap_id` | `null` |
| Admin permissions | none (the `admin_roles` table doesn't exist until increment 5) |

`active` means the account is enabled. It does **not** mean membership is
approved. No request to this endpoint can set any of these values.

## Proposed endpoint contract

`POST /api/v1/auth/registrations` — needs an allowed `Origin` and `X-CSRF-Token` (increment 0).

```json
{ "user": { "full_name": "Ada Obi", "email": "Ada@Example.com ", "password": "…" } }
```

| Case | Response |
|------|----------|
| Created | `201` `{ "user": { "id", "full_name", "email", "email_verified": false, "account_status": "active", "membership_status": "not_started" } }` |
| Validation failure or duplicate email | `422` `{ "errors": { "<field>": ["…"] } }` |
| `user` key missing / not an object | `400` (Rails' default for `params.expect`) |
| Missing/invalid CSRF token or disallowed origin | `403` (increment 0) |
| Rate limited | `429` `{ "error": "rate_limited" }` + `Retry-After: 900` |

- Response fields come from an explicit allowlist built in the controller. The
  `User` model is never serialized as a whole.
- The response has no credentials, no tokens, and no `bussco_auth` cookie.

## Input handling
- `params.expect(user: [:full_name, :email, :password])`. Unpermitted keys
  (`role`, `sap_id`, `account_status`, `membership_status`,
  `email_verified_at`, `admin`, `id`, anything else) are dropped, not
  rejected, in every environment. Leave `action_on_unpermitted_parameters`
  unset (the default does nothing). Protected attributes are never assigned
  from params.
- `full_name`: `normalizes` with `strip`. Must be 1–120 characters after trimming.
- `email`: `normalizes` with `strip.downcase`. Must match
  `URI::MailTo::EMAIL_REGEXP` (ASCII only, so Ruby `downcase` and PostgreSQL
  `lower` agree) and be ≤ 254 characters.
- `password`: no normalization (not trimmed, not truncated).
  - Minimum 12 characters: `validates :password, length: { minimum: 12 }`, which counts characters.
  - Maximum 72 bytes: from `has_secure_password`'s built-in bytesize check,
    which errors rather than truncating.
  - A password of 12 multibyte characters can exceed 72 bytes and is then rejected.

## Database constraints

Uniqueness strategy: the **normalized value is stored**, a plain unique index
sits on `email`, and a check constraint makes the DB reject anything that isn't
normalized. No `citext`, no expression index.

`users`:

| Column | Type | Null | Default | Constraint |
|--------|------|------|---------|------------|
| `full_name` | string | NOT NULL | — | `char_length(full_name) BETWEEN 1 AND 120 AND full_name !~ '^\s\|\s$'` |
| `email` | string | NOT NULL | — | unique index; `email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'` |
| `password_digest` | string | NOT NULL | — | |
| `email_verified_at` | datetime | NULL | `null` | |
| `account_status` | string | NOT NULL | `'active'` | `IN ('active', 'disabled')` |
| `membership_status` | string | NOT NULL | `'not_started'` | `IN ('not_started')`; the membership increment widens it |
| `sap_id` | string | NULL | `null` | unique index (PostgreSQL allows many NULLs); `sap_id IS NULL OR sap_id !~ '^\s*$'` |
| timestamps | | NOT NULL | | |

The model has matching validations, plus string-backed enums for
`account_status` and `membership_status`.

## Duplicate registration
- A duplicate normalized email gets `422` `{ "errors": { "email": ["has already been taken"] } }`.
  This **intentionally reveals whether an email is registered**. We accept that
  in exchange for a clear signup error, and rate limiting limits the damage.
- Concurrent duplicates: both requests can pass the uniqueness validation, but
  the unique index lets only one insert succeed. The controller rescues
  `ActiveRecord::RecordNotUnique` for the `email` index only, adds the same
  `email` error, and returns the same `422`. Any other `RecordNotUnique` is
  re-raised.
- Registration only ever does `User.create`. No upsert or
  `find_or_create_by`, so an existing account or password is never changed.

## Rate limiting
- Rule: `rate_limit to: 10, within: 15.minutes, by: -> { request.remote_ip }, store: RATE_LIMIT_STORE, with: -> { render 429 }`, on `create` only.
- Key: client IP. `remote_ip` is only correct if the proxy's address is trusted.
  The proxy runs on a private network (trusted by default); otherwise set
  `config.action_dispatch.trusted_proxies`. Tradeoff: staff behind one office
  NAT share the budget, which is why the limit is 10 and not lower.
- The `rate_limit` declaration only counts. Sharing and persistence come from
  the store, so the store is set explicitly (`store:`), not left to
  `Rails.cache`:

  | Env | Store | Notes |
  |-----|-------|-------|
  | development | `ActiveSupport::Cache::MemoryStore` | Per process; resets on restart. Acceptable locally. |
  | test | `ActiveSupport::Cache::MemoryStore`, cleared in `setup` | `Rails.cache` is `:null_store` in test, which would never limit. |
  | production | `SolidCache::Store` on the primary PostgreSQL DB | Shared across Puma workers and hosts, survives restarts. Adds the `solid_cache` gem and its table in this increment. No Redis. |

- If the store is unavailable, the limiter **fails open**. Cache errors return
  `nil`, `rate_limit` lets the request through, and the error is logged.
  Registration grants no access and can't be used to log in or verify an email,
  so we choose availability over blocking signups.

## Security requirements
- CSRF + allowed `Origin` required (increment 0).
- Passwords and `password_digest` are never logged or returned. The
  `filter_parameters` entry `:passw` covers both.
- No authenticated session is created and no `bussco_auth` cookie is set.

## Acceptance criteria
Request tests run with forgery protection enabled (see increment 0).

- `"  Ada Obi  "` / `" Ada@Example.COM "` are stored as `"Ada Obi"` / `"ada@example.com"`.
- Missing, blank or invalid `full_name`, `email`, `password` → 422 with field
  errors: name over 120 characters, email over 254 characters, bad email format.
- Password of 11 characters → 422. Password of 12 characters → 201.
- Multibyte byte limit: 24 × `"€"` (72 bytes, 24 characters) → 201. Adding one
  more ASCII character (73 bytes) → 422 without truncation.
  Leading/trailing spaces are kept: the user can authenticate with them and not without.
- Sending `role`, `sap_id`, `account_status: "disabled"`,
  `membership_status`, `email_verified_at`, `admin` → 201, and the persisted
  state still equals the initial account state table.
- A new user has exactly the initial account state.
- DB constraints, tested with `insert`/`update_columns` (validations skipped):
  - These are rejected: null columns, non-lowercase email, duplicate email,
    duplicate `sap_id`, blank `sap_id`, unknown statuses, an empty or
    untrimmed name.
  - Two NULL `sap_id`s are allowed.
- Concurrent duplicate: insert the conflicting row after validation and before
  the insert (e.g. a temporary `after_validation` hook in the test). The
  request gets the same 422 email error, not a 500, and exactly one row exists
  with its original digest.
- Duplicate email in different case → 422, and the existing user's `password_digest` is unchanged.
- Missing/invalid CSRF token or disallowed `Origin` → 403, no user created.
- 11th request from one IP within 15 minutes → 429 with `Retry-After`.
  A different IP is still allowed.
- Response body has no `password`, `password_digest`, or anything outside the field allowlist.
  The captured log output doesn't contain the submitted password.
- No `Set-Cookie: bussco_auth` after registration. `GET /api/v1/auth/me` is
  not built yet; when it is (increment 3), it must return 401 right after
  registration.

## Dependencies
- Increment 0: CSRF, allowed-origin checks, cookie middleware.
