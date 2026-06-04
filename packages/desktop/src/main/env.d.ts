interface ImportMetaEnv {
  readonly OPENLEGION_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:openlegion-server" {
  export namespace Server {
    export const listen: typeof import("../../../openlegion/dist/types/src/node").Server.listen
    export type Listener = import("../../../openlegion/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../openlegion/dist/types/src/node").Config.get
    export type Info = import("../../../openlegion/dist/types/src/node").Config.Info
  }
  export namespace Log {
    export const init: typeof import("../../../openlegion/dist/types/src/node").Log.init
  }
  export const bootstrap: typeof import("../../../openlegion/dist/types/src/node").bootstrap
}
