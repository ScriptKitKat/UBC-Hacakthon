export function isStale(loadedRev: number, ownWrites: number, currentRev: number): boolean {
  return currentRev > loadedRev + ownWrites;
}
