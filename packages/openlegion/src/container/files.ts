import path from "path"
import { AppProcess, type AppProcessError } from "@openlegion-ai/core/process"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { resolveDockerContainerId } from "./resolve"
import { containerCli, type SessionContainer } from "./session"

export class ContainerFileError extends Schema.TaggedErrorClass<ContainerFileError>()("ContainerFileError", {
  message: Schema.String,
}) {}

export type ContainerStat = {
  type: "File" | "Directory"
  size: number
}

export interface Interface {
  readonly stat: (container: SessionContainer, filePath: string) => Effect.Effect<ContainerStat, ContainerFileError>
  readonly listDirectory: (container: SessionContainer, dirPath: string) => Effect.Effect<string[], ContainerFileError>
  readonly readBytes: (container: SessionContainer, filePath: string) => Effect.Effect<Buffer, ContainerFileError>
  readonly readText: (container: SessionContainer, filePath: string) => Effect.Effect<string, ContainerFileError>
  readonly readHead: (
    container: SessionContainer,
    filePath: string,
    size: number,
  ) => Effect.Effect<Uint8Array, ContainerFileError>
  readonly writeText: (
    container: SessionContainer,
    filePath: string,
    content: string,
  ) => Effect.Effect<void, ContainerFileError>
}

export class Service extends Context.Service<Service, Interface>()("@openlegion/ContainerFiles") {}

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/")
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    const exec = Effect.fnUntraced(function* (container: SessionContainer, args: string[], stdin?: string) {
      const bin = containerCli(container.runtime)
      const containerId = yield* resolveDockerContainerId(appProcess, container.id).pipe(
        Effect.mapError((error) => new ContainerFileError({ message: error.message })),
      )
      return yield* appProcess
        .run(ChildProcess.make(bin, ["exec", "-i", containerId, ...args], { stdin: stdin === undefined ? "ignore" : "pipe" }), {
          stdin,
          maxOutputBytes: 64 * 1024 * 1024,
        })
        .pipe(
          Effect.mapError(
            (error: AppProcessError) =>
              new ContainerFileError({
                message: error.stderr?.trim() || error.message || "Container file command failed",
              }),
          ),
        )
    })

    const requireSuccess = (result: AppProcess.RunResult) => {
      if (result.exitCode === 0) return Effect.succeed(result)
      const message = result.stderr.toString("utf8").trim() || `Container command failed (${result.exitCode})`
      return Effect.fail(new ContainerFileError({ message }))
    }

    const stat = Effect.fn("ContainerFiles.stat")(function* (container: SessionContainer, filePath: string) {
      const target = shellQuote(toPosix(filePath))
      const result = yield* exec(
        container,
        ["sh", "-lc", `if test -d ${target}; then printf directory; elif test -f ${target}; then printf file; else exit 1; fi`],
      ).pipe(Effect.flatMap(requireSuccess))

      const kind = result.stdout.toString("utf8").trim()
      if (kind !== "directory" && kind !== "file") {
        return yield* new ContainerFileError({ message: `Unsupported file type for ${filePath}` })
      }

      const sizeResult = yield* exec(container, ["wc", "-c", toPosix(filePath)]).pipe(Effect.flatMap(requireSuccess))
      const size = Number.parseInt(sizeResult.stdout.toString("utf8").trim().split(/\s+/)[0] ?? "0", 10)

      return {
        type: kind === "directory" ? "Directory" : "File",
        size: Number.isFinite(size) ? size : 0,
      } satisfies ContainerStat
    })

    const listDirectory = Effect.fn("ContainerFiles.listDirectory")(function* (
      container: SessionContainer,
      dirPath: string,
    ) {
      const result = yield* exec(container, ["ls", "-1p", toPosix(dirPath)]).pipe(Effect.flatMap(requireSuccess))
      return result.stdout
        .toString("utf8")
        .split("\n")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    })

    const readBytes = Effect.fn("ContainerFiles.readBytes")(function* (container: SessionContainer, filePath: string) {
      const result = yield* exec(container, ["cat", toPosix(filePath)]).pipe(Effect.flatMap(requireSuccess))
      return result.stdout
    })

    const readText = Effect.fn("ContainerFiles.readText")(function* (container: SessionContainer, filePath: string) {
      const bytes = yield* readBytes(container, filePath)
      return bytes.toString("utf8")
    })

    const readHead = Effect.fn("ContainerFiles.readHead")(function* (
      container: SessionContainer,
      filePath: string,
      size: number,
    ) {
      const target = shellQuote(toPosix(filePath))
      const result = yield* exec(container, ["sh", "-lc", `head -c ${size} ${target}`]).pipe(Effect.flatMap(requireSuccess))
      return new Uint8Array(result.stdout)
    })

    const writeText = Effect.fn("ContainerFiles.writeText")(function* (
      container: SessionContainer,
      filePath: string,
      content: string,
    ) {
      const target = toPosix(filePath)
      const parent = path.posix.dirname(target)
      if (parent !== "." && parent !== "/") {
        yield* exec(container, ["mkdir", "-p", parent]).pipe(Effect.flatMap(requireSuccess), Effect.ignore)
      }
      yield* exec(container, ["sh", "-lc", `cat > ${shellQuote(target)}`], content).pipe(
        Effect.flatMap(requireSuccess),
        Effect.ignore,
      )
    })

    return Service.of({ stat, listDirectory, readBytes, readText, readHead, writeText })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppProcess.defaultLayer))

export * as ContainerFiles from "./files"
