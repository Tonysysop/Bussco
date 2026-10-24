# Increments 6 (A1.1), A1.3 and A1.4 — Admin authentication, the system Super Admin, provisioning, role management

Status: **implemented** (backend, the admin login and password screens in A1.2, and the Super Admin
management portal in A1.4). No approval permissions.

## Scope
- Three admin roles in `users.admin_role`: **Super Admin**, **President**, **Treasurer**.
- **The Super Admin is the single system identity** (`users.account_type = 'system'`): a system administrator,
  not a cooperative member. It is created only by an operator task, with a generated temporary password that
  must be changed at first sign-in. President and Treasurer are ordinary **member** accounts holding a role.
- Admin login, current admin, logout and password change on their own cookie (`bussco_admin`), using the
  shared `users` identity store and `sessions` table.
- An authorization foundation for later admin endpoints: deny by default, a restricted first-login session,
  and `require_admin_role`.
- **A1.4:** the Super Admin assigns, switches and revokes President and Treasurer in the portal (see
  "Super Admin role management"). **One holder per office.**

## Exclusions
- Public admin signup, and any role or account type chosen by the client.
- Creating, promoting or duplicating a Super Admin through the portal or API (never; operator tasks only).
- Dynamic roles or a permission matrix; the design's matrix is not built.
- Membership and financial approval permissions (A2). No role, Super Admin included, has approval authority
  or can bypass cooperative financial policy.
- Admin MFA: a production blocker in `PRE-PRODUCTION.md` (B7).

## Identity model
| | Super Admin | President / Treasurer |
|---|---|---|
| `account_type` | `system` (exactly one may exist) | `member` |
| How created | `admin:provision_super_admin` (operator) | public registration + email verification |
| First password | generated temporary password, must be changed | chosen by the person |
| Member login, application, membership, savings, loans | **never** | yes (unchanged) |
| Public password reset | **never** (operator recovery only) | yes |
| Admin login | yes | yes |

Why the `users` table and not an `AdminUser` model: one place for password hashing, verification, sessions,
disabling and the audit FK. An `account_type` column plus database constraints keep the system identity out
of member workflows without a second identity store.

### Database constraints (`users`)
- `users_account_type_allowed`: `member` or `system`. `account_type` is read-only after creation (`attr_readonly`).
- `users_super_admin_is_system`: `(admin_role IS NOT DISTINCT FROM 'super_admin') = (account_type = 'system')`.
  A member can never hold `super_admin` (no promotion, no self-promotion), and the system account can't lose
  it or hold another role.
- `users_one_system_identity`: unique partial index on `account_type WHERE account_type = 'system'`. At most
  one system identity, **active or disabled**. Zero means unprovisioned; one means configured.
- `users_system_not_member`: the system account has `membership_status = 'not_started'` and no SAP ID.
- `users_admin_role_allowed`, `users_admin_email_verified` (A1.1): known roles only; an admin has a verified email.
- Not in SQL (would need a trigger): no membership application for the system account. Enforced by
  `MembershipApplication` (create validation) and by the system account never holding a member session.

## Endpoint contract
All unsafe requests need an allowed `Origin` and `X-CSRF-Token` (increment 0); otherwise
`403 { "error": "invalid_csrf_token" }`. Malformed JSON gets `400 { "error": "bad_request" }`.

`POST /api/v1/admin/auth/session` with body `{ "email": "…", "password": "…" }`
- `201` → `{ "user": { id, full_name, email, admin_role, must_change_password }, "csrf_token": "…" }`, plus
  `Set-Cookie: bussco_admin=…; HttpOnly; SameSite=Strict[; Secure]` and a rotated `_bussco_session`.
- `401 { "error": "invalid_credentials" }`: one answer for an unknown email, a wrong password, a disabled
  account, a non-admin, an **expired temporary password**, or a blank or non-string password.
- `429 { "error": "rate_limited" }` + `Retry-After: 900`: 20 per IP, or 10 per submitted email, per 15 minutes.

`GET /api/v1/admin/auth/me` → `200 { "user": { …same five fields } }` · `401 { "error": "unauthenticated" }`.

`DELETE /api/v1/admin/auth/session` → `200 { "csrf_token": "…" }`, signed in or not.

