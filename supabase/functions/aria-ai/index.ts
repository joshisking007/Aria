import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() })
  }

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  try {
    const { system, userMsg } = await req.json()

    if (!userMsg) {
      return new Response(JSON.stringify({ error: 'missing userMsg' }), {
        status: 400, headers: { ...cors(), 'Content-Type': 'application/json' }
      })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500, headers: { ...cors(), 'Content-Type': 'application/json' }
      })
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: system || '',
        messages: [{ role: 'user', content: userMsg }]
      })
    })

    const data = await res.json()

    if (!res.ok) {
      console.log('Anthropic error:', JSON.stringify(data))
      return new Response(JSON.stringify({ error: data?.error?.message || res.statusText }), {
        status: res.status, headers: { ...cors(), 'Content-Type': 'application/json' }
      })
    }

    const text = data.content?.find((b: any) => b.type === 'text')?.text || ''

    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { ...cors(), 'Content-Type': 'application/json' }
    })

  } catch (e) {
    console.log('caught error:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors(), 'Content-Type': 'application/json' }
    })
  }
})
