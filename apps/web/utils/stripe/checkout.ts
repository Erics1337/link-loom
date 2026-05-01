import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  maxNetworkRetries: 2,
})

const getCheckoutMode = () =>
  process.env.STRIPE_CHECKOUT_MODE === 'subscription' ? 'subscription' : 'payment'

type CreateProCheckoutSessionInput = {
  userId: string
  email?: string | null
  customerId?: string | null
  origin: string
}

export const getProPriceId = () => process.env.STRIPE_PRICE_ID_PRO

const assertProPriceIsUsable = async (priceId: string, mode: 'payment' | 'subscription') => {
  let price: Stripe.Price

  try {
    price = await stripe.prices.retrieve(priceId)
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      throw new Error(
        `Stripe price ${priceId} was not found. Make sure STRIPE_PRICE_ID_PRO belongs to the same Stripe account and test/live mode as STRIPE_SECRET_KEY.`
      )
    }

    throw error
  }

  if (!price.active) {
    throw new Error(`Stripe price ${priceId} is inactive. Choose an active Pro Price in Stripe.`)
  }

  if (mode === 'subscription' && !price.recurring) {
    throw new Error('STRIPE_CHECKOUT_MODE=subscription requires STRIPE_PRICE_ID_PRO to be a recurring Price.')
  }

  if (mode === 'payment' && price.recurring) {
    throw new Error('STRIPE_CHECKOUT_MODE=payment requires STRIPE_PRICE_ID_PRO to be a one-time Price.')
  }
}

export const createProCheckoutSession = async ({
  userId,
  email,
  customerId,
  origin,
}: CreateProCheckoutSessionInput) => {
  const priceId = getProPriceId()
  if (!priceId) {
    throw new Error('Missing STRIPE_PRICE_ID_PRO')
  }

  const mode = getCheckoutMode()
  await assertProPriceIsUsable(priceId, mode)

  const successUrl = `${origin}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`

  return stripe.checkout.sessions.create({
    mode,
    customer: customerId || undefined,
    customer_email: customerId ? undefined : email || undefined,
    client_reference_id: userId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: `${origin}/dashboard/billing?canceled=true`,
    metadata: {
      userId,
      product: 'pro',
    },
    subscription_data: mode === 'subscription'
      ? { metadata: { userId, product: 'pro' } }
      : undefined,
    payment_intent_data: mode === 'payment'
      ? { metadata: { userId, product: 'pro' } }
      : undefined,
  })
}
