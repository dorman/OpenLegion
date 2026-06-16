# CDP browser prototype (throwaway feel-test)

A side-by-side comparison target for the VNC desktop tab. Streams a headless
Chromium to a browser viewer over the Chrome DevTools Protocol (`Page.startScreencast`)
and forwards mouse/keyboard back (`Input.dispatch*`). Includes an on-screen HUD
showing **input→paint latency**, frame interval, and fps so you can feel *and*
measure CDP responsiveness against the existing VNC path.

This is not product code. It maps onto the eventual integration like so:

| Prototype piece        | Eventual product piece                          |
| ---------------------- | ----------------------------------------------- |
| `server.ts` CDP relay  | `internal/display/bridge.go` (WS proxy, CDP mode) |
| `index.html` viewer    | a `ContainerBrowser` Solid component            |
| host Chromium          | Chromium inside the DockerSandbox container     |

## Run

```sh
bun scripts/cdp-proto/server.ts
# then open http://localhost:8080
```

If no Chrome/Chromium/Brave/Edge is installed, the script downloads a
self-contained chrome-for-testing build into `.cache/` (gitignored) the first
time. Override with `CDP_CHROME_PATH=/path/to/chrome`.

## What to look for

- Type a URL, hit Go, click links, scroll, type into fields.
- Watch the HUD: a healthy CDP path feels like **< ~80 ms input→paint**.
- Compare directly against the VNC desktop tab on the same machine.

## Why this beats VNC (the thesis under test)

CDP emits a JPEG on each real compositor paint and dispatches input straight
into Chromium's event loop — no software framebuffer scrape, no USB-tablet
emulation, no guest kernel. The same socket also exposes `DOM.*` / `Runtime.*`,
so an agent can later drive the browser by selectors instead of pixels.
