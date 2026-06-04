import { type ComponentProps } from "solid-js"

import iconUrl from "../assets/brand/openlegion-icon.png"
import wordmarkUrl from "../assets/brand/openlegion-wordmark.png"

const imgClass = (className: string | undefined) => ({ [className ?? ""]: !!className })

/** Hooded archer mark with cyber shield — compact icon */
export const Mark = (props: { class?: string; alt?: string }) => {
  return (
    <img
      data-component="logo-mark"
      src={iconUrl}
      alt={props.alt ?? "OpenLegion"}
      classList={imgClass(props.class)}
      draggable={false}
    />
  )
}

/** Loading splash emblem */
export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class" | "alt">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      src={iconUrl}
      alt={props.alt ?? "OpenLegion"}
      classList={imgClass(props.class)}
      draggable={false}
    />
  )
}

/** Full wordmark for headers and home */
export const Logo = (props: { class?: string; alt?: string }) => {
  return (
    <img
      data-component="logo-wordmark"
      src={wordmarkUrl}
      alt={props.alt ?? "OpenLegion"}
      classList={imgClass(props.class)}
      draggable={false}
    />
  )
}
