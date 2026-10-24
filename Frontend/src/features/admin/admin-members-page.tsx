import { useEffect, useId, useState, type ReactNode } from "react"
import { Tabs } from "@base-ui/react/tabs"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { AdminBanner } from "@/features/admin/admin-layout"
import {
  AdminDialog,
  BX_BTN,
  BX_CARD,
  BX_SEARCH,
  initials,
  ROLE_LABELS,
  SuperAdminShell,
} from "@/features/admin/admin-shell"
import {
  apiErrorMessage,
  membersQuery,
  type Member,
  type MemberFilters,
  type MemberStage,
} from "@/lib/api"
import { cn } from "@/lib/utils"

// Read-only directory of registered accounts (design-reference Members.dc.html). Tabs are application
// stages from Rails, not membership states: no one is an approved member until approval exists.
// Savings, loans, export and "Add member" from the design are left out: no data or workflow yet.

const TABS: { value: MemberFilters["stage"]; label: string }[] = [
  { value: "", label: "All registrations" },
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "Application in progress" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "disabled", label: "Disabled accounts" },
]

const STAGES: Record<MemberStage, { label: string; className: string }> = {
  not_started: {
    label: "Not started",
    className: "bg-[#F3F4F6] text-[#374151]",
  },
  in_progress: {
    label: "Application in progress",
    className: "bg-[#EEF2FA] text-[#27406E]",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    className: "bg-[#FDF4E3] text-[#7A4E0E]",
  },
}

const BADGE =
  "inline-flex h-6 items-center rounded-full px-[9px] text-[0.75rem] font-semibold whitespace-nowrap"
const CELL = "border-b border-[#EEF0F3] px-3 py-2.5"
const TH = "border-b border-[#EEF0F3] px-3 py-[11px] font-semibold"

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

// The passport photo when the application has one (served only to the Super Admin), else initials.
// Lazy: only rows on screen download a photo; a failed load falls back to the initials.
function MemberAvatar({
  member,
  className,
  alt = "",
}: {
  member: Member
  className?: string
  alt?: string
}) {
  const [failed, setFailed] = useState(false)
  const avatar =
    "flex shrink-0 items-center justify-center rounded-full bg-[#EEF0F3] font-semibold text-[#374151]"
  if (member.photo && !failed)
    return (
      <img
        src={`/api/v1/admin/members/${member.id}/photo`}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(avatar, "object-cover", className)}
      />
    )
  return (
    <span aria-hidden className={cn(avatar, className)}>
      {initials(member.full_name)}
    </span>
  )
}

function StatusBadges({ member }: { member: Member }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={cn(BADGE, STAGES[member.stage].className)}>
        {STAGES[member.stage].label}
      </span>
      {member.account_status === "disabled" && (
        <span className={cn(BADGE, "bg-[#FDECEA] text-[#8F1D14]")}>
          Account disabled
        </span>
      )}
      {!member.email_verified && (
        <span
          className={cn(
            BADGE,
            "border border-[#E5E7EB] bg-white text-[#5B6472]"
          )}
        >
          Email not verified
        </span>
      )}
    </div>
  )
}

// Staff ID and department are the applicant's own entries: marked as a draft until submitted.
function SelfReported({
  member,
  value,
}: {
  member: Member
  value: string | null | undefined
}) {
  if (!value) return <span className="text-[#8A929E]">—</span>
  return (
    <span className="flex flex-col gap-0.5">
      <span className="break-words">{value}</span>
      {!member.application?.submitted_at && (
        <span className="text-[0.75rem] text-[#7A4E0E]">Draft</span>
      )}
    </span>
  )
}

