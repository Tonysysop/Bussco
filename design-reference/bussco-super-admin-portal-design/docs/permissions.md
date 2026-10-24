# Permissions model (from Draft A)

15 permissions in 5 groups (see `src/design/permissions.ts` for keys and labels).

- Super Admin holds all 15 and is the only role that can open Roles & Permissions or reassign officers.
- `roles` is locked for President, Vice President and Treasurer. It cannot be toggled on.
- Defaults: President 10, Vice President 7, Treasurer 9.
- The Roles screen edits a draft matrix. Save commits it, Discard reverts. Show a confirmation of what changed.
- Every grant, revoke and officer reassignment must write an audit event with before/after values.
- Enforce on the server. UI hiding is only a convenience: hide or disable nav items and actions the user lacks.
