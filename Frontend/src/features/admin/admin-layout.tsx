import { useEffect, useState, type ReactNode } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import { CircleAlert, Clock3 } from "lucide-react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router"
// The admin portal's own faces, scoped to these pages (member pages keep Source Sans / Public Sans).
import "@fontsource-variable/instrument-sans"
import "@fontsource-variable/newsreader/opsz.css"

import emblem from "@/assets/bussco-emblem.png"
import emblemMono from "@/assets/bussco-emblem-mono.png"
import {
  adminMeQuery,
  apiDelete,
  apiErrorMessage,
  forgetAdminSession,
} from "@/lib/api"
import { cn } from "@/lib/utils"

// Admin portal shell from the approved design (design-reference admin login, Main.dc.html + tokens.json).
// Four layouts: <360 (320 frame), 360+ (390), 600+ (768), 1024+ (1440). Font sizes are rem so browser
// text scaling applies; layout widths and paddings stay px as designed.
export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-[#F8F9FB] font-admin text-[#1F2937]">
      <img
        src={emblemMono}
        alt=""
        aria-hidden
        className="pointer-events-none absolute top-[-160px] left-[96px] size-[500px] max-w-none object-contain opacity-[0.06] select-none min-[360px]:top-[-200px] min-[360px]:left-[120px] min-[360px]:size-[620px] min-[600px]:top-[520px] min-[600px]:left-[250px] min-[600px]:size-[960px] min-[1024px]:top-[-90px] min-[1024px]:left-[800px] min-[1024px]:size-[1080px]"
      />

      <header className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-[16px] pt-[20px] min-[360px]:px-[20px] min-[360px]:pt-[24px] min-[600px]:px-[48px] min-[600px]:pt-[36px] min-[1024px]:px-[80px] min-[1024px]:pt-[40px]">
        <img
          src={emblem}
          alt=""
          className="block h-[33px] w-[30px] shrink-0 object-contain"
        />
        <span className="font-admin-display text-[1.375rem] font-medium tracking-[0.06em] text-[#75141A]">
          BUSSCO
        </span>
        <span aria-hidden className="h-[18px] w-px shrink-0 bg-[#D1D5DB]" />
        <span className="min-w-0 text-[0.8125rem] tracking-[0.01em] text-[#5B6472]">
          Administrative Portal
        </span>
      </header>

      <main className="relative flex grow flex-col items-stretch justify-start px-[16px] py-[28px] min-[360px]:px-[20px] min-[360px]:pt-[36px] min-[360px]:pb-[32px] min-[600px]:items-center min-[600px]:justify-center min-[600px]:p-[48px] min-[1024px]:items-start min-[1024px]:py-[48px] min-[1024px]:pr-[80px] min-[1024px]:pl-[168px]">
        <div className="flex w-[288px] max-w-full flex-col gap-[22px] min-[360px]:w-[350px] min-[360px]:gap-[24px] min-[600px]:w-[472px] min-[600px]:gap-[28px] min-[1024px]:w-[440px]">
          {children}
        </div>
      </main>

      <footer className="relative px-[16px] pb-[24px] text-[0.75rem] leading-normal text-[#5B6472] min-[360px]:px-[20px] min-[360px]:pb-[28px] min-[600px]:px-[48px] min-[600px]:pb-[36px] min-[1024px]:px-[80px] min-[1024px]:pb-[40px]">
        BUA Senior Staff Multipurpose Cooperative Society
      </footer>
    </div>
  )
}

// Eyebrow, headline and lead that open every admin page.
export function AdminIntro({
  title,
  lead,
  className,
}: {
  title: string
  lead: string
  className?: string
}) {
  return (
    <div className="flex flex-col gap-[14px]">
      <p className="m-0 flex items-center gap-3 text-[0.75rem] font-semibold tracking-[0.18em] text-[#9E1B22]">
        <span aria-hidden className="h-px w-[28px] shrink-0 bg-[#9E1B22]" />
        <span className="min-w-0 break-words">BUSSCO ADMINISTRATION</span>
      </p>
      <h1
        className={cn(
          "m-0 font-admin-display text-[2.5rem] leading-[1.02] font-normal tracking-[-0.025em] break-words min-[360px]:text-[3rem] min-[600px]:text-[4rem] min-[1024px]:text-[4.5rem]",
          className
        )}
      >
        {title}
      </h1>
      <p className="m-0 text-[0.9375rem] leading-[1.55] text-[#4B5563] min-[360px]:text-base min-[600px]:text-[1.0625rem]">
        {lead}
      </p>
    </div>
  )
}

export const ADMIN_CARD =
  "flex flex-col gap-5 rounded-2xl border border-[#E5E7EB] bg-white p-[20px] shadow-[0_1px_2px_rgba(31,41,55,0.04),0_24px_48px_-24px_rgba(31,41,55,0.18)] min-[360px]:p-[24px] min-[600px]:p-[36px]"

export const ADMIN_PRIMARY_BUTTON =
  "mt-1 flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#9E1B22] px-4 py-2 text-[0.9375rem] font-semibold tracking-[0.01em] text-white transition-colors hover:bg-[#75141A] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#75141A] disabled:cursor-progress disabled:bg-[#75141A]"

