# Api::V1::Admin::Auth — admin authentication

Responsibility: admin login/logout/current-admin against the shared `users`
identity store. Known roles: Treasurer, President.

Constraints:
- No admin signup or role assignment via API. Provisioning is operator-run
  (rake/console) only.
- Non-admin credentials get the same 401 as bad credentials.
- Do not add financial approval permissions — they are undefined.
- Reuse the CSRF/origin checks (increment 0) and session machinery (increment 3); don't fork them.
- Never log passwords, tokens or cookies. Use `rate_limit`.

Spec: `docs/auth/admin-access.md` (depends on `browser-foundations.md` and `sessions.md`).

This file covers only this directory. When you touch models, mailers, jobs or
migrations for admin access, the same spec applies there.
