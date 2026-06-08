import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Container } from "@/container"
import { UI } from "../ui"

function runContainer<A, R>(effect: Effect.Effect<A, Container.Error, R>) {
  return effect.pipe(
    Effect.catchTag("ContainerRuntimeNotFoundError", (error) => fail(error.message)),
    Effect.catchTag("ContainerRuntimeUnavailableError", (error) => fail(error.message)),
    Effect.catchTag("ContainerCreateFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerListFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerStartFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerStopFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerRemoveFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerLogsFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerShellFailedError", (error) => fail(error.message)),
    Effect.catchTag("ContainerDisplayFailedError", (error) => fail(error.message)),
  )
}

export const ContainerCommand = cmd({
  command: "container",
  describe: "manage sandbox containers",
  builder: (yargs: Argv) =>
    yargs
      .command(ContainerListCommand)
      .command(ContainerCreateCommand)
      .command(ContainerStopCommand)
      .command(ContainerRemoveCommand)
      .command(ContainerLogsCommand)
      .command(ContainerShellCommand)
      .demandCommand(),
  async handler() {},
})

export const ContainerListCommand = effectCmd({
  command: "list",
  describe: "list containers",
  instance: false,
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.container.list")(function* (args) {
    const containers = yield* runContainer(Container.Service.use((svc) => svc.list()))

    if (containers.length === 0) return

    if (args.format === "json") {
      console.log(JSON.stringify(containers, null, 2))
      return
    }

    for (const item of containers) {
      const name = item.name ? ` ${item.name}` : ""
      console.log(`${item.id}\t${item.runtime}\t${item.image}${name}`)
    }
  }),
})

export const ContainerCreateCommand = effectCmd({
  command: "create",
  describe: "create and start a container",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("image", {
        describe: "container image",
        type: "string",
        demandOption: true,
      })
      .option("name", {
        describe: "container name",
        type: "string",
      })
      .option("env", {
        describe: "environment variable (KEY=VALUE)",
        type: "array",
        string: true,
      })
      .option("publish", {
        alias: "p",
        describe: "port mapping (host:container)",
        type: "array",
        string: true,
      })
      .option("volume", {
        alias: "v",
        describe: "volume mapping (host:container[:ro])",
        type: "array",
        string: true,
      })
      .option("command", {
        describe: "command to run in the container",
        type: "array",
        string: true,
      }),
  handler: Effect.fn("Cli.container.create")(function* (args) {
    const created = yield* runContainer(
      Container.Service.use((svc) =>
        svc.create({
          image: args.image,
          name: args.name,
          env: parseEnv(args.env),
          ports: parsePorts(args.publish),
          volumes: parseVolumes(args.volume),
          command: args.command,
        }),
      ),
    )

    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `Created ${created.runtime} container ${created.id}` +
        (created.name ? ` (${created.name})` : "") +
        UI.Style.TEXT_NORMAL,
    )
  }),
})

export const ContainerStopCommand = effectCmd({
  command: "stop <id>",
  describe: "stop a container",
  instance: false,
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "container or sandbox id",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.container.stop")(function* (args) {
    yield* runContainer(Container.Service.use((svc) => svc.stop(args.id)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Stopped ${args.id}` + UI.Style.TEXT_NORMAL)
  }),
})

export const ContainerLogsCommand = effectCmd({
  command: "logs <id>",
  describe: "fetch container logs",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("id", {
        describe: "container or sandbox id",
        type: "string",
        demandOption: true,
      })
      .option("tail", {
        describe: "number of lines to fetch",
        type: "number",
        default: 200,
      }),
  handler: Effect.fn("Cli.container.logs")(function* (args) {
    const result = yield* runContainer(Container.Service.use((svc) => svc.logs(args.id, { tail: args.tail })))
    process.stdout.write(result.logs)
    if (!result.logs.endsWith("\n")) console.log()
  }),
})

export const ContainerShellCommand = effectCmd({
  command: "shell <id>",
  describe: "print the command to open an interactive shell",
  instance: false,
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "container or sandbox id",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.container.shell")(function* (args) {
    const result = yield* runContainer(Container.Service.use((svc) => svc.shell(args.id)))
    console.log(result.command)
  }),
})

export const ContainerRemoveCommand = effectCmd({
  command: "rm <id>",
  describe: "remove a container",
  instance: false,
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "container or sandbox id",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.container.rm")(function* (args) {
    yield* runContainer(Container.Service.use((svc) => svc.remove(args.id)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Removed ${args.id}` + UI.Style.TEXT_NORMAL)
  }),
})

function parseEnv(values: string[] | undefined) {
  if (!values || values.length === 0) return undefined
  const env: Record<string, string> = {}
  for (const value of values) {
    const index = value.indexOf("=")
    if (index <= 0) continue
    env[value.slice(0, index)] = value.slice(index + 1)
  }
  return Object.keys(env).length > 0 ? env : undefined
}

function parsePorts(values: string[] | undefined) {
  if (!values || values.length === 0) return undefined
  return values.flatMap((value) => {
    const [host, container] = value.split(":")
    if (!host || !container) return []
    return [{ host, container }]
  })
}

function parseVolumes(values: string[] | undefined) {
  if (!values || values.length === 0) return undefined
  return values.flatMap((value) => {
    const parts = value.split(":")
    if (parts.length < 2) return []
    const host = parts[0]
    const container = parts[1]
    if (!host || !container) return []
    const readOnly = parts[2] === "ro"
    return [{ host, container, readOnly: readOnly ? true : undefined }]
  })
}
