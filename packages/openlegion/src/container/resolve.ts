import { AppProcess, type AppProcessError } from "@openlegion-ai/core/process"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"

type CliRuntime = "docker" | "podman"

type ProcessResult = { code: number; stdout: string; stderr: string }

export class ContainerResolveError extends Schema.TaggedErrorClass<ContainerResolveError>()("ContainerResolveError", {
  message: Schema.String,
}) {}

function dockerRuntime(): CliRuntime {
  const preferred = process.env.OPENLEGION_DOCKER_RUNTIME?.trim()
  if (preferred === "podman") return "podman"
  return "docker"
}

function normalizeMessage(result: ProcessResult, fallback: string) {
  const stderr = result.stderr.trim()
  if (stderr) return stderr
  const stdout = result.stdout.trim()
  if (stdout) return stdout
  return fallback
}

function run(appProcess: AppProcess.Interface, runtime: CliRuntime, args: string[]) {
  return appProcess
    .run(ChildProcess.make(runtime, args, { extendEnv: true, stdin: "ignore" }))
    .pipe(
      Effect.map(
        (result) =>
          ({
            code: result.exitCode,
            stdout: result.stdout.toString("utf8"),
            stderr: result.stderr.toString("utf8"),
          }) satisfies ProcessResult,
      ),
      Effect.catch((error) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
        } satisfies ProcessResult),
      ),
    )
}

export const resolveDockerContainerId = Effect.fn("Container.resolveDockerContainerId")(function* (
  appProcess: AppProcess.Interface,
  id: string,
) {
  const runtime = dockerRuntime()
  const byLabel = yield* run(appProcess, runtime, [
    "ps",
    "-a",
    "--filter",
    `label=openlegion.sandbox.id=${id}`,
    "--format",
    "{{.ID}}",
  ])
  const labelId = byLabel.stdout
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (labelId) return labelId

  const listed = yield* run(appProcess, runtime, ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}"])
  if (listed.code !== 0) {
    return yield* new ContainerResolveError({
      message: normalizeMessage(listed, "Failed to resolve container id"),
    })
  }

  for (const line of listed.stdout.split("\n")) {
    const [containerId, ...nameParts] = line.split("\t")
    const name = nameParts.join("\t").trim().replace(/^\//, "")
    if (!containerId) continue
    if (containerId === id || containerId.startsWith(id) || id.startsWith(containerId)) return containerId
    if (name === id || name.includes(id) || id.includes(name)) return containerId
  }

  return yield* new ContainerResolveError({ message: `Container ${id} not found` })
})
