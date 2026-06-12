import { expect, test } from "@playwright/test"
import { mockOpenLegionServer } from "../utils/mock-server"

test.describe("smoke: sandboxes onboarding", () => {
  test("shows onboarding on the sandboxes page and can be dismissed", async ({ page }) => {
    await mockOpenLegionServer(page, {
      provider: { all: [] },
      directory: "/tmp/openlegion-e2e",
      project: { id: "proj", name: "E2E", worktree: "/tmp/openlegion-e2e" },
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })

    await page.addInitScript(() => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: {
            newLayoutDesigns: true,
          },
        }),
      )
    })

    await page.route("**/global/containers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      })
    })

    await page.route("**/global/container-workspaces", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      })
    })

    await page.goto("/containers")

    await expect(page.getByRole("heading", { name: /Get started with sandboxes/i })).toBeVisible()
    await page.getByRole("button", { name: /Dismiss/i }).click()
    await expect(page.getByRole("heading", { name: /Get started with sandboxes/i })).toHaveCount(0)
  })
})
