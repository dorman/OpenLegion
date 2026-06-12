import { describe, expect, test } from "bun:test"
import {
  isAgentCapable,
  isDesktopWorkload,
  isInSandboxAgentCapable,
  inspectDefaultTab,
  workloadKindKey,
  workloadPillClass,
} from "./container-workload"
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

  test("host agent capability includes desktops", () => {
    expect(isAgentCapable(container)).toBe(true)
    expect(isAgentCapable(desktop)).toBe(true)
  })

  test("in-sandbox agent sessions exclude desktops", () => {
    expect(isInSandboxAgentCapable(container)).toBe(true)
    expect(isInSandboxAgentCapable(desktop)).toBe(false)
  })

  test("uses display tab for desktop inspect", () => {
    expect(inspectDefaultTab(desktop)).toBe("display")
    expect(inspectDefaultTab(container)).toBe("logs")
  })

  test("maps workload badge keys", () => {
    expect(workloadKindKey(container)).toBe("containers.badge.container")
    expect(workloadKindKey(desktop)).toBe("containers.badge.desktop")
  })

  test("maps workload pill classes", () => {
    expect(workloadPillClass(container)).toBe("desktop-pill desktop-pill-container")
    expect(workloadPillClass(desktop)).toBe("desktop-pill desktop-pill-desktop")
  })
})