export function AdminMembersPage() {
  const [filters, setFilters] = useState<MemberFilters>({
    q: "",
    stage: "",
    role: "",
    page: 1,
  })
  const [text, setText] = useState("")
  const [open, setOpen] = useState<Member | null>(null)
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters((f) =>
          f.q === text.trim() ? f : { ...f, q: text.trim(), page: 1 }
        ),
      250
    )
    return () => clearTimeout(timer)
  }, [text])

  const members = useQuery(membersQuery(filters))
  const data = members.data
  const filter = (next: Partial<MemberFilters>) =>
    setFilters((f) => ({ ...f, ...next, page: next.page ?? 1 }))
  const first = data ? (data.page - 1) * data.per_page + 1 : 0
  const last = data ? first + data.members.length - 1 : 0

  return (
    <SuperAdminShell
      active="members"
      title="Members"
      lead="Everyone who has registered, with the stage of their membership application. Read-only: approval comes in a later release."
    >
      <section className={cn(BX_CARD, "flex min-w-0 flex-col")}>
        <div className="flex flex-col gap-3 border-b border-[#EEF0F3] px-[18px] pt-4 pb-3">
          {/* Base UI Tabs filter the one table below; the burgundy indicator slides to the chosen stage. */}
          <Tabs.Root
            value={filters.stage || "all"}
            onValueChange={(value: string) =>
              filter({
                stage: value === "all" ? "" : (value as MemberFilters["stage"]),
              })
            }
          >
            <Tabs.List
              aria-label="Filter by application stage"
              className="relative flex max-w-full flex-wrap gap-1.5 self-start rounded-xl bg-[#F1F2F5] p-1"
            >
              {TABS.map((tab) => {
                const count = data?.counts[tab.value || "all"]
                return (
                  <Tabs.Tab
                    key={tab.value}
                    value={tab.value || "all"}
                    className="group relative z-10 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[9px] px-3 text-[0.84375rem] font-medium text-[#4B5563] transition-colors duration-300 not-data-active:hover:text-[#1F2937] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22] motion-reduce:transition-none data-active:text-white"
                  >
                    {tab.label}
                    {count !== undefined && (
                      <span className="rounded-full bg-[#E5E7EB] px-2 text-[0.75rem] font-semibold text-[#374151] transition-colors duration-300 group-data-active:bg-white/20 group-data-active:text-white motion-reduce:transition-none">
                        {count}
                      </span>
                    )}
                  </Tabs.Tab>
                )
              })}
              <Tabs.Indicator className="absolute top-(--active-tab-top) left-(--active-tab-left) z-0 h-(--active-tab-height) w-(--active-tab-width) rounded-[9px] bg-[#9E1B22] shadow-[0_1px_2px_rgba(117,20,26,0.25)] transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none" />
            </Tabs.List>
          </Tabs.Root>
          <div className="flex flex-wrap items-center gap-3">
            <div className="max-w-[420px] flex-[1_1_260px]">
              <label htmlFor="mb-search" className="sr-only">
                Search by name, email or staff ID
              </label>
              <input
                id="mb-search"
                type="search"
                value={text}
                maxLength={100}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search by name, email or staff ID"
                className={BX_SEARCH}
              />
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="mb-role"
                className="text-[0.84375rem] font-medium text-[#4B5563]"
              >
                Role
              </label>
              <select
                id="mb-role"
                value={filters.role}
                onChange={(e) =>
                  filter({ role: e.target.value as MemberFilters["role"] })
                }
                className="h-11 cursor-pointer rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-[0.875rem] text-[#1F2937] focus:border-[#9E1B22] focus:shadow-[0_0_0_3px_rgba(158,27,34,0.16)] focus:outline-none"
              >
                <option value="">All roles</option>
                <option value="member">Member</option>
                <option value="president">President</option>
                <option value="treasurer">Treasurer</option>
              </select>
            </div>
          </div>
          <p className="m-0 text-[0.78125rem] text-[#5B6472]">
            Staff ID and department are entered by the applicant and are not
            verified.
          </p>
        </div>

        {members.isError && (
          <div className="p-[18px]">
            <AdminBanner tone="alert" title="We couldn't load members">
              {apiErrorMessage(members.error)}
            </AdminBanner>
          </div>
        )}

        {/* relative: keeps the sr-only header label inside the scroll box on narrow screens */}
        <div
          className="relative overflow-x-auto"
          aria-busy={members.isFetching}
        >
          <table className="w-full min-w-[760px] border-collapse text-[0.84375rem]">
            <thead>
              <tr className="bg-[#FAFAFB] text-left text-[0.75rem] tracking-[0.04em] text-[#5B6472]">
                <th scope="col" className={cn(TH, "px-[18px]")}>
                  MEMBER
                </th>
                <th scope="col" className={TH}>
                  STAFF ID
                </th>
                <th scope="col" className={TH}>
                  DEPARTMENT
                </th>
                <th scope="col" className={TH}>
                  ROLE
                </th>
                <th scope="col" className={TH}>
                  STATUS
                </th>
                <th scope="col" className={TH}>
                  REGISTERED
                </th>
                <th scope="col" className={cn(TH, "px-[18px]")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.isPending && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-[18px] py-12 text-center text-[#5B6472]"
                  >
                    <span role="status">Loading members…</span>
                  </td>
                </tr>
              )}
              {data && data.members.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-[18px] py-12 text-center text-[#5B6472]"
                  >
                    {data.total === 0 ? (
                      "No registrations match these filters."
                    ) : (
                      <span className="inline-flex flex-wrap items-center justify-center gap-3">
                        This page is past the last result.
                        <button
                          type="button"
                          className={BX_BTN}
                          onClick={() => filter({ page: 1 })}
                        >
                          Go to the first page
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              )}
              {data?.members.map((m) => (
                <tr key={m.id} className="hover:bg-[#FAFAFB]">
                  <td className={cn(CELL, "px-[18px]")}>
                    <div className="flex items-center gap-3">
                      <MemberAvatar
                        member={m}
                        className="size-9 text-[0.78125rem]"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-semibold break-words">
                          {m.full_name}
                        </span>
                        <span className="text-[0.78125rem] break-words text-[#5B6472]">
                          {m.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={CELL}>
                    <SelfReported
                      member={m}
                      value={m.application?.sap_staff_id}
                    />
                  </td>
                  <td className={CELL}>
                    <SelfReported
                      member={m}
                      value={m.application?.department}
                    />
                  </td>
                  <td className={CELL}>
                    {m.admin_role ? (
                      <span
                        className={cn(
                          BADGE,
                          "rounded-md border border-[#E2B9BB] bg-white text-[#75141A]"
                        )}
                      >
                        {ROLE_LABELS[m.admin_role]}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          BADGE,
                          "rounded-md bg-[#F3F4F6] text-[#374151]"
                        )}
                      >
                        Member
                      </span>
                    )}
                  </td>
                  <td className={CELL}>
                    <StatusBadges member={m} />
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap text-[#5B6472]")}>
                    {date(m.registered_at)}
                  </td>
                  <td className={cn(CELL, "pr-[18px] text-right")}>
                    <button
                      type="button"
                      className={cn(BX_BTN, "min-h-10 px-3 whitespace-nowrap")}
                      onClick={() => setOpen(m)}
                      aria-label={`View details for ${m.full_name}`}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-[18px] py-3.5">
            <span className="text-[0.8125rem] text-[#5B6472]">
              {data.members.length > 0
                ? `Showing ${first}–${last} of ${data.total}`
                : `${data.total} in total`}
            </span>
            <nav aria-label="Pagination" className="flex items-center gap-1.5">
              <button
                type="button"
                className={cn(BX_BTN, "size-10 min-h-10 px-0")}
                aria-label="Previous page"
                disabled={data.page <= 1}
                onClick={() => filter({ page: data.page - 1 })}
              >
                <ChevronLeft aria-hidden className="size-[18px]" />
              </button>
              <span className="px-2 text-[0.84375rem] text-[#374151]">
                Page {data.page} of {Math.ceil(data.total / data.per_page)}
              </span>
              <button
                type="button"
                className={cn(BX_BTN, "size-10 min-h-10 px-0")}
                aria-label="Next page"
                disabled={data.page * data.per_page >= data.total}
                onClick={() => filter({ page: data.page + 1 })}
              >
                <ChevronRight aria-hidden className="size-[18px]" />
              </button>
            </nav>
          </div>
        )}
      </section>

      <AdminDialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.full_name ?? ""}
      >
        {open && <MemberDetails member={open} />}
      </AdminDialog>
    </SuperAdminShell>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 min-[480px]:grid-cols-[9.5rem_minmax(0,1fr)] min-[480px]:gap-4">
      <dt className="text-[#5B6472]">{label}</dt>
      <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t border-[#EEF0F3] pt-4"
    >
      <h3
        id={id}
        className="m-0 text-[0.75rem] font-semibold tracking-[0.06em] text-[#5B6472] uppercase"
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

const DL = "m-0 flex flex-col gap-2.5"

// Read-only. Employment details are the applicant's own entries: a draft until submitted, never verified.
function MemberDetails({ member }: { member: Member }) {
  const app = member.application
  return (
    <div className="flex flex-col gap-5 text-[0.875rem]">
      <div className="flex items-center gap-4">
        {/* 3:4 passport frame; object-cover keeps the photo's proportions */}
        <MemberAvatar
          member={member}
          alt={`Passport photo of ${member.full_name}`}
          className="h-28 w-21 rounded-xl border border-[#E5E7EB] text-[1.5rem]"
        />
        <StatusBadges member={member} />
      </div>

      <Section title="Account details">
        <dl className={DL}>
          <Row label="Email">
            {member.email}
            <span className="block text-[0.8125rem] text-[#5B6472]">
              {member.email_verified ? "Verified" : "Not verified"}
            </span>
          </Row>
          <Row label="Account">
            {member.account_status === "active" ? "Active" : "Disabled"}
          </Row>
          <Row label="Role">
            {member.admin_role ? ROLE_LABELS[member.admin_role] : "Member"}
          </Row>
          <Row label="Registered">{date(member.registered_at)}</Row>
        </dl>
      </Section>

      <Section title="Application status">
        <dl className={DL}>
          <Row label="Stage">{STAGES[member.stage].label}</Row>
          <Row label="Started">{app ? date(app.started_at) : "—"}</Row>
          <Row label="Submitted">
            {app?.submitted_at ? date(app.submitted_at) : "Not yet"}
          </Row>
        </dl>
      </Section>

      <Section title="Employment information">
        {app ? (
          <>
            <p
              className={cn(
                "m-0 rounded-[10px] px-3 py-2 text-[0.8125rem]",
                app.submitted_at
                  ? "bg-[#F3F4F6] text-[#374151]"
                  : "bg-[#FDF4E3] text-[#7A4E0E]"
              )}
            >
              {app.submitted_at
                ? "From the submitted application. Self-reported by the applicant and not yet verified."
                : "Draft: the applicant hasn't submitted it. Details are self-reported and may change."}
            </p>
            <dl className={DL}>
              <Row label="Staff ID">{app.sap_staff_id ?? "—"}</Row>
              <Row label="Business unit">{app.business_unit ?? "—"}</Row>
              <Row label="Department">{app.department ?? "—"}</Row>
              <Row label="Office location">{app.office_location ?? "—"}</Row>
            </dl>
          </>
        ) : (
          <p className="m-0 text-[#5B6472]">
            None yet: the member hasn&apos;t started an application.
          </p>
        )}
      </Section>
    </div>
  )
}
