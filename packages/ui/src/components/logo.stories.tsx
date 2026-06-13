// @ts-nocheck
import * as mod from "./logo"

const docs = `### Overview
OpenLegion logo assets: mark, splash, and wordmark.

Use Mark for compact spaces, Logo for stacked wordmark, Splash for hero sections.

### API
- \`Mark\`, \`Splash\`, and \`Logo\` load brand PNGs from \`assets/brand\`.

### Variants and states
- \`Mark\`: eyeless hood icon.
- \`Splash\`: loading emblem (eyeless hood mark + wordmark, transparent background).
- \`Logo\`: stacked icon + OpenLegion wordmark.

### Behavior
- White-on-transparent assets intended for dark desktop chrome.

### Accessibility
- Provide title/aria-label when logos convey meaning.

### Theming/tokens
- Uses theme color tokens via CSS variables.

`

export default {
  title: "UI/Logo",
  id: "components-logo",
  component: mod.Logo,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <div style={{ display: "grid", gap: "16px", "align-items": "start" }}>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Mark</div>
        <mod.Mark />
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Splash</div>
        <mod.Splash class="w-40 object-contain" />
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Logo</div>
        <mod.Logo class="max-w-[200px] h-auto object-contain" />
      </div>
    </div>
  ),
}
