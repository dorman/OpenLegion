import { describe, expect, test } from "bun:test"
import { classifyProcessExit } from "./process-exit"

describe("classifyProcessExit", () => {
  test("detects external SIGTERM shutdown", () => {
    expect(classifyProcessExit({ reason: "killed", exitCode: 15 })).toBe("external-sigterm")
  })

  test("detects renderer crashes", () => {
    expect(classifyProcessExit({ reason: "crashed", exitCode: 11 })).toBe("crash")
  })

  test("detects OOM exits", () => {
    expect(classifyProcessExit({ reason: "oom" })).toBe("oom")
  })
})
