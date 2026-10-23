# Increment 6 (A1.1) — Admin authentication and controlled role provisioning

Status: **implemented** (backend only). There is no admin frontend screen, no role-management API,
and no approval permissions yet.

## Scope
- Three admin roles: **Super Admin**, **President**, **Treasurer** (`users.admin_role`).
- Admin login, current admin and logout on their own cookie (`bussco_admin`), using the shared
  `users` identity store and `sessions` table.
- Operator-run provisioning (rake): a one-time Super Admin bootstrap, interim President/Treasurer
  grant and revoke, and an emergency Super Admin replacement. Every change is audited.
- An authorization foundation for later admin endpoints: deny by default, plus `require_admin_role`.

## Exclusions
- Public admin signup, and any role chosen by the client.
- The Super Admin management portal and its API (assign, revoke or switch roles; list admins and
  audit history). This is the next admin increment. Routine President/Treasurer changes move there
  from the interim rake tasks.
- Membership approval and financial approval permissions (A2). No role, Super Admin included, has
  any approval authority or can bypass cooperative financial policy.
- Admin MFA: a production blocker in `PRE-PRODUCTION.md`, not built here.
- An admin frontend.

## Design decisions
- **Identity: an `admin_role` column on `users`, not an `AdminUser` model or an `admin_roles`
  table.** A separate model would duplicate password, verification, reset, disabling and session
  handling, and `design.md` keeps one identity store. Each user has at most one role. Adding a role
  means one enum value plus one constraint value. No RBAC framework.
- **Sessions: same table, separate cookie, flagged rows.** `sessions.admin` marks admin rows.
  `Session.resume/revoke/start` take `admin:` and match `token_digest` and `admin` together.
  `Api::V1::BaseController` keeps a single set of helpers, which use two hooks (`auth_cookie`,
  `admin_session?`); `Api::V1::Admin::BaseController` overrides both. The member code path is
  unchanged.