`PATCH /api/v1/admin/auth/password` with body `{ "current_password": "…", "password": "…" }` (any admin)
- `200 { "user": { … must_change_password: false }, "csrf_token": "…" }` with a new `bussco_admin`.
- `422 { "error": "invalid_current_password" }` · `422 { "errors": { "password": […] } }` (12+ characters,
  72 bytes at most, different from the current one) · `401` without an admin session · `429` after 10 per
  15 minutes per user.

Responses never contain `password_digest`, tokens, codes or any internal column.

## First sign-in and the restricted session
- A temporary password (provisioning or recovery) is valid for **72 hours**
  (`User::TEMPORARY_PASSWORD_TTL`, `temporary_password_expires_at`) and sets `must_change_password`.
- Signing in with it creates a normal admin session, but **`Admin::BaseController#require_password_changed`
  answers `403 { "error": "password_change_required" }` on every admin endpoint**, including every future
  controller that inherits it. Only `GET /me`, `DELETE /session` and `PATCH /password` skip it, by name.
- After expiry the temporary password no longer signs in, and an existing session stops working
  (`Session#usable?`). The operator recovers.
- **The password change** (`User#change_password`): under the user's row lock it re-checks the current
  password against the locked row, saves the new one (clearing `must_change_password` and the expiry), deletes
  **every** session of the user, then starts the replacement admin session and rotates the CSRF session, all
  in one transaction. Of parallel changes made with the same old password only the first succeeds; the others
  get `422` (threaded test). The temporary password and every old cookie stop working at once.

## Sessions and isolation
Same as A1.1: `sessions.admin` flags admin rows, `Session.start/resume/revoke` take `admin:`, admin endpoints
read only `bussco_admin`, member endpoints only `bussco_auth`. Admin rows: 15-minute idle, 8-hour absolute.

| Question | Answer |
|---|---|
| Does admin login end a member session in the same browser? | No (separate cookies and rows). Both logins rotate the shared Rails CSRF session, so another open tab gets one `403` and fetches a new token (R3, R12). |
| How is admin state isolated? | Distinct cookie, `sessions.admin`, lookup scoped by kind. A token in the other cookie resolves to nothing. |
| Can the Super Admin act as a member? | No. Member login answers the generic 401 for the system account, and `Session.resume(admin: false)` rejects a member row for it even if one were forged. |

`Session#usable?` re-checks on every request: the account is active; admin rows need an admin role, a
verified email and an unexpired temporary password (if any); member rows need a member account.

## Authorization foundation
- `Api::V1::Admin::BaseController`: `require_authentication` (deny by default), then `require_password_changed`;
  `current_admin`; `require_admin_role(*roles)` → `403 { "error": "forbidden" }` unless the stored role is listed.
- Role management sits only behind `require_admin_role(:super_admin)`; never the actor's own role; President
  and Treasurer get no role management; `super_admin` is never grantable (the database refuses it anyway).

## Super Admin role management (A1.4)
All `require_admin_role(:super_admin)` (so also the password-changed gate, CSRF and Origin):

| Endpoint | Result |
|---|---|
| `GET /api/v1/admin/administrators` | `{ administrators: [{ id, full_name, email, admin_role, account_status }] }`: every account with a role, the Super Admin included |
| `GET /api/v1/admin/administrators/eligible?q=` | `{ accounts: [...] }`: up to 10 active, verified members with no role, name or email containing `q` (2+ characters; wildcards literal) |
| `PATCH /api/v1/admin/administrators/:id` `{ "role": "president" \| "treasurer" \| null }` | `200 { administrator, changed }`. `422 invalid_role` (anything else, `super_admin`, or no `role` key), `404 not_found`, `422 not_allowed` (the actor, the system account), `422 not_eligible` (grant to a disabled or unverified account), `409 conflict` (rejected by a concurrent change; nothing changed) |
| `GET /api/v1/admin/role_changes` | `{ role_changes: [{ id, previous_role, new_role, action, actor, created_at, user: { id, full_name, email } }] }`, newest first, read-only (no write routes) |

- **One holder per office:** validation plus the partial unique index `users_one_holder_per_office`. A role
  goes through `User#assign_admin_office!`: in one transaction it demotes the current holder (audit `revoke`)
  and grants the target (audit `grant`, previous role recorded when switching office). Both accounts' admin
  sessions end; membership, application and status data are untouched. `null` revokes via `change_admin_role!`.
