import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const getBackendUrl = () =>
  (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/$/, '')

export async function POST(request: Request) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }

  const backendUrl = getBackendUrl()
  if (!backendUrl) {
    return NextResponse.json({ error: 'Backend URL is not configured' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const response = await fetch(`${backendUrl}/bookmarks/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => ({}))
  return NextResponse.json(payload, { status: response.status })
}
