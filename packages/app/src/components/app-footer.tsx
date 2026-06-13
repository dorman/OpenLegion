import codemaLabsUrl from "@/assets/codema-labs.base64"
import { useLanguage } from "@/context/language"

export function AppFooter() {
  const language = useLanguage()
  return (
    <footer
      data-component="app-footer"
      class="flex shrink-0 items-center justify-center gap-2 border-t border-v2-border-border-base bg-v2-background-bg-deep px-4 py-2"
    >
      <span class="text-[13px] text-v2-text-text-muted">{language.t("app.footer.madeBy")}</span>
      <img
        src={codemaLabsUrl}
        alt="Codema Labs"
        class="h-7 w-auto object-contain"
        draggable={false}
      />
    </footer>
  )
}
