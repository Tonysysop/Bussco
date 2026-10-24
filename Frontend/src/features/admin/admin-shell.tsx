import { useState, type ReactNode } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { useQuery } from "@tanstack/react-query"
import { ChevronUp, KeyRound, LogOut, X } from "lucide-react"
import { Link, Navigate, Outlet } from "react-router"

import emblem from "@/assets/bussco-emblem.png"
import { useAdminSignOut } from "@/features/admin/admin-layout"
import { adminMeQuery, type AdminMe, type AdminRole } from "@/lib/api"
import { cn } from "@/lib/utils"

// The Super Admin workspace from the approved design (design-reference/bussco-super-admin-portal-design,
// dashboard/*.dc.html). Hiding it from other admins is a convenience: Rails refuses them every endpoint.

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  president: "President",
  treasurer: "Treasurer",
}

export const BX_BTN =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[#D1D5DB] bg-white px-4 text-[0.875rem] font-medium text-[#1F2937] hover:border-[#9CA3AF] hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22] disabled:cursor-not-allowed disabled:opacity-60"
export const BX_PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[#9E1B22] bg-[#9E1B22] px-[18px] text-[0.875rem] font-semibold text-white hover:border-[#75141A] hover:bg-[#75141A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22] disabled:cursor-not-allowed disabled:border-[#D9A3A6] disabled:bg-[#D9A3A6]"
export const BX_SEARCH =
  "h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3.5 text-[0.875rem] text-[#1F2937] placeholder:text-[#8A929E] focus:border-[#9E1B22] focus:shadow-[0_0_0_3px_rgba(158,27,34,0.16)] focus:outline-none"
export const BX_CARD = "rounded-[14px] border border-[#E5E7EB] bg-white"

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

type NavId = "overview" | "members" | "reports" | "roles" | "audit"
// Reports belongs to a later increment: shown, as designed, but not yet usable.
const NAV: { id: NavId; label: string; to?: string; d: [string, string] }[] = [
  {
    id: "overview",
    label: "Overview",
    to: "/admin",
    d: ["M4 13h6V4H4z", "M14 20h6V11h-6zM4 20h6v-3H4zM14 4h6v3h-6z"],
  },
  {
    id: "members",
    label: "Members",
    to: "/admin/members",
    d: [
      "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1",
      "M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
    ],
  },
  {
    id: "reports",
    label: "Reports",
    d: ["M5 20V10M12 20V4M19 20v-7", "M3 20h18"],
  },
  {
    id: "roles",
    label: "Roles & Permissions",
    to: "/admin/roles",
    d: ["M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z", "M9 12l2 2 4-4"],
  },
  {
    id: "audit",
    label: "Audit Log",
    to: "/admin/audit",
    d: ["M12 7v5l3 2", "M3.5 12a8.5 8.5 0 1 0 2.5-6L3 9M3 4v5h5"],
  },
]

const COLLAPSED_KEY = "bussco.sidebarCollapsed"
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function NavIcon({ d, size = 18 }: { d: [string, string]; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d[0]} />
      <path d={d[1]} />
    </svg>
  )
}

function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
      <path d={open ? "M16 10l-2 2 2 2" : "M14 10l2 2-2 2"} />
    </svg>
  )
}

const LINK =
  "flex min-h-11 items-center rounded-[10px] text-[0.875rem] font-medium text-[#374151] no-underline hover:bg-[#F3F4F6] hover:text-[#1F2937] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22]"

