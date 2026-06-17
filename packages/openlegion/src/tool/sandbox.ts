import { AppProcess } from "@openlegion-ai/core/process"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Container } from "@/container"
import { captureCdpScreenshot, performCdpActions } from "@/container/cdp"
import { captureVncScreenshot, performVncActions, type VncInputAction } from "@/container/vnc"
import * as Tool from "./tool"

const MAX_EXEC_OUTPUT_BYTES = 256 * 1024
const DEFAULT_EXEC_TIMEOUT_SECONDS = 60
const MAX_EXEC_TIMEOUT_SECONDS = 600

const PERMISSION = "sandbox"

const SandboxID = Schema.String.annotate({
  description: "The sandbox id, as returned by sandbox_list or sandbox_create",
})

const IdParameters = Schema.Struct({ id: SandboxID })
type IdParameters = typeof IdParameters.Type

const LogsParameters = Schema.Struct({
  id: SandboxID,
  tail: Schema.optional(Schema.Number).annotate({
    description: "Number of trailing log lines to return (default 200)",
  }),
})
type LogsParameters = typeof LogsParameters.Type

const InputAction = Schema.Struct({
  action: Schema.Literals(["type", "key", "click", "double_click", "move", "scroll", "wait"]).annotate({
    description: "The kind of input to send",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: 'Text to type, for action "type". Newlines press Enter.',
  }),
  key: Schema.optional(Schema.String).annotate({
    description:
      'Key or combo to press, for action "key". Single characters, named keys (enter, esc, tab, backspace, delete, arrows, home, end, pageup, pagedown, f1-f12), or modifier combos like "ctrl+c" or "ctrl+alt+t".',
  }),
  x: Schema.optional(Schema.Number).annotate({
    description: "Pointer x coordinate in screen pixels, for click, double_click, move, and scroll",
  }),
  y: Schema.optional(Schema.Number).annotate({
    description: "Pointer y coordinate in screen pixels, for click, double_click, move, and scroll",
  }),
  button: Schema.optional(Schema.Literals(["left", "middle", "right"])).annotate({
    description: "Mouse button for click and double_click (default left)",
  }),
  direction: Schema.optional(Schema.Literals(["up", "down"])).annotate({
    description: 'Scroll direction, for action "scroll"',
  }),
  amount: Schema.optional(Schema.Number).annotate({
    description: "Number of scroll ticks (default 3, max 10)",
  }),
  ms: Schema.optional(Schema.Number).annotate({
    description: 'Milliseconds to pause, for action "wait" (max 10000)',
  }),
})
type InputAction = typeof InputAction.Type

const InputParameters = Schema.Struct({
  id: SandboxID,
  actions: Schema.Array(InputAction).annotate({
    description: "The input actions to perform, in order, over a single connection to the display",
  }),
})
type InputParameters = typeof InputParameters.Type

const ExecParameters = Schema.Struct({
  id: SandboxID,
  command: Schema.String.annotate({ description: "The shell command to run inside the sandbox" }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Optional timeout in seconds (default 60, max 600)",
  }),
})
type ExecParameters = typeof ExecParameters.Type

function describe(info: Container.Info) {
  return {
    id: info.id,
    name: info.name,
    image: info.image,
    runtime: info.runtime,
    status: info.status ?? "unknown",
    kind: info.kind ?? "container",
    display: info.display ?? false,
  }
}

function sandboxError(error: unknown): Effect.Effect<Tool.ExecuteResult> {
  const message = error instanceof Error ? error.message : String(error)
  return Effect.succeed({
    title: "Sandbox error",
    output: `Error: ${message}`,
    metadata: { error: true },
  })
}