- **Locking:** every role change (portal, rake, model) first takes one transaction-level advisory lock
  (`User.lock_admin_roles`, `pg_advisory_xact_lock`), then the user-row lock, so role changes run one at a
  time in one lock order and the current holder is re-read under it. Admin login takes only the row lock and
  changes no role, so the two can't deadlock. Any failure rolls back roles, audit rows and session deletes
  together.
- **Actor:** portal rows set `changed_by_user_id` to the acting admin (and `changed_by` to their email at the
  time); `role_changes` shows that user's name. Operator and older rows keep their `changed_by` text.

## Super Admin members directory (A1.5)
`GET /api/v1/admin/members?q=&stage=&role=&page=` (`require_admin_role(:super_admin)`), read-only:

- **Lists** every `account_type: member` account (never the system Super Admin), newest registration first
  (`created_at DESC, id DESC`), 25 per page: `{ members: [...], counts, page, per_page, total }`.
- **Member fields:** `id, full_name, email, email_verified, account_status, admin_role, stage, registered_at,
  photo` (a passport photo is attached), `application` (null, or `sap_staff_id, business_unit, department, office_location, started_at, submitted_at`).
  The application's employment fields are self-reported, a draft until `submitted_at`; nothing else from
  the application (contact, personal, next of kin, contribution) and no authentication data.
- **Photo:** `GET /api/v1/admin/members/:id/photo` (same Super Admin check) serves the passport photo for the
  directory avatar, `Cache-Control: private, no-store`; `404` without one, for an unknown id or the system
  account. Originals only (≤ 2 MB, no thumbnails); the directory loads them lazily.
- **`stage`** is derived, never stored: `not_started` (no application), `in_progress` (application, still
  `not_started`), `awaiting_approval`. `account_status: disabled` is separate and is not a suspension;
  there is no approved state until approval exists.
- **Filters:** `q` (1–100 characters, name, email or application `sap_staff_id`, wildcards literal),
  `stage` (`not_started`, `in_progress`, `awaiting_approval`, or `disabled` for accounts), `role`
  (`member` = no role, `president`, `treasurer`), `page` (1+). Anything else: `422 invalid_param`.
- **`counts`** (`all` and per stage, plus `disabled`) follow `q` and `role` but not `stage`; `total` is the
  count for the current stage. A page past the end returns no members with the real `total`.
- A fixed number of queries per page (rows, applications, photo attachments, counts), whatever it holds.

## Revocation (same transaction as the change, plus the per-request re-check)
| Change | Effect |
|---|---|
| President/Treasurer role granted, switched or revoked (`change_admin_role!`) | The user's admin sessions are deleted; member sessions kept |
| Account disabled | All of the user's sessions deleted |
| Password changed (`PATCH /password`) or member password reset | All sessions deleted (a new admin session starts for the change) |
| Super Admin recovery | All sessions deleted, new temporary password |
| Changes that skip callbacks (`update_columns`, SQL) | `Session#usable?` fails on the next request: `401`, row deleted |

**Revoke vs. concurrent login:** admin login re-reads the user under its row lock (`with_password_unchanged`)
and creates the session only if the user is still active, still an admin and the temporary password (if any)
is unexpired. `change_admin_role!` takes the same row lock, after the role-change advisory lock (threaded test).

## Audit: `admin_role_changes`
`user_id` (FK, no cascade), `previous_role`, `new_role`, `action`, `changed_by` (operator, or the acting
admin's email; not blank), `changed_by_user_id` (A1.4 portal changes; FK, no cascade), `note`, `created_at`. Actions: `provision`, `recover`, `grant`, `revoke` (plus `bootstrap` and
`emergency_replace`, kept only so A1.1 rows stay valid). `previous_role ≠ new_role` except for `recover`
(credentials reissued, role unchanged), which also needs a non-blank `note`. Each row is written in the same
transaction as the change.

**Append-only through the application:** `AdminRoleChange#readonly?` once saved; a validation rejects any role
change except `change_admin_role!` (enum shortcuts, plain updates). **Not tamper-proof:** privileged database
access (SQL, `update_columns`, a console) can still change roles or audit rows (`PRE-PRODUCTION.md` R11).

### A1.3 migration (`20261024090000_super_admin_system_identity`)
A1.1 let a member account hold `super_admin`. Before adding the constraints, the migration removes **only that
role** from such accounts, deletes **only their admin sessions**, and writes a `revoke` audit row
(`changed_by: "A1.3 policy migration"`). The member, their member sessions, membership data and every earlier
audit row are kept. The system then counts as unprovisioned. Tested with legacy data and with none.

