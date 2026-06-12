import { Spinner } from "@openlegion-ai/ui/spinner"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"

function logDesktopDisplay(event: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : ""
  console.info(`[openlegion:desktop-display] ${event}${payload}`)
}

export function ContainerDisplay(props: {
  url: string
  password?: string
  active: boolean
  compact?: boolean
  fullscreen?: boolean
}) {
  const language = useLanguage()
  let viewport!: HTMLDivElement
  const [error, setError] = createSignal<string | undefined>()
  const [connecting, setConnecting] = createSignal(true)
  const [connected, setConnected] = createSignal(false)
  let client: import("@novnc/novnc/lib/rfb.js").default | undefined

  const sessionKey = createMemo(() => `${props.url}\n${props.password ?? ""}`)

  function focusDisplay() {
    // Only focus the noVNC canvas. Focusing the viewport div steals keyboard
    // input because noVNC listens exclusively on the inner canvas.
    client?.focus()
  }

  function isDisplayTarget(target: EventTarget | null) {
    return target instanceof Node && viewport?.contains(target)
  }

  function blockMonitorHotkey(event: KeyboardEvent) {
    if (event.ctrlKey && event.altKey && (event.key === "2" || event.key === "3")) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // Keep modal/dialog handlers from seeing keys that originate in the display.
  function stopDisplayKeyBubble(event: KeyboardEvent) {
    if (!isDisplayTarget(event.target)) return
    blockMonitorHotkey(event)
    event.stopPropagation()
  }

  createEffect(() => {
    if (!props.active) {
      logDesktopDisplay("inactive")
      client?.disconnect()
      client = undefined
      setConnecting(true)
      setConnected(false)
      setError(undefined)
      return
    }

    sessionKey()
    let cancelled = false
    setConnecting(true)
    setConnected(false)
    setError(undefined)
    logDesktopDisplay("connecting", { url: props.url })

    void import("@novnc/novnc/lib/rfb.js")
      .then(({ default: RFBClient }) => {
        if (cancelled) return
        client?.disconnect()
        client = new RFBClient(viewport, props.url, {
          credentials: props.password ? { password: props.password } : undefined,
        })
        // Show the whole desktop: resizeSession matches the VM resolution to
        // the frame for crisp 1:1 pixels, and scaleViewport scales to fit as a
        // fallback when the server ignores the resize (or while it applies).
        // clipViewport stays off so any leftover overflow scrolls.
        client.scaleViewport = true
        client.resizeSession = true
        client.focusOnClick = true
        client.clipViewport = false
        client.addEventListener("connect", () => {
          logDesktopDisplay("connected")
          setConnecting(false)
          setConnected(true)
          // Dialog auto-focus runs after connect; defer so the canvas keeps focus.
          requestAnimationFrame(() => focusDisplay())
          window.setTimeout(() => focusDisplay(), 0)
        })
        client.addEventListener("disconnect", (event: Event) => {
          const detail = (event as CustomEvent<{ clean?: boolean }>).detail
          logDesktopDisplay("disconnected", { clean: detail?.clean ?? false })
          setConnecting(false)
          setConnected(false)
          if (!detail?.clean) {
            setError(language.t("containers.inspect.displayDisconnected"))
          }
        })
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        logDesktopDisplay("connect failed", { error: message })
        setConnecting(false)
        setConnected(false)
        setError(message)
      })

    return () => {
      cancelled = true
      logDesktopDisplay("cleanup")
      client?.disconnect()
      client = undefined
    }
  })

  createEffect(() => {
    if (!connected() || !props.active) return
    return makeEventListener(window, "keydown", stopDisplayKeyBubble)
  })

  createEffect(() => {
    if (!connected() || !props.active) return
    return makeEventListener(window, "keyup", stopDisplayKeyBubble)
  })

  onCleanup(() => {
    client?.disconnect()
    client = undefined
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <Show when={error()}>
        <div class="text-sm text-v2-text-text-danger">{error()}</div>
      </Show>
      <div
        classList={{
          "relative min-h-[min(50vh,420px)] flex-1 overflow-hidden rounded-md border border-v2-border-border-base bg-black": true,
          "min-h-[240px]": props.compact,
          "fixed inset-4 z-[100] min-h-0 rounded-lg shadow-2xl": props.fullscreen,
        }}
      >
        <Show when={connecting() && !connected()}>
          <div class="absolute inset-0 z-10 flex items-center justify-center bg-v2-background-bg-base/80">
            <Spinner />
          </div>
        </Show>
        <div
          ref={viewport}
          role="application"
          aria-label={language.t("containers.inspect.displayViewport")}
          class="desktop-display-viewport h-full min-h-0 w-full outline-none"
          onPointerDown={() => {
            logDesktopDisplay("viewport focus")
            focusDisplay()
          }}
        />
      </div>
    </div>
  )
}
