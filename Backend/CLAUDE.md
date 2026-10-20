# BUSSCO backend

Rails API for BUSSCO (BUA Senior Staff Multipurpose Cooperative Society), an
independent cooperative formed by BUA staff. React frontend lives in
`../Frontend`; `/api` is proxied to this app on the same origin.

Stack: Ruby 3.4.11 (`.ruby-version`), Rails 8.1 API-only, PostgreSQL, Puma,
Minitest, Active Record / Action Mailer / Active Job.

## Commands (run from `Backend/`)

```sh
bin/setup --skip-server            # bundle + db:prepare
bin/rails s                        # http://localhost:3000
bin/rails test
bin/rails zeitwerk:check
bin/rubocop
bin/brakeman --quiet --no-pager
bin/bundler-audit
bin/ci                             # all of the above
```

Local PostgreSQL; DB settings come from env vars; see README "Environment variables".

## Conventions

- Plain Rails. Browser-facing controllers under `app/controllers/api/v1/` inherit
  `Api::V1::BaseController` (CSRF + Origin checks; never `skip_forgery_protection`). Zeitwerk naming (`api/v1/foo_controller.rb` → `Api::V1::FooController`).
- Thin controllers; add `app/services/<area>/` only for real multi-step logic.
- DB constraints (NOT NULL, unique indexes, FKs, checks) alongside validations.
- Transactions for operations that must be atomic.
- Money: integer minor units (kobo) or fixed-scale decimal. Never floats.
- Never log passwords, codes, reset tokens or session cookies; keep
  `config/initializers/filter_parameter_logging.rb` current.
- No new gems (auth, Redis, Sidekiq, RSpec, serializers, authorization) without a current requirement.

## Working rules

- Implement only the requested increment. No placeholder routes, empty
  controllers/models/services "for later".
- Preserve unrelated code and user changes.
- Every behaviour change ships with tests and updates the relevant spec's status.
- Never claim a check passed unless you ran it.
- Don't deploy, push, or reset databases unless asked.

## Specifications — read only what the current task needs

- Architecture, identity model, future financial rules: `design.md`
- Authentication index and increment order: `docs/auth/README.md`
  (then open only the one increment spec you're implementing)

Scoped `CLAUDE.md` files exist in `app/controllers/api/v1/auth/` and
`app/controllers/api/v1/admin/auth/`. They cover only those directories:
when you edit shared models, mailers, jobs or migrations, read the feature
spec for the increment you're implementing as well.
