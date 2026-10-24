import { useEffect, useState } from "react"
import { Menu } from "@base-ui/react/menu"
import { useQuery } from "@tanstack/react-query"
import { CircleCheck, EllipsisVertical, UserPlus, X } from "lucide-react"

import { AdminBanner } from "@/features/admin/admin-layout"
import {
  AdminDialog,
  BX_BTN,
  BX_CARD,
  BX_PRIMARY,
  BX_SEARCH,
  ROLE_LABELS,
  SuperAdminShell,
  initials,
} from "@/features/admin/admin-shell"
import {
  ApiError,
  administratorsQuery,
  apiErrorMessage,
  eligibleAccountsQuery,
  useChangeAdminRole,
  type Administrator,
  type Office,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const OFFICES: Office[] = ["president", "treasurer"]
const other = (office: Office): Office =>
  office === "president" ? "treasurer" : "president"

function changeErrorMessage(error: Error) {
  if (error instanceof ApiError) {
    const code = (error.body as { error?: string } | null)?.error
    if (error.status === 409)
      return "Administrator access changed at the same time elsewhere. Check the updated list and try again."
    if (code === "not_eligible")
      return "This account can't hold an office: it must be active with a verified email."
    if (code === "not_allowed") return "This account can't be managed here."
    if (error.status === 404) return "This account no longer exists."
  }
  return apiErrorMessage(error)
}

// What a change will do, in words, for the confirmation step. `holder` is whoever loses the office.
type Pending = { target: Administrator; role: Office | null }

function consequence({ target, role }: Pending, holder?: Administrator) {
  const lines = [
    role
      ? `${target.full_name} will become ${ROLE_LABELS[role]}.`
      : `${target.full_name} will lose ${ROLE_LABELS[target.admin_role!]} access and return to member access.`,
  ]
  if (role && holder && holder.id !== target.id)
    lines.push(
      `${holder.full_name} currently holds this office and will return to member access.`
    )
  if (role && target.admin_role)
    lines.push(`${ROLE_LABELS[target.admin_role]} will become vacant.`)
  lines.push(
    "Anyone affected is signed out of the admin portal. Membership, savings and loan records are not changed."
  )
  return lines
}

// Appoint, move and revoke the cooperative's President and Treasurer (one holder per office).
export function AdminRolesPage() {
  const admins = useQuery(administratorsQuery)
  const change = useChangeAdminRole()
  const [assigning, setAssigning] = useState<Office | null>(null)
  const [confirming, setConfirming] = useState<Pending | null>(null)
  const [toast, setToast] = useState("")
  const [q, setQ] = useState("")

  const list = admins.data?.administrators ?? []
  const holderOf = (role: Office) => list.find((a) => a.admin_role === role)
  const needle = q.trim().toLowerCase()
  const rows = list.filter(
    (a) => !needle || `${a.full_name} ${a.email}`.toLowerCase().includes(needle)
  )

  const submit = (pending: Pending) =>
    change.mutate(
      { id: pending.target.id, role: pending.role },
      {
        onSuccess: ({ changed }) => {
          setConfirming(null)
          setAssigning(null)
          setToast(
            !changed
              ? "Nothing changed: the account already had this access."
              : pending.role
                ? `${pending.target.full_name} is now ${ROLE_LABELS[pending.role]}.`
                : `${pending.target.full_name} has returned to member access.`
          )
        },
      }
    )
  const openConfirm = (pending: Pending) => {
    change.reset()
    setConfirming(pending)
  }

  return (
    <SuperAdminShell
      active="roles"
      title="Roles & Permissions"
      lead="Appoint the cooperative's executive officers. Every change is recorded in the audit log."
      actions={
        <button
          type="button"
          className={BX_PRIMARY}
          onClick={() => {
            change.reset()
            setAssigning("president")
          }}
        >
          <UserPlus aria-hidden className="size-4" strokeWidth={1.8} />
          Assign role
        </button>
      }
    >
      {toast && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-[#BFE0CB] bg-[#EAF5EE] px-4 py-3 text-[0.875rem] text-[#1E5E3A]"
        >
          <CircleCheck
            aria-hidden
            className="size-[18px] shrink-0"
            strokeWidth={1.8}
          />
          <span className="grow break-words">{toast}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToast("")}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#1E5E3A] hover:bg-[#D7EEDF]"
          >
            <X aria-hidden className="size-4" strokeWidth={2} />
          </button>
        </div>
      )}
      {admins.isError && (
        <div className="flex flex-col items-start gap-3">
          <AdminBanner tone="alert" title="We couldn't load administrators">
            {apiErrorMessage(admins.error)}
          </AdminBanner>
          <button
            type="button"
            className={BX_BTN}
            onClick={() => admins.refetch()}
            disabled={admins.isFetching}
          >
            Try again
          </button>
        </div>
      )}

      <section aria-labelledby="rl-off-h" className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 id="rl-off-h" className="m-0 text-[1.0625rem] font-semibold">
            Executive officers
          </h2>
          <p className="m-0 text-[0.84375rem] text-[#5B6472]">
            One member per office. Reassigning an office returns the previous
            holder to standard member access.
          </p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {OFFICES.map((office) => {
            const holder = holderOf(office)
            return (
              <div
                key={office}
                className={`${BX_CARD} flex min-w-0 flex-col gap-4 p-5`}
              >
                <span className="text-[0.71875rem] font-semibold tracking-[0.16em] text-[#9E1B22]">
                  {ROLE_LABELS[office].toUpperCase()}
                </span>
                <div className="flex items-center gap-3.5">
                  <span
                    aria-hidden
                    className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#F7ECEC] font-admin-display text-lg font-medium text-[#75141A]"
                  >
                    {holder ? initials(holder.full_name) : "–"}
                  </span>
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <span className="font-admin-display text-[1.375rem] leading-[1.1] break-words">
                      {admins.isPending
                        ? "Loading…"
                        : (holder?.full_name ?? "Vacant")}
                    </span>
                    <span className="text-[0.78125rem] break-words text-[#5B6472]">
                      {holder?.email ?? "No one holds this office"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={BX_BTN}
                  disabled={!admins.data}
                  onClick={() => {
                    change.reset()
                    setAssigning(office)
                  }}
                >
                  {holder ? "Reassign" : "Assign"} {ROLE_LABELS[office]}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section
        aria-labelledby="rl-dir-h"
        className={`${BX_CARD} flex min-w-0 flex-col`}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-[#EEF0F3] px-[18px] py-4">
          <h2 id="rl-dir-h" className="m-0 mr-2 text-base font-semibold">
            Administrators
          </h2>
          <div className="max-w-[420px] flex-[1_1_260px]">
            <label htmlFor="rl-search" className="sr-only">
              Search administrators by name or email
            </label>
            <input
              id="rl-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              className={BX_SEARCH}
            />
          </div>
          {admins.data && (
            <span className="ml-auto text-[0.8125rem] text-[#5B6472]">
              {rows.length} of {list.length} administrators
            </span>
          )}
        </div>
        {/* relative: keeps the sr-only header label inside the scroll box on narrow screens */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[0.84375rem]">
            <thead>
              <tr className="bg-[#FAFAFB] text-left text-[0.75rem] tracking-[0.04em] text-[#5B6472]">
                <th
                  scope="col"
                  className="border-b border-[#EEF0F3] px-[18px] py-[11px] font-semibold"
                >
                  ADMINISTRATOR
                </th>
                <th
                  scope="col"
                  className="border-b border-[#EEF0F3] px-3 py-[11px] font-semibold"
                >
                  ROLE
                </th>
                <th
                  scope="col"
                  className="border-b border-[#EEF0F3] px-3 py-[11px] font-semibold"
                >
                  STATUS
                </th>
                <th
                  scope="col"
                  className="border-b border-[#EEF0F3] px-[18px] py-[11px]"
                >
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {admins.isPending && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-[18px] py-12 text-center text-[#5B6472]"
                  >
                    <span role="status">Loading administrators…</span>
                  </td>
                </tr>
              )}
              {admins.data && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-[18px] py-12 text-center text-[#5B6472]"
                  >
                    No administrators match this search.
                  </td>
                </tr>
              )}
              {rows.map((a) => {
                const office =
                  a.admin_role === "super_admin"
                    ? null
                    : (a.admin_role as Office)
                return (
                  <tr key={a.id} className="hover:bg-[#FAFAFB]">
                    <td className="border-b border-[#EEF0F3] px-[18px] py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-full text-[0.78125rem] font-semibold",
                            office
                              ? "bg-[#F7ECEC] text-[#75141A]"
                              : "bg-[#75141A] text-white"
                          )}
                        >
                          {initials(a.full_name)}
                        </span>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-semibold break-words">
                            {a.full_name}
                          </span>
                          <span className="text-[0.78125rem] break-words text-[#5B6472]">
                            {a.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-[#EEF0F3] px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex h-6 items-center rounded-md border px-[9px] text-[0.75rem] font-semibold whitespace-nowrap",
                          office
                            ? "border-[#E2B9BB] bg-white text-[#75141A]"
                            : "border-[#75141A] bg-[#75141A] text-white"
                        )}
                      >
                        {ROLE_LABELS[a.admin_role!]}
                      </span>
                    </td>
                    <td className="border-b border-[#EEF0F3] px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex h-6 items-center gap-1.5 rounded-full px-[9px] text-[0.75rem] font-semibold",
                          a.account_status === "active"
                            ? "bg-[#EAF5EE] text-[#1E5E3A]"
                            : "bg-[#FDECEA] text-[#8F1D14]"
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            a.account_status === "active"
                              ? "bg-[#2E7D4F]"
                              : "bg-[#B42318]"
                          )}
                        />
                        {a.account_status === "active" ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="border-b border-[#EEF0F3] py-1.5 pr-[18px] pl-3 text-right">
                      {office ? (
                        <Menu.Root>
                          <Menu.Trigger
                            aria-label={`Actions for ${a.full_name}`}
                            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-[#5B6472] hover:bg-[#F3F4F6] hover:text-[#1F2937] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22]"
                          >
                            <EllipsisVertical
                              aria-hidden
                              className="size-[18px]"
                            />
                          </Menu.Trigger>
                          <Menu.Portal>
                            <Menu.Positioner
                              align="end"
                              sideOffset={4}
                              className="z-40"
                            >
                              <Menu.Popup className="min-w-[220px] rounded-[14px] border border-[#E5E7EB] bg-white p-1.5 font-admin text-[0.875rem] font-medium text-[#1F2937] shadow-[0_1px_2px_rgba(31,41,55,0.06),0_20px_40px_-12px_rgba(31,41,55,0.28)] outline-none">
                                <Menu.Item
                                  onClick={() =>
                                    openConfirm({
                                      target: a,
                                      role: other(office),
                                    })
                                  }
                                  className="flex min-h-11 cursor-pointer items-center rounded-[9px] px-3 outline-none data-[highlighted]:bg-[#F3F4F6]"
                                >
                                  Change to {ROLE_LABELS[other(office)]}
                                </Menu.Item>
                                <Menu.Item
                                  onClick={() =>
                                    openConfirm({ target: a, role: null })
                                  }
                                  className="flex min-h-11 cursor-pointer items-center rounded-[9px] px-3 text-[#B42318] outline-none data-[highlighted]:bg-[#FEF3F2]"
                                >
                                  Revoke access
                                </Menu.Item>
                              </Menu.Popup>
                            </Menu.Positioner>
                          </Menu.Portal>
                        </Menu.Root>
                      ) : (
                        <span className="text-[0.78125rem] text-[#5B6472]">
                          System account
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {assigning && (
        <AssignDialog
          initialOffice={assigning}
          holderOf={holderOf}
          onClose={() => setAssigning(null)}
          onSubmit={submit}
          pending={change.isPending}
          error={change.error}
        />
      )}

      <AdminDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={
          confirming?.role
            ? `Change to ${ROLE_LABELS[confirming.role]}?`
            : "Revoke admin access?"
        }
      >
        {confirming && (
          <ConfirmBody
            lines={consequence(
              confirming,
              confirming.role ? holderOf(confirming.role) : undefined
            )}
            confirmLabel={
              confirming.role
                ? `Change to ${ROLE_LABELS[confirming.role]}`
                : "Revoke access"
            }
            pending={change.isPending}
            error={change.error}
            onCancel={() => setConfirming(null)}
            onConfirm={() => submit(confirming)}
          />
        )}
      </AdminDialog>
    </SuperAdminShell>
  )
}

function ConfirmBody({
  lines,
  confirmLabel,
  pending,
  error,
  onCancel,
  onConfirm,
  cancelLabel = "Cancel",
}: {
  lines: string[]
  confirmLabel: string
  pending: boolean
  error: Error | null
  onCancel: () => void
  onConfirm: () => void
  cancelLabel?: string
}) {
  return (
    <>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[0.875rem] leading-normal text-[#374151]">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {error && (
        <AdminBanner tone="alert" title="Nothing was changed">
          {changeErrorMessage(error)}
        </AdminBanner>
      )}
      <div className="flex flex-wrap justify-end gap-2.5 pt-1">
        <button
          type="button"
          className={BX_BTN}
          onClick={onCancel}
          disabled={pending}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={BX_PRIMARY}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Saving…" : confirmLabel}
        </button>
      </div>
    </>
  )
}

// The design's assign dialog: choose an office, find an eligible member, then confirm.
function AssignDialog({
  initialOffice,
  holderOf,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  initialOffice: Office
  holderOf: (office: Office) => Administrator | undefined
  onClose: () => void
  onSubmit: (pending: Pending) => void
  pending: boolean
  error: Error | null
}) {
  const [office, setOffice] = useState(initialOffice)
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("")
  const [pick, setPick] = useState<Administrator | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), 250)
    return () => clearTimeout(timer)
  }, [q])
  const accounts = useQuery(eligibleAccountsQuery(term))
  const holder = holderOf(office)

  return (
    <AdminDialog
      open
      onClose={onClose}
      title={
        confirm
          ? `Assign ${ROLE_LABELS[office]}?`
          : `Assign ${ROLE_LABELS[office]}`
      }
      description={
        confirm
          ? undefined
          : holder
            ? `${holder.full_name} currently holds this office and will return to member access.`
            : "This office is vacant."
      }
    >
      {confirm && pick ? (
        <ConfirmBody
          lines={consequence({ target: pick, role: office }, holder)}
          confirmLabel={`Assign as ${ROLE_LABELS[office]}`}
          cancelLabel="Back"
          pending={pending}
          error={error}
          onCancel={() => setConfirm(false)}
          onConfirm={() => onSubmit({ target: pick, role: office })}
        />
      ) : (
        <>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-[0.84375rem] font-medium">
              Office
            </legend>
            <div className="flex gap-2">
              {OFFICES.map((o) => (
                <label
                  key={o}
                  className={cn(
                    "flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-[10px] border text-[0.875rem] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#9E1B22]",
                    o === office
                      ? "border-[#9E1B22] bg-[#FCF6F6] text-[#75141A] shadow-[inset_0_0_0_1px_#9E1B22]"
                      : "border-[#E5E7EB] bg-white hover:border-[#9CA3AF]"
                  )}
                >
                  <input
                    type="radio"
                    name="office"
                    value={o}
                    checked={o === office}
                    onChange={() => setOffice(o)}
                    className="sr-only"
                  />
                  {ROLE_LABELS[o]}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="rl-dlg-q" className="sr-only">
              Search active members
            </label>
            <input
              id="rl-dlg-q"
              type="search"
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPick(null)
              }}
              placeholder="Search active members by name or email"
              className={BX_SEARCH}
            />
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">Eligible members</legend>
            {term.length < 2 && (
              <p className="m-0 p-4 text-center text-[0.875rem] text-[#5B6472]">
                Type at least 2 characters of a name or email.
              </p>
            )}
            {term.length >= 2 && accounts.isPending && (
              <p
                role="status"
                className="m-0 p-4 text-center text-[0.875rem] text-[#5B6472]"
              >
                Searching…
              </p>
            )}
            {accounts.isError && (
              <AdminBanner tone="alert" title="We couldn't search members">
                {apiErrorMessage(accounts.error)}
              </AdminBanner>
            )}
            {accounts.data?.accounts.length === 0 && (
              <p className="m-0 p-4 text-center text-[0.875rem] text-[#5B6472]">
                No active, verified members without a role match “{term}”.
              </p>
            )}
            {accounts.data?.accounts.map((m) => (
              <label
                key={m.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#9E1B22]",
                  pick?.id === m.id
                    ? "border-[#9E1B22] bg-[#FCF6F6] shadow-[inset_0_0_0_1px_#9E1B22]"
                    : "border-[#E5E7EB] bg-white hover:border-[#9CA3AF]"
                )}
              >
                <input
                  type="radio"
                  name="member"
                  checked={pick?.id === m.id}
                  onChange={() => setPick(m)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#EEF0F3] text-[0.78125rem] font-semibold text-[#374151]"
                >
                  {initials(m.full_name)}
                </span>
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="text-[0.875rem] font-semibold break-words">
                    {m.full_name}
                  </span>
                  <span className="text-[0.78125rem] break-words text-[#5B6472]">
                    {m.email}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "size-[18px] shrink-0 rounded-full",
                    pick?.id === m.id
                      ? "border-[5px] border-[#9E1B22]"
                      : "border-[1.5px] border-[#C4C9D1]"
                  )}
                />
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2.5 pt-1">
            <button type="button" className={BX_BTN} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={BX_PRIMARY}
              disabled={!pick}
              onClick={() => setConfirm(true)}
            >
              Continue
            </button>
          </div>
        </>
      )}
    </AdminDialog>
  )
}
