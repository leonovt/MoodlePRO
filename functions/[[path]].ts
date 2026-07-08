// functions/[[path]].ts
import { jwtVerify, createRemoteJWKSet } from 'jose'

const ISS = 'hub02'
const AUD = 'tool-launch'
const JWKS_URL = 'https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks'
const COOKIE_NAME = 'hub02_session'
const COOKIE_MAX_AGE_FALLBACK = 300
const IDENTITY_MODE_DEFAULT = 'off'

const jwks = createRemoteJWKSet(new URL(JWKS_URL))

function parseCookies(req: Request): Record<string,string> {
  const raw = req.headers.get('cookie') ?? ''
  return Object.fromEntries(
    raw.split(';').map(v => v.trim()).filter(Boolean).map(kv => {
      const i = kv.indexOf('=')
      return i === -1 ? [kv, ''] : [decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(1 + i))]
    })
  )
}

function setCookie(resp: Response, name: string, value: string, maxAge: number) {
  const parts = [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    'Max-Age=' + Math.max(0, Math.floor(maxAge))
  ]
  resp.headers.append('Set-Cookie', parts.join('; '))
}

export const onRequest: PagesFunction = async (ctx) => {
  const { request, env, next } = ctx
  const url = new URL(request.url)
  const path = url.pathname
  const t0 = Date.now()

  if (path.startsWith('/.well-known/')) {
    return next()
  }

  // --- Identity surface (Tool-Identity SSO). Gated on env.HUB02_IDENTITY_MODE. ---
  // Default 'off' = today's behavior (no identity endpoints, no redirect).
  const IDENTITY_MODE = String((env.HUB02_IDENTITY_MODE as string) || IDENTITY_MODE_DEFAULT || 'off').toLowerCase()
  const H02_SUPA = (env.HUB02_SUPABASE_URL as string) || (env.SUPABASE_URL as string) || 'https://ddeubhasvmeqwtzgkunt.supabase.co'
  const H02_BUILDER = (env.HUB02_BUILDER_API_KEY as string) || ''
  const h02LoginUrl = () => {
    const toolId = (env.HUB02_TOOL_ID as string) || ''
    let u = 'https://hub02.com/login?return_url=' + encodeURIComponent(url.toString())
    if (toolId) u += '&tool_id=' + encodeURIComponent(toolId)
    return u
  }
  const h02IdHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Cookie' }

  if ((path === '/__hub02/me' || path === '/__hub02/token') && IDENTITY_MODE !== 'off') {
    // Same-origin only.
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: h02IdHeaders })
    }
    const idCookies = parseCookies(request)
    const cookieTok = idCookies[COOKIE_NAME] || ''

    // Unauthenticated response: redirect a top-level browser navigation to
    // login (no raw-JSON black screen); programmatic fetch() calls get JSON.
    const acceptHdr = (request.headers.get('accept') || '').toLowerCase()
    const isDocNav = request.method === 'GET' && acceptHdr.indexOf('text/html') !== -1
    const unauth = () => isDocNav
      ? new Response(null, { status: 302, headers: { Location: h02LoginUrl() } })
      : new Response(JSON.stringify({ authenticated: false, login_url: h02LoginUrl() }), { status: 401, headers: h02IdHeaders })

    if (path === '/__hub02/me') {
      // Identity comes from the verified launch JWT already in the cookie.
      let payload: any = null
      if (cookieTok) { try { payload = (await jwtVerify(cookieTok, jwks, { issuer: ISS, audience: AUD })).payload } catch (e) { payload = null } }
      if (payload) {
        return new Response(JSON.stringify({
          authenticated: true,
          user_id: payload.sub || null,
          hub_id: payload.hub_id || null,
          tool_id: payload.tool_id || (env.HUB02_TOOL_ID as string) || null,
          email: null, name: null,
          exp: payload.exp || null,
        }), { status: 200, headers: h02IdHeaders })
      }
      return unauth()
    }

    // /__hub02/token — re-mint the launch JWT as a short-lived identity token
    // (aud="tool-identity") via the Hub02 issue-tool-identity function.
    if (cookieTok) {
      try {
        const idHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (H02_BUILDER) idHeaders['Authorization'] = 'Bearer ' + H02_BUILDER
        const r = await fetch(H02_SUPA + '/functions/v1/issue-tool-identity', {
          method: 'POST', headers: idHeaders, body: JSON.stringify({ launch_token: cookieTok }),
        })
        if (r.ok) { const d = await r.json(); if (d && d.token) return new Response(JSON.stringify({ token: d.token, exp: d.exp }), { status: 200, headers: h02IdHeaders }) }
      } catch (e) {}
    }
    return unauth()
  }

  // --- JTI-based launch support ---
  const jti = url.searchParams.get('h02_launch_jti')
  if (jti) {
    const supabaseUrl = (env.HUB02_SUPABASE_URL as string | undefined) || (env.SUPABASE_URL as string | undefined) || 'https://ddeubhasvmeqwtzgkunt.supabase.co'
    const toolId = (env.HUB02_TOOL_ID as string | undefined)

    try {
      const body: any = { jti }
      if (toolId) body.tool_id = toolId

      const supabaseAnon =
        (env.HUB02_SUPABASE_ANON_KEY as string | undefined) ||
        (env.SUPABASE_ANON_KEY as string | undefined)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (supabaseAnon) {
        headers['apikey'] = supabaseAnon
        headers['Authorization'] = 'Bearer ' + supabaseAnon
      }

      const exchangeRes = await fetch(supabaseUrl + '/functions/v1/session-exchange', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!exchangeRes.ok) {
        console.log('[Gate] session-exchange non-200', exchangeRes.status)
        return new Response('Access required', { status: 403 })
      }

      const { session_token, expires_at } = await exchangeRes.json()
      if (!session_token) {
        return new Response('Access required', { status: 403 })
      }

      let maxAge = COOKIE_MAX_AGE_FALLBACK
      if (expires_at) {
        const expMs = new Date(expires_at).getTime()
        const nowMs = Date.now()
        const diffSec = Math.floor((expMs - nowMs) / 1000)
        if (diffSec > 0) maxAge = diffSec
      }

      url.searchParams.delete('h02_launch_jti')
      const clean = url.toString()
      const resp = new Response(null, { status: 302, headers: { Location: clean } })
      setCookie(resp, COOKIE_NAME, session_token, maxAge)
      console.log('[Gate] jti_exchange_ok total_ms=' + (Date.now() - t0))
      return resp
    } catch (err) {
      console.log('[Gate] session-exchange failed', err)
      return new Response('Access required', { status: 403 })
    }
  }

  // --- JWT-based access (existing path) ---
  let token: string | null = url.searchParams.get('hub02')
  let tokenSource = 'query'
  if (!token) {
    const auth = request.headers.get('authorization')
    if (auth?.toLowerCase().startsWith('bearer ')) {
      token = auth.slice(7)
      tokenSource = 'header'
    }
  }
  if (!token) {
    const cookies = parseCookies(request)
    if (cookies[COOKIE_NAME]) {
      token = cookies[COOKIE_NAME]
      tokenSource = 'cookie'
    }
  }

  if (!token) {
    console.log('[Gate] no_token path=' + path + ' total_ms=' + (Date.now() - t0))
    // 'active' mode: redirect a top-level navigation to Hub02 login (no black
    // screen); API/non-GET requests still get a structured 401.
    if (IDENTITY_MODE === 'active') {
      const accept = (request.headers.get('accept') || '').toLowerCase()
      if (request.method === 'GET' && accept.indexOf('text/html') !== -1) {
        return new Response(null, { status: 302, headers: { Location: h02LoginUrl() } })
      }
    }
    return new Response('Access required', { status: 401 })
  }

  const tJwksStart = Date.now()
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISS, audience: AUD })
    const tJwksEnd = Date.now()
    console.log('[Gate] verify_ok source=' + tokenSource + ' jwks_ms=' + (tJwksEnd - tJwksStart) + ' total_ms=' + (tJwksEnd - t0) + ' sub=' + (payload.sub || 'n/a'))
    
    const now = Math.floor(Date.now() / 1000)
    const exp = typeof payload.exp === 'number' ? payload.exp : now + COOKIE_MAX_AGE_FALLBACK
    const maxAge = exp - now

    if (url.searchParams.has('hub02')) {
      url.searchParams.delete('hub02')
      const clean = new URL(url.pathname + url.search, url.origin).toString()
      const resp = new Response(null, { status: 302, headers: { Location: clean } })
      setCookie(resp, COOKIE_NAME, token, maxAge)
      return resp
    }

    const resp = await next()
    setCookie(resp, COOKIE_NAME, token, maxAge)
    return resp
  } catch (err: any) {
    const tJwksEnd = Date.now()
    console.log('[Gate] verify_fail source=' + tokenSource + ' jwks_ms=' + (tJwksEnd - tJwksStart) + ' total_ms=' + (tJwksEnd - t0) + ' error_name=' + (err?.name || 'unknown') + ' error_message=' + (err?.message || 'n/a') + ' iss=' + ISS + ' aud=' + AUD)
    return new Response('Invalid or expired token', { status: 403 })
  }
}