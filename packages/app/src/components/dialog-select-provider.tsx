import { Component, Show } from "solid-js"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@openlegion-ai/ui/dialog"
import { List } from "@openlegion-ai/ui/list"
import { Tag } from "@openlegion-ai/ui/tag"
import { ProviderIcon } from "@openlegion-ai/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { DialogLocalProvider } from "./dialog-local-provider"

const CUSTOM_ID = "_custom"
const LOCAL_ID = "_local"

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")
  const localLabel = () => language.t("dialog.provider.local.label")
  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "openlegion-go") return language.t("dialog.provider.openlegionGo.tagline")
  }

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        class="px-3"
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return [
            { id: LOCAL_ID, name: localLabel() },
            { id: CUSTOM_ID, name: customLabel() },
            ...providers.all().values(),
          ]
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (x.id === LOCAL_ID || popularProviders.includes(x.id) ? popularGroup() : otherGroup())}
        sortBy={(a, b) => {
          if (a.id === LOCAL_ID) return -1
          if (b.id === LOCAL_ID) return 1
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const popular = popularGroup()
          if (a.category === popular && b.category !== popular) return -1
          if (b.category === popular && a.category !== popular) return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === LOCAL_ID) {
            dialog.show(() => <DialogLocalProvider back="providers" />)
            return
          }
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id === LOCAL_ID ? "synthetic" : i.id} />
            <span>{i.name}</span>
            <Show when={i.id === LOCAL_ID}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.local.tagline")}</div>
            </Show>
            <Show when={i.id === "openlegion"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.openlegion.tagline")}</div>
            </Show>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            <Show when={i.id === "openlegion"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
            <Show when={note(i.id)}>{(value) => <div class="text-14-regular text-text-weak">{value()}</div>}</Show>
            <Show when={i.id === "openlegion-go"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
