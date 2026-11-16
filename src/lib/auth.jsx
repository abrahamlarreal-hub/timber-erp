import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const qc = useQueryClient()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s) => {
    if (!s) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile(data)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session); await loadProfile(data.session); setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setTimeout(() => loadProfile(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value = {
    session, profile, loading,
    isStaff: profile?.role === 'staff' || profile?.role === 'manager',
    isManager: profile?.role === 'manager',
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, meta) => supabase.auth.signUp({ email, password, options: { data: meta } }),
    // Always ends the session on this device, even if the server can't be reached
    signOut: async () => {
      try { await supabase.auth.signOut() } catch { /* server unreachable - handled below */ }
      // If the server call failed, the library keeps the saved login; remove it ourselves.
      try {
        Object.keys(window.localStorage).filter((k) => k.startsWith('sb-') && k.includes('-auth-token'))
          .forEach((k) => window.localStorage.removeItem(k))
      } catch { /* storage blocked */ }
      setSession(null); setProfile(null); qc.clear()
      if (window.location.pathname !== '/') window.history.replaceState(null, '', '/')
    },
    reloadProfile: () => loadProfile(session),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
