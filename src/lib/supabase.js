import { createClient } from '@supabase/supabase-js'

// 'proxy' = talk to Supabase through the dev server (used for the in-session preview)
const url = import.meta.env.VITE_SUPABASE_URL === 'proxy' ? window.location.origin : import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(url && key)
export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  realtime: { params: { eventsPerSecond: 20 } },
})

// Call a database function; throws an Error with the database's message.
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(cleanError(error))
  return data
}

// Select helper: throws on error
export async function sel(query) {
  const { data, error } = await query
  if (error) throw new Error(cleanError(error))
  return data
}

export function cleanError(error) {
  const msg = error?.message || String(error)
  return msg.replace(/^.*?ERROR:\s*/, '')
}
