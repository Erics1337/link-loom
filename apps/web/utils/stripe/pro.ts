import Stripe from 'stripe'
import { createAdminClient } from '@/utils/supabase/admin'
import { createProCheckoutSession, stripe } from '@/utils/stripe/checkout'

type StartProCheckoutInput = {
  userId: string
  email?: string | null
  origin: string
}

export const startProCheckoutForUser = async ({
  userId,
  email,
  origin,
}: StartProCheckoutInput) => {
  const supabase = createAdminClient()

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id,email,is_premium,stripe_customer_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    throw new Error(`Failed to load billing profile: ${profileError.message}`)
  }

  if (profile?.is_premium) {
    return { url: `${origin}/dashboard/billing?already_premium=true` }
  }

  const billingEmail = profile?.email || email || null

  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      {
        id: userId,
        email: billingEmail,
      },
      { onConflict: 'id' }
    )

  if (upsertError) {
    throw new Error(`Failed to initialize billing profile: ${upsertError.message}`)
  }

  const session = await createProCheckoutSession({
    userId,
    email: billingEmail,
    customerId: profile?.stripe_customer_id,
    origin,
  })

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL')
  }

  return { url: session.url }
}

export const applyCheckoutSessionToUser = async (session: Stripe.Checkout.Session) => {
  const supabase = createAdminClient()
  const userId = session.metadata?.userId || session.client_reference_id

  if (!userId) {
    throw new Error('Missing checkout user reference')
  }

  if (session.mode === 'payment') {
    if (session.payment_status !== 'paid') {
      return
    }

    const { error } = await supabase
      .from('users')
      .update({
        is_premium: true,
        stripe_customer_id: (session.customer as string | null) ?? null,
        subscription_id: session.id,
        subscription_status: 'lifetime',
      })
      .eq('id', userId)

    if (error) {
      throw new Error(`Failed to activate lifetime Pro access: ${error.message}`)
    }
    return
  }

  if (session.mode === 'subscription' && session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
    const { error } = await supabase
      .from('users')
      .update({
        is_premium: ['active', 'trialing'].includes(subscription.status),
        stripe_customer_id: subscription.customer as string,
        subscription_id: subscription.id,
        subscription_status: subscription.status,
      })
      .eq('id', userId)

    if (error) {
      throw new Error(`Failed to activate subscription Pro access: ${error.message}`)
    }
  }
}
