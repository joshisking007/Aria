import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ALLOWED_ORIGINS = [
  'https://aria-b15.pages.dev',
  'http://localhost',
  'file://',
  'null',
]

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

serve(async (req) => {
  const origin = req.headers.get('Origin')

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) })
  }

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  try {
    const { text, voiceId, model, stability, similarity } = await req.json()

    if (!text || !voiceId) {
      return new Response(JSON.stringify({ error: 'missing text or voiceId' }), {
        status: 400,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      })
    }

    const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      })
    }

    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: model || 'eleven_turbo_v2_5',
          voice_settings: {
            stability:        stability  ?? 0.45,
            similarity_boost: similarity ?? 0.75,
          },
        }),
      }
    )

    if (!elRes.ok) {
      const err = await elRes.json().catch(() => ({}))
      return new Response(JSON.stringify({ error: err?.detail || elRes.statusText, status: elRes.status }), {
        status: elRes.status,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      })
    }

    const audio = await elRes.arrayBuffer()

    return new Response(audio, {
      status: 200,
      headers: {
        ...cors(origin),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...cors(origin), 'Content-Type': 'application/json' }
    })
  }
})
