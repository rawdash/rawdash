// Minimal parser for the handful of AWS Query-protocol (XML) responses this
// connector consumes: GetMetricData, STS AssumeRole, and error envelopes. It
// is deliberately narrow — it understands the specific element nesting these
// responses use rather than being a general-purpose XML parser.

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Inner text of the first `<tag>...</tag>` in `xml`. Returns '' for a
// self-closing `<tag/>`, and null when the tag is absent. Tags that contain
// repeated `<member>` children (Timestamps, Values, MetricDataResults) do not
// nest within themselves, so the first matching close tag is the correct one.
export function firstInner(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>`).exec(xml);
  if (!open) {
    return new RegExp(`<${escapedTag}\\s*/>`).test(xml) ? '' : null;
  }
  const start = open.index + open[0].length;
  const closeIdx = xml.indexOf(`</${tag}>`, start);
  if (closeIdx === -1) {
    return null;
  }
  return xml.slice(start, closeIdx);
}

export function firstText(xml: string, tag: string): string | null {
  const inner = firstInner(xml, tag);
  return inner === null ? null : decodeEntities(inner).trim();
}

// Inner content of each top-level `<member>...</member>`, tracking nesting so
// that a result member's nested Timestamps/Values members are not mistaken for
// top-level entries.
export function topLevelMembers(xml: string): string[] {
  const results: string[] = [];
  const re = /<member(?:\s[^>]*)?>|<\/member>/g;
  let depth = 0;
  let contentStart = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[0].startsWith('</')) {
      depth--;
      if (depth === 0 && contentStart !== -1) {
        results.push(xml.slice(contentStart, match.index));
        contentStart = -1;
      }
    } else {
      if (depth === 0) {
        contentStart = match.index + match[0].length;
      }
      depth++;
    }
  }
  return results;
}

export interface MetricDataResult {
  id: string;
  label: string;
  statusCode: string;
  timestamps: string[];
  values: number[];
}

export interface GetMetricDataParsed {
  results: MetricDataResult[];
  nextToken: string | null;
}

export function parseGetMetricData(xml: string): GetMetricDataParsed {
  const resultsBlock = firstInner(xml, 'MetricDataResults') ?? '';
  const results = topLevelMembers(resultsBlock).map((member) => {
    const tsBlock = firstInner(member, 'Timestamps') ?? '';
    const valBlock = firstInner(member, 'Values') ?? '';
    return {
      id: firstText(member, 'Id') ?? '',
      label: firstText(member, 'Label') ?? '',
      statusCode: firstText(member, 'StatusCode') ?? '',
      timestamps: topLevelMembers(tsBlock).map((t) => decodeEntities(t).trim()),
      values: topLevelMembers(valBlock).map((v) =>
        Number(decodeEntities(v).trim()),
      ),
    };
  });
  const nextToken = firstText(xml, 'NextToken');
  return { results, nextToken: nextToken === '' ? null : nextToken };
}

export interface StsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

export function parseAssumeRole(xml: string): StsCredentials | null {
  const credBlock = firstInner(xml, 'Credentials');
  if (credBlock === null) {
    return null;
  }
  const accessKeyId = firstText(credBlock, 'AccessKeyId') ?? '';
  const secretAccessKey = firstText(credBlock, 'SecretAccessKey') ?? '';
  if (accessKeyId === '' || secretAccessKey === '') {
    return null;
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: firstText(credBlock, 'SessionToken') ?? '',
    expiration: firstText(credBlock, 'Expiration') ?? '',
  };
}

// AWS Query-protocol error envelopes carry the machine-readable error code in
// an `<Error><Code>...</Code></Error>` element.
export function parseErrorCode(xml: string): string | null {
  return firstText(xml, 'Code');
}
