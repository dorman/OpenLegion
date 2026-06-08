import * as InstanceState from "@/effect/instance-state"
import { ContainerFiles } from "@/container/files"
import { hostPathInContainerMount, hostPathToContainerPath, sessionContainer } from "@/container/session"
import { FileSystem } from "@openlegion-ai/core/filesystem"
import { LocationServiceMap } from "@openlegion-ai/core/location-layer"
import { Ripgrep } from "@openlegion-ai/core/filesystem/ripgrep"
import { FSUtil } from "@openlegion-ai/core/fs-util"
import { AbsolutePath, RelativePath } from "@openlegion-ai/core/schema"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Effect, Layer } from "effect"
import path from "path"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

function parseContainerEntry(entry: string) {
  if (entry.endsWith("/")) {
    return { name: entry.slice(0, -1), type: "directory" as const }
  }
  return { name: entry, type: "file" as const }
}

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const locations = yield* LocationServiceMap
    const sessions = yield* Session.Service
    const containerFiles = yield* ContainerFiles.Service

    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(locations.get({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
      )
    })

    const sessionContainerFor = Effect.fn("FileHttpApi.sessionContainerFor")(function* (sessionID?: SessionID) {
      if (!sessionID) return undefined
      const info = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return sessionContainer(info?.metadata)
    })

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .search({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).items
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      return (yield* filesystem(
        FileSystem.Service.use((fs) =>
          fs.find({
            query: ctx.query.query,
            limit: ctx.query.limit ?? 10,
            type: ctx.query.type ?? (ctx.query.dirs === "false" ? "file" : undefined),
          }),
        ),
      )).map((item) => item.path)
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string; sessionID?: SessionID } }) {
      const directory = (yield* InstanceState.context).directory
      const container = yield* sessionContainerFor(ctx.query.sessionID)
      if (!container) {
        return yield* filesystem(
          FileSystem.Service.use((fs) =>
            fs.list({ path: RelativePath.make(ctx.query.path) }).pipe(
              Effect.map((items) =>
                items.map((item) => ({
                  name: path.basename(item.path),
                  path: item.path,
                  absolute: path.join(directory, item.path),
                  type: item.type,
                  ignored: fs.isIgnored(item.path, item.type),
                })),
              ),
            ),
          ),
        )
      }

      const hostPath = path.resolve(directory, ctx.query.path)
      if (!hostPathInContainerMount(hostPath, container)) return []

      const entries = yield* containerFiles
        .listDirectory(container, hostPathToContainerPath(hostPath, container))
        .pipe(Effect.orDie)

      return entries.map((entry) => {
        const parsed = parseContainerEntry(entry)
        const relative = ctx.query.path ? path.join(ctx.query.path, parsed.name) : parsed.name
        return {
          name: parsed.name,
          path: relative,
          absolute: path.join(directory, relative),
          type: parsed.type,
          ignored: false,
        }
      })
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string; sessionID?: SessionID } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.query.path)
      if (!FSUtil.contains(directory, file)) return yield* Effect.die(new Error("Path escapes the location"))

      const container = yield* sessionContainerFor(ctx.query.sessionID)
      if (container) {
        if (!hostPathInContainerMount(file, container)) return { type: "text" as const, content: "" }
        const text = yield* containerFiles.readText(container, hostPathToContainerPath(file, container)).pipe(Effect.orDie)
        return { type: "text" as const, content: text.trim() }
      }

      if (!(yield* FSUtil.Service.use((fs) => fs.existsSafe(file)))) return { type: "text" as const, content: "" }
      return yield* filesystem(
        FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(ctx.query.path) })),
      ).pipe(
        Effect.map((item) => ({
          type: item.type,
          content: item.type === "text" ? item.content.trim() : item.content,
          ...(item.type === "binary" ? { encoding: item.encoding, mimeType: item.mime } : {}),
        })),
      )
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return []
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
  }),
).pipe(Layer.provide(LocationServiceMap.layer), Layer.provide(ContainerFiles.defaultLayer))
