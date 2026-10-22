# Increment 4 — Five-stage membership application

Status: **implemented** (backend only).

Naming: this is product increment 4. The auth docs (`docs/auth/README.md`) separately number
password recovery as "auth increment 4" and admin access as "auth increment 5". Those are still planned.

Journey: register → email code → automatic sign-in → welcome → five stages → submit → awaiting
approval. A returning applicant signs in and resumes the draft.

## Exclusions
- Approval, administrative review, member dashboard, loans: later increments.
- Registration-fee collection, payroll deductions, savings transactions.
- React screens.
- Allowlists for the dropdown fields, to be added once approved option lists exist.
- Stripping photo metadata (see "Photo").

## Data: `membership_applications`
There is one row per user (`user_id` is unique, `ON DELETE CASCADE`). Every stage column is
nullable, so drafts can be partial. Name and email are not stored here: they are shown from
`users` (`applicant` in responses).

| Stage | Field | Type | When present | Required to submit |
|---|---|---|---|---|
| 1 Employment | `sap_staff_id` | string | trimmed, `[A-Za-z0-9/-]{1,30}` | yes |
| | `business_unit` | string (dropdown value) | ≤ 120 | yes |
| | `department` | string | ≤ 120 | yes |
| | `office_location` | string | ≤ 200 | yes |
| 2 Personal | `passport_photo` | Active Storage | JPEG/PNG by file signature, ≤ 2 MB | yes |
| | `primary_phone` | string | spaces, `()`, `.` and `-` removed; `+?` 7–15 digits | yes |
| | `secondary_phone` | string | same | no |
| | `date_of_birth` | date | ISO `YYYY-MM-DD`, after 1900-01-01, before today | yes |
| | `sex` | string (dropdown value) | ≤ 30 | yes |
| | `marital_status` | string (dropdown value) | ≤ 30 | yes |
| | `nationality` | string | ≤ 60 | yes |
| | `home_address` | text | ≤ 300, line breaks allowed | yes |
| 3 Next of kin | `next_of_kin_name` | string | ≤ 120 | yes |
| | `next_of_kin_relationship` | string | ≤ 50 | yes |
| | `next_of_kin_phone` | string | phone format | no |
| | `next_of_kin_address` | text | ≤ 300; the UI may copy `home_address` (no flag stored) | yes |
| 4 Savings | `monthly_contribution_kobo` | bigint | integer ≥ 3,000,000 (₦30,000) | yes |
| | `contribution_start_date` | date | ISO date, 1st of a month | yes, and at submission it must be next month's 1st or later |
| 5 Declaration | `declaration_version`, `declaration_accepted_at` | string, datetime | server-set | yes |
| | `submitted_at` | datetime | server-set | — |

Validation rules:
- **Text fields:** trimmed (Unicode-aware). A blank value is stored as NULL, which is how a draft
  field is cleared. No control characters are allowed, except line breaks in addresses.
- **Inputs:**
  - Values must be JSON strings or null.
  - `monthly_contribution_kobo` also accepts a JSON integer.
  - Floats, booleans, other numbers, and strings containing NUL are rejected with 422.
  - Arrays and objects are dropped by the params allowlist.
- **Database checks:** lengths and trimming, phone and staff ID formats, contribution > 0, the
  start date on day 1, and every required column present once `submitted_at` is set. The ₦30,000
  minimum is a model constant, so a policy change needs no migration.
- **Business rules:** the minimum and the ₦10,000 one-time registration fee
  (`REGISTRATION_FEE_KOBO`, separate from monthly contributions) come from the registration
  requirements. Both are returned under `policy` for display. The fee is never stored or collected.
- **SAP / Staff ID:** self-declared and unverified. It is not unique and never copied to
  `users.sap_id`. Only a future authorised membership review may verify employment and set
  `users.sap_id`.

`users.membership_status` now allows `not_started | awaiting_approval`. Only submission sets it,
in the same transaction as the application.

## API: `/api/v1/membership/application`
- Every action needs a session; otherwise `401 { "error": "unauthenticated" }`. Disabled
  accounts get the same 401.
- Unsafe requests need `Origin` and `X-CSRF-Token`; otherwise 403.
- Every write (start, stage save, photo upload, submission) must also send `X-Applicant-Id` with the
  signed-in user's id (from `/me`). Any other value, or none, gets
  `409 { "error": "identity_mismatch" }` before the application is read or written. A browser tab still
  showing applicant A, after B signed in elsewhere in the same browser, therefore can't write A's
  details into B's application, even when the two `lock_version`s happen to match.
