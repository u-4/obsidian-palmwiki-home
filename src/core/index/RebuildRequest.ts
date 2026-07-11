export interface RebuildRequest {
  reason: string;
  allowBackground: boolean;
}

export function mergeRebuildRequest(
  current: RebuildRequest | null,
  next: RebuildRequest
): RebuildRequest {
  return {
    reason: next.reason,
    allowBackground: current?.allowBackground === true || next.allowBackground
  };
}

export function canRunScheduledRebuild(
  request: RebuildRequest,
  homeViewActive: boolean
): boolean {
  return request.allowBackground || homeViewActive;
}