| Question | Answer |
|---|---|
| Does admin login end a member session in the same browser? | No. They use separate cookies and rows. Admin login does rotate the shared Rails CSRF session (`rotate_browser_session`), so an open member tab gets one `403` and then fetches a new token (R3). |
| Does member login end an admin session? | No, for the same reason. Each login revokes only the previous session *of its own kind* in that browser. |
| How is admin state isolated? | By a distinct cookie name, the `sessions.admin` flag and a lookup scoped by kind. Admin endpoints never read `bussco_auth`, and member endpoints never read `bussco_admin`. A token presented in the other cookie resolves to nothing and is left untouched. |
| Are different cookie scopes needed? | No. Both cookies are host-only, `SameSite=Strict` and HttpOnly. A `path=/api/v1/admin` scope would add nothing (scripts can't read either cookie) and would complicate deletion. |
| How do privilege changes take effect? | See "Revocation". In short: in the same transaction, plus a re-check on every request. |

## Endpoint contract
All unsafe requests need an allowed `Origin` and `X-CSRF-Token` (increment 0); otherwise the
response is `403 { "error": "invalid_csrf_token" }` and no row is written. Malformed JSON gets
`400 { "error": "bad_request" }`.

`POST /api/v1/admin/auth/session` with body `{ "email": "…", "password": "…" }`
- `201` → `{ "user": { id, full_name, email, admin_role }, "csrf_token": "…" }`, plus
  `Set-Cookie: bussco_admin=…; HttpOnly; SameSite=Strict[; Secure]` and a rotated `_bussco_session`.
- `401 { "error": "invalid_credentials" }`: one answer for an unknown email, a wrong password, a
  disabled account, an account with no admin role, or a blank or non-string password.
  (An unverified admin can't exist; see the constraints below.)
- `429 { "error": "rate_limited" }` + `Retry-After: 900`: 20 per IP, or 10 per submitted email,
  per 15 minutes. These counters are separate from member login.

`GET /api/v1/admin/auth/me`
- `200 { "user": { id, full_name, email, admin_role } }`.
- `401 { "error": "unauthenticated" }` when there is no admin session, after logout, after
  expiry, after a role or status change, or when only a member session exists. (The earlier draft's
  `403` case can't occur: a member never holds an admin session.)

`DELETE /api/v1/admin/auth/session`
- `200 { "csrf_token": "…" }`, whether signed in or not. It deletes the row, clears
  `bussco_admin` and rotates the Rails session.

Responses never contain `password_digest`, tokens, codes or any internal column.

## Business rules
- `admin_role ∈ { super_admin, president, treasurer }` or NULL. This is enforced by a model enum and
  the DB check `users_admin_role_allowed`.
- An admin has a verified email (DB check `users_admin_email_verified`, plus a validation) and an
  active account when the role is granted.
- **Only `User#change_admin_role!` changes a persisted role.** A validation rejects every other
  update of `admin_role`: enum shortcuts (`user.treasurer!`), `update(admin_role:)` and `save`. So
  no supported model operation can skip the audit. Creating a user with a role (test fixtures only)
  is not audited; no application path does it, since registration never permits `admin_role`.
- Roles are never read from request params or headers. They are re-read from the database on every
  admin request.
- Admin sessions have a **15-minute idle timeout and an 8-hour absolute lifetime**
  (`Session::ADMIN_IDLE_TIMEOUT`, `ADMIN_ABSOLUTE_LIFETIME`). Member sessions keep 30 minutes and
  12 hours.

### Authorization foundation
- `Api::V1::Admin::BaseController` runs `before_action :require_authentication` (deny by default)
  and provides `current_admin`. A controller must skip the check by name to allow anonymous access;
  only login and logout do.
- `require_admin_role(*roles)` returns `403 { "error": "forbidden" }` unless the stored role is
  listed. Signing in authorizes nothing privileged by itself.
- **Rules for the future portal (not built):**
  - Every role-management endpoint uses `before_action -> { require_admin_role(:super_admin) }`.
  - An actor may never change their own role.
  - President and Treasurer get no role-management access.
  - Its tests must cover: President and Treasurer get `403`; a member and anonymous get `401`;
    self-change is refused; the last-Super-Admin guard surfaces as `422`; audit rows record the
    acting Super Admin.

### Super Admin safety
- **The last active Super Admin is always kept.** A `before_update` guard aborts any change that
  would leave no other active Super Admin. That covers a revoke, a role switch and disabling the
  account. Deletion is blocked by the audit table's foreign key (no cascade).
- **Lock order, everywhere:** transaction → Postgres advisory lock (`User::SUPER_ADMIN_LOCK`) →
  user row locks (in id order when there are two) → update and audit row. `change_admin_role!`,
  bootstrap and replace all take the advisory lock first. Disabling takes it in the guard, before
  the UPDATE locks the row. Admin login takes only the row lock. This removed a deadlock between a
  direct role change and an emergency replacement, which has a regression test.
- Concurrent changes therefore can't each count the other as "the remaining Super Admin".

### Revocation (all in the same transaction as the change, plus a per-request re-check)
| Change | Effect |
|---|---|
| Role granted, switched or revoked (`change_admin_role!`) | The user's admin sessions are deleted; member sessions are kept |
| Account disabled | All of the user's sessions are deleted (existing rule) |
| Password reset | All of the user's sessions are deleted, admin ones included |
| Changes that skip callbacks (`update_columns`, SQL) | `Session.resume(admin: true)` re-checks `active?`, `admin_role?` and `email_verified_at?` on every request, so the next request gets `401` and the row is deleted |

**Revoke vs. concurrent login:** admin login authenticates, then re-reads the user under its row
lock (`with_password_unchanged`) and creates the session only if the user is still active and still
an admin. `change_admin_role!` takes the same row lock. If the revoke commits first, the login
returns 401. If the login commits first, the revoke deletes the new row. A threaded test covers
this.

**Expiry under concurrency:** `touch_last_seen` is one conditional UPDATE inside the row's own idle
window, so it can't revive a row that has gone idle (16 minutes is live for a member but expired
for an admin). `created_at` is never written, so the 8-hour limit can't be extended. A threaded test
covers parallel touches and resumes.

## Audit: `admin_role_changes`
Columns:
- `user_id`: FK without cascade;
- `previous_role` and `new_role`: nullable, both checked against the known roles, and they must
  differ;
- `action`: `bootstrap`, `grant`, `revoke` or `emergency_replace`;
- `changed_by`: the operator name, not blank;
- `created_at`.

Each row is written in the same transaction as the role update, so both commit or neither does.

**Append-only through the application:** `AdminRoleChange#readonly?` is true once a row is saved,
so `update` and `destroy` raise, and no code edits or deletes audit rows. **This is not tamper-proof.**
Privileged database access (SQL, `delete_all`, `update_columns`, a Rails console) can still change
or remove rows, and can change `users.admin_role` without an audit row. Tamper resistance would need
restricted DB grants or off-box log shipping (PRE-PRODUCTION). No audit framework or triggers were
added.

## Provisioning runbook (operators only)
No password ever passes through a task. Every admin first **registers through the normal public
signup and verifies their email**, choosing their own password. The tasks only attach a role to an
existing account. `OPERATOR` is required and is recorded as `changed_by`. An email address is not a
credential, so having it in shell history is acceptable. The confirmation is retyped on stdin, so it
never enters history.

| Task | When | Guards |
|---|---|---|
| `bin/rails admin:bootstrap EMAIL=… OPERATOR=…` | **Once**: the first Super Admin | Retype the email to confirm. Refused if *anyone has ever been provisioned* as a Super Admin: any `super_admin` user in any status, or any audit row with `new_role = super_admin`, checked under the advisory lock. After that, recovery uses the emergency task. |
| `bin/rails admin:grant EMAIL=… ROLE=president\|treasurer OPERATOR=…` | Interim, until the portal | Refuses `super_admin` and refuses to touch a Super Admin. Idempotent: an unchanged role is a no-op with no audit row. |
| `bin/rails admin:revoke EMAIL=… OPERATOR=…` | Interim, until the portal | Refuses Super Admins. Idempotent. |
| `bin/rails admin:replace_super_admin FROM=… TO=… OPERATOR=…` | **Emergency only**: a Super Admin who is lost, compromised, disabled or unreachable | Retype TO's email to confirm. FROM must currently be a Super Admin in any status; TO must be active, verified and hold no role. In one transaction TO is granted, then FROM is revoked, giving two `emergency_replace` rows. FROM's admin sessions end at once. This works even when FROM is disabled and no active Super Admin remains. |

To end a compromised admin's access immediately, revoke the role (or use the replacement task for
a Super Admin). A password reset also ends every session.

### Implications of using public registration as the identity route
- Registration proves control of an **email address**, not identity or office. The operator must
  confirm the person, and that they created this account, out of band before running `admin:grant`
  or `admin:bootstrap`.
- A squatter could register a future officer's address first. The out-of-band confirmation above is
  the control; never grant a role to an account the officer doesn't recognise.
- An admin account is also an ordinary member/applicant account with the same password, and it can
  sign in to the member app. The two sessions stay isolated.
- Anyone who controls the admin's mailbox can reset the password. This is why **admin MFA is a
  production requirement** (PRE-PRODUCTION).
- Leaving office means `admin:revoke`: the member account remains.
- None of these needs a second identity model, so none was built.

## Tests
- `test/controllers/api/v1/admin/auth/sessions_controller_test.rb`: login for all three roles with
  the exact payload; cookie flags; digest-only storage; identical 401s (wrong password, unknown
  email, disabled, non-admin, malformed); spoofed `admin_role` params and the `X-Admin-Role` header;
  CSRF and Origin; malformed JSON; rotation; logout and replay; isolation in both directions,
  including the membership endpoint; independent member and admin logins; 15-minute and 8-hour
  expiry; revocation by revoke, switch, disable, password reset and callback-skipping changes;
  rate limits; logs.
- `test/controllers/api/v1/admin/base_controller_test.rb` (test-only probe controllers): deny by
  default, and `require_admin_role(:super_admin)` (President and Treasurer get 403, re-read on every
  request).
- `test/models/admin_access_test.rb`: role and DB constraints; audit columns and atomicity;
  read-only audit; enum shortcuts and plain updates rejected; bootstrap once, including after a
  disabled or revoked Super Admin; last-Super-Admin guard (revoke, switch, disable) and successful
  disable while another exists; emergency replacement (active, disabled, invalid target);
  per-kind expiry.
- `test/integration/admin_race_test.rb` (threads, committed rows): a revoke racing logins; two
  concurrent Super Admin revokes, and a revoke plus a disable; a direct role change racing an
  emergency replacement (deadlock regression); concurrent bootstraps; idle and absolute expiry
  under parallel touches and resumes.
- `test/tasks/admin_tasks_test.rb`: every task, its confirmation and its refusals.
- Registration ignores `admin_role` (`registrations_controller_test.rb`).

## Dependencies
- 0 (CSRF, Origin, rotation), 2 (verified email), 3 (sessions table and helpers), 5 (password reset
  revokes all sessions).
