import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
} from "lucide-react"
import { Link, Navigate, useSearchParams } from "react-router"
import { z } from "zod"

import {
  ADMIN_CARD,
  ADMIN_INPUT as INPUT,
  ADMIN_LABEL as LABEL,
  ADMIN_PRIMARY_BUTTON,
  AdminBanner,
  AdminFieldMessage as FieldMessage,
  AdminIntro,
  AdminLayout,
  AdminSessionStatus,
  safeAdminPath,
} from "@/features/admin/admin-layout"
import {
  adminMeQuery,
  apiErrorCode,
  apiErrorMessage,
  apiPost,
  ApiError,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { adminLoginSchema } from "@/lib/validation"

type Values = z.input<typeof adminLoginSchema>
type Errors = { email?: string; password?: string }

// Admin sign-in (design-reference admin login). Rails gives one 401 for every rejected sign-in, so the
// page never says which part was wrong. After Rails accepts the password, the page confirms the admin
// session with /admin/auth/me before leaving; if that check can't be made, it retries only the check,
// never the sign-in.
export function AdminLoginPage() {
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const next = safeAdminPath(params.get("next"))
  const admin = useQuery(adminMeQuery)
  const [values, setValues] = useState<Values>({ email: "", password: "" })
  const [errors, setErrors] = useState<Errors>({})
  const [showPassword, setShowPassword] = useState(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  // Caching the confirmed admin redirects below.
  const verify = useMutation({
    mutationFn: () => queryClient.fetchQuery({ ...adminMeQuery, staleTime: 0 }),
  })

  const login = useMutation({
    mutationFn: (body: z.output<typeof adminLoginSchema>) =>
      apiPost("/api/v1/admin/auth/session", body),
    // Rails has set bussco_admin and api.ts has adopted the rotated CSRF token.
    onSuccess: () => verify.mutate(),
    onError: (error) => {
      if (apiErrorCode(error) === "invalid_credentials") {
        setValues((current) => ({ ...current, password: "" }))
        passwordInput.current?.focus()
      }
    },
  })

  // A temporary password must be replaced before any other admin page.
  if (admin.data)
    return (
      <Navigate
        to={admin.data.user.must_change_password ? "/admin/password" : next}
        replace
      />
    )

  if (admin.data === undefined)
    return (
      <AdminLayout>
        <AdminSessionStatus query={admin} />
      </AdminLayout>
    )

  const busy = login.isPending || verify.isPending
  const incorrect =
    !!login.error && apiErrorCode(login.error) === "invalid_credentials"
  const failure =
    login.error && !incorrect
      ? login.error instanceof ApiError && login.error.status === 403
        ? "We couldn't verify this request. Please try again."
        : apiErrorMessage(login.error)
      : verify.data === null
        ? "Your details were accepted, but this browser didn't keep the admin session. Check that cookies are allowed for this site, then try again."
        : null
  const expired =
    params.get("reason") === "expired" && !login.error && !verify.data

  function update(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) => ({ ...current, [field]: undefined }))
    // The banner hides once the user edits a field.
    if (login.error) login.reset()
    if (verify.data === null) verify.reset()
  }

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const result = adminLoginSchema.safeParse(values)
    if (!result.success) {
      const fields = z.flattenError(result.error).fieldErrors
      setErrors({ email: fields.email?.[0], password: fields.password?.[0] })
      ;(fields.email ? emailInput : passwordInput).current?.focus()
      login.reset()
      return
    }
    setErrors({})
    setShowPassword(false)
    verify.reset()
    login.mutate(result.data)
  }

  return (
    <AdminLayout>
      <AdminIntro
        title="Welcome Back"
        lead="Sign in to access your administrative workspace."
        className="min-[1024px]:min-h-[115px] min-[1024px]:w-[484px] min-[1024px]:max-w-none"
      />

      {verify.isError ? (
        // Rails accepted the password but the check of the new session got no answer.
        <div className={ADMIN_CARD}>
          <AdminBanner tone="alert" title="We couldn't confirm your sign-in">
            {apiErrorMessage(verify.error)} Your sign-in may have worked; trying
            again only checks it.
          </AdminBanner>
          <button
            type="button"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className={ADMIN_PRIMARY_BUTTON}
          >
            Try again
          </button>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={handleSubmit}
          aria-busy={busy}
          aria-label="Administrator sign in"
          className={ADMIN_CARD}
        >
          {expired && (
            <AdminBanner tone="notice" title="Your session has expired">
              For your security, please sign in again.
            </AdminBanner>
          )}
          {incorrect && (
            <AdminBanner tone="alert" title="Incorrect email or password">
              Check your details and try again.
            </AdminBanner>
          )}
          {failure && (
            <AdminBanner tone="alert" title="We couldn't sign you in">
              {failure}
            </AdminBanner>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="admin-email" className={LABEL}>
              Corporate Email Address
            </label>
            <input
              ref={emailInput}
              id="admin-email"
              name="email"
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@company.com"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
              readOnly={busy}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "admin-email-error" : undefined}
              className={INPUT}
            />
            {errors.email && (
              <FieldMessage id="admin-email-error">{errors.email}</FieldMessage>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="admin-password" className={LABEL}>
              Password
            </label>
            <div className="relative">
              <input
                ref={passwordInput}
                id="admin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={values.password}
                onChange={(event) => update("password", event.target.value)}
                readOnly={busy}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={
                  errors.password ? "admin-password-error" : undefined
                }
                className={cn(INPUT, "pr-14 tracking-[0.02em]")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="admin-password"
                className="absolute top-[2px] right-[2px] flex size-11 items-center justify-center rounded-lg text-[#5B6472] hover:bg-[#F3F4F6] hover:text-[#1F2937] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#9E1B22]"
              >
                {showPassword ? (
                  <EyeOff aria-hidden className="size-5" strokeWidth={1.7} />
                ) : (
                  <Eye aria-hidden className="size-5" strokeWidth={1.7} />
                )}
              </button>
            </div>
            {errors.password && (
              <FieldMessage id="admin-password-error">
                {errors.password}
              </FieldMessage>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className={ADMIN_PRIMARY_BUTTON}
          >
            {busy ? (
              <>
                <LoaderCircle
                  aria-hidden
                  className="size-[1.125rem] animate-spin motion-reduce:[animation-duration:2.4s]"
                />
                Signing in…
              </>
            ) : (
              <>
                Sign In to Admin Portal
                <ArrowRight
                  aria-hidden
                  className="size-[1.125rem]"
                  strokeWidth={1.8}
                />
              </>
            )}
          </button>
          {/* Announces the pending sign-in; the button's own text change isn't read out. */}
          <p role="status" className="sr-only">
            {busy ? "Signing in…" : ""}
          </p>

          <div className="flex items-start gap-2.5 border-t border-[#EEF0F3] pt-[18px] text-[0.8125rem] leading-[1.45] text-[#5B6472]">
            <Lock
              aria-hidden
              className="mt-px size-4 shrink-0"
              strokeWidth={1.8}
            />
            <span className="min-w-0">
              Restricted access. Authorized administrators only.
            </span>
          </div>
        </form>
      )}

      <Link
        to="/login"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md text-[0.875rem] font-medium text-[#1F2937] underline-offset-4 hover:text-[#75141A] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9E1B22]"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.8} />
        Return to Member Portal
      </Link>
    </AdminLayout>
  )
}
