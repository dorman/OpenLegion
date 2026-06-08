import { withAlpha } from "@openlegion-ai/ui/theme/color"
import { useTheme } from "@openlegion-ai/ui/theme/context"
import { resolveThemeVariant } from "@openlegion-ai/ui/theme/resolve"
import type { HexColor } from "@openlegion-ai/ui/theme/types"
import type { FitAddon, Ghostty, Terminal as Term } from "ghostty-web"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { terminalFontFamily, useSettings } from "@/context/settings"
import { disposeIfDisposable, setOptionIfSupported } from "@/utils/runtime-adapters"
import { terminalWriter } from "@/utils/terminal-writer"

type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

const DEFAULT_TERMINAL_COLORS: Record<"light" | "dark", TerminalColors> = {
  light: {
    background: "#fcfcfc",
    foreground: "#211e1e",
    cursor: "#211e1e",
    selectionBackground: withAlpha("#211e1e", 0.2),
  },
  dark: {
    background: "#191515",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: withAlpha("#d4d4d4", 0.25),
  },
}

let shared: Promise<{ mod: typeof import("ghostty-web"); ghostty: Ghostty }> | undefined

const loadGhostty = () => {
  if (shared) return shared
  shared = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
    .catch((err) => {
      shared = undefined
      throw err
    })
  return shared
}

export function ContainerTerminal(props: {
  command: string
  active: boolean
  onExit?: (code: number) => void
}) {
  const platform = usePlatform()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()
  let container!: HTMLDivElement
  const [error, setError] = createSignal<string | undefined>()
  const [ready, setReady] = createSignal(false)
  let term: Term | undefined
  let fitAddon: FitAddon | undefined
  let ptyId: string | undefined
  let output: ReturnType<typeof terminalWriter> | undefined
  let disposed = false
  const cleanups: VoidFunction[] = []

  const getTerminalColors = (): TerminalColors => {
    const mode = theme.mode() === "dark" ? "dark" : "light"
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds && !variant?.palette) return fallback
    const resolved = resolveThemeVariant(variant, mode === "dark")
    const text = resolved["text-stronger"] ?? fallback.foreground
    const background = resolved["background-stronger"] ?? fallback.background
    const alpha = mode === "dark" ? 0.25 : 0.2
    const base = text.startsWith("#") ? (text as HexColor) : (fallback.foreground as HexColor)
    return {
      background,
      foreground: text,
      cursor: text,
      selectionBackground: withAlpha(base, alpha),
    }
  }

  const terminalColors = createMemo(getTerminalColors)

  const cleanup = () => {
    if (!cleanups.length) return
    const fns = cleanups.splice(0).reverse()
    for (const fn of fns) {
      try {
        fn()
      } catch {}
    }
  }

  const scheduleFit = () => {
    if (disposed || !fitAddon) return
    requestAnimationFrame(() => {
      if (disposed || !fitAddon || !term) return
      fitAddon.fit()
      if (!ptyId || !platform.containerPty) return
      void platform.containerPty.resize(ptyId, term.cols, term.rows)
    })
  }

  createEffect(() => {
    const colors = terminalColors()
    if (!term) return
    setOptionIfSupported(term, "theme", colors)
  })

  createEffect(() => {
    const font = terminalFontFamily(settings.appearance.terminalFont())
    if (!term) return
    setOptionIfSupported(term, "fontFamily", font)
    scheduleFit()
  })

  onMount(() => {
    const run = async () => {
      if (!platform.containerPty) {
        setError(language.t("containers.inspect.shellUnavailable"))
        return
      }

      const loaded = await loadGhostty()
      if (disposed) return

      const mod = loaded.mod
      const t = new mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 14,
        fontFamily: terminalFontFamily(settings.appearance.terminalFont()),
        allowTransparency: false,
        convertEol: false,
        theme: terminalColors(),
        scrollback: 10_000,
        ghostty: loaded.ghostty,
      })
      cleanups.push(() => t.dispose())
      if (disposed) {
        cleanup()
        return
      }

      term = t
      output = terminalWriter((data, done) => t.write(data, () => done?.()))

      const fit = new mod.FitAddon()
      cleanups.push(() => disposeIfDisposable(fit))
      t.loadAddon(fit)
      fitAddon = fit
      t.open(container)
      fit.fit()

      const onData = t.onData((data) => {
        if (!ptyId) return
        void platform.containerPty?.write(ptyId, data)
      })
      cleanups.push(() => disposeIfDisposable(onData))

      const onResize = t.onResize((size) => {
        if (!ptyId) return
        void platform.containerPty?.resize(ptyId, size.cols, size.rows)
      })
      cleanups.push(() => disposeIfDisposable(onResize))

      fit.observeResize()
      const handleResize = () => scheduleFit()
      window.addEventListener("resize", handleResize)
      cleanups.push(() => window.removeEventListener("resize", handleResize))

      const created = await platform.containerPty.create(props.command, { cols: t.cols, rows: t.rows })
      if ("error" in created) {
        setError(created.error)
        return
      }
      if (disposed) {
        void platform.containerPty.close(created.id)
        return
      }

      ptyId = created.id
      const stopData = platform.containerPty.onData((id, data) => {
        if (id !== ptyId) return
        output?.push(data)
        output?.flush()
      })
      const stopExit = platform.containerPty.onExit((id, code) => {
        if (id !== ptyId) return
        props.onExit?.(code)
      })
      cleanups.push(stopData, stopExit)

      setReady(true)
      t.focus()
    }

    void run().catch((err) => {
      if (disposed) return
      setError(err instanceof Error ? err.message : String(err))
    })
  })

  createEffect(() => {
    if (!props.active || !term) return
    term.focus()
    scheduleFit()
  })

  onCleanup(() => {
    disposed = true
    if (ptyId) void platform.containerPty?.close(ptyId)
    cleanup()
  })

  return (
    <div class="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-md border border-v2-border-border-base">
      <Show when={error()}>
        <div class="p-3 text-sm text-v2-text-text-danger">{error()}</div>
      </Show>
      <Show when={!error() && !ready()}>
        <div class="flex flex-1 items-center justify-center p-6 text-sm text-v2-text-text-muted">
          {language.t("terminal.loading")}
        </div>
      </Show>
      <div
        ref={container}
        data-component="container-terminal"
        data-prevent-autofocus
        tabIndex={-1}
        style={{ "background-color": terminalColors().background }}
        classList={{
          "select-text size-full px-4 py-3 font-mono relative overflow-hidden": true,
          hidden: !!error() || !ready(),
        }}
      />
    </div>
  )
}
