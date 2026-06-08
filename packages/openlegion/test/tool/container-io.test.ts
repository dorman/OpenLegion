import { describe, expect, it } from "bun:test"
import { containerPermissionMetadata, hostPathInContainerMount, toContainerPath } from "@/tool/container-io"

const container = {
  id: "abc123",
  runtime: "docker" as const,
  hostMount: "/Users/dev/project",
  containerMount: "/workspace",
}

describe("container-io", () => {
  it("maps host paths into container paths", () => {
    expect(toContainerPath("/Users/dev/project/src/main.ts", container)).toBe("/workspace/src/main.ts")
  })

  it("checks whether a host path is inside the container mount", () => {
    expect(hostPathInContainerMount("/Users/dev/project/src", container)).toBe(true)
    expect(hostPathInContainerMount("/Users/dev/other", container)).toBe(false)
  })

  it("adds container metadata to permission prompts", () => {
    expect(containerPermissionMetadata(container)).toEqual({
      containerId: "abc123",
      containerRuntime: "docker",
    })
    expect(containerPermissionMetadata()).toEqual({})
  })
})