- The application is always the session user's own: no request names an id.
- Write actions are rate limited at 300 per 15 minutes per signed-in user (not per IP: staff may share an office IP).

| Method and path | Request | Responses |
|---|---|---|
| `GET` | — | `200` body below · `404 not_found` (never started) |
| `POST` | — | `201` new draft · `200` existing one (idempotent) |
| `PATCH /stages/:stage` | `{ lock_version, application: {…stage fields} }`. Stages: `employment`, `personal`, `next_of_kin`, `savings` | `200` · `422 { errors }` · `409 stale` / `already_submitted` · `404` unknown stage |
| `PUT /passport_photo` | multipart `photo`, `lock_version` | `200` · `422` · `409` |
| `GET /passport_photo` | — | the owner's image, `Cache-Control: private, no-store`, `nosniff`, `X-Applicant-Id` (the session user's id) · `404` |
| `POST /submission` | `{ lock_version, declaration_accepted: true, declaration_version }` | `201` · `422 { errors, missing }` · `409` · `503 declaration_unavailable` |

Body for 200/201:
```json
{
  "application": { "…stage fields…", "passport_photo": { "content_type": "image/png", "byte_size": 1234, "checksum": "…" } | null,
                   "declaration_version": null, "declaration_accepted_at": null, "submitted_at": null, "lock_version": 3 },
  "applicant": { "full_name": "…", "email": "…", "membership_status": "not_started" },
  "progress": { "stages": { "employment": "complete", "personal": "incomplete", "next_of_kin": "…", "savings": "…" },
                "current_stage": "personal", "ready_to_submit": false,
                "missing": { "personal": ["passport_photo", "date_of_birth"], "…": [] } },
  "policy": { "minimum_monthly_contribution_kobo": 3000000, "registration_fee_kobo": 1000000,
              "declaration": { "version": "draft-v1", "text": "…", "approved": false } }
}
```
`progress` is `null` once submitted. `policy.declaration` is `null` when submissions are unavailable.
A `409` also returns the saved `application`, so the client can reload or merge.

## Draft saving and concurrency
- **One stage per request:** each request writes only that stage's fields, so other stages may stay
  empty or invalid. Draft validation checks only the values sent; submit validation adds presence
  (`on: :submit`).
- **Autosave contract for the frontend:** save on Next/Back and after about 2 s of idle typing,
  with one request in flight per tab, and send the `lock_version` from the last response. An
  unchanged save issues no UPDATE.
- **Optimistic locking:** every write must carry the `lock_version` the client last saw. An older
  one gets `409 stale` before anything is written. Two requests racing from the same version:
  the database's `WHERE lock_version = n` lets exactly one win. A photo upload counts as a write too:
  attaching touches the row inside the same transaction, so a stale upload rolls back and leaves no
  blob behind. Nothing can silently overwrite newer data.
- **Atomic submission:** one transaction saves the application (versioned) with `submitted_at` and
  the declaration fields, and sets `users.membership_status = awaiting_approval`. Parallel submits
  produce exactly one 201.
- **Read-only after submission:** a `before_update` guard blocks every update in the model (deleting the user still works), and the API returns
  `409 already_submitted`. Only a future authorised review process may reopen an application.

## Declaration
- `MembershipApplication::DECLARATIONS` maps each version to its exact text and an `approved` flag.
  It is append-only: a test pins each version's SHA-256, so historical wording can't be edited.
  New wording gets a new version, and old records keep theirs.
- `draft-v1` is the temporary wording: **DRAFT — Pending Legal Approval** (`approved: false`).
- The current version comes from `config.x.membership_declaration_version`. Development and test
  use `draft-v1`. Production reads `MEMBERSHIP_DECLARATION_VERSION` with no default, and accepts only
  a version marked `approved: true`. Until then every submission returns
  `503 { "error": "declaration_unavailable" }`.
- Submission requires `declaration_accepted: true` (a JSON boolean) and the current version. The
  server stores `declaration_version` and sets `declaration_accepted_at`.
- Accepting the declaration does **not** authorise payroll deductions or fee collection.

