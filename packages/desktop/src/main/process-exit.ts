export type ProcessExitKind = "external-sigterm" | "crash" | "oom" | "abnormal" | "clean" | "unknown"

export function classifyProcessExit(details: { reason?: string; exitCode?: number | null }) {
  const reason = details.reason ?? "unknown"
  const code = details.exitCode ?? null
  if (reason === "killed" && code === 15) return "external-sigterm"
  if (reason === "crashed") return "crash"
  if (reason === "oom") return "oom"
  if (reason === "clean") return "clean"
  if (reason === "abnormal") return "abnormal"
  return "unknown"
}
