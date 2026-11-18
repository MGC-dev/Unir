/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Empty: the portal runs in demo mode without real accounts. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon (public) key. Safe in the browser; data is protected by row level security. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** "true" lets people create their own accounts; otherwise accounts are by invite only. */
  readonly VITE_ALLOW_SIGNUP?: string
}
