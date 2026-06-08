import { Spinner } from "@openlegion-ai/ui/spinner"
import { createEffect, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"

export function ContainerDisplay(props: {
  url: string
  password?: string
  active: boolean
}) {
  const language = useLanguage()
  let viewport!: HTMLDivElement
  const [error, setError] = createSignal<string | undefined>()
  const [connecting, setConnecting] = createSignal(true)
  let client: import("@novnc/novnc/lib/rfb.js").default | undefined

  createEffect(() => {
    if (!props.active) {
      client?.disconnect()
      client = undefined
      setConnecting(true)
      setError(undefined)
      return
    }

    let cancelled = false
    setConnecting(true)
    setError(undefined)

    void import("@novnc/novnc/lib/rfb.js")
      .then(({ default: RFBClient }) => {
        if (cancelled) return
        client?.disconnect()
        client = new RFBClient(viewport, props.url, {
          credentials: props.password ? { password: props.password } : undefined,
        })
        client.scaleViewport = true
        client.resizeSession = true
        client.addEventListener("connect", () => setConnecting(false))
        client.addEventListener("disconnect", (event: Event) => {
          setConnecting(false)
          const detail = (event as CustomEvent<{ clean?: boolean }>).detail
          if (!detail?.clean) {
            setError(language.t("containers.inspect.displayDisconnected"))
          }
        })
      })
      .catch((err) => {
        setConnecting(false)
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      client?.disconnect()
      client = undefined
    }
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <Show when={connecting()}>
        <div class="flex justify-center py-8">
          <Spinner />
        </div>
      </Show>
      <Show when={error()}>
        <div class="text-sm text-v2-text-text-danger">{error()}</div>
      </Show>
      <div
        ref={viewport}
        class="min-h-[min(50vh,420px)] flex-1 overflow-hidden rounded-md border border-v2-border-border-base bg-v2-background-bg-base"
      />
    </div>
  )
}
