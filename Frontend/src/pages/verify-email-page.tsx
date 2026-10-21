import { MailCheck } from "lucide-react"
import { useLocation } from "react-router"

import { AuthLayout } from "@/components/auth-layout"

// Placeholder until the email verification increment: confirms registration, no OTP form.
export function VerifyEmailPage() {
  const email = (useLocation().state as { email?: string } | null)?.email

  return (
    <AuthLayout>
      <MailCheck aria-hidden className="mb-4 size-10 text-primary" />
      <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
        Account created
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        We&apos;ve sent a 6-digit verification code to{" "}
        {email ? (
          <strong className="text-gray-900">{email}</strong>
        ) : (
          "your email address"
        )}
        .
      </p>
      <p className="mt-4 text-sm text-gray-600">
        Verifying your email is the next step. Keep the code ready; the
        verification screen is coming soon.
      </p>
    </AuthLayout>
  )
}