export const SandboxListTool = Tool.define(
  "sandbox_list",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description:
        "List the sandboxes (containers and desktop VMs) managed by the local runtime. Returns each sandbox's id, name, image, runtime (docker, podman, or microvm), status, and workload kind. Use this before operating on a sandbox to find its id.",
      parameters: Schema.Struct({}),
      execute: () =>
        Effect.gen(function* () {
          const items = yield* container.list()
          if (items.length === 0) {
            return {
              title: "No sandboxes",
              output: "No sandboxes found.",
              metadata: { count: 0 },
            }
          }
          return {
            title: `${items.length} sandbox${items.length === 1 ? "" : "es"}`,
            output: JSON.stringify(items.map(describe), null, 2),
            metadata: { count: items.length },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxCreateTool = Tool.define(
  "sandbox_create",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description:
        'Create and start a new sandbox. Set kind to "desktop" for a VM with a graphical desktop (microvm runtime), or omit it for a regular container. Container workloads need a long-running command (for example sleep 3600) or they exit immediately. Returns the new sandbox\'s id.',
      parameters: Container.CreateInput,
      execute: (params: Container.CreateInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: PERMISSION,
            patterns: [`create ${params.image}`],
            always: ["create *"],
            metadata: { ...params },
          })
          const info = yield* container.create(params)
          return {
            title: `Created ${info.name ?? info.id}`,
            output: JSON.stringify(describe(info), null, 2),
            metadata: { containerId: info.id, containerRuntime: info.runtime },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxStartTool = Tool.define(
  "sandbox_start",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description: "Start a stopped sandbox.",
      parameters: IdParameters,
      execute: (params: IdParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: PERMISSION,
            patterns: [`start ${params.id}`],
            always: ["start *"],
            metadata: { containerId: params.id },
          })
          yield* container.start(params.id)
          return {
            title: `Started ${params.id}`,
            output: `Sandbox ${params.id} started.`,
            metadata: { containerId: params.id },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxStopTool = Tool.define(
  "sandbox_stop",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description: "Stop a running sandbox. The sandbox can be started again later with sandbox_start.",
      parameters: IdParameters,
      execute: (params: IdParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: PERMISSION,
            patterns: [`stop ${params.id}`],
            always: ["stop *"],
            metadata: { containerId: params.id },
          })
          yield* container.stop(params.id)
          return {
            title: `Stopped ${params.id}`,
            output: `Sandbox ${params.id} stopped.`,
            metadata: { containerId: params.id },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxDeleteTool = Tool.define(
  "sandbox_delete",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description:
        "Permanently delete a sandbox and its state. This cannot be undone, so confirm with the user before deleting anything you did not create in this conversation.",
      parameters: IdParameters,
      execute: (params: IdParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: PERMISSION,
            patterns: [`delete ${params.id}`],
            always: [`delete ${params.id}`],
            metadata: { containerId: params.id },
          })
          yield* container.remove(params.id)
          return {
            title: `Deleted ${params.id}`,
            output: `Sandbox ${params.id} deleted.`,
            metadata: { containerId: params.id },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxInspectTool = Tool.define(
  "sandbox_inspect",
  Effect.gen(function* () {
    const container = yield* Container.Service
    const appProcess = yield* AppProcess.Service

    return {
      description:
        "Return a sandbox's configuration and state in structured form. For docker/podman sandboxes this includes the full runtime inspect output (network settings, mounts, ports, restart state, exit codes). Prefer this over sandbox_exec for questions about how a sandbox is configured.",
      parameters: IdParameters,
      execute: (params: IdParameters) =>
        Effect.gen(function* () {
          const items = yield* container.list()
          const info = items.find((item) => item.id === params.id || item.name === params.id)
          if (!info) {
            return {
              title: `Sandbox ${params.id} not found`,
              output: `No sandbox found with id or name "${params.id}". Use sandbox_list to see available sandboxes.`,
              metadata: { containerId: params.id, found: false },
            }
          }

          const summary = describe(info)

          if (info.runtime === "docker" || info.runtime === "podman") {
            const result = yield* appProcess
              .run(
                ChildProcess.make(info.runtime, ["inspect", info.id], { extendEnv: true, stdin: "ignore" }),
                { maxOutputBytes: MAX_EXEC_OUTPUT_BYTES },
              )
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (result && result.exitCode === 0) {
              return {
                title: `Inspect ${summary.name ?? summary.id}`,
                output: `${JSON.stringify(summary, null, 2)}\n\nRuntime inspect output:\n${result.stdout.toString("utf8").trim()}`,
                metadata: { containerId: info.id, containerRuntime: info.runtime },
              }
            }
          }

          // microvm workloads keep their detailed config in the sandbox
          // daemon; report the structured summary the runtime exposes.
          return {
            title: `Inspect ${summary.name ?? summary.id}`,
            output: JSON.stringify(summary, null, 2),
            metadata: { containerId: info.id, containerRuntime: info.runtime },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxLogsTool = Tool.define(
  "sandbox_logs",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description:
        "Fetch recent logs from a sandbox (container stdout/stderr, or boot/console logs for desktop VMs). Useful for diagnosing sandboxes that fail to start or misbehave.",
      parameters: LogsParameters,
      execute: (params: LogsParameters) =>
        Effect.gen(function* () {
          const result = yield* container.logs(params.id, { tail: params.tail ?? 200 })
          return {
            title: `Logs for ${params.id}`,
            output: result.logs.length > 0 ? result.logs : "(no log output)",
            metadata: { containerId: params.id },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxScreenshotTool = Tool.define(
  "sandbox_screenshot",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description:
        "Capture a screenshot of a display-capable sandbox's screen and attach it as an image. Works for any sandbox that reports a display — a VNC desktop VM or a CDP browser. Use this to see what is currently shown — login prompts, installers, error dialogs, the loaded web page, or whether the desktop booted at all.",
      parameters: IdParameters,
      execute: (params: IdParameters) =>
        Effect.gen(function* () {
          const display = yield* container.display(params.id)
          const shot = yield* Effect.tryPromise({
            try: () =>
              display.kind === "cdp"
                ? captureCdpScreenshot({ url: display.url })
                : captureVncScreenshot({ url: display.url, password: display.password }),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          })
          return {
            title: `Screenshot ${shot.width}x${shot.height}`,
            output: `Captured a ${shot.width}x${shot.height} screenshot of the sandbox display (attached).`,
            metadata: { containerId: params.id, width: shot.width, height: shot.height },
            attachments: [
              {
                type: "file" as const,
                mime: "image/png",
                url: `data:image/png;base64,${shot.png.toString("base64")}`,
              },
            ],
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

/** Validate the flat action structs and narrow them to discriminated VNC actions. */
function parseInputActions(items: readonly InputAction[]): VncInputAction[] | { invalid: string } {
  if (items.length === 0) return { invalid: "actions must not be empty" }
  const actions: VncInputAction[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const at = `actions[${i}] (${item.action})`
    switch (item.action) {
      case "type": {
        if (item.text === undefined || item.text === "") return { invalid: `${at} requires "text"` }
        actions.push({ action: "type", text: item.text })
        break
      }
      case "key": {
        if (item.key === undefined || item.key.trim() === "") return { invalid: `${at} requires "key"` }
        actions.push({ action: "key", key: item.key })
        break
      }
      case "click":
      case "double_click":
      case "move":
      case "scroll": {
        if (item.x === undefined || item.y === undefined || !Number.isFinite(item.x) || !Number.isFinite(item.y)) {
          return { invalid: `${at} requires numeric "x" and "y"` }
        }
        if (item.action === "scroll") {
          if (item.direction === undefined) return { invalid: `${at} requires "direction"` }
          actions.push({ action: "scroll", x: item.x, y: item.y, direction: item.direction, amount: item.amount })
        } else if (item.action === "move") {
          actions.push({ action: "move", x: item.x, y: item.y })
        } else {
          actions.push({ action: item.action, x: item.x, y: item.y, button: item.button })
        }
        break
      }
      case "wait": {
        if (item.ms === undefined || !Number.isFinite(item.ms) || item.ms <= 0) {
          return { invalid: `${at} requires a positive "ms"` }
        }
        actions.push({ action: "wait", ms: item.ms })
        break
      }
    }
  }
  return actions
}

function describeInputAction(action: VncInputAction) {
  switch (action.action) {
    case "type":
      return `type ${JSON.stringify(action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text)}`
    case "key":
      return `key ${action.key}`
    case "click":
    case "double_click":
      return `${action.action.replace("_", " ")} ${action.button ?? "left"} at ${action.x},${action.y}`
    case "move":
      return `move to ${action.x},${action.y}`
    case "scroll":
      return `scroll ${action.direction} at ${action.x},${action.y}`
    case "wait":
      return `wait ${action.ms}ms`
  }
}

export const SandboxInputTool = Tool.define(
  "sandbox_input",
  Effect.gen(function* () {
    const container = yield* Container.Service

    return {
      description:
        'Send keyboard and mouse input to a display-capable sandbox\'s screen, then return a screenshot of the result. Works for any sandbox that reports a display — a VNC desktop VM or a CDP browser. Actions run in order: type text, press keys or combos (e.g. "ctrl+c", "enter"), click/double-click/move/scroll at pixel coordinates, or wait for the UI to react. Take a sandbox_screenshot first to find coordinates, and check the returned screenshot to verify the effect before continuing.',
      parameters: InputParameters,
      execute: (params: InputParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const parsed = parseInputActions(params.actions)
          if (!Array.isArray(parsed)) {
            return {
              title: "Invalid input actions",
              output: `Error: ${parsed.invalid}`,
              metadata: { containerId: params.id, error: true },
            }
          }

          const summary = parsed.map(describeInputAction).join(", ")
          yield* ctx.ask({
            permission: PERMISSION,
            patterns: [`input ${params.id} ${summary}`],
            always: [`input ${params.id} *`],
            metadata: { containerId: params.id, actions: summary },
          })

          const display = yield* container.display(params.id)
          const shot = yield* Effect.tryPromise({
            try: () =>
              display.kind === "cdp"
                ? performCdpActions({ url: display.url, actions: parsed })
                : performVncActions({ url: display.url, password: display.password, actions: parsed }),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          })
          return {
            title: summary.length > 80 ? `${summary.slice(0, 80)}…` : summary,
            output: `Performed ${parsed.length} input action${parsed.length === 1 ? "" : "s"} (${summary}). A ${shot.width}x${shot.height} screenshot of the resulting screen is attached.`,
            metadata: { containerId: params.id, actions: parsed.length, width: shot.width, height: shot.height },
            attachments: [
              {
                type: "file" as const,
                mime: "image/png",
                url: `data:image/png;base64,${shot.png.toString("base64")}`,
              },
            ],
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)

export const SandboxExecTool = Tool.define(
  "sandbox_exec",
  Effect.gen(function* () {
    const container = yield* Container.Service
    const appProcess = yield* AppProcess.Service

    return {
      description:
        "Run a shell command inside a running sandbox and return its output. The command is executed non-interactively with sh, so it must not require a TTY. Use this to inspect or configure a sandbox, for example checking network state, installing packages, or reading files.",
      parameters: ExecParameters,
      execute: (params: ExecParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: PERMISSION,
            patterns: [`exec ${params.id} ${params.command}`],
            always: [`exec ${params.id} *`],
            metadata: { containerId: params.id, command: params.command },
          })

          // shell() resolves the runtime-specific entry command (for example
          // `docker exec -i <id> sh`); pipe the script over stdin so the same
          // path works for docker, podman, and microvm workloads.
          const shell = yield* container.shell(params.id)
          const timeoutSeconds = Math.min(params.timeout ?? DEFAULT_EXEC_TIMEOUT_SECONDS, MAX_EXEC_TIMEOUT_SECONDS)
          const proc =
            process.platform === "win32"
              ? ChildProcess.make("cmd.exe", ["/c", shell.command], { extendEnv: true })
              : ChildProcess.make("/bin/sh", ["-c", shell.command], { extendEnv: true })
          const result = yield* appProcess.run(proc, {
            stdin: `${params.command}\n`,
            timeout: `${timeoutSeconds} seconds`,
            signal: ctx.abort,
            maxOutputBytes: MAX_EXEC_OUTPUT_BYTES,
            maxErrorBytes: MAX_EXEC_OUTPUT_BYTES,
          })

          const stdout = result.stdout.toString("utf8")
          const stderr = result.stderr.toString("utf8")
          const sections = [stdout.trim() === "" && stderr.trim() === "" ? "(no output)" : stdout]
          if (stderr.trim() !== "") sections.push(`[stderr]\n${stderr}`)
          if (result.stdoutTruncated || result.stderrTruncated) sections.push("[output truncated]")
          if (result.exitCode !== 0) sections.push(`Exit code: ${result.exitCode}`)

          return {
            title: params.command,
            output: sections.join("\n"),
            metadata: {
              containerId: params.id,
              exitCode: result.exitCode,
            },
          }
        }).pipe(Effect.catch(sandboxError)),
    }
  }),
)
