export function compareConnectorVersions(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = Number.parseInt(partsA[i] ?? '0', 10);
    const numB = Number.parseInt(partsB[i] ?? '0', 10);
    const safeA = Number.isNaN(numA) ? 0 : numA;
    const safeB = Number.isNaN(numB) ? 0 : numB;
    if (safeA !== safeB) {return safeA < safeB ? -1 : 1;}
  }
  return 0;
}

export function latestVersion(versions: ReadonlyArray<string>): string | null {
  let max: string | null = null;
  for (const version of versions) {
    if (max === null || compareConnectorVersions(version, max) > 0)
      {max = version;}
  }
  return max;
}
