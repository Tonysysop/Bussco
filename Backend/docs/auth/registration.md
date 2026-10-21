# Increment 1 — Registration and database constraints

Status: **implemented**. See "Implementation notes" at the end for where the
build differs from or adds to this spec.

## Scope
- `users` table with constraints, and a `User` model using `has_secure_password`.
- `POST /api/v1/auth/registrations`, with rate limiting.

## Exclusions
- Verifying email (increment 2). Since increment 2, a successful registration also sends the
  first verification code; see [email-verification.md](email-verification.md).
- Creating an authenticated session. Registration never logs the user in. It stores
  `registered_user_id` in the Rails session as onboarding state, so that verifying the email in
  this browser can sign it in ([sessions.md](sessions.md#automatic-login-after-email-verification)).
- Membership review, SAP ID linking, admin provisioning.

## Initial account state

| Field | Value on registration |
|-------|-----------------------|
| `email_verified_at` | `null` |
| `account_status` | `"active"` |
| `membership_status` | `"not_started"` (submitting a membership application later sets `"awaiting_approval"`; see [membership/application.md](../membership/application.md)) |
| `sap_id` | `null` |
| Admin permissions | none (the `admin_roles` table doesn't exist until increment 5) |

`active` means the account is enabled. It does **not** mean membership is
approved. No request to this endpoint can set any of these values.

## Proposed endpoint contract

`POST /api/v1/auth/registrations` — needs a same-origin `Origin` and `X-CSRF-Token` (increment 0).

```json
{ "user": { "full_name": "Ada Obi", "email": "Ada@Example.com ", "password": "…" } }
```

| Case | Response |
|------|----------|
| Created | `201` `{ "user": { "id", "full_name", "email", "email_verified": false, "account_status": "active", "membership_status": "not_started" } }` |
| Validation failure or duplicate email | `422` `{ "errors": { "<field>": ["…"] } }` |
| Empty body, unparseable JSON, or `user` missing / not an object (array, string, number or `null` root) | `400` `{ "error": "bad_request" }` (`Api::V1::BaseController`) |
| Body isn't valid UTF-8 | `400` from Rails itself: `{ "status": 400, "error": "Bad Request" }` with `Accept: application/json`, otherwise an empty HTML 400 |
| `full_name`/`email`/`password` not a string, or containing a NUL character | `422`, treated as missing |
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
- `full_name`: `normalizes` by trimming leading/trailing Unicode whitespace (`[[:space:]]`,
  e.g. EM SPACE; Ruby's `strip` is ASCII-only but the DB check's `\s` is not). Must be
  1–120 characters after trimming. Zero-width characters such as U+200B aren't
  whitespace to Ruby or PostgreSQL and are kept.
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
| `membership_status` | string | NOT NULL | `'not_started'` | `IN ('not_started', 'awaiting_approval')` (widened by the membership application migration) |
| `sap_id` | string | NULL | `null` | unique index (PostgreSQL allows many NULLs); `sap_id IS NULL OR sap_id !~ '^\s*$'` |
| timestamps | | NOT NULL | | |

The model has matching validations, plus string-backed enums for
`account_status` and `membership_status`.

## Duplicate registration
- A duplicate normalized email gets `422` `{ "errors": { "email": ["has already been taken"] } }`.
  This **intentionally reveals whether an email is registered**. We accept that
  in exchange for a clear signup error, and rate limiting limits the damage.
- **Email enumeration.** Anyone can learn whether an address has an account by
  trying to register it. That is the price of a clear error. Limits: 10 attempts
  per IP per 15 minutes, no account details are revealed (only "taken"), and
  nothing about the existing account changes. Revisit if registration ever
  needs to hide account existence (e.g. respond identically and email the owner,
  once increment 2 sends mail).
- Concurrent duplicates: both requests can pass the uniqueness validation, but
  the unique index lets only one insert succeed. The controller rescues
  `ActiveRecord::RecordNotUnique`, reads the violated constraint's name from the
  structured PostgreSQL error field (`PG_DIAG_CONSTRAINT_NAME`, not the message
  text), and only for `index_users_on_email` adds the same `email` error and
  returns the same `422`. Any other `RecordNotUnique` is re-raised.
- Registration only ever does `User.create`. No upsert or
  `find_or_create_by`, so an existing account or password is never changed.

## Rate limiting
- Rule: `rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { render 429 }`, on `create` only.
- Key: client IP — Rails' default `by:` is `-> { request.remote_ip }`, so it isn't repeated. `remote_ip` is only correct if the proxy's address is trusted.
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
- **What "unavailable" covers (Solid Cache 1.0).** Only transient database errors
  fail open: connection lost/not established, adapter or statement timeout,
  deadlock, lock wait timeout, cancelled query. Any other database error (e.g. a
  missing `solid_cache_entries` table) is raised and the request gets a 500,
  so a broken deployment fails loudly instead of silently disabling the limit.
- **Logging.** Solid Cache's default handler logs through
  `ActiveSupport::Cache::Store.logger`, which is `nil` in this app, so a failure
  would leave no trace. The registration store is built with an explicit
  `error_handler` that logs `Rate limit store <method> failed (<ExceptionClass>);
  request allowed` at ERROR via `Rails.logger` (exception class only; DB error
  messages can include hosts). Failures are also sent to `Rails.error`.
- **Security implications of fail-open.** While the database is degraded,
  registration is unlimited: an attacker can create accounts in bulk and probe
  for registered emails (enumeration) at full speed. Accounts created this way
  are unverified, non-member and can't log in, and the same database outage
  usually breaks registration too, since users live in the same database.
  Watch for the ERROR line above; repeated occurrences mean the limit is off.

## Security requirements
- CSRF + allowed `Origin` required (increment 0).
- Passwords and `password_digest` are never logged or returned. The
  `filter_parameters` entry `:passw` covers both.
- No authenticated session is created and no `bussco_auth` cookie is set; `registered_user_id`
  alone authenticates nothing.

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
- Increment 0: CSRF, same-origin checks, cookie middleware.
- Gems: `bcrypt` (`has_secure_password`) and `solid_cache` (rate-limit store).

## Implementation notes
- **Files:** `db/migrate/*_create_users.rb`, `*_create_solid_cache_entries.rb`,
  `app/models/user.rb`, `app/controllers/api/v1/auth/registrations_controller.rb`,
  route `namespace :auth { resources :registrations, only: :create }`.
- **`has_secure_password reset_token: false`.** Rails 8.1 otherwise generates a
  `password_reset_token`; resets belong to increment 4.
- **Non-string and NUL values.** `params.expect` permits any scalar. A number
  or boolean would crash normalization, and a NUL character (`\u0000`, legal in
  JSON) makes bcrypt raise on password assignment and PostgreSQL reject text.
  The controller turns non-strings and strings containing NUL into `nil`, so
  they fail validation with a `422`.
- **Malformed bodies.** `BaseController` rescues `ParseError` (unparseable
  JSON) and `ParameterMissing` (empty body, wrong root, missing `user`) as
  `400 { "error": "bad_request" }`, regardless of `Accept`, with no exception
  details. No change to the CSRF/Origin checks.
- **Invalid UTF-8** is rejected by Rails while it builds the request log entry
  (`ActionController::Instrumentation`), before `rescue_from` applies, so Rails'
  exception handling answers and picks the format from `Accept`. Production
  verified: `Accept: application/json` → JSON 400 without details; no `Accept`
  or `*/*` → empty HTML 400. **Client contract:** the frontend sends
  `Accept: application/json` on every API request. Not worth a global
  `exceptions_app` for this one case.
- **Solid Cache install.** Ran the official `bin/rails solid_cache:install`, then
  adapted it to the primary database as its README allows: removed `database:`
  from `config/cache.yml` (no `database`/`connects_to` means the primary
  connection) and moved the generated `db/cache_schema.rb` table into a normal
  migration. The installer also set production `config.cache_store =
  :solid_cache_store`; kept (nothing else uses `Rails.cache` yet).
- **Test store deviates from the table above:** test uses `:solid_cache_store`
  (not MemoryStore) so rate limiting is exercised through PostgreSQL. Isolation:
  transactional tests roll counters back; the non-transactional tests delete
  `solid_cache_entries` in `teardown`. Development keeps MemoryStore.
  Selected per environment with `config.x.rate_limit_store`.
- **Tests:** `test/models/user_test.rb` (validations, normalization, passwords),
  `test/models/user_constraints_test.rb` (constraints via raw SQL),
  `test/controllers/api/v1/auth/registrations_controller_test.rb` (endpoint,
  CSRF, malformed input, rate limit, fail-open, logs),
  `test/integration/registration_race_test.rb`,
  `test/integration/rate_limit_store_test.rb` (primary connection, shared
  counters across store instances and a separate OS process).
- **Race tests are labelled.** *Simulated* (deterministic): another connection
  commits the same email between validation and insert, exercising the
  controller's handling every run. *Genuine* (non-deterministic interleaving):
  four threads on independent connections create the same email; asserts
  exactly one row and that every loser failed cleanly, whatever the order.
- **Increment 2 moved** `RATE_LIMIT_STORE`, `rate_limited` and the NUL/non-string sanitiser
  (`string_param`) up to `Api::V1::BaseController` so email verification shares them. No
  behaviour change; `capture_log` moved to `test/test_helper.rb`.
