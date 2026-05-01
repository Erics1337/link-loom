import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/utils/supabase/admin'
import { applyCheckoutSessionToUser } from '@/utils/stripe/pro'
import { stripe } from '@/utils/stripe/checkout'

export async function POST(request: Request) {
  const body = await request.text()
  const signature = headers().get('Stripe-Signature') as string

  console.log('[Stripe Webhook] Received webhook, signature:', signature?.substring(0, 20) + '...')

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
    console.log('[Stripe Webhook] Event verified:', event.type, 'ID:', event.id)
  } catch (error: any) {
    console.error('[Stripe Webhook] Signature verification failed:', error.message)
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 })
  }

  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session
      console.log('[Stripe Webhook] Processing checkout session:', session.id)
      console.log('[Stripe Webhook] Session mode:', session.mode, 'payment_status:', session.payment_status)
      console.log('[Stripe Webhook] metadata:', session.metadata, 'client_reference_id:', session.client_reference_id)
      await applyCheckoutSessionToUser(session)
      console.log('[Stripe Webhook] Successfully processed checkout session')
    }

    if (event.type === 'customer.subscription.updated') {
      const supabase = createAdminClient()
      const subscription = event.data.object as Stripe.Subscription

      const { error } = await supabase
        .from('users')
        .update({
          is_premium: ['active', 'trialing'].includes(subscription.status),
          subscription_status: subscription.status,
        })
        .eq('stripe_customer_id', subscription.customer as string)

      if (error) {
        throw new Error(`Failed to update subscription status: ${error.message}`)
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const supabase = createAdminClient()
      const subscription = event.data.object as Stripe.Subscription

      const { error } = await supabase
        .from('users')
        .update({
          is_premium: false,
          subscription_status: subscription.status,
        })
        .eq('stripe_customer_id', subscription.customer as string)

      if (error) {
        throw new Error(`Failed to mark subscription deleted: ${error.message}`)
      }
    }
  } catch (error) {
    console.error('[Stripe Webhook] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook handler failed' },
      { status: 500 }
    )
  }

  return new NextResponse(null, { status: 200 })
}
