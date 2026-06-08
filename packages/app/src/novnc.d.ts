declare module "@novnc/novnc/lib/rfb.js" {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: { credentials?: { password?: string } })
    scaleViewport: boolean
    resizeSession: boolean
    disconnect(): void
    addEventListener(type: string, listener: (event: Event) => void): void
  }
}
