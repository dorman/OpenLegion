import { AppProcess } from "@openlegion-ai/core/process"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as MicroVMClient from "./microvm-client"
import { ContainerResolveError, resolveDockerContainerId, resolveRunningDockerContainerId } from "./resolve"
import type * as ContainerSchema from "./schema"

export * from "./schema"

type CreateInput = ContainerSchema.CreateInput
type Info = ContainerSchema.Info
type ListOutput = ContainerSchema.ListOutput
type Runtime = ContainerSchema.Runtime

type CliRuntime = "docker" | "podman"

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

export class ListFailedError extends Schema.TaggedErrorClass<ListFailedError>()("ContainerListFailedError", {
  message: Schema.String,
}) {}

export class StopFailedError extends Schema.TaggedErrorClass<StopFailedError>()("ContainerStopFailedError", {
  message: Schema.String,
}) {}

export class RemoveFailedError extends Schema.TaggedErrorClass<RemoveFailedError>()("ContainerRemoveFailedError", {
  message: Schema.String,
}) {}

export class LogsFailedError extends Schema.TaggedErrorClass<LogsFailedError>()("ContainerLogsFailedError", {
  message: Schema.String,
}) {}

export class ShellFailedError extends Schema.TaggedErrorClass<ShellFailedError>()("ContainerShellFailedError", {
  message: Schema.String,
}) {}

export class DisplayFailedError extends Schema.TaggedErrorClass<DisplayFailedError>()("ContainerDisplayFailedError", {
  message: Schema.String,
}) {}

export class StartFailedError extends Schema.TaggedErrorClass<StartFailedError>()("ContainerStartFailedError", {
  message: Schema.String,
}) {}

export type Error =
  | RuntimeNotFoundError
  | RuntimeUnavailableError
  | CreateFailedError
  | ListFailedError
  | StopFailedError
  | StartFailedError
  | RemoveFailedError
  | LogsFailedError
  | ShellFailedError
  | DisplayFailedError

type ProcessResult = { code: number; stdout: string; stderr: string }

export interface Interface {
  readonly list: () => Effect.Effect<ListOutput, Error>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
  readonly start: (id: string) => Effect.Effect<void, Error>
  readonly stop: (id: string) => Effect.Effect<void, Error>
  readonly remove: (id: string) => Effect.Effect<void, Error>
  readonly logs: (id: string, input?: { tail?: number }) => Effect.Effect<ContainerSchema.LogsOutput, Error>
  readonly shell: (id: string) => Effect.Effect<ContainerSchema.ShellOutput, Error>
  readonly display: (id: string) => Effect.Effect<ContainerSchema.DisplayOutput, Error>
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

const SANDBOX_LABEL_PREFIX = "openlegion.sandbox.id="

function parseSandboxLabel(labels: string) {
  for (const part of labels.split(",")) {
    const trimmed = part.trim()
    if (trimmed.startsWith(SANDBOX_LABEL_PREFIX)) return trimmed.slice(SANDBOX_LABEL_PREFIX.length)
  }
  return undefined
}

function parseSandboxDockerStatus(stdout: string) {
  const map = new Map<string, "running" | "stopped">()
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const data = JSON.parse(trimmed) as { Labels?: unknown; State?: unknown }
      if (typeof data.Labels !== "string") continue
      const sandboxId = parseSandboxLabel(data.Labels)
      if (!sandboxId) continue
      const state = typeof data.State === "string" ? data.State.toLowerCase() : ""
      map.set(sandboxId, state === "running" ? "running" : "stopped")
    } catch {}
  }
  return map
}

