import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { deployComposeStack, stopComposeStack } from "@/utils/compose"
import { recordSandboxAuditEntry } from "@/utils/sandbox-audit"
import { showToast } from "@/utils/toast"
import { writePersisted } from "@/utils/persist"

const COMPOSE_FILE_KEY = "containers.compose.file"

function readComposeFile(storage?: ReturnType<typeof usePlatform>["storage"]) {
  try {
    const value = storage?.("openlegion")?.getItem(COMPOSE_FILE_KEY)
    if (value instanceof Promise) return ""
    if (!value) return ""
    try {
      const parsed = JSON.parse(value) as unknown
      if (typeof parsed === "string") return parsed
    } catch {
      return value
    }
    return ""
  } catch {
    return ""
  }
}

export function ContainersComposePanel(props: { onChanged?: () => Promise<void> }) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const [file, setFile] = createSignal(readComposeFile(platform.storage))
  const [pending, setPending] = createSignal<"deploy" | "stop" | undefined>()

  async function persistFile(path: string) {
    setFile(path)
    await writePersisted({ storage: "openlegion", key: COMPOSE_FILE_KEY }, JSON.stringify(path), platform)
  }

  async function pickComposeFile() {
    const picked = await platform.openFilePickerDialog?.({
      title: language.t("containers.compose.pickFile"),
      accept: ["yml", "yaml"],
    })
    if (!picked || Array.isArray(picked)) return
    await persistFile(picked)
  }

  async function run(action: "deploy" | "stop") {
    const http = server.current?.http
    const path = file().trim()
    if (!http || !path) return

    setPending(action)
    try {
      const result =
        action === "deploy" ? await deployComposeStack(http, path) : await stopComposeStack(http, path)
      recordSandboxAuditEntry({
        action: action === "deploy" ? "compose.deploy" : "compose.stop",
        detail: path,
        outcome: "allowed",
      })
      showToast({
        variant: "success",
        title:
          action === "deploy" ? language.t("containers.compose.deployed") : language.t("containers.compose.stopped"),
        description: result.output,
      })
      await props.onChanged?.()
    } catch (err) {
      recordSandboxAuditEntry({
        action: action === "deploy" ? "compose.deploy" : "compose.stop",
        detail: path,
        outcome: "denied",
      })
      showToast({
        variant: "error",
        title: language.t("containers.compose.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPending(undefined)
    }
  }

  return (
 <section class="flex flex-col gap-3 rounded-md border border-v2 border border-base bg-v2-background-bg-base p-4">
	<h2><center>Choose one of the Quick Launch Recipes below to get started.</center></h2>
      <div>
        <div class="text-sm text-v2-text-text-base">{language.t("quick_launch_recipes.title")}</div>
        <p class="m1 text-xs leading-relaxed text-v2-text-text-muted">{language.t("quick_launch_recipes.title")}</p>
      </div>
	<div class="min-w-2 flex flex-wrap gap-3 text-sm">
      <ButtonV2>
        Create Ubuntu Linux VM
      </ButtonV2>
	<ButtonV2>
	n8n workflow
	</ButtonV2>
		<ButtonV2>
			Django app
		</ButtonV2>
			<ButtonV2>
				Spin up Jenkins
			</ButtonV2>
				<ButtonV2>
					Svelte + Tailwind
				</ButtonV2>
					<ButtonV2>
						Spin up Ghidra
					</ButtonV2>
						<ButtonV2>
						Start a Notion container
						</ButtonV2>
	</div>
    </section>
 )

}
