import { describe, expect, test } from "bun:test"
import {
  linkedSandboxFromMetadata,
  sessionSandboxFromMetadata,
  SESSION_CONTAINER_KEY,
  SESSION_SANDBOX_KEY,
} from "./container-workspaces"

describe("container-workspaces", () => {
  test("sessionSandboxFromMetadata decodes sandbox metadata", () => {
    expect(
      sessionSandboxFromMetadata({
        [SESSION_SANDBOX_KEY]: {
          id: "vm_123",
          name: "dev-desktop",
          runtime: "microvm",
          kind: "desktop",
        },
      }),
    ).toMatchObject({
      id: "vm_123",
      name: "dev-desktop",
      runtime: "microvm",
      kind: "desktop",
    })
  })

  test("linkedSandboxFromMetadata prefers container sessions", () => {
    expect(
      linkedSandboxFromMetadata({
        [SESSION_CONTAINER_KEY]: {
          id: "ctr_1",
          runtime: "docker",
          hostMount: "/tmp/project",
          containerMount: "/workspace",
        },
        [SESSION_SANDBOX_KEY]: { id: "vm_1" },
      }),
    ).toMatchObject({
      id: "ctr_1",
      mode: "container",
    })
  })

  test("linkedSandboxFromMetadata falls back to sandbox metadata", () => {
    expect(
      linkedSandboxFromMetadata({
        [SESSION_SANDBOX_KEY]: { id: "vm_1", name: "desktop" },
      }),
    ).toMatchObject({
      id: "vm_1",
      label: "desktop",
      mode: "sandbox",
    })
  })
})
