import { describe, expect, test } from "bun:test"
import { Permission } from "@/permission"
import { PermissionPresetID, permissionPreset, ruleset } from "@/permission/preset"

describe("permission.preset", () => {
  test("strict preset asks before network, shell, and sandbox changes", () => {
    const preset = permissionPreset(PermissionPresetID.strict)
    expect(preset.label).toBe("Strict")
    expect(preset.permission.webfetch).toBe("ask")
    expect(preset.permission.bash).toBe("ask")
    expect(preset.permission.sandbox).toMatchObject({ "create *": "ask", "stop *": "ask" })
  })

  test("dev preset allows routine network and shell work", () => {
    const preset = permissionPreset(PermissionPresetID.dev)
    expect(preset.permission.webfetch).toBe("allow")
    expect(preset.permission.bash).toBe("allow")
    expect(preset.permission.sandbox).toMatchObject({ "exec *": "allow", "delete *": "ask" })
  })

  test("ruleset converts preset config into permission rules", () => {
    const rules = ruleset(PermissionPresetID.strict)
    expect(Permission.evaluate("webfetch", "*", rules).action).toBe("ask")
    expect(Permission.evaluate("sandbox", "create alpine:latest", rules).action).toBe("ask")
  })
})
