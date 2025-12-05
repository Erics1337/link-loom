import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: session.user.email,
    client_reference_id: session.user.id,
    line_items: [
      {
        price: 'price_1234567890', // Replace with your actual Stripe Price ID
        quantity: 1,
      },
    ],
    success_url: `${request.headers.get('origin')}/dashboard?success=true`,
    cancel_url: `${request.headers.get('origin')}/dashboard?canceled=true`,
    metadata: {
      userId: session.user.id,
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
