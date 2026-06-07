import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/login',
    '/auth/:path*',
    '/api/bookmarks/:path*',
    '/api/checkout/:path*',
    '/api/create-checkout-session',
  ],
}
