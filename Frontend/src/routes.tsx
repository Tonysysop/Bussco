import { Navigate, type RouteObject } from "react-router"

import { ApplyPage } from "@/pages/apply-page"
import { SignupPage } from "@/pages/signup-page"
import { VerifyEmailPage } from "@/pages/verify-email-page"

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/signup" replace /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/verify-email", element: <VerifyEmailPage /> },
  { path: "/apply", element: <ApplyPage /> },
]
