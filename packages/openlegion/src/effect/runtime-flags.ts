import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("OPENLEGION_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@openlegion/RuntimeFlags", {
  autoShare: bool("OPENLEGION_AUTO_SHARE"),
  pure: bool("OPENLEGION_PURE"),
  disableDefaultPlugins: bool("OPENLEGION_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("OPENLEGION_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("OPENLEGION_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("OPENLEGION_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("OPENLEGION_DISABLE_CLAUDE_CODE"),
    direct: bool("OPENLEGION_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("OPENLEGION_DISABLE_CLAUDE_CODE"),
    direct: bool("OPENLEGION_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("OPENLEGION_ENABLE_EXA"),
    legacy: bool("OPENLEGION_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("OPENLEGION_ENABLE_PARALLEL"),
    legacy: bool("OPENLEGION_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("OPENLEGION_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("OPENLEGION_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("OPENLEGION_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("OPENLEGION_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("OPENLEGION_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("OPENLEGION_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("OPENLEGION_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("OPENLEGION_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("OPENLEGION_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("OPENLEGION_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("OPENLEGION_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("OPENLEGION_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("OPENLEGION_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("OPENLEGION_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("OPENLEGION_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("OPENLEGION_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.defaultLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const defaultLayer = Service.defaultLayer.pipe(Layer.orDie)

export * as RuntimeFlags from "./runtime-flags"
