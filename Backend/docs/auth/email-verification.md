# Increment 2 — Email verification by six-digit code

Status: **implemented**. See "Implementation notes" at the end.

## Scope
- Send a six-digit code by email after registration and on request, through Resend.
- Verify the code and set `users.email_verified_at`.

## Exclusions
- Login (increment 3). Until then, verification is identified by email + code.
- Password recovery, membership, any employment check. Verification proves email ownership
  only: no session, no `bussco_auth` cookie, no role or membership change.

## Endpoint contract

One controller, `Api::V1::Auth::EmailVerificationsController`
(`resource :email_verification, only: [ :create, :update ]`). Both actions are unsafe
requests: allowed `Origin` + valid `X-CSRF-Token` (increment 0), otherwise `403`.

`POST /api/v1/auth/email_verification` — request another code
```json
{ "email": "ada@example.com" }
```
→ `202 Accepted`, empty body, **always**: unknown email, already verified, inside the
cooldown, or sent. Only a rate limit changes the answer (`429`).

`PATCH /api/v1/auth/email_verification` — verify
```json
{ "email": "ada@example.com", "code": "123456" }
```
→ `200 { "email_verified": true }`
→ `422 { "error": "invalid_code" }` for every failure: unknown email, wrong, expired, used,
  superseded, five attempts used, already verified.

| Other cases | Response |
|---|---|
| Rate limited | `429 { "error": "rate_limited" }` + `Retry-After` (`900` per IP, `3600` per email) |
| Unparseable JSON | `400 { "error": "bad_request" }` (`BaseController`) |
| `email`/`code` not a string, or containing NUL | treated as blank → `202` / `422`, never `500` |

Responses never contain the code, its digest, a session cookie or a CSRF token.

## Business rules
- **Code**: `format("%06d", SecureRandom.random_number(1_000_000))` (CSPRNG, uniform).
- **Storage**: only `HMAC-SHA256(key, "#{user.id}:#{code}")`, key from
  `Rails.application.key_generator` (derived from `secret_key_base`). Compared with
  `ActiveSupport::SecurityUtils.secure_compare`. Without the server key a leaked digest
  can't be brute-forced over the 10⁶ codes.
- **Expiry**: 10 minutes from `email_verification_code_issued_at`, the moment the delivery
  job wrote the code (not when it was requested).
- **Attempts**: 5 per issued code. Any wrong submission counts; after five, even the right
  code fails until a new one is requested. A DB check keeps the counter in 0–5.
- **Single use**: success sets `email_verified_at` and clears the digest.
- **Sending**: registration sends the first code automatically. Another code only once
  60 seconds have passed since the last request; inside the cooldown nothing is sent and the
  answer is still `202`, so the cooldown can't be used to probe accounts. Verified users get nothing.
- **Replacement**: a new request clears the current digest at once and starts a new
  *generation*, so the previous code stops working even before the new email arrives.

## How a code is issued
1. Request (registration or `POST`): `User#request_email_verification` locks the row, checks
   the cooldown, then increments `email_verification_generation`, stamps
   `email_verification_requested_at` and clears digest, issue time and attempts. It returns
   the generation, or `nil` (verified / cooling down).
2. `UserMailer.with(user:, generation:).email_verification.deliver_later`. The job's
   arguments are the user's GlobalID and the generation number — never the code.
3. In the job, `User#issue_email_verification_code(generation)` generates the code and writes
   its digest with one conditional `UPDATE … WHERE generation = ? AND digest IS NULL AND
   email_verified_at IS NULL`. Only if that updates the row does the mailer build and send the email.

So a delayed job from a superseded request, or the same job run twice, matches no row and
sends nothing; it can never overwrite a newer code.

## Concurrency and replay
- Verification runs under `with_lock` (`SELECT … FOR UPDATE`, which reloads the row). Parallel
  submissions of the right code: one `200`, the rest see no digest and get `422`. Parallel wrong
  guesses are serialised, so attempts stop at 5.
- Parallel requests for a new code: the row lock lets exactly one pass the cooldown.

## Rate limits
Shared Solid Cache store from increment 1 (`BaseController::RATE_LIMIT_STORE`, fail-open on
transient DB errors).
- 20 requests / 15 min per IP, across both actions.
- 5 code requests / hour per submitted email (normalised), whether or not an account exists,
  so a `429` reveals nothing.
- The attempt cap lives in the database, so guessing stays bounded even when the limiter fails open.

