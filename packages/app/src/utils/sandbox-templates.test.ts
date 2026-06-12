import { describe, expect, test } from "bun:test"
import { SANDBOX_TEMPLATES, templateById } from "./sandbox-templates"

describe("sandbox-templates", () => {
  test("includes alpine, node, and ubuntu desktop templates", () => {
    expect(SANDBOX_TEMPLATES.map((item) => item.id)).toEqual(["alpine-dev", "node-bind", "ubuntu-desktop"])
  })

  test("ubuntu desktop preset follows host arch", () => {
    const template = templateById("ubuntu-desktop")
    expect(template?.apply("arm64").preset).toBe("ubuntu-2404-arm64")
    expect(template?.apply("x64").preset).toBe("ubuntu-2404-amd64")
  })
})
