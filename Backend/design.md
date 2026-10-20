# BUSSCO backend design

BUSSCO = BUA Senior Staff Multipurpose Cooperative Society, an independent
cooperative formed by BUA staff. This Rails API serves the BUSSCO React app.

## Status

| Area | Status |
|------|--------|
| Scaffold, `GET /up`, `GET /api/v1/health/ready` | Implemented |
| Browser foundations (auth increment 0): session cookie, CSRF, Origin checks, `GET /api/v1/csrf` | Implemented — request-integrity controls only, not authentication |
| Registration (auth increment 1): `users` table, `POST /api/v1/auth/registrations` | Implemented — creates an unverified, non-member account; no login |
| Authentication (increments 2–5) | Planned — see [docs/auth/README.md](docs/auth/README.md) |
| Membership review, savings, loans | Planned — rules below, no design yet |

## Architecture

- Rails 8.1 API-only, PostgreSQL, Puma, Minitest.
- Plain Rails: controllers + Active Record models. Add `app/services/<area>`
  only when a feature has real multi-step logic (e.g. `app/services/auth`).
- Routes are versioned under `/api/v1`. Browser-facing API controllers inherit
  `Api::V1::BaseController` (session cookie, CSRF, Origin checks). A future
  non-browser integration gets its own base controller and authentication.
- Mail goes through Action Mailer; background work through Active Job
  (async adapter for now; choose a production backend when a feature needs one).
- No Redis, Sidekiq, serializers, or authorization frameworks until required.

## Origin and proxying

React and Rails share one public origin; the reverse proxy forwards `/api/*`
to Rails. This keeps auth cookies first-party and avoids CORS.

Local development mirrors this with the Vite dev server proxy (frontend
`vite.config.ts`, added when the frontend first calls the API):

```ts
server: { proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } } }
```

Use this object form. Vite's string shorthand turns on `changeOrigin`, which
rewrites `Host` and makes Rails reject every unsafe request (see
[docs/auth/browser-foundations.md](docs/auth/browser-foundations.md) §4).
Production must serve HTTPS through a proxy that preserves `Host`; same section.

No CORS middleware is configured, by design.

## Identity model (`users` table implemented; dimensions beyond the initial state planned)

One identity store (`users`) for members, applicants and admins. These are
**independent dimensions**, never collapsed into a single "role" column:

| Dimension | Meaning | Set by |
|-----------|---------|--------|
| Email verification | Owns the email address (not proof of employment) | User, via verification code |
| Account status | Active / disabled | Admin process |
| Membership | Applicant → approved member; links unique SAP ID | Authorised membership review |
| Admin role | Treasurer, President | Controlled provisioning only |

- Public registration: full name, email, password. No role, no SAP ID, no
  membership approval.
- Members sign in with email **or** linked SAP ID + password. Applicants can
  sign in to complete/track their application.
- Dashboard, savings and loans require approved membership.
- Admins log in on a separate screen/endpoint against the same identity store.
- Financial approval permissions are **not defined** yet; do not invent them.

## Future financial rules — documented only, not implemented

- Savings contributions and loan repayments are deducted via BUA payroll.
- BUSSCO reviews and posts confirmed payroll records. Uploading records alone
  must not change any balance; only posting does.
- Maximum requested loan principal = 2 × posted savings balance.
- Interest is flat over the whole tenure and deducted upfront:
  - 12 months: 8% of principal.
  - 18 months: 10% of principal.
- Members repay the full principal in equal instalments; the final instalment
  absorbs rounding.
- Money is stored exactly: integer minor units (kobo) in `bigint` columns, or
  `decimal` with fixed scale. Never floats.

Unresolved — do not implement until decided:
- How existing loans count against the 2× limit (exposure rules).
- Who approves loans and payroll postings (approval responsibilities).
