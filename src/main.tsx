import { StrictMode, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import './styles/tokens.css'
import './styles/portal.css'
import './styles/theme.css'
import { AuthProvider, RequireAuth } from './app/auth'
import AppShell from './app/AppShell'
import { AUTH, DASHBOARD, HOME, OLD_PORTAL_PATHS } from './app/paths'
import Dashboard from './modules/dashboard/Dashboard'
import Pipeline from './modules/pipeline/Pipeline'
import Leads from './modules/leads/Leads'
import Contacts from './modules/contacts/Contacts'
import Calendar from './modules/calendar/Calendar'
import Tasks from './modules/tasks/Tasks'
import Messages from './modules/messages/Messages'
import Campaigns from './modules/campaigns/Campaigns'
import CampaignDetail from './modules/campaigns/CampaignDetail'
import Chat from './modules/chat/Chat'
import Bots from './modules/bots/Bots'
import Documents from './modules/documents/Documents'
import DocumentDetail from './modules/documents/DocumentDetail'
import Reports from './modules/reports/Reports'
import Integrations from './modules/integrations/Integrations'
import Services from './modules/services/Services'
import Settings from './modules/settings/Settings'

// the public landing page loads on its own, so the portal doesn't carry it
const Landing = lazy(() => import('./modules/landing/Landing'))
const SignIn = lazy(() => import('./modules/auth/SignIn'))
const Unsubscribe = lazy(() => import('./modules/auth/Unsubscribe'))

/**
 * Old addresses from before /home, /dashboard and /auth: /welcome, /sign-in?…, and portal pages at the root such as
 * /pipeline. Invite and reset emails already sent still link to /sign-in?set-password&token_hash=…, so the query is kept.
 */
function OldAddress() {
  const { pathname, search, hash } = useLocation()
  const q = new URLSearchParams(search)
  const first = pathname.split('/')[1] ?? ''
  if (first === 'sign-in') {
    const mode = q.has('set-password') ? 'set-password' : q.has('create') ? 'create' : q.has('reset') ? 'reset' : 'sign-in'
    for (const k of ['set-password', 'create', 'reset']) q.delete(k)
    const rest = q.toString()
    return <Navigate to={AUTH[mode] + (rest ? `?${rest}` : '') + hash} replace />
  }
  if (OLD_PORTAL_PATHS.includes(first)) return <Navigate to={DASHBOARD + pathname + search + hash} replace />
  return <Navigate to={HOME} replace />
}

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
      <Routes>
        <Route index element={<Navigate to={HOME} replace />} />
        <Route path="home" element={page(<Landing />)} />
        <Route path="auth" element={<Navigate to={AUTH['sign-in']} replace />} />
        <Route path="auth/:page" element={page(<SignIn />)} />
        <Route path="unsubscribe" element={page(<Unsubscribe />)} />
        <Route path="dashboard" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="leads" element={<Leads />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="agenda" element={<Navigate to={`${DASHBOARD}/tasks`} replace />} />
          <Route path="messages" element={<Messages />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/:id" element={<CampaignDetail />} />
          <Route path="documents" element={<Documents />} />
          <Route path="documents/:id" element={<DocumentDetail />} />
          <Route path="reports" element={<Reports />} />
          <Route path="chat" element={<Chat />} />
          <Route path="chat/:id" element={<Chat />} />
          <Route path="agents" element={<Bots />} />
          {/* Bots were renamed Agents: old links still land in the right place. */}
          <Route path="bots/*" element={<Navigate to={`${DASHBOARD}/agents`} replace />} />
          <Route path="agents/:id" element={<Bots />} />
          <Route path="agents/:id/settings" element={<Bots />} />
          <Route path="services" element={<Services />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to={DASHBOARD} replace />} />
        </Route>
        <Route path="*" element={<OldAddress />} />
      </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
