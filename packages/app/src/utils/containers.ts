import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export type ContainerRuntime = "docker" | "podman" | "microvm"

export type ContainerStatus = "running" | "stopped"

export type ContainerInfo = {
  id: string
  runtime: ContainerRuntime
  image: string
  name?: string
  status?: ContainerStatus
}

export type ContainerCreateInput = {
  image: string
  name?: string
  env?: Record<string, string>
  ports?: { host: string; container: string }[]
  volumes?: { host: string; container: string; readOnly?: boolean }[]
  command?: string[]
}

export type ContainerRuntimeStatus = {
  docker: boolean
  microvm: boolean
  microvmUrl: string
}

async function containerFetch(server: ServerConnection.HttpBase, path: string, init?: RequestInit) {
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

export async function listContainers(server: ServerConnection.HttpBase) {
  const response = await containerFetch(server, "/global/containers")
  return (await response.json()) as ContainerInfo[]
}

export async function createContainer(server: ServerConnection.HttpBase, input: ContainerCreateInput) {
  const response = await containerFetch(server, "/global/containers", {
    method: "POST",
    body: JSON.stringify(input),
  })
  return (await response.json()) as ContainerInfo
}

export async function stopContainer(server: ServerConnection.HttpBase, id: string) {
  await containerFetch(server, `/global/containers/${encodeURIComponent(id)}/stop`, { method: "POST" })
}

export async function removeContainer(server: ServerConnection.HttpBase, id: string) {
  await containerFetch(server, `/global/containers/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export function containerIdsMatch(left: string, right: string) {
  return left === right || left.startsWith(right) || right.startsWith(left)
}

export async function ensureContainerAvailable(server: ServerConnection.HttpBase, id: string) {
  const containers = await listContainers(server)
  const found = containers.find((item) => containerIdsMatch(item.id, id))
  if (!found) throw new Error("Container is not available. It may have been removed.")
  return found
}
