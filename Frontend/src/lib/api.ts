import {
  QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

// TanStack's default "online" mode pauses requests while the browser reports itself offline, which
// leaves "Saving…" or "Loading…" on screen with no error. Failing instead shows apiErrorMessage's
// "We couldn't reach the server", and the user decides when to retry.
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  })

export class ApiError extends Error {
  status: number
  body: unknown
  retryAfter: number | null

  constructor(response: Response, body: unknown) {
    super(`API request failed with status ${response.status}`)
    this.status = response.status
    this.body = body
    const retryAfter = Number(response.headers.get("Retry-After"))
    this.retryAfter = retryAfter > 0 ? retryAfter : null
  }
}

// Kept in memory only (docs/auth/browser-foundations.md); any token for the current Rails session works.
let csrfToken: Promise<string> | null = null

function fetchCsrfToken() {
  if (!csrfToken) {
    csrfToken = request("/api/v1/csrf").then(
      (body) => (body as { csrf_token: string }).csrf_token
    )
    csrfToken.catch(() => (csrfToken = null))
  }
  return csrfToken
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...init.headers },
  })
  // Rails' `head :accepted` sends Content-Type: application/json with an empty body.
  const text = await response.text()
  const body =
    text && response.headers.get("Content-Type")?.includes("application/json")
      ? JSON.parse(text)
      : null
  if (!response.ok) throw new ApiError(response, body)
  return body
}

export const apiGet = (path: string) => request(path)

export type Me = {
  user: {
    id: number
    full_name: string
    email: string
    email_verified: boolean
    account_status: string
    membership_status: string
  }
}

// GET that resolves to null for the one status meaning "there is none", rather than erroring.
async function getOrNull<T>(path: string, noneStatus: number) {
  try {
    return (await apiGet(path)) as T
  } catch (error) {
    if (error instanceof ApiError && error.status === noneStatus) return null
    throw error
  }
}

// Every cached application lives under this key (see applicationQuery).
const MEMBERSHIP_KEY = ["membership"]

// A 401 means signed out: it resolves to null, replacing any cached user, rather than erroring.
export const meQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async ({ client }) => {
    const me = await getOrNull<Me>("/api/v1/auth/me", 401)
    // Wherever Rails reports the session over, no cached application may outlive it.
    if (!me) client.removeQueries({ queryKey: MEMBERSHIP_KEY })
    return me
  },
  // Other failures get a Try again button.
  retry: false,
})

export const APPLICATION_PATH = "/api/v1/membership/application"

export type EmploymentFields = {
  sap_staff_id: string | null
  business_unit: string | null
  department: string | null
  office_location: string | null
}

export type PersonalFields = {
  primary_phone: string | null
  secondary_phone: string | null
  date_of_birth: string | null
  sex: string | null
  marital_status: string | null
  nationality: string | null
  home_address: string | null
}

export type NextOfKinFields = {
  next_of_kin_name: string | null
  next_of_kin_relationship: string | null
  next_of_kin_phone: string | null
  next_of_kin_address: string | null
}

// Money is integer kobo, as Rails stores it.
export type SavingsFields = {
  monthly_contribution_kobo: number | null
  contribution_start_date: string | null
}

// Only the fields the frontend reads (Backend/docs/membership/application.md).
export type MembershipApplication = {
  application: EmploymentFields &
    PersonalFields &
    NextOfKinFields &
    SavingsFields & {
      passport_photo: {
        content_type: string
        byte_size: number
        checksum: string
      } | null
      submitted_at: string | null
      lock_version: number
    }
  applicant: { full_name: string; email: string; membership_status: string }
  // null once submitted; current_stage is the first incomplete stage, or "review".
  progress: {
    stages: Record<string, "complete" | "incomplete">
    current_stage: string
    ready_to_submit: boolean
    missing: Record<string, string[]>
  } | null
  policy: {
    minimum_monthly_contribution_kobo: number
    registration_fee_kobo: number
    // null when no declaration may be accepted (production without an approved version).
    declaration: { version: string; text: string; approved: boolean } | null
  }
}

