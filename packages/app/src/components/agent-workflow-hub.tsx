import { For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useLayout } from "@/context/layout"
import { useServerSDK } from "@/context/server-sdk"
import { startAgentWorkflow, type AgentWorkflow } from "@/utils/container-session"

type WorkflowCard = {
  id: AgentWorkflow
  pillClass: string
  pillKey: string
  titleKey: string
  descriptionKey: string
}

// Creation runtimes carry their workload pill color; the helper flows are neutral.
const WORKFLOW_CARDS: WorkflowCard[] = [
  {
    id: "docker",
    pillClass: "desktop-pill desktop-pill-container",
    pillKey: "agents.workflow.docker.pill",
    titleKey: "agents.workflow.docker.title",
    descriptionKey: "agents.workflow.docker.description",
  },
  {
    id: "kubernetes",
    pillClass: "desktop-pill desktop-pill-kubernetes",
    pillKey: "agents.workflow.kubernetes.pill",
    titleKey: "agents.workflow.kubernetes.title",
    descriptionKey: "agents.workflow.kubernetes.description",
  },
  {
    id: "linux-vm",
    pillClass: "desktop-pill desktop-pill-desktop",
    pillKey: "agents.workflow.linuxVm.pill",
    titleKey: "agents.workflow.linuxVm.title",
    descriptionKey: "agents.workflow.linuxVm.description",
  },
  {
    id: "read-docs",
    pillClass: "desktop-pill desktop-pill-muted",
    pillKey: "agents.workflow.readDocs.pill",
    titleKey: "agents.workflow.readDocs.title",
    descriptionKey: "agents.workflow.readDocs.description",
  },
  {
    id: "debug-net",
    pillClass: "desktop-pill desktop-pill-muted",
    pillKey: "agents.workflow.debugNet.pill",
    titleKey: "agents.workflow.debugNet.title",
    descriptionKey: "agents.workflow.debugNet.description",
  },
  {
    id: "clone-repo",
    pillClass: "desktop-pill desktop-pill-muted",
    pillKey: "agents.workflow.cloneRepo.pill",
    titleKey: "agents.workflow.cloneRepo.title",
    descriptionKey: "agents.workflow.cloneRepo.description",
  },
]

/**
 * The Agents "workflow hub": preset flows that each open an agent chat seeded
 * with that flow's goal. Self-contained — it pulls its own contexts so the
 * Agents page only needs to render it.
 */
export function AgentWorkflowHub() {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const global = useGlobal()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()

  async function launch(workflow: AgentWorkflow) {
    const conn = server.current
    if (!conn) return
    await startAgentWorkflow({
      conn,
      workflow,
      platform,
      global,
      layout,
      createClient: serverSDK.createClient,
      navigate,
      pickDirectory: async () => {
        const host = await platform.openDirectoryPickerDialog?.({
          title: language.t("containers.openSession.pickProject"),
        })
        if (!host || Array.isArray(host)) return undefined
        return host
      },
    })
  }

  return (
    <section class="flex flex-col gap-3" aria-label={language.t("agents.workflow.title")}>
      <div class="flex flex-col gap-1">
        <h2 class="text-sm font-medium text-v2-text-text-base">{language.t("agents.workflow.title")}</h2>
        <p class="text-sm text-v2-text-text-muted">{language.t("agents.workflow.description")}</p>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <For each={WORKFLOW_CARDS}>
          {(card) => (
            <button
              type="button"
              onClick={() => void launch(card.id)}
              class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3 text-left transition-colors hover:border-v2-border-border-strong"
            >
              <div class="flex items-center justify-between gap-3">
                <span class={card.pillClass}>{language.t(card.pillKey)}</span>
                <span class="text-v2-text-text-muted" aria-hidden="true">
                  →
                </span>
              </div>
              <div class="font-medium text-v2-text-text-base">{language.t(card.titleKey)}</div>
              <p class="text-sm leading-relaxed text-v2-text-text-muted">{language.t(card.descriptionKey)}</p>
            </button>
          )}
        </For>
      </div>
    </section>
  )
}