### Known limitation: shared public IPs
BUA staff on the corporate network likely reach BUSSCO from one public (NAT) address. The
per-IP budget is shared by everyone behind it: about 7 people each registering, requesting a
code and verifying it once use up 20 requests, and the rest of the office gets `429` for
15 minutes. That risk is highest at rollout, when many staff sign up at once. Registration's
10 per 15 minutes per IP limit (increment 1) has the same shape. Not changed in increment 2.

### Recommended layered strategy (not implemented)
Decide before the production rollout. Brute-force protection comes from the per-code and
per-email layers, not the IP layer, so the IP layer can be sized for shared networks without
weakening OTP security. Keep these unchanged:
- **Per code (database):** 5 attempts, 10-minute TTL, single use, replaced on each new request.
- **Per email:** 5 code requests per hour, plus the 60-second resend cooldown. Together they
  allow at most about 25 guesses an hour against one account, from any number of IPs.

Change the IP layer:
- **Per IP becomes a flood ceiling only.** Size it from the largest expected group behind one
  address at peak, not from one person's use. Never exempt an IP. If known corporate egress
  addresses need more room, give them a higher ceiling, not an exemption.
- **Correct client IPs first.** `request.remote_ip` must see the real client through the
  reverse proxy (trusted proxies; see [registration.md](registration.md) "Rate limiting").
  Otherwise every user shares the proxy's address and any per-IP limit acts like a global one.
- **Measure before tuning.** Log `429`s by limit name (per IP or per email) and count only;
  never log the email or the code.

Raising the IP ceiling lets one address spray guesses across many accounts. Each account still
gets about 25 guesses an hour, so an attacker's odds per account stay negligible (about 1 in
40,000 per hour). Any change keeps the generic `202`/`422` answers and the `Retry-After` headers.

## Email delivery (Resend)
- Action Mailer over **Resend SMTP**: `smtp.resend.com:465`, implicit TLS (`tls: true`), user
  `resend`, password `RESEND_API_KEY`. No gem. Settings in `config/application.rb`.
- Sender: `MAIL_FROM` (an address on the Resend-verified domain).

| Env | Delivery |
|---|---|
| production | `:smtp` (Resend). Boot fails if `RESEND_API_KEY` or `MAIL_FROM` is missing |
| development | `:smtp` when `RESEND_API_KEY` is exported, otherwise `:file` to `tmp/mails/`. `raise_delivery_errors = true` |
| test | `:test` — never reaches Resend |

- Email: subject "Your BUSSCO verification code"; HTML + text with BUSSCO header, the code,
  "This code expires in 10 minutes", and an ignore-if-not-you line. No links.
- **Logs**: request params `email`/`code` are filtered; Active Job logs only the GlobalID and
  generation; Action Mailer's logger is off (`config.action_mailer.logger = nil`) because it
  prints whole messages at debug level. Rails never logs SMTP settings.
- **Delivery failure** (Resend down, bad key, rejected sender): registration (`201`) and the
  request (`202`) have already answered. The job raises; Active Job logs the exception class and
  SMTP reply. The account stays unverified — only a correct `PATCH` verifies. The user can
  request another code after the cooldown.

## Background jobs
`deliver_later` uses Rails' default `:async` adapter: an in-process thread pool, no extra
infrastructure, fine for development.
- Jobs pending when the app restarts are **lost** and failed jobs are **not retried**; the user
  requests another code after 60 seconds.
- **Production deployment requirement:** switch to a durable, persistent backend (e.g. Solid
  Queue on the primary database) before BUSSCO goes to production. Nothing else changes: job
  arguments already hold no secrets. Not part of increment 3 unless one of its features
  actually depends on it. Also listed in the README's production requirements.

## Database
Added to `users` (`AddEmailVerificationToUsers`):

| Column | Type | Null | Default |
|---|---|---|---|
| `email_verification_code_digest` | string | yes | — |
| `email_verification_code_issued_at` | datetime | yes | — |
| `email_verification_requested_at` | datetime | yes | — |
| `email_verification_generation` | integer | no | `0` |
| `email_verification_attempts` | integer | no | `0`; check `BETWEEN 0 AND 5` |

One code per user, so issuing a new one replaces the old; no separate table.

