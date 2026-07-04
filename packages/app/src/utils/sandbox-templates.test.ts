import { describe, expect, test } from "bun:test"
import { SANDBOX_TEMPLATES, templateById } from "./sandbox-templates"

describe("sandbox-templates", () => {
  test("leads with RE workflow templates, demotes raw runtimes", () => {
    const featured = SANDBOX_TEMPLATES.filter((item) => !item.advanced).map((item) => item.id)
    expect(featured).toEqual(["detonation", "re-toolkit", "ghidra", "linux-vm"])
    const advanced = SANDBOX_TEMPLATES.filter((item) => item.advanced).map((item) => item.id)
    expect(advanced).toEqual(["docker-custom", "kubernetes"])
  })

  test("detonation template targets Docker and seeds an offline prompt", () => {
    const template = templateById("detonation")
    expect(template?.runtime).toBe("docker")
    expect(template?.prompt.toLowerCase()).toContain("offline")
  })

  test("templateById returns undefined for unknown ids", () => {
    expect(templateById("nope")).toBeUndefined()
  })
})
