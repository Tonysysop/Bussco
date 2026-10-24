import { QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { createMemoryRouter, parsePath, RouterProvider } from "react-router"
import { vi } from "vitest"

import { createQueryClient } from "@/lib/api"

// `path` may carry a ?search and #hash, as in the address bar.
export async function renderRoute(path: string, state?: unknown) {
  // Fresh modules so the in-memory CSRF token from another test isn't reused.
  vi.resetModules()
  const { routes } = await import("@/routes")
  const router = createMemoryRouter(routes, {
    initialEntries: [{ ...parsePath(path), state }],
  })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}
