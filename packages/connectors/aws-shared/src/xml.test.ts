import { describe, expect, it } from 'vitest';

import { parseAssumeRole, parseErrorCode, parseGetMetricData } from './xml';

const GET_METRIC_DATA_XML = `<?xml version="1.0"?>
<GetMetricDataResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/">
  <GetMetricDataResult>
    <MetricDataResults>
      <member>
        <Id>cpu</Id>
        <Label>CPUUtilization</Label>
        <Timestamps>
          <member>2024-01-01T00:00:00Z</member>
          <member>2024-01-01T00:05:00Z</member>
        </Timestamps>
        <Values>
          <member>12.5</member>
          <member>13.25</member>
        </Values>
        <StatusCode>Complete</StatusCode>
      </member>
      <member>
        <Id>net</Id>
        <Label>NetworkIn &amp; Out</Label>
        <Timestamps>
          <member>2024-01-01T00:00:00Z</member>
        </Timestamps>
        <Values>
          <member>1024</member>
        </Values>
        <StatusCode>Complete</StatusCode>
      </member>
    </MetricDataResults>
  </GetMetricDataResult>
  <ResponseMetadata>
    <RequestId>req-1</RequestId>
  </ResponseMetadata>
</GetMetricDataResponse>`;

describe('parseGetMetricData', () => {
  it('parses each metric result with paired timestamps and values', () => {
    const parsed = parseGetMetricData(GET_METRIC_DATA_XML);
    expect(parsed.nextToken).toBeNull();
    expect(parsed.results).toHaveLength(2);

    const cpu = parsed.results[0]!;
    expect(cpu.id).toBe('cpu');
    expect(cpu.label).toBe('CPUUtilization');
    expect(cpu.statusCode).toBe('Complete');
    expect(cpu.timestamps).toEqual([
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:05:00Z',
    ]);
    expect(cpu.values).toEqual([12.5, 13.25]);

    const net = parsed.results[1]!;
    expect(net.id).toBe('net');
    expect(net.label).toBe('NetworkIn & Out');
    expect(net.values).toEqual([1024]);
  });

  it('captures the NextToken when present', () => {
    const xml = GET_METRIC_DATA_XML.replace(
      '</GetMetricDataResult>',
      '<NextToken>tok-abc</NextToken></GetMetricDataResult>',
    );
    expect(parseGetMetricData(xml).nextToken).toBe('tok-abc');
  });

  it('handles an empty MetricDataResults set', () => {
    const xml = `<GetMetricDataResponse><GetMetricDataResult><MetricDataResults/></GetMetricDataResult></GetMetricDataResponse>`;
    const parsed = parseGetMetricData(xml);
    expect(parsed.results).toEqual([]);
    expect(parsed.nextToken).toBeNull();
  });
});

describe('parseAssumeRole', () => {
  it('extracts temporary credentials', () => {
    const xml = `<AssumeRoleResponse><AssumeRoleResult><Credentials>
        <AccessKeyId>ASIA_TEMP</AccessKeyId>
        <SecretAccessKey>temp-secret</SecretAccessKey>
        <SessionToken>session-token</SessionToken>
        <Expiration>2024-01-01T01:00:00Z</Expiration>
      </Credentials></AssumeRoleResult></AssumeRoleResponse>`;
    expect(parseAssumeRole(xml)).toEqual({
      accessKeyId: 'ASIA_TEMP',
      secretAccessKey: 'temp-secret',
      sessionToken: 'session-token',
      expiration: '2024-01-01T01:00:00Z',
    });
  });

  it('returns null when no credentials block is present', () => {
    expect(parseAssumeRole('<AssumeRoleResponse/>')).toBeNull();
  });
});

describe('parseErrorCode', () => {
  it('reads the AWS error code from a query-protocol error envelope', () => {
    const xml = `<ErrorResponse><Error><Type>Sender</Type><Code>Throttling</Code><Message>Rate exceeded</Message></Error></ErrorResponse>`;
    expect(parseErrorCode(xml)).toBe('Throttling');
  });
});
