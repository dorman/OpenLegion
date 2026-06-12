export function RuntimePill(props: {
  label: string
  ready: boolean
  readyLabel: string
  unavailableLabel: string
}) {
  return (
    <span
      classList={{
        "desktop-pill": true,
        "desktop-pill-success": props.ready,
        "desktop-pill-stopped": !props.ready,
      }}
    >
      {props.label}: {props.ready ? props.readyLabel : props.unavailableLabel}
    </span>
  )
}
