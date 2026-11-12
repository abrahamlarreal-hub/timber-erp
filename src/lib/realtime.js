import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

const TABLES = ['inventory', 'sales_orders', 'purchase_orders', 'production_orders', 'items', 'suppliers',
  'settings', 'activity_log', 'customers', 'bom_lines']

// Keeps every logged-in screen in sync: any change committed by any user
// invalidates cached queries so the page re-reads live data.
export function useRealtimeSync(enabled, onActivity) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('connecting')
  const timer = useRef(null)
  const cb = useRef(onActivity)
  cb.current = onActivity

  useEffect(() => {
    if (!enabled) return
    let ch = supabase.channel('erp-live')
    for (const t of TABLES) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (payload) => {
        if (t === 'activity_log' && payload.eventType === 'INSERT') cb.current?.(payload.new)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => qc.invalidateQueries(), 250)
      })
    }
    ch.subscribe((s) => setStatus(s === 'SUBSCRIBED' ? 'live' : s.toLowerCase()))
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch) }
  }, [enabled, qc])
  return status
}
