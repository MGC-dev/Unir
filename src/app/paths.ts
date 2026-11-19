import type { SignInMode } from '@/components/ui/sign-in'

/** Public pages, the portal, and the sign-in pages. */
export const HOME = '/home'
export const DASHBOARD = '/dashboard'

/** Each sign-in page's address under /auth. */
export const AUTH: Record<SignInMode, string> = {
  'sign-in': '/auth/sign-in',
  create: '/auth/sign-up',
  reset: '/auth/reset-password',
  'set-password': '/auth/set-password',
}

/** The sign-in page an /auth/:page address shows, or undefined for an unknown page. */
export const authMode = (page?: string) =>
  (Object.keys(AUTH) as SignInMode[]).find(m => AUTH[m] === `/auth/${page}`)

/** Portal sections that used to live at the site root, e.g. /pipeline before /dashboard/pipeline. */
export const OLD_PORTAL_PATHS = ['pipeline', 'leads', 'contacts', 'calendar', 'tasks', 'agenda', 'messages', 'campaigns', 'documents',
  'reports', 'chat', 'agents', 'bots', 'services', 'integrations', 'settings']
