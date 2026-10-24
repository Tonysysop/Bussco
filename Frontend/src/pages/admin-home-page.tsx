import { useQuery } from "@tanstack/react-query"
import { KeyRound, LogOut } from "lucide-react"
import { Link } from "react-router"

import {
  ADMIN_CARD,
  ADMIN_SECONDARY_BUTTON,
  AdminBanner,
  AdminIntro,
  AdminLayout,
  useAdminSignOut,
} from "@/components/admin-layout"
import { adminMeQuery, apiErrorMessage, type AdminMe } from "@/lib/api"

const ROLE_LABELS: Record<AdminMe["user"]["admin_role"], string> = {
  super_admin: "Super Admin",
  president: "President",
  treasurer: "Treasurer",
}

// Placeholder landing page behind RequireAdmin until the admin dashboard is built: who is signed in, and
// sign out. The role shown is Rails' answer; it grants nothing here.
export function AdminHomePage() {
  const admin = useQuery(adminMeQuery)
  const logout = useAdminSignOut()

  const user = admin.data?.user
  if (!user) return null

  return (
    <AdminLayout>
      <AdminIntro
        title="Signed in"
        lead="The administrative workspace isn't available yet."
      />

      <section aria-label="Your admin account" className={ADMIN_CARD}>
        {logout.isError && (
          <AdminBanner tone="alert" title="We couldn't sign you out">
            {apiErrorMessage(logout.error)}
          </AdminBanner>
        )}
        <dl className="m-0 flex flex-col gap-3 text-[0.9375rem]">
          {[
            ["Name", user.full_name],
            ["Email", user.email],
            ["Role", ROLE_LABELS[user.admin_role]],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-[0.8125rem] text-[#5B6472]">{label}</dt>
              <dd className="m-0 font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <Link to="/admin/password" className={ADMIN_SECONDARY_BUTTON}>
          <KeyRound aria-hidden className="size-[18px]" strokeWidth={1.8} />
          Change password
        </Link>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={ADMIN_SECONDARY_BUTTON}
        >
          <LogOut aria-hidden className="size-[18px]" strokeWidth={1.8} />
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </AdminLayout>
  )
}