## Acceptance criteria (all covered by tests)
- Registration enqueues exactly one email; a rejected registration none; still no session.
- Right code → 200, verified, digest cleared, no `bussco_auth`; same code again → 422.
- Wrong → 422 and attempt +1; five wrong then right → 422; 10 min + 1 s after issue → 422;
  a job delayed 5 minutes still gives the full 10 minutes from issue.
- Resend inside 60 s → 202, no email; after → new email, old code 422, new code 200.
- Delayed job of a superseded request sends nothing; a repeated or stale job can't change the code.
- Unknown or verified email → 202, no email; verifying an unknown email → 422.
- Missing CSRF / foreign Origin → 403, no email, no attempt used.
- 21st request per IP and 6th per email → 429.
- Resend unreachable → job raises, account unverified, no API key in the log, later resend works.
- Code and digest never in responses or the debug-level log; job arguments hold no code.
- Concurrency (real threads, separate connections): one success from 4 parallel right codes;
  attempts stop at 5 under 10 parallel wrong guesses; one winner among 4 parallel resends.

## Manual testing
Real delivery through Resend, and verifying the emailed code, were tested by hand with
Thunder Client (steps below) on 2026-10-20 and passed. Automated tests (`bin/rails test`, CI)
use `:test` delivery or a fake SMTP host. They never contact Resend and must never need
real Resend credentials.

### Real email through Resend (automated, opt-in)
```sh
RESEND_API_KEY=re_... MAIL_FROM="BUSSCO <verify@your-domain>" RESEND_TEST_TO=you@example.com \
  bin/rails test test/manual/resend_delivery_test.rb
```
Skipped unless `RESEND_TEST_TO` is set. Sends one email over TLS and checks the emailed code
verifies. Then check the inbox: sender, subject, branding, code, "expires in 10 minutes".

### Thunder Client (development)
Start the server with real delivery (or without the key to read codes from `tmp/mails/`):
```sh
RESEND_API_KEY=re_... MAIL_FROM="BUSSCO <verify@your-domain>" bin/rails s
```
In Thunder Client keep cookies for the collection (the Rails session cookie holds the CSRF
secret). Every `POST`/`PATCH` needs these headers:
```
Origin: http://localhost:3000
X-CSRF-Token: <csrf_token from step 1>
Content-Type: application/json
Accept: application/json
```
1. `GET http://localhost:3000/api/v1/csrf` → copy `csrf_token`.
2. `POST http://localhost:3000/api/v1/auth/registrations`
   `{"user":{"full_name":"Ada Obi","email":"<your inbox>","password":"correct horse battery"}}`
   → `201`, `"email_verified": false`.
3. The code arrives from `MAIL_FROM` within seconds.
4. `PATCH http://localhost:3000/api/v1/auth/email_verification`
   `{"email":"<your inbox>","code":"000000"}` → `422 {"error":"invalid_code"}`.
5. Same request with the real code → `200 {"email_verified": true}`. Send it again → `422`.
   No `bussco_auth` cookie appears.
6. Cooldown and replacement (use a second inbox, or a `+tag` address): register, then
   `POST http://localhost:3000/api/v1/auth/email_verification` `{"email":"<it>"}` straight away
   → `202`, no new email. After 60 s → `202`, new email. Old code → `422`, new code → `200`.
7. Remove `X-CSRF-Token`, or set `Origin: http://evil.example` → `403`.
8. `POST …/email_verification` `{"email":"nobody@example.com"}` → `202`, nothing sent.
9. Failure path: restart with `RESEND_API_KEY=re_invalid`, register → `201`. The server log
   shows the job error but no code and no key; the account stays unverified.
10. Search `log/development.log` for the code and the key: neither appears.

## Implementation notes
- **Files:** `db/migrate/*_add_email_verification_to_users.rb`, `app/models/user.rb`
  (`request_email_verification`, `send_email_verification`, `issue_email_verification_code`,
  `verify_email_code`), `app/mailers/user_mailer.rb`, `app/views/user_mailer/`,
  `app/views/layouts/mailer.html.erb`, `app/controllers/api/v1/auth/email_verifications_controller.rb`,
  `config/application.rb`, `config/environments/{development,production}.rb`.
- `BaseController` now holds `RATE_LIMIT_STORE`, `rate_limited(retry_after)` and
  `string_param`, moved from `RegistrationsController`.
- **Tests:** `test/controllers/api/v1/auth/email_verifications_controller_test.rb`,
  `test/integration/email_verification_race_test.rb`, `test/manual/resend_delivery_test.rb`,
  plus additions to the registration and user-constraint tests.
