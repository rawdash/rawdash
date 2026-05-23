export type EpochUnit = 'ms' | 's' | 'iso';

export function parseEpoch(
  value: number | string | null | undefined,
  unit: EpochUnit,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (unit === 'iso') {
    if (typeof value !== 'string') {
      return null;
    }
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  const result = unit === 's' ? n * 1000 : n;
  return Number.isFinite(result) ? result : null;
}
