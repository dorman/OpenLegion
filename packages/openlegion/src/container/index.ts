import { AppProcess } from "@openlegion-ai/core/process"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"

export const Runtime = Schema.Literals(["docker", "podman"])
export type Runtime = typeof Runtime.Type

export const CreateInput = Schema.Struct({
  image: Schema.String,
  name: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  ports: Schema.optional(
    Schema.Array(
      Schema.Struct({
        host: Schema.String,
        container: Schema.String,
      }),
    ),
  ),
  volumes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        host: Schema.String,
        container: Schema.String,
        readOnly: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  command: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "ContainerCreateInput" })
export type CreateInput = typeof CreateInput.Type

export const Info = Schema.Struct({
  id: Schema.String,
  runtime: Runtime,
  image: Schema.String,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "ContainerInfo" })
export type Info = typeof Info.Type

export class RuntimeNotFoundError extends Schema.TaggedErrorClass<RuntimeNotFoundError>()(
  "ContainerRuntimeNotFoundError",
  { message: Schema.String },
) {}

export class RuntimeUnavailableError extends Schema.TaggedErrorClass<RuntimeUnavailableError>()(
  "ContainerRuntimeUnavailableError",
  { message: Schema.String },
) {}

export class CreateFailedError extends Schema.TaggedErrorClass<CreateFailedError>()("ContainerCreateFailedError", {
  message: Schema.String,
}) {}

export type Error = RuntimeNotFoundError | RuntimeUnavailableError | CreateFailedError

type ProcessResult = { code: number; stdout: string; stderr: string }

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openlegion/Container") {}

function normalizeMessage(result: ProcessResult, fallback: string) {
  const stderr = result.stderr.trim()
  if (stderr) return stderr
  const stdout = result.stdout.trim()
  if (stdout) return stdout
  return fallback
}

function buildCreateArgs(input: CreateInput) {
  const name = input.name ? ["--name", input.name] : []
  const env = Object.entries(input.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`])
  const ports = (input.ports ?? []).flatMap((item) => ["--publish", `${item.host}:${item.container}`])
  const volumes = (input.volumes ?? []).flatMap((item) => {
    const suffix = item.readOnly ? ":ro" : ""
    return ["--volume", `${item.host}:${item.container}${suffix}`]
  })
  const command = input.command ?? []
  return ["container", "create", ...name, ...env, ...ports, ...volumes, input.image, ...command]
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    const run = Effect.fnUntraced(
      function* (runtime: Runtime, args: string[]) {
        const result = yield* appProcess.run(
          ChildProcess.make(runtime, args, {
            extendEnv: true,
            stdin: "ignore",
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        } satisfies ProcessResult
      },
      Effect.catch((error) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
        } satisfies ProcessResult),
      ),
    )

    const detectRuntime = Effect.fnUntraced(function* () {
      const docker = yield* run("docker", ["--version"])
      if (docker.code === 0) return "docker" as const
      const podman = yield* run("podman", ["--version"])
      if (podman.code === 0) return "podman" as const
      return yield* new RuntimeNotFoundError({
        message: "Neither docker nor podman is available on PATH",
      })
    })

    const ensureRuntimeAvailable = Effect.fnUntraced(function* (runtime: Runtime) {
      const result = yield* run(runtime, ["info"])
      if (result.code === 0) return
      return yield* new RuntimeUnavailableError({
        message: normalizeMessage(result, `${runtime} runtime is unavailable`),
      })
    })

    const create = Effect.fn("Container.create")(function* (input: CreateInput) {
      const runtime = yield* detectRuntime()
      yield* ensureRuntimeAvailable(runtime)
      const result = yield* run(runtime, buildCreateArgs(input))
      if (result.code !== 0) {
        return yield* new CreateFailedError({
          message: normalizeMessage(result, "Failed to create container"),
        })
      }
      const id = result.stdout
        .split(/\s+/)
        .map((item) => item.trim())
        .find((item) => item.length > 0)
      if (!id) {
        return yield* new CreateFailedError({
          message: "Container runtime returned an empty container id",
        })
      }
      return {
        id,
        runtime,
        image: input.image,
        name: input.name,
      }
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppProcess.defaultLayer))

export * as Container from "."
