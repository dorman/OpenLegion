export type SandboxConfigWarning = {
  id: "etcPath" | "varPath" | "homeRootBind" | "privileged"
  messageKey:
    | "containers.warnings.etcPath"
    | "containers.warnings.varPath"
    | "containers.warnings.homeRootBind"
    | "containers.warnings.privileged"
}

function normalizeHostPath(path: string) {
  const trimmed = path.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  if (trimmed === "~") return trimmed
  if (trimmed.startsWith("~/")) return trimmed
  return trimmed
}

function isHomeRootBind(path: string) {
  const normalized = normalizeHostPath(path)
  if (!normalized) return false
  if (normalized === "~") return true
  if (normalized.startsWith("~/") && normalized.split("/").length === 2) return true
  if (/^\/Users\/[^/]+$/i.test(normalized)) return true
  if (/^\/home\/[^/]+$/i.test(normalized)) return true
  return false
}

function isSensitiveSystemPath(path: string) {
  const normalized = normalizeHostPath(path).toLowerCase()
  if (!normalized) return false
  return (
    normalized === "/etc" ||
    normalized.startsWith("/etc/") ||
    normalized === "/var" ||
    normalized.startsWith("/var/")
  )
}

export function warningsForVolumeHost(hostPath: string): SandboxConfigWarning[] {
  const normalized = normalizeHostPath(hostPath)
  if (!normalized) return []

  const warnings: SandboxConfigWarning[] = []
  const lower = normalized.toLowerCase()

  if (lower === "/etc" || lower.startsWith("/etc/")) {
    warnings.push({ id: "etcPath", messageKey: "containers.warnings.etcPath" })
  }
  if (lower === "/var" || lower.startsWith("/var/")) {
    warnings.push({ id: "varPath", messageKey: "containers.warnings.varPath" })
  }
  if (isHomeRootBind(normalized)) {
    warnings.push({ id: "homeRootBind", messageKey: "containers.warnings.homeRootBind" })
  }

  return warnings
}

export function warningsForCreateInput(input: {
  volumeHost?: string
  privileged?: boolean
}): SandboxConfigWarning[] {
  const warnings = warningsForVolumeHost(input.volumeHost ?? "")
  if (input.privileged) {
    warnings.push({ id: "privileged", messageKey: "containers.warnings.privileged" })
  }
  return warnings
}

export function warningsForWorkspaceHostMount(hostMount?: string) {
  return warningsForVolumeHost(hostMount ?? "")
}

export function isSensitiveHostPath(path: string) {
  return warningsForVolumeHost(path).length > 0 || isSensitiveSystemPath(path)
}
