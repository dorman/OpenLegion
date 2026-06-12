import { describe, expect, test } from "bun:test"
import { warningsForCreateInput, warningsForVolumeHost } from "./sandbox-config-warnings"

describe("sandbox-config-warnings", () => {
  test("flags /etc bind mounts", () => {
    expect(warningsForVolumeHost("/etc/passwd").map((item) => item.id)).toContain("etcPath")
  })

  test("flags /var bind mounts", () => {
    expect(warningsForVolumeHost("/var/lib/docker").map((item) => item.id)).toContain("varPath")
  })

  test("flags home root binds", () => {
    expect(warningsForVolumeHost("/Users/alice").map((item) => item.id)).toContain("homeRootBind")
    expect(warningsForVolumeHost("~").map((item) => item.id)).toContain("homeRootBind")
  })

  test("flags privileged workloads", () => {
    expect(warningsForCreateInput({ privileged: true }).map((item) => item.id)).toContain("privileged")
  })

  test("ignores normal project paths", () => {
    expect(warningsForVolumeHost("/Users/alice/projects/demo")).toEqual([])
  })
})
