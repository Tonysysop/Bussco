# Increment 5 — Admin login and controlled admin provisioning

Status: **planned**

## Scope
- Admin role assignments for known roles: **Treasurer**, **President**.
- Separate admin login endpoint (and frontend screen), same `users` identity store and `sessions` table.
- Controlled provisioning: a console/rake task run by an operator — no API.

## Exclusions
- Public admin signup; client-selected roles.
- Financial approval permissions (who approves loans/postings) — unresolved; do not invent.
- Admin management UI.

## Proposed endpoint contract

`POST /api/v1/admin/auth/session` `{ "email": "…", "password": "…" }`
→ `201` `{ "user": { …, "admin_roles": ["treasurer"] }, "csrf_token": "…" }` + session cookie
→ `401` identical message for bad credentials **and** non-admin users.

`DELETE /api/v1/admin/auth/session` → `200` `{ "csrf_token": "…" }`.

`GET /api/v1/admin/auth/me` → `200` · `401` · `403` if session user has no admin role.

Provisioning: `bin/rails admin:grant EMAIL=… ROLE=treasurer` and `admin:revoke`.

## Business rules
- Admin role is a separate dimension: an admin may or may not be a member.
- Roles stored in an `admin_roles` table (`user_id`, `role`) with unique
  `(user_id, role)` and a check constraint limiting `role` to known values.
- Admin sessions marked (`sessions.admin: true`) so member login cookies can't
  reach admin endpoints without admin login.
- Email must be verified to hold an admin role.

## Security requirements
- Role never accepted from request params.
- Grant/revoke wrapped in a transaction and audited (who, when, which role).
- Admin sessions: 15-minute idle timeout, 8-hour absolute lifetime (increment 0).
  Disabling the account or revoking the last admin role deletes the user's admin sessions.
- Admin login and logout call `rotate_browser_session`, and need an allowed `Origin`
  and a valid CSRF token, the same as member auth.
- `rate_limit` on admin login.

## Acceptance criteria
- Admin with role logs in; non-admin with correct password → 401.
- Member session cannot access `/admin/auth/me` (403/401).
- Rake task grants/revokes; invalid role rejected by model and DB.
- No route allows creating admins.
- With forgery protection enabled: admin login without a valid token, or from a disallowed `Origin` → 403.
- An admin session past its 15-minute idle or 8-hour absolute limit → 401.

## Dependencies
- 0 (CSRF/origin, session rules), 2 (verified email), 3 (sessions table and concern).
