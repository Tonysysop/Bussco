# Screen specs (Draft A)

Open the `.dc.html` files in `design-source/` as visual and behavioural references.

## Login (`design-source/login/Login.dc.html`)
Single column, left of centre, emblem cropped off the right as a watermark. Same markup across desktop 1440, tablet 768, mobile 390 and 320. The fixed h1 size is desktop-only; keep it fluid below. Five states: default, focus, error, loading, success. The prototype never authenticates: wire to real auth.

## Sidebar (`dashboard/Sidebar.dc.html`)
Nav: Overview, Members, Reports, Roles & Permissions, Audit Log. No Savings or Loans entries (their totals live as cards on Overview). Collapsible 248px to 76px, persisted in localStorage `bussco.sidebarCollapsed`; below 860px it becomes a static full-width block. The user card sits at the bottom and is a button opening a menu: Change password (modal: current, new, confirm; required, 8+ characters, differs from current, confirm matches) and Log out. Esc and backdrop click close it. In collapsed mode the avatar opens the menu to the right.

## Overview (`Overview.dc.html`)
KPI cards (members, total savings, loans outstanding, pending approvals), savings bar chart with 6M/12M toggle, loan portfolio bar (performing, watchlist, overdue), pending approvals table, officers list, activity feed.

## Members (`Members.dc.html`)
Directory with status tabs (All, Active, Pending, Suspended), search, role filter.

## Roles & Permissions (`Roles.dc.html`)
Officer cards, 15-permission matrix with switches, Save/Discard, officer reassignment dialog. See `permissions.md`.

## Audit Log (`AuditLog.dc.html`)
Filters: period, role, category. Day-grouped events; rows expand to show before/after detail. Read-only.
