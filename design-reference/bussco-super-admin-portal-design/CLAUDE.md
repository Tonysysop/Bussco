# BUSSCO Admin Portal: implementation guidance

BUSSCO is the BUA Senior Staff Multipurpose Cooperative Society (savings and loans for staff).

- The `.dc.html` files in `design-source/` are design references, not production code. Recreate them in this repo's existing stack and component conventions (React + TypeScript if there is none).
- Match visuals using `tokens.css` / `tokens.json` and `assets/`.
- Never fake authentication. Wire login, logout and change password to the real auth system.
- Replace all sample data with real API calls. Keep the "Sample data" tag only while data is mocked.
- Enforce permissions server-side; the UI only reflects them.
- Do not redesign the existing portal outside these screens.
- Build order: tokens and layout shell with Sidebar, Overview, Members, Roles & Permissions, Audit Log, Login.
- Check accessibility: keyboard focus, role="menu" and dialogs with Esc, 44px touch targets.
