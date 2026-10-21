import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// jsdom has no layout; input-otp calls this to look for password-manager badges.
document.elementFromPoint ??= () => null
