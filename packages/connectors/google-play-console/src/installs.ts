export interface InstallsBreakdown {
  resource: string;
  fileDimension: string;
  phase: string;
  responseTag: string;
  dimensionAttr: string | null;
  dimensionDescription: string;
  description: string;
}

export const INSTALLS_BREAKDOWNS: InstallsBreakdown[] = [
  {
    resource: 'gplay_installs_overview_by_day',
    fileDimension: 'overview',
    phase: 'installs_overview',
    responseTag: 'installs_overview',
    dimensionAttr: null,
    dimensionDescription: '',
    description:
      'Daily install statistics for the app from the Play Console monthly installs report (stats/installs overview CSV). Primary value is Daily Device Installs; uninstalls, upgrades, active-device installs and user-keyed counts are carried as additional attributes.',
  },
  {
    resource: 'gplay_installs_by_country',
    fileDimension: 'country',
    phase: 'installs_country',
    responseTag: 'installs_country',
    dimensionAttr: 'country',
    dimensionDescription:
      'ISO 3166-1 alpha-2 country/region code the installs are attributed to.',
    description:
      'Daily install statistics broken down by country/region from the Play Console monthly installs report (stats/installs country CSV).',
  },
  {
    resource: 'gplay_installs_by_app_version',
    fileDimension: 'app_version',
    phase: 'installs_app_version',
    responseTag: 'installs_app_version',
    dimensionAttr: 'app_version_code',
    dimensionDescription: 'Android versionCode the installs are attributed to.',
    description:
      'Daily install statistics broken down by app version code from the Play Console monthly installs report (stats/installs app_version CSV).',
  },
  {
    resource: 'gplay_installs_by_device',
    fileDimension: 'device',
    phase: 'installs_device',
    responseTag: 'installs_device',
    dimensionAttr: 'device',
    dimensionDescription: 'Device codename the installs are attributed to.',
    description:
      'Daily install statistics broken down by device from the Play Console monthly installs report (stats/installs device CSV).',
  },
  {
    resource: 'gplay_installs_by_os_version',
    fileDimension: 'os_version',
    phase: 'installs_os_version',
    responseTag: 'installs_os_version',
    dimensionAttr: 'android_os_version',
    dimensionDescription:
      'Android API level (SDK version) the installs are attributed to.',
    description:
      'Daily install statistics broken down by Android OS version from the Play Console monthly installs report (stats/installs os_version CSV).',
  },
  {
    resource: 'gplay_installs_by_language',
    fileDimension: 'language',
    phase: 'installs_language',
    responseTag: 'installs_language',
    dimensionAttr: 'language',
    dimensionDescription:
      'BCP-47 language/locale code the installs are attributed to.',
    description:
      'Daily install statistics broken down by language from the Play Console monthly installs report (stats/installs language CSV).',
  },
  {
    resource: 'gplay_installs_by_carrier',
    fileDimension: 'carrier',
    phase: 'installs_carrier',
    responseTag: 'installs_carrier',
    dimensionAttr: 'carrier',
    dimensionDescription: 'Mobile carrier the installs are attributed to.',
    description:
      'Daily install statistics broken down by carrier from the Play Console monthly installs report (stats/installs carrier CSV).',
  },
];

export const INSTALLS_METRIC_ATTRIBUTES = [
  'current_device_installs',
  'active_device_installs',
  'daily_device_installs',
  'daily_device_uninstalls',
  'daily_device_upgrades',
  'current_user_installs',
  'total_user_installs',
  'daily_user_installs',
  'daily_user_uninstalls',
] as const;

const PRIMARY_METRIC_KEY = 'daily_device_installs';

const METRIC_KEY_ALIASES: Record<string, string> = {
  installs_on_active_devices: 'active_device_installs',
};

const KNOWN_METRIC_KEYS = new Set<string>([
  ...INSTALLS_METRIC_ATTRIBUTES,
  'installs_on_active_devices',
]);

const INSTALLS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InstallsSample {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number>;
}

export function normalizeInstallsBucketId(value: string): string {
  return value
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}

export function installsObjectPath(
  packageName: string,
  yyyymm: string,
  fileDimension: string,
): string {
  return `stats/installs/installs_${packageName}_${yyyymm}_${fileDimension}.csv`;
}

export function installsMonthsForRange(
  startDate: string,
  endDate: string,
): string[] {
  const start = monthIndex(startDate);
  const end = monthIndex(endDate);
  if (start === null || end === null || end < start) {
    return [];
  }
  const months: string[] = [];
  for (let m = start; m <= end; m++) {
    const year = Math.floor(m / 12);
    const month = (m % 12) + 1;
    months.push(
      `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}`,
    );
  }
  return months;
}

function monthIndex(date: string): number | null {
  if (!INSTALLS_DATE_RE.test(date)) {
    return null;
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return year * 12 + (month - 1);
}

export function decodeUtf16Csv(bytes: Uint8Array): string {
  const littleEndian = !(bytes[0] === 0xfe && bytes[1] === 0xff);
  const decoder = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be');
  const text = decoder.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let sawContent = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawContent = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      sawContent = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') {
        i++;
      }
      if (sawContent || field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      field = '';
      row = [];
      sawContent = false;
    } else {
      field += c;
      sawContent = true;
    }
  }
  if (sawContent || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function installsDateToMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

export function parseInstallsCsv(
  text: string,
  breakdown: InstallsBreakdown,
  packageName: string,
): InstallsSample[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return [];
  }

  const header = rows[0]!.map(normalizeHeaderKey);
  const dateIdx = header.indexOf('date');
  if (dateIdx < 0) {
    return [];
  }

  const metricCols: Array<{ idx: number; key: string }> = [];
  let dimIdx = -1;
  for (let i = 0; i < header.length; i++) {
    const key = header[i]!;
    if (i === dateIdx || key === 'package_name') {
      continue;
    }
    if (KNOWN_METRIC_KEYS.has(key)) {
      metricCols.push({ idx: i, key: METRIC_KEY_ALIASES[key] ?? key });
    } else if (breakdown.dimensionAttr && dimIdx < 0) {
      dimIdx = i;
    }
  }

  const samples: InstallsSample[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    const dateStr = (cols[dateIdx] ?? '').trim();
    if (!INSTALLS_DATE_RE.test(dateStr)) {
      continue;
    }

    const attributes: Record<string, string | number> = {
      date: dateStr,
      package_name: packageName,
    };
    if (breakdown.dimensionAttr && dimIdx >= 0) {
      attributes[breakdown.dimensionAttr] = (cols[dimIdx] ?? '').trim();
    }
    for (const mc of metricCols) {
      const raw = (cols[mc.idx] ?? '').trim();
      const parsed = raw === '' ? 0 : Number(raw);
      attributes[mc.key] = Number.isFinite(parsed) ? parsed : 0;
    }

    const primary = attributes[PRIMARY_METRIC_KEY];
    const value = typeof primary === 'number' ? primary : 0;

    samples.push({
      name: breakdown.resource,
      ts: installsDateToMs(dateStr),
      value,
      attributes,
    });
  }

  return samples;
}
