import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { getProPriceId } from '@/utils/stripe/checkout'
import { startProCheckoutForUser } from '@/utils/stripe/pro'
import { enforceSameOrigin, rateLimit, sanitizeApiError } from '@/utils/api/security'

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request)
  if (originError) return originError

  const rateLimitError = await rateLimit({ key: 'checkout', limit: 10, windowMs: 60_000 })
  if (rateLimitError) return rateLimitError

  if (!getProPriceId()) {
    return NextResponse.json({ error: 'Checkout is temporarily unavailable' }, { status: 500 })
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
    return sanitizeApiError('[Stripe Checkout] Error:', checkoutError, 'Failed to start checkout')
  }
}
