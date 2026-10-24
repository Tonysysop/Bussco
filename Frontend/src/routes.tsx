import { Navigate, type RouteObject } from "react-router"

import { RequireAdmin } from "@/features/admin/admin-layout"
import { RequireSuperAdmin } from "@/features/admin/admin-shell"
import { AdminAuditPage } from "@/features/admin/admin-audit-page"
import { AdminHomePage } from "@/features/admin/admin-home-page"
import { AdminLoginPage } from "@/features/admin/admin-login-page"
import { AdminPasswordPage } from "@/features/admin/admin-password-page"
import { AdminRolesPage } from "@/features/admin/admin-roles-page"
import { ApplyPage } from "@/pages/apply-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { LoginPage } from "@/pages/login-page"
import { ResetCodePage } from "@/pages/reset-code-page"
import { ResetPasswordPage } from "@/pages/reset-password-page"
import { SignupPage } from "@/pages/signup-page"
import { VerifyEmailPage } from "@/pages/verify-email-page"

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/verify-email", element: <VerifyEmailPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-code", element: <ResetCodePage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/apply/:stage?", element: <ApplyPage /> },
  // Admin portal: its own sign-in and session (never the member's). Every /admin page needs an admin.
  { path: "/admin/login", element: <AdminLoginPage /> },
  {
    path: "/admin",
    element: <RequireAdmin />,
    children: [
      { index: true, element: <AdminHomePage /> },
      { path: "password", element: <AdminPasswordPage /> },
      // Super Admin only (other admins go to /admin; Rails refuses them the data anyway).
      {
        element: <RequireSuperAdmin />,
        children: [
          { path: "roles", element: <AdminRolesPage /> },
          { path: "audit", element: <AdminAuditPage /> },
        ],
      },
      { path: "*", element: <Navigate to="/admin" replace /> },
    ],
  },
]
