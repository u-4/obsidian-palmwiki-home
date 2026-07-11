export function normalizeSearchText(input: string): string {
  return input.normalize("NFKC").toLocaleLowerCase();
}
