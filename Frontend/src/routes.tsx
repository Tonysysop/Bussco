import { Navigate, type RouteObject } from "react-router"

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
]
