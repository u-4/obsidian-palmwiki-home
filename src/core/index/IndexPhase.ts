export type IndexPhase = "waiting" | "indexing" | "complete" | "error";

export interface IndexPhaseInput {
  indexDirty: boolean;
  isIndexing: boolean;
  lastError: string | null;
}

export function deriveIndexPhase(state: IndexPhaseInput): IndexPhase {
  if (state.isIndexing) {
    return "indexing";
  }

  if (state.lastError) {
    return "error";
  }

  return state.indexDirty ? "waiting" : "complete";
}
