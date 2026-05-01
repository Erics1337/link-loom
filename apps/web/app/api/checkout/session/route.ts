import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { stripe } from '@/utils/stripe/checkout'
import { applyCheckoutSessionToUser } from '@/utils/stripe/pro'

export async function POST(request: Request) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { sessionId } = await request.json().catch(() => ({ sessionId: null }))

  if (!sessionId || typeof sessionId !== 'string') {
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
    console.error('[Stripe Checkout Session] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync checkout session' },
      { status: 500 }
    )
  }
}
