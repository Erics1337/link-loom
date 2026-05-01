import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createProCheckoutSession, getProPriceId } from '@/utils/stripe/checkout';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: Request) {
  try {
    const { userId, email } = await req.json();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    if (!userId || !getProPriceId()) {
      return NextResponse.json(
        { error: 'Missing userId or STRIPE_PRICE_ID_PRO' },
        { status: 400 }
      );
    }

    // Ensure user row exists so webhooks can reliably update premium state.
    await supabase.from('users').upsert(
      { id: userId, email: email || null },
      { onConflict: 'id' }
    );

    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    const session = await createProCheckoutSession({
      userId,
      email: user?.email || email,
      origin,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('[Stripe Checkout] Error:', error);
    return new NextResponse(`Internal Error: ${error.message}`, { status: 500 });
  }
}
