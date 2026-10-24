import { Navigate, type RouteObject } from "react-router"

import { RequireAdmin } from "@/components/admin-layout"
import { AdminHomePage } from "@/pages/admin-home-page"
import { AdminLoginPage } from "@/pages/admin-login-page"
import { AdminPasswordPage } from "@/pages/admin-password-page"
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
      { path: "*", element: <Navigate to="/admin" replace /> },
    ],
  },
]
