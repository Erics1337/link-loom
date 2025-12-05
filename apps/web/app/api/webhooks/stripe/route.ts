import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function POST(request: Request) {
  const body = await request.text()
  const signature = headers().get('Stripe-Signature') as string

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (error: any) {
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 })
  }

  const session = event.data.object as Stripe.Checkout.Session

  if (event.type === 'checkout.session.completed') {
    const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
    const userId = session.metadata!.userId

    await supabase
      .from('users')
      .update({
        is_premium: true,
        stripe_customer_id: subscription.customer as string,
        subscription_id: subscription.id,
        subscription_status: subscription.status,
      })
      .eq('id', userId)
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    // Find user by stripe_customer_id if userId is not available in metadata here
    // But usually we store stripe_customer_id in DB
    
    await supabase
      .from('users')
      .update({
        is_premium: subscription.status === 'active',
        subscription_status: subscription.status,
      })
      .eq('stripe_customer_id', subscription.customer as string)
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription

    await supabase
      .from('users')
      .update({
        is_premium: false,
        subscription_status: subscription.status,
      })
      .eq('stripe_customer_id', subscription.customer as string)
  }

  return new NextResponse(null, { status: 200 })
}