## Photo
- **Storage:** Active Storage on Disk. Test uses `tmp/storage`; development and production use
  `storage/`, which must be a persistent volume in production.
- **Private:** Active Storage's own routes are off (`draw_routes = false`), so there are no public
  signed blob URLs and no anonymous direct uploads. Owners fetch their photo through
  `GET …/passport_photo`, which names its owner in `X-Applicant-Id` so a browser can drop a photo that
  arrived for a different sign-in (an account switched in another tab mid-request). The JSON gives the
  blob's `checksum`, which changes with every replacement.
- **Type check:** the type comes from the file's first bytes (JPEG `FF D8 FF`, PNG signature), never
  from the filename or the client's Content-Type. The stored filename is always `passport-photo`.
- **No background analysis:** the blob is stored as already analyzed. Active Storage's analyze job
  would otherwise touch the application row after the response, raising `lock_version` past the one
  just returned, so the applicant's next save would get a false `409 stale`. Image dimensions are never
  used.
- **Replacement:** the new file is validated before anything changes. An invalid upload leaves the
  previous photo in place; a valid one replaces it, and the old blob is purged by a background job.
- **Time zone:** the app runs on `Africa/Lagos` time, so "today", "before today" and "next month"
  follow Nigerian dates. Stored timestamps are UTC.
- **Metadata:** EXIF data (camera, possibly GPS location) is kept as uploaded. Removing it means
  re-encoding the image, which needs `image_processing` with libvips or ImageMagick (a new gem and a
  system library). Not added yet: the photo is visible only to its owner (and later to authorised
  reviewers).

## Production requirements
- **Cap upload size at the reverse proxy.** Puma, the app server, receives the whole request body
  (and Rails writes multipart uploads to a temp file) before the app can check the 2 MB limit. Without
  a cap, a signed-in user could send a multi-gigabyte body and fill the server's disk before getting
  a 422. The proxy must reject oversized bodies first, for example in Nginx:

  ```nginx
  # Passport photos: 2 MB file + multipart overhead. Everything else in the API is small JSON.
  location = /api/v1/membership/application/passport_photo {
      client_max_body_size 3m;
      proxy_pass http://rails;   # same upstream and Host-preserving headers as /api/
  }
  location /api/ {
      client_max_body_size 1m;
      proxy_pass http://rails;
  }
  ```
  Nginx then answers `413 Request Entity Too Large` without involving Rails.
- **Keep the app's own file checks.** The proxy only bounds the request size. The app still enforces
  the exact 2 MB limit and checks that the file really is a JPEG or PNG (from its first bytes). The
  proxy can't do either, and the app must stay safe if a proxy is misconfigured or bypassed.
- **Durable background jobs.** Replacing a photo deletes the old file in a background job. Like the
  verification emails, jobs run in-process (`:async`) for now, so a restart can lose the job and leave
  the old photo in `storage/` (unreachable through the API, but still personal data on disk). A durable
  job backend (e.g. Solid Queue) is required before production deployment. It is not added in this
  increment.
- **Persistent storage.** `storage/` must be a persistent volume, included in backups.
- **Declaration.** Set `MEMBERSHIP_DECLARATION_VERSION` to an approved version; until then
  submissions return 503.

## Privacy
- **Log filters:** `filter_parameters` covers the nested `application` params, `photo`, `declaration`
  and every application column, so SQL bind values and `inspect` output are filtered too. Error
  bodies contain field names, never values.
- **Never permitted:** `user_id`, `id`, statuses, `sap_id`, `email`, `full_name`, timestamps,
  `lock_version` inside `application`, and declaration fields.

## Tests
- `test/models/membership_application_test.rb`: declaration pinning, the production gate,
  normalisation, every format rule, money, dates, photo type by content, atomic submission, DB
  constraints, cascade delete.
- `test/controllers/api/v1/membership/applications_controller_test.rb`:
  - authentication, disabled accounts, ownership
  - start, partial stages, resume, editing earlier stages, progress
  - invalid inputs, dropdown strings, mass assignment, no-op saves, stale writes
  - photo upload, replacement and privacy; Active Storage routes absent
  - submission rules, immutability, the production 503
  - CSRF and Origin checks; log privacy
- `test/integration/membership_application_race_test.rb`: parallel starts, parallel saves, a photo
  upload racing a save, parallel submits (real threads, committed rows).