type Applicant = Pick<Me["user"], "id" | "email">

// Rails answers for whoever owns the session cookie now, which another tab can change between
// /me and this request. Such an answer is an error, never data: it is not cached or shown.
export class IdentityMismatch extends Error {}

function forApplicant<T extends MembershipApplication | null>(
  data: T,
  { email }: Applicant
) {
  if (data && data.applicant.email !== email)
    throw new IdentityMismatch("Application belongs to a different sign-in")
  return data
}

// A 404 means never started. Keyed by the /me user id: on a shared computer the next person to sign
// in must never be shown the previous person's cached application.
export const applicationQuery = (user: Applicant) =>
  queryOptions({
    queryKey: [...MEMBERSHIP_KEY, "application", user.id],
    queryFn: async () =>
      forApplicant(
        await getOrNull<MembershipApplication>(APPLICATION_PATH, 404),
        user
      ),
    retry: false,
  })

// The saved passport photo, in memory only (never browser storage). Image bytes can't carry the
// applicant's email, so Rails names the owner in X-Applicant-Id: a photo answered for another sign-in
// (switched in another tab mid-request) is an error, never shown. Keyed by checksum, so a replacement
// is a new entry and identical bytes are never fetched twice.
export const passportPhotoQuery = (user: Applicant, checksum: string) =>
  queryOptions({
    queryKey: [...MEMBERSHIP_KEY, "passport_photo", user.id, checksum],
    queryFn: async ({ client }) => {
      const response = await fetch(`${APPLICATION_PATH}/passport_photo`, {
        credentials: "include",
      })
      if (!response.ok) {
        if (response.status === 401) forgetSession(client)
        throw new ApiError(response, null)
      }
      if (response.headers.get("X-Applicant-Id") !== String(user.id)) {
        revalidateIdentity(client)
        throw new IdentityMismatch("Photo belongs to a different sign-in")
      }
      return response.blob()
    },
    staleTime: Infinity,
    retry: false,
  })

// The sign-in changed underneath this tab: ask Rails who is signed in now.
export const revalidateIdentity = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: meQuery.queryKey })

// Asks Rails who is signed in, then for their application; the page follows both answers (a submitted
// application shows the submitted screen, another account its own application).
export async function refetchApplicant(queryClient: QueryClient) {
  const me = await queryClient.fetchQuery(meQuery)
  if (!me) return
  return {
    user: me.user,
    application: await queryClient.fetchQuery(applicationQuery(me.user)),
  }
}

// Signed out without asking /me (an application 401, password reset, later logout): forget the user
// and every cached application, so none of it outlives the session in memory.
export function forgetSession(queryClient: QueryClient) {
  queryClient.setQueryData(meQuery.queryKey, () => null)
  queryClient.removeQueries({ queryKey: MEMBERSHIP_KEY })
}

// FormData goes as multipart, with the boundary the browser sets; anything else as JSON.
async function send(
  method: string,
  path: string,
  data: unknown,
  headers: Record<string, string> = {}
) {
  const form = data instanceof FormData
  try {
    const body = await request(path, {
      method,
      headers: {
        ...(form ? {} : { "Content-Type": "application/json" }),
        "X-CSRF-Token": await fetchCsrfToken(),
        ...headers,
      },
      body: form ? data : JSON.stringify(data),
    })
    // Sign-in resets the Rails session, killing the old token; Rails returns its replacement.
    const rotated = (body as { csrf_token?: unknown } | null)?.csrf_token
    if (typeof rotated === "string") csrfToken = Promise.resolve(rotated)
    return body
  } catch (error) {
    // The Rails session (and with it the token) may have changed; fetch a fresh one next time.
    if (error instanceof ApiError && error.status === 403) csrfToken = null
    throw error
  }
}

export const apiPost = (path: string, data: unknown) => send("POST", path, data)
export const apiPatch = (path: string, data: unknown) =>
  send("PATCH", path, data)