function parseListOutput(stdout: string, runtime: CliRuntime) {
  return stdout
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .flatMap((line) => {
      try {
        const data = JSON.parse(line) as { ID?: unknown; Image?: unknown; Names?: unknown; Name?: unknown; State?: unknown }
        if (typeof data.ID !== "string") return []
        if (typeof data.Image !== "string") return []
        const name = typeof data.Names === "string" ? data.Names : typeof data.Name === "string" ? data.Name : undefined
        const state = typeof data.State === "string" ? data.State.toLowerCase() : "running"
        const status = state === "running" ? ("running" as const) : ("stopped" as const)
        return [{ id: data.ID, image: data.Image, runtime, name, status }] satisfies ListOutput
      } catch {
        return []
      }
    })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const microvmClient = yield* MicroVMClient.Service

    const run = Effect.fnUntraced(
      function* (runtime: CliRuntime, args: string[]) {
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
      const preferred = process.env.OPENLEGION_CONTAINER_RUNTIME?.trim().toLowerCase()

      if (preferred === "microvm") {
        if (yield* microvmClient.health()) return "microvm" as const
        return yield* new RuntimeNotFoundError({
          message: "OPENLEGION_CONTAINER_RUNTIME=microvm but the sandbox daemon is unavailable",
        })
      }

      if (preferred === "docker") {
        const docker = yield* run("docker", ["--version"])
        if (docker.code === 0) return "docker" as const
        return yield* new RuntimeNotFoundError({ message: "docker is not available on PATH" })
      }

      if (preferred === "podman") {
        const podman = yield* run("podman", ["--version"])
        if (podman.code === 0) return "podman" as const
        return yield* new RuntimeNotFoundError({ message: "podman is not available on PATH" })
      }

      if (yield* microvmClient.health()) return "microvm" as const

      const docker = yield* run("docker", ["--version"])
      if (docker.code === 0) return "docker" as const
      const podman = yield* run("podman", ["--version"])
      if (podman.code === 0) return "podman" as const
      return yield* new RuntimeNotFoundError({
        message: "Neither the sandbox daemon, docker, nor podman is available",
      })
    })

    const dockerRuntime = (): CliRuntime => {
      const preferred = process.env.OPENLEGION_DOCKER_RUNTIME?.trim()
      if (preferred === "podman") return "podman"
      return "docker"
    }

    const dockerContainerId = Effect.fnUntraced(function* (id: string) {
      return yield* resolveDockerContainerId(appProcess, id).pipe(
        Effect.mapError((error) =>
          new LogsFailedError({
            message: error instanceof ContainerResolveError ? error.message : "Failed to resolve container id",
          }),
        ),
      )
    })

    const dockerRunningContainerId = Effect.fnUntraced(function* (id: string) {
      return yield* resolveRunningDockerContainerId(appProcess, id).pipe(
        Effect.mapError((error) =>
          new ShellFailedError({
            message: error instanceof ContainerResolveError ? error.message : "Failed to resolve container id",
          }),
        ),
      )
    })

    const dockerLogs = Effect.fnUntraced(function* (id: string, tail: number) {
      const runtime = dockerRuntime()
      const containerId = yield* dockerContainerId(id)
      const args = tail > 0 ? ["logs", "--tail", String(tail), containerId] : ["logs", containerId]
      const result = yield* run(runtime, args)
      if (result.code !== 0) {
        return yield* new LogsFailedError({
          message: normalizeMessage(result, "Failed to fetch container logs"),
        })
      }
      return { logs: result.stdout }
    })

    const dockerShell = Effect.fnUntraced(function* (id: string) {
      const runtime = dockerRuntime()
      const containerId = yield* dockerRunningContainerId(id)
      return {
        command: `${runtime} exec -i ${containerId} sh`,
        runtime,
      }
    })

    const ensureRuntimeAvailable = Effect.fnUntraced(function* (runtime: Runtime) {
      if (runtime === "microvm") {
        if (yield* microvmClient.health()) return
        return yield* new RuntimeUnavailableError({
          message: "microvm daemon is unavailable",
        })
      }
      const result = yield* run(runtime, ["info"])
      if (result.code === 0) return
      return yield* new RuntimeUnavailableError({
        message: normalizeMessage(result, `${runtime} runtime is unavailable`),
      })
    })

    const sandboxDockerStatus = Effect.fnUntraced(function* () {
      const result = yield* run(dockerRuntime(), [
        "ps",
        "-a",
        "--filter",
        "label=openlegion.sandbox.id",
        "--format",
        "{{json .}}",
      ])
      if (result.code !== 0) return new Map<string, "running" | "stopped">()
      return parseSandboxDockerStatus(result.stdout)
    })

    const list = Effect.fn("Container.list")(function* () {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        const statusBySandbox = yield* sandboxDockerStatus()
        return yield* microvmClient.list().pipe(
          Effect.map((items) =>
            items.map((item) => ({
              ...item,
              status: statusBySandbox.get(item.id) ?? item.status ?? ("stopped" as const),
            })),
          ),
          Effect.mapError((message) => new ListFailedError({ message })),
        )
      }
      yield* ensureRuntimeAvailable(runtime)
      const result = yield* run(runtime, ["container", "ls", "--all", "--format", "{{json .}}"])
      if (result.code !== 0) {
        return yield* new ListFailedError({
          message: normalizeMessage(result, "Failed to list containers"),
        })
      }
      return parseListOutput(result.stdout, runtime)
    })

    const create = Effect.fn("Container.create")(function* (input: CreateInput) {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        return yield* microvmClient.create(input).pipe(
          Effect.mapError((message) => new CreateFailedError({ message })),
        )
      }
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
      const start = yield* run(runtime, ["start", id])
      if (start.code !== 0) {
        yield* run(runtime, ["rm", "-f", id])
        return yield* new CreateFailedError({
          message: normalizeMessage(start, "Failed to start container"),
        })
      }
      return {
        id,
        runtime,
        image: input.image,
        name: input.name,
      }
    })

    const ensureRunningAfterStart = Effect.fnUntraced(function* (runtime: CliRuntime, containerId: string) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const inspect = yield* run(runtime, ["inspect", "-f", "{{.State.Running}}", containerId])
        if (inspect.code === 0 && inspect.stdout.trim() === "true") return
        yield* Effect.sleep("100 millis")
      }
      return yield* new StartFailedError({
        message:
          "Container exited immediately after start. Recreate it with a long-running command such as sleep 3600.",
      })
    })

    const start = Effect.fn("Container.start")(function* (id: string) {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        return yield* microvmClient.start(id).pipe(
          Effect.mapError((message) => new StartFailedError({ message })),
        )
      }
      yield* ensureRuntimeAvailable(runtime)
      const containerId = id
      const result = yield* run(runtime, ["start", containerId])
      if (result.code !== 0) {
        return yield* new StartFailedError({
          message: normalizeMessage(result, "Failed to start container"),
        })
      }
      yield* ensureRunningAfterStart(runtime, containerId)
    })

    const stop = Effect.fn("Container.stop")(function* (id: string) {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        return yield* microvmClient.stop(id).pipe(Effect.mapError((message) => new StopFailedError({ message })))
      }
      yield* ensureRuntimeAvailable(runtime)
      const result = yield* run(runtime, ["stop", id])
      if (result.code !== 0) {
        return yield* new StopFailedError({
          message: normalizeMessage(result, "Failed to stop container"),
        })
      }
    })

    const remove = Effect.fn("Container.remove")(function* (id: string) {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        return yield* microvmClient.remove(id).pipe(Effect.mapError((message) => new RemoveFailedError({ message })))
      }
      yield* ensureRuntimeAvailable(runtime)
      const result = yield* run(runtime, ["rm", "-f", id])
      if (result.code !== 0) {
        return yield* new RemoveFailedError({
          message: normalizeMessage(result, "Failed to remove container"),
        })
      }
    })

    const logs = Effect.fn("Container.logs")(function* (id: string, input?: { tail?: number }) {
      const runtime = yield* detectRuntime()
      const tail = input?.tail ?? 200
      if (runtime === "microvm") {
        return yield* microvmClient.logs(id, tail).pipe(Effect.catch(() => dockerLogs(id, tail)))
      }
      yield* ensureRuntimeAvailable(runtime)
      const args = tail > 0 ? ["logs", "--tail", String(tail), id] : ["logs", id]
      const result = yield* run(runtime, args)
      if (result.code !== 0) {
        return yield* new LogsFailedError({
          message: normalizeMessage(result, "Failed to fetch container logs"),
        })
      }
      return { logs: result.stdout }
    })

    const shell = Effect.fn("Container.shell")(function* (id: string) {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        return yield* microvmClient.shell(id).pipe(Effect.catch(() => dockerShell(id)))
      }
      yield* ensureRuntimeAvailable(runtime)
      const containerId = yield* dockerRunningContainerId(id)
      return {
        command: `${runtime} exec -i ${containerId} sh`,
        runtime,
      }
    })

    const display = Effect.fn("Container.display")(function* (id: string) {
      const runtime = yield* detectRuntime()
      if (runtime === "microvm") {
        return yield* microvmClient.display(id).pipe(Effect.mapError((message) => new DisplayFailedError({ message })))
      }
      return yield* new DisplayFailedError({
        message: "Display is only available for sandbox daemon workloads",
      })
    })

    return Service.of({ list, create, start, stop, remove, logs, shell, display })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppProcess.defaultLayer), Layer.provide(MicroVMClient.defaultLayer))

export * from "./session"
export * as ContainerFiles from "./files"
export * as ContainerWorkspace from "./workspace"

export * as Container from "."
