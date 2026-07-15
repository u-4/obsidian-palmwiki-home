export interface ToolbarFilterState {
  folderFilter: string;
  linkTargetPath: string;
  query: string;
  tagFilter: string;
}

export function countActiveToolbarFilters({
  folderFilter,
  linkTargetPath,
  query,
  tagFilter
}: ToolbarFilterState): number {
  return [folderFilter, tagFilter, query.trim(), linkTargetPath].filter(
    Boolean
  ).length;
}

export function getDisplaySettingsToggleLabel(
  isOpen: boolean,
  activeFilterCount: number
): string {
  if (isOpen) {
    return "Hide display settings";
  }

  if (activeFilterCount <= 0) {
    return "Show display settings";
  }

  return `Show display settings, ${activeFilterCount} active filter${
    activeFilterCount === 1 ? "" : "s"
  }`;
}
