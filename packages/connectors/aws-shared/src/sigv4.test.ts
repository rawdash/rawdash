import { describe, expect, it } from 'vitest';

import { createAuthorizationHeader, formatAmzDate, sha256Hex } from './sigv4';

describe('sha256Hex', () => {
  it('matches the well-known empty-string digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the well-known "abc" digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('formatAmzDate', () => {
  it('strips separators into the SigV4 date forms', () => {
    expect(formatAmzDate(new Date('2015-08-30T12:36:00Z'))).toEqual({
      amzDate: '20150830T123600Z',
      dateStamp: '20150830',
    });
  });
});

describe('createAuthorizationHeader', () => {
  // AWS SigV4 test suite, `get-vanilla` case:
  // https://docs.aws.amazon.com/general/latest/gr/signature-v4-test-suite.html
  it('reproduces the published get-vanilla signature', async () => {
    const emptyHash = await sha256Hex('');
    const authorization = await createAuthorizationHeader({
      method: 'GET',
      host: 'example.amazonaws.com',
      path: '/',
      query: '',
      headers: {
        host: 'example.amazonaws.com',
        'x-amz-date': '20150830T123600Z',
      },
      payloadHash: emptyHash,
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'service',
      amzDate: '20150830T123600Z',
      dateStamp: '20150830',
    });

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('sorts signed headers regardless of input order', async () => {
    const authorization = await createAuthorizationHeader({
      method: 'POST',
      host: 'monitoring.us-east-1.amazonaws.com',
      path: '/',
      query: '',
      headers: {
        'x-amz-date': '20150830T123600Z',
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        host: 'monitoring.us-east-1.amazonaws.com',
      },
      payloadHash: await sha256Hex('Action=GetMetricData'),
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'monitoring',
      amzDate: '20150830T123600Z',
      dateStamp: '20150830',
    });

    expect(authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-date',
    );
  });
});
