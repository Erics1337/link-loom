import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const getCheckoutMode = () =>
  process.env.STRIPE_CHECKOUT_MODE === 'subscription' ? 'subscription' : 'payment'

type CreateProCheckoutSessionInput = {
  userId: string
  email?: string | null
  origin: string
}

export const getProPriceId = () => process.env.STRIPE_PRICE_ID_PRO

export const createProCheckoutSession = async ({
  userId,
  email,
  origin,
}: CreateProCheckoutSessionInput) => {
  const priceId = getProPriceId()
  if (!priceId) {
    throw new Error('Missing STRIPE_PRICE_ID_PRO')
  }

  const mode = getCheckoutMode()

  return stripe.checkout.sessions.create({
    mode,
    customer_email: email || undefined,
    client_reference_id: userId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${origin}/dashboard/billing?success=true`,
    cancel_url: `${origin}/dashboard/billing?canceled=true`,
    metadata: {
      userId,
    },
    subscription_data: mode === 'subscription'
      ? { metadata: { userId } }
      : undefined,
  })
}
