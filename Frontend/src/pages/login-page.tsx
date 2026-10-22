import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, CircleAlert, Eye, EyeOff, Lock, Mail } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router"
import { z } from "zod"

import { AuthLayout } from "@/components/auth-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ApiError, apiErrorMessage, apiPost, meQuery, type Me } from "@/lib/api"
import { loginSchema, type LoginInput } from "@/lib/validation"

const INTRO = "Keep track of your savings, loan repayments and membership."
// Rails gives one answer for an unknown email, a wrong password and a disabled account.
const INVALID_CREDENTIALS = "Incorrect email or password."

type Errors = { email?: string; password?: string }

const errorCode = (error: Error) =>
  error instanceof ApiError
    ? (error.body as { error?: string } | null)?.error
    : undefined

export function LoginPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery(meQuery)
  const [values, setValues] = useState<LoginInput>({ email: "", password: "" })
  const [errors, setErrors] = useState<Errors>({})
  const [showPassword, setShowPassword] = useState(false)
  const passwordInput = useRef<HTMLInputElement>(null)

  const login = useMutation({
    mutationFn: (body: z.output<typeof loginSchema>) =>
      apiPost("/api/v1/auth/session", body) as Promise<Me>,
    // Rails has set bussco_auth and api.ts has adopted the rotated CSRF token.
    // Caching the user redirects to /apply below.
    onSuccess: ({ user }) =>
      queryClient.setQueryData(meQuery.queryKey, () => ({ user })),
    onError: (error, { email }) => {
      // Rails only says this once the password is right, so it reveals nothing to a guesser.
      if (errorCode(error) === "email_not_verified")
        navigate("/verify-email", { state: { email } })
      if (errorCode(error) === "invalid_credentials") {
        setValues((current) => ({ ...current, password: "" }))
        passwordInput.current?.focus()
      }
    },
  })

  if (me.data) return <Navigate to="/apply" replace />

  // Until /me answers, a network or server failure isn't proof of being signed out.
  if (me.data === undefined)
    return (
      <AuthLayout intro={INTRO}>
        {me.isError ? (
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

  const formError =
    login.error &&
    errorCode(login.error) !== "email_not_verified" &&
    (errorCode(login.error) === "invalid_credentials"
      ? INVALID_CREDENTIALS
      : apiErrorMessage(login.error))

  function update(field: keyof LoginInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (login.isPending) return
    const result = loginSchema.safeParse(values)
    if (!result.success) {
      const fields = z.flattenError(result.error).fieldErrors
      setErrors({ email: fields.email?.[0], password: fields.password?.[0] })
      login.reset()
      return
    }
    setErrors({})
    login.mutate(result.data)
  }

  return (
    <AuthLayout intro={INTRO}>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-gray-900">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Sign in to your cooperative account.
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          {formError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email" className="font-heading font-semibold">
              Work Email Address
            </FieldLabel>
            <InputGroup className="h-12 bg-white">
              <InputGroupAddon>
                <Mail aria-hidden className="size-5 text-gray-400" />
              </InputGroupAddon>
              <InputGroupInput
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@buagroup.com"
                value={values.email}
                onChange={(event) => update("email", event.target.value)}
                aria-invalid={errors.email ? true : undefined}
                aria-required
                aria-describedby={errors.email ? "email-error" : undefined}
                className="h-full"
              />
            </InputGroup>
            <FieldError id="email-error">{errors.email}</FieldError>
          </Field>

          <Field data-invalid={!!errors.password}>
            <div className="flex items-baseline justify-between">
              <FieldLabel
                htmlFor="password"
                className="font-heading font-semibold"
              >
                Password
              </FieldLabel>
              <Link
                to="/forgot-password"
                className="rounded-sm font-heading text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Forgot password?
              </Link>
            </div>
            <InputGroup className="h-12 bg-white">
              <InputGroupAddon>
                <Lock aria-hidden className="size-5 text-gray-400" />
              </InputGroupAddon>
              <InputGroupInput
                ref={passwordInput}
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={values.password}
                onChange={(event) => update("password", event.target.value)}
                aria-invalid={errors.password ? true : undefined}
                aria-required
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
                className="h-full"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  className="size-10"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? (
                    <Eye className="size-5" />
                  ) : (
                    <EyeOff className="size-5" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldError id="password-error">{errors.password}</FieldError>
          </Field>

          <Button
            type="submit"
            disabled={login.isPending}
            size="lg"
            className="w-full"
          >
            {login.isPending ? (
              "Signing in…"
            ) : (
              <>
                Sign In
                <ArrowRight aria-hidden className="size-[18px]" />
              </>
            )}
          </Button>
        </FieldGroup>
      </form>

      <div className="mt-6 border-t border-gray-100 pt-5 text-center text-sm text-gray-600">
        New member?{" "}
        <Link
          to="/signup"
          className="rounded-sm font-heading font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Create an account
        </Link>
      </div>
    </AuthLayout>
  )
}
