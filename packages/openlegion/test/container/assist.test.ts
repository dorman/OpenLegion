import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sandboxSystemPrompt } from "@/container/assist"
import { sessionSandbox, SESSION_SANDBOX_KEY } from "@/container/session"
import type { Container } from "@/container"

const info: Container.Info = {
  id: "sb-123",
  runtime: "microvm",
  image: "ubuntu-desktop",
  name: "testfed",
  status: "running",
  kind: "desktop",
  display: true,
}

function stubContainer(overrides: Partial<Container.Interface> = {}): Container.Interface {
  const unexpected = Effect.die(new Error("unexpected call"))
  return {
    list: () => Effect.succeed([info]),
    create: () => unexpected,
    start: () => unexpected,
    stop: () => unexpected,
    remove: () => unexpected,
    logs: () => Effect.succeed({ logs: "boot ok\nnetwork up" }),
    shell: () => unexpected,
    display: () => unexpected,
    ...overrides,
  }
}

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("container.assist", () => {
  test("includes live state and recent logs", async () => {
    const prompt = await run(sandboxSystemPrompt(stubContainer(), { id: "sb-123" }))

    expect(prompt).toContain("<sandbox-context>")
    expect(prompt).toContain("</sandbox-context>")
    expect(prompt).toContain('sandbox "testfed"')
    expect(prompt).toContain("- status: running")
    expect(prompt).toContain("- image: ubuntu-desktop")
    expect(prompt).toContain("network up")
    expect(prompt).toContain("sandbox_exec")
  })

  test("notes when the sandbox is missing and skips logs", async () => {
    const prompt = await run(
      sandboxSystemPrompt(stubContainer({ list: () => Effect.succeed([]) }), {
        id: "gone",
        name: "old-vm",
        image: "fedora",
      }),
    )

    expect(prompt).toContain("not found")
    expect(prompt).toContain("- image: fedora")
    expect(prompt).not.toContain("Recent logs")
  })

  test("degrades when the runtime is unavailable", async () => {
    const failing = stubContainer({
      list: () => Effect.fail({ _tag: "ContainerListFailedError", message: "daemon down" } as never),
    })
    const prompt = await run(sandboxSystemPrompt(failing, { id: "sb-123" }))

    expect(prompt).toContain("<sandbox-context>")
    expect(prompt).toContain("not found")
  })

  test("sessionSandbox decodes only well-formed metadata", () => {
    expect(sessionSandbox(undefined)).toBeUndefined()
    expect(sessionSandbox({})).toBeUndefined()
    expect(sessionSandbox({ [SESSION_SANDBOX_KEY]: { id: 42 } })).toBeUndefined()
    expect(sessionSandbox({ [SESSION_SANDBOX_KEY]: { id: "sb-123", runtime: "microvm" } })).toEqual({
      id: "sb-123",
      runtime: "microvm",
    })
  })
})
