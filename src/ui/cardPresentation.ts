import type { PalmWikiCardShape } from "../settings/Settings";

export interface CardPresentation {
  showDescriptionPathFallback: boolean;
  showSecondaryMetadata: boolean;
}

export function getCardPresentation(
  cardShape: PalmWikiCardShape
): CardPresentation {
  const showSecondaryMetadata = cardShape === "portrait";

  return {
    showDescriptionPathFallback: showSecondaryMetadata,
    showSecondaryMetadata
  };
}
