import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const getBackendUrl = () =>
  (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/$/, '')

const BACKEND_FETCH_TIMEOUT_MS = 15_000

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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${backendUrl}/bookmarks/add`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    clearTimeout(timeoutId)
    const timedOut = controller.signal.aborted
    return NextResponse.json(
      {
        error: timedOut
          ? 'Backend request timed out. Please try again.'
          : 'Could not reach the backend service.',
      },
      { status: timedOut ? 504 : 502 }
    )
  }

  clearTimeout(timeoutId)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    const text = await response.text().catch(() => '')
    payload = text || {}
  }

  return NextResponse.json(payload, { status: response.status || 502 })
}
