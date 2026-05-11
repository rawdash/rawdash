import { NextRequest, NextResponse } from 'next/server';

const CLOUD_URL = process.env['RAWDASH_CLOUD_URL'];
const API_KEY = process.env['RAWDASH_API_KEY'];

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!CLOUD_URL) {
    return NextResponse.json(
      { error: 'RAWDASH_CLOUD_URL is not configured' },
      { status: 503 },
    );
  }

  const { path } = await params;
  const targetUrl = `${CLOUD_URL}/${path.join('/')}${request.nextUrl.search}`;

  const headers: Record<string, string> = {};
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  const upstream = await fetch(targetUrl, init);
  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
}

export const GET = handler;
export const POST = handler;
