import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const stripePriceIdPro = process.env.STRIPE_PRICE_ID_PRO

export async function POST(request: Request) {
  if (!stripePriceIdPro) {
    return new NextResponse('Missing STRIPE_PRICE_ID_PRO', { status: 500 })
  }

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
        price: stripePriceIdPro,
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