export const ADMIN_SECONDARY_BUTTON =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[#D1D5DB] bg-white px-4 py-2 text-[0.9375rem] font-semibold text-[#1F2937] transition-colors hover:border-[#9CA3AF] hover:bg-[#F3F4F6] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#9E1B22] disabled:cursor-progress disabled:opacity-70"

// The design's form controls (design-reference admin login, Main.dc.html).
export const ADMIN_INPUT =
  "min-h-12 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3.5 py-2.5 text-[0.9375rem] text-[#1F2937] transition-[border-color,box-shadow] placeholder:text-[#8A929E] hover:border-[#9CA3AF] focus:border-[#9E1B22] focus:shadow-[0_0_0_3px_rgba(158,27,34,0.16)] focus:outline-none read-only:bg-[#F9FAFB] read-only:text-[#6B7280] aria-invalid:border-[#B42318] aria-invalid:bg-[#FFFBFA] aria-invalid:focus:shadow-[0_0_0_3px_rgba(180,35,24,0.16)]"
export const ADMIN_LABEL = "text-[0.84375rem] font-medium text-[#1F2937]"

export function AdminFieldMessage({
  id,
  children,
}: {
  id: string
  children: string
}) {
  return (
    <p
      id={id}
      className="m-0 flex items-center gap-1.5 text-[0.8125rem] leading-[1.4] text-[#B42318]"
    >
      <CircleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

// Signs the admin out of Rails, then forgets every cached admin answer. Leaves first, so the guard never
// reads the cleared session as an expired one. The member's sign-in and cache are untouched; Rails keeps
// the two sessions apart.
export function useAdminSignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => apiDelete("/api/v1/admin/auth/session"),
    onSuccess: async () => {
      await navigate("/admin/login", { replace: true })
      forgetAdminSession(queryClient)
    },
  })
}

// The design's two banners: an alert (failure) and a notice (session expired).
export function AdminBanner({
  tone,
  title,
  children,
}: {
  tone: "alert" | "notice"
  title: string
  children: ReactNode
}) {
  const Icon = tone === "alert" ? CircleAlert : Clock3
  return (
    <div
      role={tone === "alert" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-4 py-3.5 text-[0.84375rem] leading-normal",
        tone === "alert"
          ? "border-[#FECDCA] bg-[#FEF3F2] text-[#7A271A]"
          : "border-[#E4DCCB] bg-[#F6F4EF] text-[#4A3F2A]"
      )}
    >
      <Icon
        aria-hidden
        className="mt-px size-[18px] shrink-0"
        strokeWidth={1.8}
      />
      <div className="min-w-0 break-words">
        <strong className="block font-semibold">{title}</strong>
        {children}
      </div>
    </div>
  )
}

// Only internal admin pages may be returned to after sign-in; anything else (another origin, a member
// page, the login page itself) falls back to /admin. URL parsing normalizes "..", "\" and encodings.
export function safeAdminPath(next: string | null) {
  if (next) {
    try {
      const url = new URL(next, window.location.origin)
      if (
        url.origin === window.location.origin &&
        /^\/admin(\/|$)/.test(url.pathname) &&
        !url.pathname.startsWith("/admin/login")
      )
        return url.pathname + url.search + url.hash
    } catch {
      // Not a URL: fall through.
    }
  }
  return "/admin"
}

// Guards /admin/*. A convenience only: Rails authorizes every admin request. Rails is re-asked on each
// route change (and on focus) once the 30 s cached answer is stale; a known admin turning into "no
// session" means it expired or was revoked, so the login page says so.
export function RequireAdmin() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const admin = useQuery(adminMeQuery)
  const [hadAdmin, setHadAdmin] = useState(false)
  if (admin.data && !hadAdmin) setHadAdmin(true)

  useEffect(() => {
    queryClient.prefetchQuery(adminMeQuery)
  }, [queryClient, location.pathname])

  if (admin.data) {
    // A temporary password opens only the password page (Rails refuses everything else anyway).
    if (
      admin.data.user.must_change_password &&
      location.pathname !== "/admin/password"
    )
      return <Navigate to="/admin/password" replace />
    return <Outlet />
  }

  if (admin.data === null) {
    const params = new URLSearchParams()
    const here = location.pathname + location.search + location.hash
    if (here !== "/admin") params.set("next", here)
    if (hadAdmin) params.set("reason", "expired")
    const query = params.toString()
    return <Navigate to={`/admin/login${query ? `?${query}` : ""}`} replace />
  }

  return (
    <AdminLayout>
      <AdminSessionStatus query={admin} />
    </AdminLayout>
  )
}

// While the admin sign-in is checked: a status line, or the failure with Try again.
export function AdminSessionStatus({ query }: { query: UseQueryResult }) {
  return query.isError ? (
    <div className={ADMIN_CARD}>
      <AdminBanner tone="alert" title="We couldn't check your sign-in">
        {apiErrorMessage(query.error)}
      </AdminBanner>
      <button
        type="button"
        onClick={() => query.refetch()}
        disabled={query.isFetching}
        className={ADMIN_PRIMARY_BUTTON}
      >
        Try again
      </button>
    </div>
  ) : (
    <p role="status" className="text-[0.9375rem] text-[#4B5563]">
      Checking your sign-in…
    </p>
  )
}
