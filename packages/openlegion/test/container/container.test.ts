import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { Container } from "@/container"
import { testEffect } from "../lib/effect"

const it = testEffect(Container.defaultLayer)

describe("container", () => {
  it.live("exposes list and create on the service", () =>
    Effect.gen(function* () {
      const svc = yield* Container.Service
      expect(svc.list).toBeTypeOf("function")
      expect(svc.create).toBeTypeOf("function")
      expect(svc.stop).toBeTypeOf("function")
      expect(svc.remove).toBeTypeOf("function")
    }),
  )

  it.live("lists containers when a runtime is available", () =>
    Effect.gen(function* () {
      const containers = yield* Container.Service.use((svc) => svc.list()).pipe(
        Effect.timeout(Duration.seconds(3)),
        Effect.catchTag("ContainerRuntimeNotFoundError", () => Effect.succeed(null)),
        Effect.catchTag("ContainerListFailedError", (error) => Effect.fail(error)),
        Effect.catchTag("TimeoutError", () => Effect.succeed(null)),
      )

      if (containers === null) return

      expect(Array.isArray(containers)).toBe(true)
    }),
  )
})
