export function selectedResearchSymbol(pathSymbol: string, contract: string | undefined): string {
  const chosen = contract?.trim();
  return chosen !== undefined && chosen !== "" ? chosen : pathSymbol;
}
