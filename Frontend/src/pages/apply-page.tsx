import { useQuery } from "@tanstack/react-query"
import { CircleAlert, CircleCheck } from "lucide-react"

import { AuthLayout } from "@/components/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ApiError, apiErrorMessage, apiGet } from "@/lib/api"

type Me = { user: { full_name: string; email: string } }

// Placeholder until the membership application increment. Authentication comes from
// the bussco_auth cookie via /me, never from router state.
export function ApplyPage() {
  const me = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet("/api/v1/auth/me") as Promise<Me>,
    // A 401 is an answer, and other failures get a Try again button.
    retry: false,
  })

  const unauthenticated =
    me.error instanceof ApiError && me.error.status === 401

  return (
    <AuthLayout>
      {me.isPending ? (
        <p role="status" className="text-center text-sm text-gray-600">
          Checking your sign-in…
        </p>
      ) : me.isSuccess ? (
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
      ) : unauthenticated ? (
        <div className="text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
            Sign in to continue
          </h1>
          {/* No login page yet; plain text rather than a link to nowhere. */}
          <p className="mt-2 text-sm text-gray-600">
            Sign in with your email and password to start your membership
            application.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{apiErrorMessage(me.error)}</AlertDescription>
          </Alert>
          <Button
            onClick={() => me.refetch()}
            disabled={me.isFetching}
            className="h-12 w-full font-heading text-sm font-semibold"
          >
            Try again
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}
