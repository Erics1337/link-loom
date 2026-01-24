'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function BillingPage() {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
        setProfile(data);
      }
    };
    getUser();
  }, [supabase]);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          priceId: 'price_LIFETIME_ID', // REPLACE WITH REAL STRIPE PRICE ID
          successUrl: `${window.location.origin}/dashboard/billing?success=true`,
          cancelUrl: `${window.location.origin}/dashboard/billing?canceled=true`,
        }),
      });
      const { url } = await res.json();
      window.location.href = url;
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-10">
          <h1 className="text-xl font-semibold text-white">Billing</h1>
      </header>

      <div className="p-8 max-w-4xl mx-auto space-y-6">

        {searchParams.get('success') && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            Payment successful! Your lifetime license is active.
          </div>
        )}
         {searchParams.get('canceled') && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 p-4 rounded-xl flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-yellow-500" />
            Payment canceled. You have not been charged.
          </div>
        )}

        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8">
          <h2 className="text-xl font-semibold mb-6 text-white">Current Plan</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm mb-1">Status</p>
              <p className="text-3xl font-bold text-white">
                {profile?.is_premium ? 'Lifetime License' : 'Free Tier'}
              </p>
              {profile?.is_premium && (
                  <p className="mt-2 text-green-400 text-sm flex items-center gap-2">
                       ✓ You have access to all premium features forever.
                  </p>
              )}
            </div>
            {!profile?.is_premium && (
              <button
                onClick={handleCheckout}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-8 rounded-lg transition disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-blue-500/20"
              >
                {loading ? 'Processing...' : 'Upgrade to Lifetime ($29)'}
              </button>
            )}
          </div>
          
          {!profile?.is_premium && (
             <div className="mt-8 pt-6 border-t border-gray-700/50 grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div>
                     <h3 className="font-semibold text-white mb-2">Unlimited Bookmarks</h3>
                     <p className="text-sm text-gray-400">Store and organize as many links as you need without limits.</p>
                 </div>
                 <div>
                     <h3 className="font-semibold text-white mb-2">Device Sync (3+)</h3>
                     <p className="text-sm text-gray-400">Sync across more than 3 devices seamlessly.</p>
                 </div>
                 <div>
                     <h3 className="font-semibold text-white mb-2">Priority Support</h3>
                     <p className="text-sm text-gray-400">Get faster responses from our support team.</p>
                 </div>
             </div>
          )}
        </div>
      </div>
    </>
  );
}
