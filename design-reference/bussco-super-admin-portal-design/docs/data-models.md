# Data models and suggested endpoints (proposals, not a spec)

Types: `src/design/types.ts`. Adapt to the existing backend; do not invent tables if equivalents exist.

Suggested endpoints:
- `GET /api/admin/overview` KPIs, 6M/12M savings series, loan portfolio split, pending approvals, officers, recent activity
- `GET /api/admin/members?status=&q=&role=`
- `GET /api/admin/roles`, `PUT /api/admin/roles/:role/permissions` (Super Admin only)
- `POST /api/admin/officers/:role/assign` body `{ memberId }` (Super Admin only)
- `GET /api/admin/audit?period=&role=&category=`
- `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/change-password`

All sample figures in the design (1,248 members, ₦842.6M savings, ₦316.4M loans, 12 pending, 13 audit events) are placeholders marked "Sample data".
