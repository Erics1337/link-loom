import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { stripe } from '@/utils/stripe/checkout'
import { applyCheckoutSessionToUser } from '@/utils/stripe/pro'
import { requireApiUser } from '@/utils/api/auth'
import { enforceSameOrigin, rateLimit, sanitizeApiError } from '@/utils/api/security'

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request)
  if (originError) return originError

  const rateLimitError = await rateLimit({ key: 'checkout:session', limit: 20, windowMs: 60_000 })
  if (rateLimitError) return rateLimitError

  const { user, response: unauthorizedResponse } = await requireApiUser()
  if (unauthorizedResponse) return unauthorizedResponse

  const { sessionId } = await request.json().catch(() => ({ sessionId: null }))

  if (!sessionId || typeof sessionId !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return NextResponse.json({ error: 'Missing checkout session id' }, { status: 400 })
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
    const checkoutUserId = checkoutSession.metadata?.userId || checkoutSession.client_reference_id

    if (checkoutUserId !== user.id) {
      return NextResponse.json({ error: 'Checkout session does not belong to this user' }, { status: 403 })
    }

    await applyCheckoutSessionToUser(checkoutSession)

    const admin = createAdminClient()
    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profileError) {
      throw new Error(`Failed to load updated billing profile: ${profileError.message}`)
    }

    return NextResponse.json({ profile })
  } catch (error) {
    return sanitizeApiError('[Stripe Checkout Session] Error:', error, 'Failed to sync checkout session')
  }
}
