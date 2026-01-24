import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: Request) {
  try {
    const { userId, priceId, successUrl, cancelUrl } = await req.json();

    if (!userId || !priceId) {
      return new NextResponse('Missing userId or priceId', { status: 400 });
    }

    // Optional: Check if user already exists or get email
    const { data: user } = await supabase.from('users').select('email').eq('id', userId).single();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // One-time payment
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      client_reference_id: userId,
      metadata: {
        userId: userId,
      },
      customer_email: user?.email, // Pre-fill email if known
      success_url: successUrl || `${req.headers.get('origin')}/dashboard/billing?success=true`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/dashboard/billing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('[Stripe Checkout] Error:', error);
    return new NextResponse(`Internal Error: ${error.message}`, { status: 500 });
  }
}
