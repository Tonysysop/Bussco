# Api::V1::Admin::Auth — admin authentication

Responsibility: admin login/logout/current-admin against the shared `users`
identity store, on the `bussco_admin` cookie and admin session rows. Roles: Super Admin (only the single
`system` account, never a member), President, Treasurer (member accounts). Admin controllers inherit
`Api::V1::Admin::BaseController`: deny by default, a restricted session while `must_change_password`
(only `/me`, logout and the password change skip it, by name), `require_admin_role` for privileged actions.

Constraints:
- No admin signup here. The Super Admin is provisioned by operators only (`lib/tasks/admin.rake`).
  President/Treasurer change only through `User#change_admin_role!` / `assign_admin_office!` (audited),
  from the operator tasks or the Super Admin endpoints in `../administrators_controller.rb` (A1.4).
- Non-admin credentials get the same 401 as bad credentials.
- Do not add financial approval permissions — they are undefined.
- Reuse the CSRF/origin checks (increment 0) and session machinery (increment 3); don't fork them.
- Never log passwords, tokens or cookies. Use `rate_limit`.

Spec: `docs/auth/admin-access.md` (depends on `browser-foundations.md` and `sessions.md`).

This file covers only this directory. When you touch models, mailers, jobs or
migrations for admin access, the same spec applies there.
