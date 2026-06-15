import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const isExtensionAuth = requestUrl.searchParams.get('extension') === '1'
  const extensionId = requestUrl.searchParams.get('ext_id')

  const headersList = headers()
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000'
  const protocol = headersList.get('x-forwarded-proto') || 'https'
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`

  const extensionCompleteUrl = (params: Record<string, string>) => {
    const url = new URL('/auth/extension-complete', origin)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  if (code) {
    const supabase = createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.session) {
      // Check if this is a new user (created within last 5 minutes = likely new signup)
      const userCreatedAt = new Date(data.session.user.created_at)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      const isNewUser = userCreatedAt > fiveMinutesAgo

      // Check for invite code in cookies (set during OAuth initiation)
      const cookieStore = cookies()
      const hasInviteCode = cookieStore.has('invite_code') || cookieStore.has('invite-code')

      // Block new signups without invite
      if (isNewUser && !hasInviteCode) {
        // Sign them out immediately
        await supabase.auth.signOut()

        if (isExtensionAuth && extensionId) {
          return NextResponse.redirect(
            extensionCompleteUrl({
              ext_id: extensionId,
              error: 'waitlist_only',
            })
          )
        }

        // Redirect to login with waitlist message
        return NextResponse.redirect(
          origin + '/login?error=waitlist_only&message=Sign+up+is+currently+waitlist-only.+Please+join+the+waitlist+for+early+access.'
        )
      }

      // Clear the invite code cookie after successful signup
      if (hasInviteCode) {
        cookieStore.delete('invite_code')
        cookieStore.delete('invite-code')
      }
    }
  }

  if (isExtensionAuth && extensionId) {
    return NextResponse.redirect(extensionCompleteUrl({ ext_id: extensionId }))
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(origin + '/dashboard')
}
