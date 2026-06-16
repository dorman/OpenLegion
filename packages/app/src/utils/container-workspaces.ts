import type { ServerConnection } from "@/context/server"
import { containerIdsMatch, type ContainerInfo, type ContainerRuntime } from "@/utils/containers"
import { authTokenFromCredentials } from "@/utils/server"

export const SESSION_CONTAINER_KEY = "openlegion.container"
export const SESSION_SANDBOX_KEY = "openlegion.sandbox"
export const DEFAULT_CONTAINER_MOUNT = "/workspace"

export type ContainerWorkspace = {
  containerId: string
  image: string
  name?: string
  runtime: ContainerRuntime
  hostMount?: string
  containerMount?: string
  sessionId?: string
  createdAt: number
}

export type ContainerWorkspaceUpsert = {
  image: string
  name?: string
  runtime: ContainerRuntime
  hostMount?: string
  containerMount?: string
  sessionId?: string
}

async function workspaceFetch(server: ServerConnection.HttpBase, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json")
  if (server.password) {
    headers.set(
      "authorization",
      `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    )
  }

  const response = await fetch(new URL(path, server.url), {
    ...init,
    headers,
  })

  if (!response.ok) {
    const text = await response.text()
    let message = text
    try {
      const json = JSON.parse(text) as { message?: string; error?: string }
      message = json.message ?? json.error ?? text
    } catch {}
    throw new Error(message || `Request failed (${response.status})`)
  }

  return response
}

export async function listContainerWorkspaces(server: ServerConnection.HttpBase) {
  const response = await workspaceFetch(server, "/global/container-workspaces")
  return (await response.json()) as ContainerWorkspace[]
}

export async function upsertContainerWorkspace(
  server: ServerConnection.HttpBase,
  containerId: string,
  input: ContainerWorkspaceUpsert,
) {
  const response = await workspaceFetch(server, `/global/container-workspaces/${encodeURIComponent(containerId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
  return (await response.json()) as ContainerWorkspace
}

export function workspaceForContainer(workspaces: ContainerWorkspace[], container: ContainerInfo) {
  return workspaces.find((item) => containerIdsMatch(item.containerId, container.id))
}

export type SessionSandboxContext = {
  id: string
  name?: string
  image?: string
  runtime?: ContainerRuntime
  kind?: "container" | "desktop" | "kubernetes"
}

export function sessionSandboxFromMetadata(metadata?: Record<string, unknown>) {
  const value = metadata?.[SESSION_SANDBOX_KEY]
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string") return undefined
  if (record.runtime !== undefined && record.runtime !== "docker" && record.runtime !== "podman" && record.runtime !== "microvm") {
    return undefined
  }
  return {
    id: record.id,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.image === "string" ? { image: record.image } : {}),
    ...(record.runtime === "docker" || record.runtime === "podman" || record.runtime === "microvm"
      ? { runtime: record.runtime }
      : {}),
    ...(record.kind === "container" || record.kind === "desktop" || record.kind === "kubernetes"
      ? { kind: record.kind }
      : {}),
  } satisfies SessionSandboxContext
}

export type LinkedSandboxContext = {
  id: string
  label: string
  mode: "container" | "sandbox"
}

export function linkedSandboxFromMetadata(metadata?: Record<string, unknown>) {
  const container = sessionContainerFromMetadata(metadata)
  if (container) {
    return {
      id: container.id,
      label: container.id,
      mode: "container",
    } satisfies LinkedSandboxContext
  }
  const sandbox = sessionSandboxFromMetadata(metadata)
  if (!sandbox) return undefined
  return {
    id: sandbox.id,
    label: sandbox.name ?? sandbox.id,
    mode: "sandbox",
  } satisfies LinkedSandboxContext
}

export type SessionContainerContext = {
  id: string
  runtime: ContainerRuntime
  hostMount: string
  containerMount: string
}

export function sessionContainerFromMetadata(metadata?: Record<string, unknown>) {
  const value = metadata?.[SESSION_CONTAINER_KEY]
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string") return undefined
  if (record.runtime !== "docker" && record.runtime !== "podman" && record.runtime !== "microvm") return undefined
  if (typeof record.hostMount !== "string") return undefined
  if (typeof record.containerMount !== "string") return undefined
  return {
    id: record.id,
    runtime: record.runtime,
    hostMount: record.hostMount,
    containerMount: record.containerMount,
  } satisfies SessionContainerContext
}

export function containerSessionMetadata(
  container: ContainerInfo,
  input: { hostMount: string; containerMount: string },
) {
  return {
    [SESSION_CONTAINER_KEY]: {
      id: container.id,
      runtime: container.runtime,
      hostMount: input.hostMount,
      containerMount: input.containerMount,
    },
  }
}
