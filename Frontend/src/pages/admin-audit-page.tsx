import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown } from "lucide-react"

import { AdminBanner } from "@/components/admin-layout"
import {
  BX_BTN,
  BX_CARD,
  BX_SEARCH,
  ROLE_LABELS,
  SuperAdminShell,
  initials,
} from "@/components/admin-shell"
import {
  apiErrorMessage,
  roleChangesQuery,
  type AdminRole,
  type RoleChange,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const roleName = (role: AdminRole | null) =>
  role ? ROLE_LABELS[role] : "Member access"

// What the actor did, read from the audit row (operator rows use the same actions).
export function describeChange(change: RoleChange) {
  const { action, previous_role: from, new_role: to } = change
  if (action === "provision") return "provisioned the Super Admin"
  if (action === "recover") return "recovered the Super Admin"
  if (action === "revoke" || !to) return `revoked ${roleName(from)} access`
  if (from) return `changed ${roleName(from)} to ${roleName(to)}`
  return `assigned ${roleName(to)}`
}

const dayKey = (date: Date) => date.toDateString()
const time = (date: Date) =>
  date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

function relativeDay(date: Date) {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  if (dayKey(date) === dayKey(today)) return "Today"
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday"
  return null
}

export function formatWhen(iso: string) {
  const date = new Date(iso)
  const day = relativeDay(date)
  if (day === "Today") return `Today ${time(date)}`
  return (
    day ?? date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  )
}

const dayLabel = (date: Date) =>
  (
    relativeDay(date) ??
    date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  ).toUpperCase()

// Read-only role-change history, newest first, grouped by day. Nothing here edits or deletes a record.
export function AdminAuditPage() {
  const changes = useQuery(roleChangesQuery)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<number | null>(null)

  const needle = q.trim().toLowerCase()
  const shown = (changes.data?.role_changes ?? []).filter(
    (c) =>
      !needle ||
      `${c.actor} ${c.user.full_name} ${c.user.email}`
        .toLowerCase()
        .includes(needle)
  )
  const days: { label: string; events: RoleChange[] }[] = []
  for (const change of shown) {
    const label = dayLabel(new Date(change.created_at))
    if (days.at(-1)?.label !== label) days.push({ label, events: [] })
    days.at(-1)!.events.push(change)
  }

  return (
    <SuperAdminShell
      active="audit"
      title="Audit Log"
      lead="Every change to administrator access: who did it, when, and what changed. Entries are read-only."
    >
      <section
        aria-label="Audit events"
        className={`${BX_CARD} flex min-w-0 flex-col`}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-[#EEF0F3] px-[18px] py-4">
          <div className="max-w-[420px] flex-[1_1_260px]">
            <label htmlFor="al-search" className="sr-only">
              Search by person or email
            </label>
            <input
              id="al-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by person or email"
              className={BX_SEARCH}
            />
          </div>
          {changes.data && (
            <span className="ml-auto text-[0.8125rem] text-[#5B6472]">
              {shown.length} of {changes.data.role_changes.length} events
            </span>
          )}
        </div>

        {changes.isPending && (
          <p
            role="status"
            className="m-0 px-5 py-12 text-center text-[#5B6472]"
          >
            Loading the audit log…
          </p>
        )}
        {changes.isError && (
          <div className="flex flex-col items-start gap-3 p-5">
            <AdminBanner tone="alert" title="We couldn't load the audit log">
              {apiErrorMessage(changes.error)}
            </AdminBanner>
            <button
              type="button"
              className={BX_BTN}
              onClick={() => changes.refetch()}
              disabled={changes.isFetching}
            >
              Try again
            </button>
          </div>
        )}
        {changes.data && shown.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-5 py-12 text-center">
            <p className="m-0 font-semibold">
              {needle ? "No events match this search" : "No role changes yet"}
            </p>
            {needle && (
              <p className="m-0 text-[0.875rem] text-[#5B6472]">
                Try another name or email.
              </p>
            )}
          </div>
        )}

        {days.map((day) => (
          <div key={day.label} className="flex flex-col">
            <h2 className="m-0 border-b border-[#EEF0F3] bg-[#FAFAFB] px-5 pt-3.5 pb-2.5 text-[0.75rem] font-semibold tracking-[0.12em] text-[#5B6472]">
              {day.label}
            </h2>
            <ol className="m-0 list-none p-0">
              {day.events.map((c) => {
                const isOpen = open === c.id
                const date = new Date(c.created_at)
                return (
                  <li key={c.id} className="border-b border-[#EEF0F3]">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`al-ev-${c.id}`}
                      onClick={() => setOpen(isOpen ? null : c.id)}
                      className={cn(
                        "group flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2.5 border-0 px-5 py-3.5 text-left hover:bg-[#FAFAFB] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9E1B22]",
                        isOpen
                          ? "bg-[#FCF8F8] hover:bg-[#FCF8F8]"
                          : "bg-transparent"
                      )}
                    >
                      <span className="flex-[0_0_48px] text-[0.8125rem] text-[#5B6472] tabular-nums">
                        {time(date)}
                      </span>
                      <span
                        aria-hidden
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#F7ECEC] text-[0.75rem] font-semibold text-[#75141A]"
                      >
                        {initials(c.actor)}
                      </span>
                      <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-[3px]">
                        <span className="text-[0.875rem] leading-[1.45] break-words">
                          <strong className="font-semibold">{c.actor}</strong> —{" "}
                          {describeChange(c)}
                        </span>
                        <span className="text-[0.8125rem] break-words text-[#4B5563]">
                          {c.user.full_name} · {c.user.email}
                        </span>
                      </span>
                      <span className="inline-flex h-[26px] items-center rounded-full bg-[#F7ECEC] px-2.5 text-[0.75rem] font-semibold whitespace-nowrap text-[#75141A]">
                        Access &amp; roles
                      </span>
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "size-[18px] shrink-0 text-[#5B6472] transition-transform motion-reduce:transition-none",
                          isOpen && "rotate-180"
                        )}
                        strokeWidth={1.8}
                      />
                    </button>
                    {isOpen && (
                      <div
                        id={`al-ev-${c.id}`}
                        className="flex flex-wrap gap-4 bg-[#FCF8F8] px-5 pt-1 pb-5 min-[600px]:pl-[84px]"
                      >
                        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 rounded-xl border border-[#EEE3E3] bg-white px-4 py-3.5">
                          <span className="text-[0.71875rem] font-semibold tracking-[0.12em] text-[#9E1B22]">
                            WHAT CHANGED
                          </span>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.84375rem]">
                            <span className="flex-[1_1_140px] text-[#374151]">
                              Role
                            </span>
                            <span className="rounded-md bg-[#F3F4F6] px-2 py-[3px] text-[#4B5563] line-through decoration-[#9CA3AF]">
                              {roleName(c.previous_role)}
                            </span>
                            <span aria-hidden>→</span>
                            <span className="sr-only">to</span>
                            <span className="rounded-md bg-[#F7ECEC] px-2 py-[3px] font-semibold text-[#75141A]">
                              {roleName(c.new_role)}
                            </span>
                          </div>
                        </div>
                        <dl className="m-0 grid min-w-0 flex-[1_1_280px] grid-cols-[minmax(0,110px)_minmax(0,1fr)] content-start gap-x-3 gap-y-2 text-[0.8125rem]">
                          <dt className="text-[#5B6472]">Reference</dt>
                          <dd className="m-0 font-mono text-[0.78125rem]">
                            RC-{c.id}
                          </dd>
                          <dt className="text-[#5B6472]">Date &amp; time</dt>
                          <dd className="m-0">
                            {date.toLocaleString("en-GB", {
                              dateStyle: "long",
                              timeStyle: "short",
                            })}
                          </dd>
                          <dt className="text-[#5B6472]">Done by</dt>
                          <dd className="m-0 break-words">{c.actor}</dd>
                        </dl>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </section>
    </SuperAdminShell>
  )
}
