const LEADING_KEYWORDS = new Set(['select', 'with', 'table', 'values']);

const FORBIDDEN_KEYWORDS = [
  'alter',
  'create',
  'delete',
  'drop',
  'grant',
  'insert',
  'into',
  'merge',
  'reindex',
  'revoke',
  'truncate',
  'update',
  'vacuum',
] as const;

const DOLLAR_TAG = /^\$([A-Za-z_]\w*)?\$/;

export function stripSqlNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }
    if (rest.startsWith('/*')) {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      i = j;
      out += ' ';
      continue;
    }
    const char = sql[i]!;
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === char) {
          if (sql[j + 1] === char) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        if (char === "'" && sql[j] === '\\') {
          j += 2;
          continue;
        }
        j += 1;
      }
      i = j;
      out += ' ';
      continue;
    }
    if (char === '$') {
      const tag = DOLLAR_TAG.exec(rest);
      if (tag) {
        const marker = tag[0];
        const close = sql.indexOf(marker, i + marker.length);
        i = close === -1 ? sql.length : close + marker.length;
        out += ' ';
        continue;
      }
    }
    out += char;
    i += 1;
  }
  return out;
}

export function highestPlaceholder(sql: string): number {
  let highest = 0;
  for (const match of stripSqlNoise(sql).matchAll(/\$(\d+)/g)) {
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, '');
}

export function readOnlySqlIssues(sql: string): string[] {
  const stripped = stripSqlNoise(sql);
  const normalized = stripped.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return ['SQL is empty (or contains only comments).'];
  }

  const issues: string[] = [];
  const withoutTrailing = stripTrailingSemicolon(normalized);
  if (withoutTrailing.includes(';')) {
    issues.push(
      'SQL must be a single statement; remove the `;` separating statements.',
    );
  }

  const leading = /^\(*\s*([A-Za-z_]+)/.exec(withoutTrailing)?.[1] ?? '';
  if (!LEADING_KEYWORDS.has(leading.toLowerCase())) {
    issues.push(
      `SQL must start with ${[...LEADING_KEYWORDS]
        .map((k) => k.toUpperCase())
        .join(', ')}; got "${leading || withoutTrailing.slice(0, 12)}".`,
    );
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(withoutTrailing)) {
      issues.push(
        `SQL must be read-only; the \`${keyword.toUpperCase()}\` keyword is not allowed.`,
      );
    }
  }

  return issues;
}

export function isReadOnlySql(sql: string): boolean {
  return readOnlySqlIssues(sql).length === 0;
}
