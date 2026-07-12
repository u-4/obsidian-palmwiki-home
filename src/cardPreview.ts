import type { HoverLinkSource, HoverParent } from "obsidian";

export const CARD_PREVIEW_MODE_OPTIONS = {
  off: "Off",
  modifier: "Cmd/Ctrl + hover",
  hover: "Hover"
} as const;

export type CardPreviewMode = keyof typeof CARD_PREVIEW_MODE_OPTIONS;

export interface CardPreviewSource {
  id: string;
  info: HoverLinkSource;
}

export interface CardPreviewEventPayload {
  event: MouseEvent;
  hoverParent: HoverParent;
  linktext: string;
  source: string;
  sourcePath: string;
  targetEl: HTMLElement;
}

const MODIFIER_SOURCE: CardPreviewSource = {
  id: "palmwiki-home-card-preview-modifier",
  info: {
    display: "PalmWiki Home cards",
    defaultMod: true
  }
};

const HOVER_SOURCE: CardPreviewSource = {
  id: "palmwiki-home-card-preview-hover",
  info: {
    display: "PalmWiki Home cards",
    defaultMod: false
  }
};

export function isCardPreviewMode(value: unknown): value is CardPreviewMode {
  return value === "off" || value === "modifier" || value === "hover";
}

export function getCardPreviewSource(mode: CardPreviewMode): CardPreviewSource | null {
  if (mode === "modifier") {
    return MODIFIER_SOURCE;
  }
  if (mode === "hover") {
    return HOVER_SOURCE;
  }
  return null;
}

export function createCardPreviewEventPayload(options: {
  event: MouseEvent;
  hoverParent: HoverParent;
  path: string;
  source: CardPreviewSource;
  targetEl: HTMLElement;
}): CardPreviewEventPayload {
  return {
    event: options.event,
    hoverParent: options.hoverParent,
    linktext: options.path,
    source: options.source.id,
    sourcePath: "",
    targetEl: options.targetEl
  };
}
