import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow } from "electron"

import contextMenu from "electron-context-menu"

import type { ServerReadyData, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import {
  classifyProcessExit,
  exportDebugLogs,
  initCrashReporter,
  initLogging,
  processMeta,
  startNetLog,
  write as writeLog,
} from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import {
  getDefaultServerUrl,
  getWslConfig,
  preferAppEnv,
  setDefaultServerUrl,
  setWslConfig,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import {
  createMainWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setBackgroundColor,
  setDockIcon,
} from "./windows"
import {
  containerRuntimeStatus,
  ensureMicrovmDaemon,
  recoverMicrovmDaemon,
  startMicrovmDaemonMonitor,
  stopMicrovmDaemonMonitor,
} from "./container-runtime"
import { getSandboxHostConfig, setSandboxHostConfig } from "./sandbox-host"
import { ensureDesktopImage, cancelDesktopImageDownload } from "./desktop-images"
import {
  closeAllContainerPtys,
  closeContainerPty,
  createContainerPty,
  resizeContainerPty,
  writeContainerPty,
} from "./container-pty"
import { migrate } from "./migrate"
import { checkUpdate, checkForUpdates, installUpdate, setupAutoUpdater } from "./updater"
import { Deferred, Effect, Fiber } from "effect"

const APP_NAMES: Record<string, string> = {
  dev: "OpenLegion Dev",
  beta: "OpenLegion Beta",
  prod: "OpenLegion",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.openlegion.desktop.dev",
  beta: "ai.openlegion.desktop.beta",
  prod: "ai.openlegion.desktop",
}
const TEST_ONBOARDING = process.env.OPENLEGION_TEST_ONBOARDING === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

let logger: ReturnType<typeof initLogging>
let mainWindow: BrowserWindow | null = null
let server: SidecarListener | null = null
let sessionStartedAt = Date.now()

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENLEGION_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.openlegion.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `openlegion-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENLEGION_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenLegion Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  sessionStartedAt = Date.now()
  logger = initLogging()
  initCrashReporter()

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("openlegion://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    writeLog("lifecycle", "before-quit", processMeta(sessionStartedAt))
    stopMicrovmDaemonMonitor()
    closeAllContainerPtys()
    void killSidecar()
  })

  app.on("will-quit", () => {
    writeLog("lifecycle", "will-quit", processMeta(sessionStartedAt))
    void killSidecar()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog(
      "lifecycle",
      "child process gone",
      {
        ...processMeta(sessionStartedAt),
        kind: classifyProcessExit({ reason: details.reason, exitCode: details.exitCode }),
        details,
      },
      "error",
    )
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog(
      "lifecycle",
      "app render process gone",
      {
        ...processMeta(sessionStartedAt),
        url: webContents.getURL(),
        kind: classifyProcessExit(details),
        details,
      },
      "error",
    )
  })

  setRelaunchHandler(() => {
    void killSidecar().finally(() => {
      app.relaunch()
      app.exit(0)
    })
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      writeLog(
        "lifecycle",
        "received shutdown signal",
        { signal, ...processMeta(sessionStartedAt), devGracePeriodMs: app.isPackaged ? 0 : 8_000 },
        "warn",
      )
      void killSidecar().finally(() => {
        if (!app.isPackaged) {
          setTimeout(() => app.exit(0), 8_000)
          return
        }
        app.exit(0)
      })
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData>()

  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    getWslConfig: () => Promise.resolve(getWslConfig()),
    setWslConfig: (config: WslConfig) => setWslConfig(config),
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    wslPath: async (path, mode) => wslPath(path, mode),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail, killSidecar),
    checkUpdate: async () => checkUpdate(),
    installUpdate: async () => installUpdate(killSidecar),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    containerRuntimeStatus: () => containerRuntimeStatus(),
    ensureMicrovmDaemon: () => ensureMicrovmDaemon(),
    recoverMicrovmDaemon: () => recoverMicrovmDaemon(),
    getSandboxHost: () => getSandboxHostConfig(),
    setSandboxHost: (config) => setSandboxHostConfig(config),
    ensureDesktopImage: (event, presetId) => ensureDesktopImage(presetId, event.sender),
  cancelDesktopImageDownload: () => {
    cancelDesktopImageDownload()
  },
    containerPtyCreate: (event, input) => {
      try {
        let id = ""
        id = createContainerPty({
          ...input,
          onData: (data) => event.sender.send("container-pty-data", id, data),
          onExit: (code) => {
            writeLog("pty", "session exited", { id, code, command: input.command }, code === 0 ? "info" : "warn")
            event.sender.send("container-pty-exit", id, code)
          },
        })
        writeLog("pty", "session created", { id, command: input.command })
        return { id }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeLog("pty", "session create failed", { command: input.command, error: message }, "error")
        return { error: message }
      }
    },
    containerPtyWrite: (id, data) => writeContainerPty(id, data),
    containerPtyResize: (id, cols, rows) => resizeContainerPty(id, cols, rows),
    containerPtyClose: (id) => closeContainerPty(id),
  })

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  app.setAsDefaultProtocolClient("openlegion")
  registerRendererProtocol()
  setDockIcon()
  setupAutoUpdater()
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  const port = yield* Effect.gen(function* () {
    const fromEnv = process.env.OPENLEGION_PORT
    if (fromEnv) {
      const parsed = Number.parseInt(fromEnv, 10)
      if (!Number.isNaN(parsed)) return parsed
    }

    const res = yield* Deferred.make<number, unknown>()
    const server = createServer()
    server.on("error", (e) => Deferred.failSync(res, () => e))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        Deferred.failSync(res, () => new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => Effect.runSync(Deferred.succeed(res, port)))
    })

    return yield* Deferred.await(res)
  })
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { url })

    ensureLoopbackNoProxy()
    useEnvProxy()

    logger.log("spawning sidecar", { url })
    const { listener, health } = yield* Effect.promise(() =>
      spawnLocalServer(hostname, port, password, {
        userDataPath: app.getPath("userData"),
        onStdout: (message) => writeLog("server", "stdout", { message }),
        onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
        onExit: (code) => writeLog("utility", "sidecar exited", { code }, "warn"),
      }),
    )
    server = listener
    yield* Deferred.succeed(serverReady, {
      url,
      username: "openlegion",
      password,
    })

    yield* Effect.promise(() => health.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
        }),
      ),
    )

    void ensureMicrovmDaemon().then((result) => {
      if (!result.ok) logger.warn("sandbox daemon unavailable", result)
    })

    // Guardrail: watch the local daemon and auto-run the recovery playbook if it
    // goes offline while the app is running, so the user doesn't have to.
    startMicrovmDaemonMonitor({
      onStatus: (status) => {
        if (status.state === "offline") logger.warn("sandbox daemon offline", status)
        else logger.log("sandbox daemon status", status)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("microvm-daemon-status", status)
        }
      },
    })

    logger.log("loading task finished")
  }).pipe(Effect.forkChild)

  yield* Fiber.await(loadingTask)

  mainWindow = createMainWindow()
  if (mainWindow) {
    createMenu({
      trigger: (id) => {
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow
        if (win) sendMenuCommand(win, id)
      },
      checkForUpdates: () => {
        void checkForUpdates(true, killSidecar)
      },
      relaunch: () => {
        void killSidecar().finally(() => {
          app.relaunch()
          app.exit(0)
        })
      },
    })
  }
})

Effect.runFork(main)
