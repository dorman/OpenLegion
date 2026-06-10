import { describe, expect, test } from "bun:test"
import { isAgentCapable, isDesktopWorkload, inspectDefaultTab, workloadKindKey } from "./container-workload"
import type { ContainerInfo } from "./containers"

const container: ContainerInfo = {
  id: "abc123",
  runtime: "microvm",
  image: "alpine:latest",
  kind: "container",
}

const desktop: ContainerInfo = {
  id: "desktop-abc",
  runtime: "microvm",
  image: "ubuntu.iso",
  kind: "desktop",
}

describe("container-workload", () => {
  test("detects desktop workloads", () => {
    expect(isDesktopWorkload(desktop)).toBe(true)
    expect(isDesktopWorkload(container)).toBe(false)
  })

  test("agent capability excludes desktops", () => {
    expect(isAgentCapable(container)).toBe(true)
    expect(isAgentCapable(desktop)).toBe(false)
  })

  test("uses display tab for desktop inspect", () => {
    expect(inspectDefaultTab(desktop)).toBe("display")
    expect(inspectDefaultTab(container)).toBe("logs")
  })

  test("maps workload badge keys", () => {
    expect(workloadKindKey(container)).toBe("containers.badge.container")
    expect(workloadKindKey(desktop)).toBe("containers.badge.desktop")
  })
})
