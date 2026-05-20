import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RAWDASH_URL = process.env['RAWDASH_URL'];
const API_KEY = process.env['RAWDASH_API_KEY'];

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!RAWDASH_URL) {
    return NextResponse.json(
      { error: 'RAWDASH_URL is not configured' },
      { status: 503 },
    );
  }

  const { path } = await params;
  const targetUrl = `${RAWDASH_URL}/${path.join('/')}${request.nextUrl.search}`;

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

  try {
    const upstream = await fetch(targetUrl, init);
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch (error) {
    console.error('Proxy fetch failed:', { targetUrl, error });
    return NextResponse.json(
      { error: 'Failed to fetch from upstream API' },
      { status: 502 },
    );
  }
}

export const GET = handler;
export const POST = handler;
