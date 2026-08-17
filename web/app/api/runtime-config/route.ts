import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const walletConnectProjectId =
    process.env.WALLETCONNECT_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() ||
    null;

  return NextResponse.json(
    { walletConnectProjectId },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
