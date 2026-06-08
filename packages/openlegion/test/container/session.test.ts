import { describe, expect, it } from "bun:test"
import {
  containerExecArgs,
  hostPathInContainerMount,
  hostPathToContainerPath,
  sessionContainer,
  SESSION_CONTAINER_KEY,
} from "@/container/session"

describe("container session", () => {
  it("parses session container metadata", () => {
    const metadata = {
      [SESSION_CONTAINER_KEY]: {
        id: "abc123",
        runtime: "docker",
        hostMount: "/Users/dev/project",
        containerMount: "/workspace",
      },
    }

    expect(sessionContainer(metadata)).toEqual({
      id: "abc123",
      runtime: "docker",
      hostMount: "/Users/dev/project",
      containerMount: "/workspace",
    })
  })

  it("checks host paths against the container mount", () => {
    const container = {
      id: "abc123",
      runtime: "docker" as const,
      hostMount: "/Users/dev/project",
      containerMount: "/workspace",
    }

    expect(hostPathInContainerMount("/Users/dev/project/src", container)).toBe(true)
    expect(hostPathInContainerMount("/Users/dev/other", container)).toBe(false)
  })

  it("maps host paths into the container workdir", () => {
    const container = {
      id: "abc123",
      runtime: "docker" as const,
      hostMount: "/Users/dev/project",
      containerMount: "/workspace",
    }

    expect(hostPathToContainerPath("/Users/dev/project", container)).toBe("/workspace")
    expect(hostPathToContainerPath("/Users/dev/project/src", container)).toBe("/workspace/src")
    expect(hostPathToContainerPath("/elsewhere", container)).toBe("/workspace")
  })

  it("builds docker exec arguments for sandbox shell commands", () => {
    const container = {
      id: "abc123",
      runtime: "docker" as const,
      hostMount: "/Users/dev/project",
      containerMount: "/workspace",
    }

    expect(containerExecArgs({ container, containerCwd: "/workspace/src", command: "pwd" })).toEqual({
      bin: "docker",
      args: ["exec", "-w", "/workspace/src", "abc123", "sh", "-lc", "pwd"],
    })
  })
})