// The admin comes from the shell, which checked it: on sign-out the cached admin turns null before the
// shell's redirect, and reading it here would crash that render.
function Sidebar({ active, admin }: { active: NavId; admin: AdminMe["user"] }) {
  const logout = useAdminSignOut()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = () => {
    setCollapsed(!collapsed)
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1")
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex max-w-full flex-col self-start border-r border-[#E5E7EB] bg-white max-[860px]:static max-[860px]:basis-full max-[860px]:self-stretch",
        collapsed ? "flex-[1_1_76px]" : "flex-[1_1_248px]"
      )}
    >
      <nav
        aria-label="Super admin"
        className={cn(
          "flex h-svh min-h-[560px] w-full flex-col gap-6 bg-white max-[860px]:h-auto max-[860px]:min-h-0",
          collapsed ? "px-3 py-6" : "px-4 pt-7 pb-6"
        )}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={emblem}
              alt="BUSSCO"
              className="block h-[33px] w-[30px] object-contain"
            />
            <button
              type="button"
              onClick={toggle}
              aria-label="Expand sidebar"
              aria-expanded="false"
              title="Expand sidebar"
              className="flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-[#5B6472] hover:bg-[#EEF0F3] hover:text-[#1F2937] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22]"
            >
              <PanelIcon open={false} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 pl-2">
            <img
              src={emblem}
              alt=""
              className="block h-[33px] w-[30px] object-contain"
            />
            <div className="flex grow flex-col gap-0.5">
              <span className="font-admin-display text-[1.3125rem] leading-none font-medium tracking-[0.06em] text-[#75141A]">
                BUSSCO
              </span>
              <span className="text-[0.6875rem] font-semibold tracking-[0.14em] text-[#5B6472]">
                SUPER ADMIN
              </span>
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label="Collapse sidebar"
              aria-expanded="true"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-[#5B6472] hover:bg-[#EEF0F3] hover:text-[#1F2937] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22]"
            >
              <PanelIcon open />
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {!collapsed && (
            <p className="m-0 px-3 text-[0.6875rem] font-semibold tracking-[0.14em] text-[#5B6472]">
              WORKSPACE
            </p>
          )}
          <ul
            className={cn(
              "m-0 flex list-none flex-wrap gap-0.5 p-0",
              collapsed && "justify-center"
            )}
          >
            {NAV.map((item) => {
              const current = item.id === active
              const className = cn(
                LINK,
                collapsed ? "size-11 justify-center" : "gap-3 px-3",
                current &&
                  "bg-[#F7ECEC] text-[#75141A] hover:bg-[#F7ECEC] hover:text-[#75141A]"
              )
              const body = (
                <>
                  <NavIcon d={item.d} size={collapsed ? 19 : 18} />
                  {!collapsed && <span className="grow">{item.label}</span>}
                  {!collapsed && !item.to && (
                    <span className="text-[0.6875rem] font-medium text-[#8A929E]">
                      Later
                    </span>
                  )}
                </>
              )
              return (
                <li
                  key={item.id}
                  className={cn(
                    "min-w-0",
                    collapsed ? "flex-[0_0_44px]" : "flex-[1_1_170px]"
                  )}
                >
                  {item.to ? (
                    <Link
                      to={item.to}
                      aria-current={current ? "page" : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
                      className={className}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span
                      role="link"
                      aria-disabled="true"
                      aria-label={`${item.label} (coming in a later release)`}
                      title={`${item.label}: coming in a later release`}
                      className={cn(
                        className,
                        "cursor-not-allowed opacity-55 hover:bg-transparent"
                      )}
                    >
                      {body}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div
          className={cn(
            "mt-auto flex flex-col",
            collapsed ? "items-center" : "items-stretch"
          )}
        >
          <Menu.Root>
            <Menu.Trigger
              aria-label={
                collapsed ? `Account menu for ${admin.full_name}` : undefined
              }
              className={cn(
                "group flex cursor-pointer items-center text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E1B22]",
                collapsed
                  ? "size-11 justify-center rounded-full"
                  : "min-h-16 w-full gap-3 rounded-xl border border-[#EEF0F3] bg-[#F8F9FB] p-3 hover:border-[#E2E4E9] hover:bg-[#F3F4F6] data-[popup-open]:border-[#D9A3A6] data-[popup-open]:bg-white data-[popup-open]:shadow-[0_0_0_3px_rgba(158,27,34,0.10)]"
              )}
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#75141A] text-[0.8125rem] font-semibold text-white"
              >
                {initials(admin.full_name)}
              </span>
              {!collapsed && (
                <>
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="truncate text-[0.84375rem] font-semibold">
                      {admin.full_name}
                    </span>
                    <span className="text-[0.75rem] text-[#5B6472]">
                      Super Administrator
                    </span>
                  </span>
                  <ChevronUp
                    aria-hidden
                    className="size-[18px] shrink-0 text-[#5B6472] transition-transform group-data-[popup-open]:rotate-180 motion-reduce:transition-none"
                    strokeWidth={1.8}
                  />
                </>
              )}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                side={collapsed ? "right" : "top"}
                align={collapsed ? "end" : "center"}
                sideOffset={collapsed ? 12 : 8}
                className="z-40"
              >
                <Menu.Popup
                  aria-label="Account"
                  className={cn(
                    "rounded-[14px] border border-[#E5E7EB] bg-white p-1.5 font-admin text-[#1F2937] shadow-[0_1px_2px_rgba(31,41,55,0.06),0_20px_40px_-12px_rgba(31,41,55,0.28)] outline-none",
                    collapsed ? "w-[224px]" : "w-[var(--anchor-width)]"
                  )}
                >
                  <div className="mb-1 flex flex-col gap-0.5 border-b border-[#F1F2F5] px-3 py-2.5">
                    <span className="text-[0.84375rem] font-semibold">
                      {admin.full_name}
                    </span>
                    <span className="text-[0.75rem] [overflow-wrap:anywhere] text-[#5B6472]">
                      {admin.email}
                    </span>
                  </div>
                  <Menu.LinkItem
                    render={<Link to="/admin/password" />}
                    className="flex min-h-11 items-center gap-3 rounded-[9px] px-3 text-[0.875rem] font-medium text-[#1F2937] no-underline outline-none data-[highlighted]:bg-[#F3F4F6]"
                  >
                    <KeyRound
                      aria-hidden
                      className="size-[17px]"
                      strokeWidth={1.7}
                    />
                    Change password
                  </Menu.LinkItem>
                  <Menu.Item
                    onClick={() => logout.mutate()}
                    disabled={logout.isPending}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[9px] px-3 text-[0.875rem] font-medium text-[#B42318] outline-none data-[highlighted]:bg-[#FEF3F2]"
                  >
                    <LogOut
                      aria-hidden
                      className="size-[17px]"
                      strokeWidth={1.7}
                    />
                    {logout.isPending ? "Logging out…" : "Log out"}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          {logout.isError && (
            <p
              role="alert"
              className="m-0 mt-2 text-[0.8125rem] text-[#B42318]"
            >
              We couldn't log you out. Please try again.
            </p>
          )}
        </div>
      </nav>
    </div>
  )
}

// Guards the Super Admin pages under RequireAdmin: other admins go to /admin before any data is asked for.
export function RequireSuperAdmin() {
  const admin = useQuery(adminMeQuery).data
  if (admin?.user.admin_role !== "super_admin")
    return <Navigate to="/admin" replace />
  return <Outlet />
}

// Sidebar plus the page header every Super Admin screen opens with.
export function SuperAdminShell({
  active,
  title,
  lead,
  actions,
  children,
}: {
  active: NavId
  title: string
  lead: string
  actions?: ReactNode
  children: ReactNode
}) {
  const admin = useQuery(adminMeQuery).data
  if (admin?.user.admin_role !== "super_admin")
    return <Navigate to="/admin" replace />

  return (
    <div className="flex min-h-svh flex-wrap bg-[#F8F9FB] font-admin text-[#1F2937]">
      <Sidebar active={active} admin={admin.user} />
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-[clamp(16px,3vw,40px)] pt-7 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            {/* <p className="m-0 flex items-center gap-2.5 text-[0.71875rem] font-semibold tracking-[0.18em] text-[#9E1B22]">
              <span aria-hidden className="h-px w-6 bg-[#9E1B22]" />
              SUPER ADMIN
            </p> */}
            <h1 className="m-0 font-admin-display text-[2.25rem] leading-[1.05] font-normal tracking-[-0.02em] min-[600px]:text-[2.75rem]">
              {title}
            </h1>
            <p className="m-0 text-[0.9375rem] text-[#4B5563]">{lead}</p>
          </div>
          {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  )
}

// The design's modal: Esc, backdrop click and Close dismiss it; focus stays inside while open.
export function AdminDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(17,24,39,0.42)]" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100svh-32px)] w-[calc(100%-32px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[18px] overflow-auto rounded-[18px] bg-white p-5 font-admin text-[#1F2937] shadow-[0_40px_80px_-24px_rgba(17,24,39,0.45)] outline-none min-[600px]:p-7">
          <div className="flex items-start justify-between gap-3">
            {/* min-w-0 + overflow-wrap: a long unbroken name or email wraps instead of pushing out Close */}
            <div className="flex min-w-0 flex-col gap-1.5 [overflow-wrap:anywhere]">
              <Dialog.Title className="m-0 font-admin-display text-[1.75rem] leading-tight font-normal tracking-[-0.01em]">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="m-0 text-[0.875rem] leading-normal text-[#4B5563]">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className={cn(BX_BTN, "size-10 shrink-0 px-0")}
            >
              <X aria-hidden className="size-4" strokeWidth={2} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
