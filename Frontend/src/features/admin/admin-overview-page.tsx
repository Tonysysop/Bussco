import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { History, ShieldCheck, UserRound, Users } from "lucide-react"
import { Link } from "react-router"

import { AdminBanner } from "@/features/admin/admin-layout"
import {
  BX_CARD,
  BX_PRIMARY,
  ROLE_LABELS,
  SuperAdminShell,
  initials,
} from "@/features/admin/admin-shell"
import {
  administratorsQuery,
  apiErrorMessage,
  roleChangesQuery,
  type RoleChange,
} from "@/lib/api"
import { describeChange, formatWhen } from "@/features/admin/admin-audit-page"

const DAY = 24 * 60 * 60 * 1000

// The Super Admin's landing page: administrative identity only. The design's savings, loans and
// approvals panels wait for the increments that create that data.
export function AdminOverviewPage() {
  const admins = useQuery(administratorsQuery)
  const changes = useQuery(roleChangesQuery)

  const list = admins.data?.administrators ?? []
  const holder = (role: "president" | "treasurer") =>
    list.find((a) => a.admin_role === role)
  // Fixed when the page opens; a 30-day window doesn't need to tick.
  const [since] = useState(() => Date.now() - 30 * DAY)
  const recent =
    changes.data?.role_changes.filter(
      (c) => new Date(c.created_at).getTime() >= since
    ).length ?? 0

  const kpis = [
    {
      label: "Administrators",
      value: admins.data ? String(list.length) : "–",
      note: "Super Admin, President and Treasurer",
      Icon: Users,
    },
    {
      label: "President",
      value: admins.data ? (holder("president")?.full_name ?? "Vacant") : "–",
      note: holder("president")?.email ?? "No one holds this office",
      Icon: UserRound,
    },
    {
      label: "Treasurer",
      value: admins.data ? (holder("treasurer")?.full_name ?? "Vacant") : "–",
      note: holder("treasurer")?.email ?? "No one holds this office",
      Icon: UserRound,
    },
    {
      label: "Role changes",
      value: changes.data ? String(recent) : "–",
      note: "In the last 30 days",
      Icon: History,
    },
  ]

  return (
    <SuperAdminShell
      active="overview"
      title="Overview"
      lead="Administrative access across the cooperative."
      actions={
        <Link to="/admin/roles" className={BX_PRIMARY}>
          <ShieldCheck aria-hidden className="size-4" strokeWidth={1.8} />
          Manage roles
        </Link>
      }
    >
      {(admins.isError || changes.isError) && (
        <AdminBanner tone="alert" title="We couldn't load the overview">
          {apiErrorMessage((admins.error ?? changes.error)!)}
        </AdminBanner>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {kpis.map(({ label, value, note, Icon }) => (
          <div
            key={label}
            className={`${BX_CARD} flex min-w-0 flex-col gap-3 p-5`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.84375rem] font-medium text-[#4B5563]">
                {label}
              </span>
              <span
                aria-hidden
                className="flex size-[34px] items-center justify-center rounded-[9px] bg-[#F7ECEC] text-[#9E1B22]"
              >
                <Icon className="size-[18px]" strokeWidth={1.7} />
              </span>
            </div>
            <span className="font-admin-display text-[2.25rem] leading-none tracking-[-0.02em] break-words tabular-nums">
              {value}
            </span>
            <span className="text-[0.8125rem] break-words text-[#5B6472]">
              {note}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4">
        <section
          aria-labelledby="ov-exec-h"
          className={`${BX_CARD} flex min-w-0 flex-[1_1_300px] flex-col gap-1.5 px-[22px] py-5`}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="ov-exec-h" className="m-0 text-base font-semibold">
              Executive officers
            </h2>
            <Link
              to="/admin/roles"
              className="inline-flex min-h-11 items-center text-[0.84375rem] font-medium text-[#75141A] hover:text-[#9E1B22]"
            >
              Manage roles
            </Link>
          </div>
          {admins.isPending && (
            <p
              role="status"
              className="m-0 py-3 text-[0.875rem] text-[#5B6472]"
            >
              Loading officers…
            </p>
          )}
          {list.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 border-t border-[#EEF0F3] py-3"
            >
              <span
                aria-hidden
                className={`flex size-[38px] shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold ${a.admin_role === "super_admin" ? "bg-[#75141A] text-white" : "bg-[#F7ECEC] text-[#75141A]"}`}
              >
                {initials(a.full_name)}
              </span>
              <div className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-[0.875rem] font-semibold break-words">
                  {a.full_name}
                </span>
                <span className="text-[0.78125rem] text-[#5B6472]">
                  {ROLE_LABELS[a.admin_role!]}
                </span>
              </div>
            </div>
          ))}
        </section>

        <section
          aria-labelledby="ov-act-h"
          className={`${BX_CARD} flex min-w-0 flex-[2_1_420px] flex-col`}
        >
          <div className="flex items-center justify-between gap-3 px-[22px] pt-5 pb-2">
            <h2 id="ov-act-h" className="m-0 text-base font-semibold">
              Recent activity
            </h2>
            <Link
              to="/admin/audit"
              className="inline-flex min-h-11 items-center text-[0.84375rem] font-medium text-[#75141A] hover:text-[#9E1B22]"
            >
              Open audit log
            </Link>
          </div>
          {changes.isPending && (
            <p
              role="status"
              className="m-0 px-[22px] pb-4 text-[0.875rem] text-[#5B6472]"
            >
              Loading activity…
            </p>
          )}
          {changes.data?.role_changes.length === 0 && (
            <p className="m-0 px-[22px] pb-5 text-[0.875rem] text-[#5B6472]">
              No role changes yet.
            </p>
          )}
          <ol className="m-0 list-none px-[22px] pt-0 pb-2.5">
            {changes.data?.role_changes.slice(0, 6).map((c: RoleChange) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[#EEF0F3] py-3 text-[0.84375rem]"
              >
                <span className="flex-[0_0_104px] text-[#5B6472] tabular-nums">
                  {formatWhen(c.created_at)}
                </span>
                <span className="min-w-0 flex-[1_1_320px] break-words">
                  <strong className="font-semibold">{c.actor}</strong>{" "}
                  {describeChange(c)}
                </span>
                <span className="flex-[0_1_auto] break-words text-[#374151]">
                  {c.user.full_name}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </SuperAdminShell>
  )
}
