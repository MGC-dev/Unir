import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** Accounts by invite only unless VITE_ALLOW_SIGNUP is "true". */
export const signupAllowed = import.meta.env.VITE_ALLOW_SIGNUP === 'true'

// "Keep me signed in": the session lives in localStorage (survives closing the browser) when ticked,
// otherwise in sessionStorage (gone when the tab closes).
const REMEMBER = 'unir-remember-me'
const safe = <T,>(fn: () => T, fallback: T) => { try { return fn() } catch { return fallback } }
export const setRememberMe = (on: boolean) => safe(() => (on ? localStorage.setItem(REMEMBER, '1') : localStorage.removeItem(REMEMBER)), undefined)
const remember = () => safe(() => localStorage.getItem(REMEMBER) === '1', true)
const storage = {
  getItem: (k: string) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k: string, v: string) => safe(() => {
    const [keep, drop] = remember() ? [localStorage, sessionStorage] : [sessionStorage, localStorage]
    keep.setItem(k, v); drop.removeItem(k)
  }, undefined),
  removeItem: (k: string) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k) }, undefined),
}

/** The Supabase client, or null when the project keys are not set (demo mode). */
export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })
  : null

/** Absolute URL of a page in this app, for links Supabase sends by email or redirects back to. */
export const appUrl = (path: string) => window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + path