## Provisioning runbook (operators only; never seeds)
The temporary password is generated by the task (24 alphanumerics, about 143 bits), stored only as a bcrypt
digest, never logged, emailed or typed, and **shown once on the operator's terminal**. Both tasks refuse to run
when stdout isn't a terminal (CI, a file, a pipe). The confirmation is the email retyped on stdin, so it stays
out of shell history. Hand the password over in person or by phone.

| Task | When | Effect |
|---|---|---|
| `bin/rails admin:provision_super_admin EMAIL=… NAME=… OPERATOR=…` | Once, on an unprovisioned system | Creates the system identity (verified email, `must_change_password`, 72 h temporary password); audit `provision`. Refused once a system identity exists in any state, or if the email belongs to any account. |
| `bin/rails admin:recover_super_admin OPERATOR=… REASON=… [NEW_EMAIL=… NEW_NAME=…]` | Emergency: lost password, compromised, disabled | Same identity, never a new one: new temporary password, forced change, re-enabled, **every session ended**; optionally re-pointed to a newly designated person (email verified, change recorded). Audit `recover` with REASON in `note`. |
| `bin/rails admin:grant EMAIL=… ROLE=president\|treasurer OPERATOR=…` / `admin:revoke EMAIL=… OPERATOR=…` | Operator fallback to the portal | Member accounts only; refuse `super_admin`, the system account, and an office someone already holds (revoke them first). Idempotent. |

Before provisioning or re-pointing, confirm the designated person out of band. Admin accounts for President and
Treasurer come from public registration, which proves control of an email address only: confirm the officer
created that account before `admin:grant`, and remember whoever controls their mailbox can reset their
password, which is why **admin MFA is a production requirement**.

## Tests
- `test/models/admin_access_test.rb`: roles and account types (model and SQL); one system identity, active or
  disabled; `super_admin` only on it; the system account can't be a member; provisioning, recovery (same id,
  re-enable, re-point, audit, reason); password change (current password, different, rules, sessions ended,
  temporary password dead); audit read-only and atomic; enum shortcuts rejected; session rules per account.
- `test/db/super_admin_system_identity_migration_test.rb`: legacy member Super Admin, and none.
- `test/controllers/api/v1/admin/auth/passwords_controller_test.rb`: first sign-in to change, rotation, old
  cookie and temporary password dead, 422s, CSRF/Origin, expiry, President/Treasurer, rate limit, logs.
- `test/controllers/api/v1/admin/base_controller_test.rb` (test-only probes): deny by default; the restricted
  session blocks a plain and a `require_admin_role(:super_admin)` probe until the change; role checks.
- `test/controllers/api/v1/admin/auth/sessions_controller_test.rb`: login for all roles, cookie flags,
  identical 401s, spoofed roles, CSRF/Origin, rotation, logout, isolation, expiry, revocation, rate limits, logs.
- `test/integration/super_admin_isolation_test.rb`: no member login, application or reset for the Super Admin;
  registration can't create or claim it; President and Treasurer keep member sign-in and applications.
- `test/integration/admin_race_test.rb` (threads): revoke racing logins; concurrent provisioning → one;
  parallel password changes with the same old password → one winner; expiry under parallel requests.
- `test/tasks/admin_tasks_test.rb`: every task, the terminal and confirmation guards, refusals (an occupied
  office too), the password shown once and never logged.
- A1.5: `test/controllers/api/v1/admin/members_controller_test.rb` (Super Admin only; system account
  excluded; exact fields; stages; search, role filter and counts; pagination past the end; parameter
  validation; constant query count).
- A1.4: `test/controllers/api/v1/admin/administrators_controller_test.rb` and `role_changes_controller_test.rb`
  (Super Admin only; President/Treasurer/member/anonymous refused; CSRF/Origin; temporary password; spoofed
  roles and actors; ineligible, system and self targets; office swap with two audit rows and the holder
  signed out; member data unchanged; read-only history); `admin_access_test.rb` (one holder per office,
  `assign_admin_office!` atomicity and actor); `admin_race_test.rb` (concurrent assignments to a vacant office
  and across both offices).

## Dependencies
- 0 (CSRF, Origin, rotation), 2 (verified email), 3 (sessions), 5 (password reset).
