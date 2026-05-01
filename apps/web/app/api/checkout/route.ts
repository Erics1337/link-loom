import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { createProCheckoutSession, getProPriceId } from '@/utils/stripe/checkout'

export async function POST(request: Request) {
  if (!getProPriceId()) {
    return new NextResponse('Missing STRIPE_PRICE_ID_PRO', { status: 500 })
  }

  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const checkoutSession = await createProCheckoutSession({
    userId: session.user.id,
    email: session.user.email,
    origin: new URL(request.url).origin,
  })

  return NextResponse.json({ url: checkoutSession.url })
}