// Every application write names the applicant it is meant for. After a sign-in changes in another
// tab, Rails refuses it (409 identity_mismatch) instead of writing into someone else's application;
// that refusal, like an answer for the wrong applicant, is an IdentityMismatch.
async function writeFor(
  user: Applicant,
  write: (headers: Record<string, string>) => Promise<unknown>
) {
  try {
    const data = await write({ "X-Applicant-Id": String(user.id) })
    return forApplicant(data as MembershipApplication, user)
  } catch (error) {
    if (
      error instanceof ApiError &&
      apiErrorCode(error) === "identity_mismatch"
    )
      throw new IdentityMismatch("Write refused for a different sign-in")
    throw error
  }
}

export const startApplication = (user: Applicant) =>
  writeFor(user, (headers) => send("POST", APPLICATION_PATH, {}, headers))

// One write to the application, sent with the lock_version the form's values were loaded with (never
// a newer cached one, which would overwrite changes the form never saw). Only Rails' answer updates
// the cache.
function useApplicationWrite<Variables>(
  user: Applicant,
  write: (
    variables: Variables,
    headers: Record<string, string>
  ) => Promise<unknown>,
  mutationKey?: readonly unknown[]
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey,
    mutationFn: (variables: Variables) =>
      writeFor(user, (headers) => write(variables, headers)),
    onSuccess: (data) =>
      queryClient.setQueryData(applicationQuery(user).queryKey, () => data),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        forgetSession(queryClient)
      if (error instanceof IdentityMismatch) revalidateIdentity(queryClient)
      // Submitted elsewhere (read-only screen) or gone (Start screen): reload and let the page decide.
      if (
        error instanceof ApiError &&
        (apiErrorCode(error) === "already_submitted" || error.status === 404)
      )
        queryClient.invalidateQueries({
          queryKey: applicationQuery(user).queryKey,
        })
    },
  })
}

export const useSaveStage = (stage: string, user: Applicant) =>
  useApplicationWrite(
    user,
    (
      {
        version,
        fields,
      }: {
        version: number
        fields: Record<string, string | null>
      },
      headers
    ) =>
      send(
        "PATCH",
        `${APPLICATION_PATH}/stages/${stage}`,
        { lock_version: version, application: fields },
        headers
      )
  )

// Per applicant, so the page can tell a submission made in this session (in memory only) from a
// submitted application it merely loaded.
export const submitKey = (user: Applicant) => [
  ...MEMBERSHIP_KEY,
  "submit",
  user.id,
]

// Never retried: an unanswered submission may still have succeeded, so the applicant checks first.
export const useSubmitApplication = (user: Applicant) =>
  useApplicationWrite(
    user,
    (
      { version, declaration }: { version: number; declaration: string },
      headers
    ) =>
      send(
        "POST",
        `${APPLICATION_PATH}/submission`,
        {
          lock_version: version,
          declaration_accepted: true,
          declaration_version: declaration,
        },
        headers
      ),
    submitKey(user)
  )

export const useUploadPhoto = (user: Applicant) =>
  useApplicationWrite(
    user,
    ({ version, photo }: { version: number; photo: File }, headers) => {
      const body = new FormData()
      body.append("photo", photo)
      body.append("lock_version", String(version))
      return send("PUT", `${APPLICATION_PATH}/passport_photo`, body, headers)
    }
  )

export const apiErrorCode = (error: Error) =>
  error instanceof ApiError
    ? (error.body as { error?: string } | null)?.error
    : undefined

// Message for any failure a form can't attribute to a field.
export function apiErrorMessage(error: Error) {
  // fetch rejects with a TypeError only when no response arrived.
  if (error instanceof TypeError)
    return "We couldn't reach the server. Check your connection and try again."
  if (error instanceof IdentityMismatch)
    return "You signed in to a different account in another window. Please try again."
  if (!(error instanceof ApiError))
    return "Something went wrong on our side. Please try again."
  if (error.status === 403) return "Your session expired. Please try again."
  if (error.status === 429) {
    const minutes = Math.ceil((error.retryAfter ?? 900) / 60)
    return `Too many attempts. Try again in ${minutes} minutes.`
  }
  return "Something went wrong on our side. Please try again."
}
