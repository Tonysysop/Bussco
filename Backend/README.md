# BUSSCO backend

Rails 8.1 API-only app for BUSSCO (BUA Senior Staff Multipurpose Cooperative
Society). Design: [design.md](design.md). Auth plan: [docs/auth/README.md](docs/auth/README.md).

Implemented endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /up` | Liveness: 200 if the app boots |
| `GET /api/v1/health/ready` | Readiness: 200 `{"status":"ok"}`, or 503 `{"status":"unavailable"}` when the DB is unreachable |
| `GET /api/v1/csrf` | CSRF token for the browser app; sets the `_bussco_session` cookie |
| `POST /api/v1/auth/registrations` | Public registration: creates an unverified, non-member account; no login ([spec](docs/auth/registration.md)) |
| `PATCH`/`POST /api/v1/auth/email_verification` | Email verification by six-digit code; signs in the registering browser ([spec](docs/auth/email-verification.md)) |
| `POST`/`DELETE /api/v1/auth/session`, `GET /api/v1/auth/me` | Login, logout, current user ([spec](docs/auth/sessions.md)) |
| `/api/v1/membership/application` (+ `/stages/:stage`, `/passport_photo`, `/submission`) | The signed-in user's five-stage membership application: drafts, photo, submission ([spec](docs/membership/application.md)) |

Unsafe requests (POST/PUT/PATCH/DELETE) need a same-origin `Origin` header and an
`X-CSRF-Token` header; see [docs/auth/browser-foundations.md](docs/auth/browser-foundations.md).
Password recovery and admin access are still planned (see the auth index).

Rate-limit counters: in-process memory in development; Solid Cache on the primary
PostgreSQL database in test and production (`solid_cache_entries`, created by a normal migration).

Dev caveat: in development, Rails' pending-migration check touches the DB on
every request, so with the DB down both endpoints return 500 there. In
production `/up` stays 200 and readiness returns 503.

## Prerequisites

- Ruby 3.4.11 (see `.ruby-version`). With [mise](https://mise.jdx.dev):
  ```sh
  mise settings add idiomatic_version_file_enable_tools ruby   # read .ruby-version
  mise install
  ```
  Add `eval "$(~/.local/bin/mise activate bash)"` to `~/.bashrc` so `ruby`/`bin/rails`
  pick up the version automatically inside `Backend/`.
- Build headers on Ubuntu: `sudo apt install build-essential libyaml-dev libpq-dev libssl-dev libffi-dev zlib1g-dev`
- PostgreSQL running locally (tested with PostgreSQL 18). Create a role for your OS user once:
  `sudo -u postgres createuser -s "$USER"`

## Environment variables

Rails does not load `.env` files (no dotenv gem). Load them into your shell:

```sh
cp .env.example .env
set -a; . ./.env; set +a     # export everything in .env for this shell
```

(or use direnv with `dotenv` in `.envrc`).

| Var | Default if unset |
|-----|------------------|
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` | Unix socket, port 5432, OS user, no password |
| `RAILS_MAX_THREADS` | `5` |
| `DATABASE_URL` | Production only |
| `RESEND_API_KEY` | Production: **required** (boot fails without it). Development: unset writes mail to `tmp/mails/`; set it to send real mail through Resend SMTP. Never set in test |
| `MAIL_FROM` | `BUSSCO <no-reply@localhost>`; production **required**. A sender on your Resend-verified domain, e.g. `BUSSCO <verify@your-domain>` |
| `APP_HOSTS` | Production only, **required** (boot fails without it): comma-separated public hostnames for host authorization |

Production also requires HTTPS at the reverse proxy, with the browser's `Host`
preserved; see [docs/auth/browser-foundations.md](docs/auth/browser-foundations.md) §4.
It also requires a durable Active Job backend such as Solid Queue. Today's `:async` adapter
loses pending verification emails on restart; see
[docs/auth/email-verification.md](docs/auth/email-verification.md) "Background jobs". Before
rollout, review that spec's per-IP limit for staff behind a shared corporate IP ("Rate limits").

With the role above, leave the `DATABASE_*` vars unset. Set them only for a
password-protected role or a TCP connection.

Databases: `bussco_development` and `bussco_test` (separate; the test DB is rebuilt by the test suite).

Mail: development writes each email to `tmp/mails/` (`:file` delivery) unless
`RESEND_API_KEY` is set; test uses `:test` delivery and never needs Resend credentials.

## Setup and run

```sh
bin/setup --skip-server        # bundle install + db:prepare (dev); test DB is prepared too
bin/rails s
curl -i localhost:3000/up
curl -i localhost:3000/api/v1/health/ready
```

## Checks

```sh
bin/rails test
bin/rails zeitwerk:check
bin/rubocop
bin/brakeman --quiet --no-pager
bin/bundler-audit
bin/ci            # runs setup, lint, security, zeitwerk, tests
```

GitHub Actions: `../.github/workflows/backend.yml` (repo root is the parent directory).

## Claude Code project settings

`.claude/settings.json` holds a minimal shared config: it allows the check
commands above without a prompt and blocks reads of `.env` and key files. No
hooks, plugins or permission bypass. Personal overrides go in
`.claude/settings.local.json` (git-ignored).

To verify it's loaded: start `claude` from `Backend/`, run `/permissions`, and
check the allow/deny rules appear with source "Project settings".
