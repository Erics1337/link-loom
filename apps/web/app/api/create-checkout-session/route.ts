import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getProPriceId } from '@/utils/stripe/checkout';
import { startProCheckoutForUser } from '@/utils/stripe/pro';
import { rateLimit, sanitizeApiError } from '@/utils/api/security';

export async function POST(req: Request) {
  const rateLimitError = await rateLimit({ key: 'checkout:token', limit: 10, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Missing Supabase auth configuration' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    if (body.userId && body.userId !== user.id) {
      return NextResponse.json({ error: 'Checkout user mismatch' }, { status: 403 });
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    if (!getProPriceId()) {
      return NextResponse.json(
        { error: 'Checkout is temporarily unavailable' },
        { status: 500 }
      );
    }

    const result = await startProCheckoutForUser({
      userId: user.id,
      email: user.email,
      origin,
    });

    return NextResponse.json(result);
  } catch (error) {
    return sanitizeApiError('[Stripe Checkout] Error:', error, 'Failed to start checkout');
  }
}
