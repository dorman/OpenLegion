export { AppBaseProviders, AppInterface } from "./app"
export { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_TYPES, filePickerFilters } from "./constants/file-picker"
export { useCommand } from "./context/command"
export { loadLocaleDict, normalizeLocale, type Locale } from "./context/language"
export { type DisplayBackend, type FatalRendererErrorLog, type Platform, PlatformProvider } from "./context/platform"
export { ServerConnection } from "./context/server"
export { handleNotificationClick } from "./utils/notification-click"

// Prevent HMR updates from sub-modules cascading through this barrel to
// renderer/index.tsx (which has `// @refresh reload`). SolidJS .tsx components
// already accept their own HMR via vite-plugin-solid; this boundary stops
// plain .ts utility updates from triggering a full page reload on startup.
if (import.meta.hot) {
  import.meta.hot.accept()
}
