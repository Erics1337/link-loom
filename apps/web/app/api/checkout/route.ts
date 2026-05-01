import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { getProPriceId } from '@/utils/stripe/checkout'
import { startProCheckoutForUser } from '@/utils/stripe/pro'

export async function POST(request: Request) {
  if (!getProPriceId()) {
    return NextResponse.json({ error: 'Missing STRIPE_PRICE_ID_PRO' }, { status: 500 })
  }

  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await startProCheckoutForUser({
      userId: user.id,
      email: user.email,
      origin: new URL(request.url).origin,
    })

    return NextResponse.json(result)
  } catch (checkoutError) {
    console.error('[Stripe Checkout] Error:', checkoutError)
    return NextResponse.json(
      { error: checkoutError instanceof Error ? checkoutError.message : 'Failed to start checkout' },
      { status: 500 }
    )
  }
}
