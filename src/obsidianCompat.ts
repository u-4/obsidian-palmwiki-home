import type { Workspace } from "obsidian";

type RuntimeHoverWorkspace = Workspace & {
  unregisterHoverLinkSource?: (sourceId: string) => void;
};

export function unregisterHoverLinkSourceCompat(
  workspace: Workspace,
  sourceId: string
): boolean {
  try {
    const unregister = (workspace as RuntimeHoverWorkspace).unregisterHoverLinkSource;
    if (typeof unregister !== "function") {
      return false;
    }
    unregister.call(workspace, sourceId);
    return true;
  } catch {
    return false;
  }
}
