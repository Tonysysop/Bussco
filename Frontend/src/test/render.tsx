import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { vi } from "vitest"

export async function renderRoute(pathname: string, state?: unknown) {
  // Fresh modules so the in-memory CSRF token from another test isn't reused.
  vi.resetModules()
  const { routes } = await import("@/routes")
  const router = createMemoryRouter(routes, {
    initialEntries: [{ pathname, state }],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}
