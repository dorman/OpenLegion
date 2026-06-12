const STORAGE_KEY = "openlegion.sandbox-audit"
const MAX_ENTRIES = 100

export type SandboxAuditEntry = {
  id: string
  containerId?: string
  at: number
  action: string
  detail?: string
  outcome?: "allowed" | "denied" | "pending"
}

type AuditStore = {
  entries: SandboxAuditEntry[]
}

function readStore(): AuditStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { entries: [] }
    const parsed = JSON.parse(raw) as AuditStore
    if (!Array.isArray(parsed.entries)) return { entries: [] }
    return parsed
  } catch {
    return { entries: [] }
  }
}

function writeStore(store: AuditStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {}
}

export function listSandboxAuditEntries(containerId?: string) {
  const entries = readStore().entries
  if (!containerId) return entries
  return entries.filter((entry) => !entry.containerId || entry.containerId === containerId)
}

export function recordSandboxAuditEntry(input: Omit<SandboxAuditEntry, "id" | "at"> & { at?: number }) {
  const store = readStore()
  const entry: SandboxAuditEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: input.at ?? Date.now(),
    action: input.action,
    containerId: input.containerId,
    detail: input.detail,
    outcome: input.outcome,
  }
  store.entries = [entry, ...store.entries].slice(0, MAX_ENTRIES)
  writeStore(store)
  return entry
}
