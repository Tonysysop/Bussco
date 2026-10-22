import { useQuery } from "@tanstack/react-query"
import { CircleAlert, CircleCheck } from "lucide-react"
import { Navigate } from "react-router"

import { AuthLayout } from "@/components/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { apiErrorMessage, meQuery } from "@/lib/api"

// Placeholder until the membership application increment. Authentication comes from
// the bussco_auth cookie via /me, never from router state.
export function ApplyPage() {
  const me = useQuery(meQuery)

  // Signed out, logged out elsewhere, or the session expired.
  if (me.data === null) return <Navigate to="/login" replace />

  return (
    <AuthLayout>
      {me.data ? (
        <div className="text-center">
          <CircleCheck
            aria-hidden
            className="mx-auto mb-4 size-10 text-green-700"
          />
          <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
            Welcome, {me.data.user.full_name}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Your email is verified and you&apos;re signed in. Your membership
            application is the next step.
          </p>
        </div>
      ) : me.isError ? (
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{apiErrorMessage(me.error)}</AlertDescription>
          </Alert>
          <Button
            onClick={() => me.refetch()}
            disabled={me.isFetching}
            size="lg"
            className="w-full"
          >
            Try again
          </Button>
        </div>
      ) : (
        <p role="status" className="text-center text-sm text-gray-600">
          Checking your sign-in…
        </p>
      )}
    </AuthLayout>
  )
}
