# BUSSCO Admin Portal: Draft A export for Claude Code

Contents: `design-source/` (login + dashboard references), `assets/` (logos, emblem), `tokens.css`/`tokens.json`, `docs/` (screens, permissions, data models), `src/design/` (permissions.ts, types.ts), `CLAUDE.md`.

## How to use
1. Unzip into your project root (or a `design/` folder) and keep `CLAUDE.md` at the repo root.
2. Open design-source `.dc.html` files in a browser to view them.
3. Paste this into Claude Code:

> Read CLAUDE.md and docs/*.md. Using design-source/ as the visual reference, implement the BUSSCO Super Admin dashboard (Sidebar with account menu, Overview, Members, Roles & Permissions, Audit Log) and the admin login in our existing stack. Use tokens.css and assets/. Start with the layout shell and sidebar, then one screen at a time, confirming with me after each. Use real auth and APIs where they exist; otherwise isolate mock data behind a service layer.
