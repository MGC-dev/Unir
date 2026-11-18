import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Modal =
  | { type: 'intake' }
  | { type: 'compose' | 'reminder' | 'lost' | 'client' | 'send-docs' | 'request-payment'; id: string }
  | { type: 'pick-services'; id: string; next?: 'send-docs' | 'request-payment' }
  | { type: 'newcamp'; kind: 'auto' | 'broadcast' | 'survey'; /** Folder the new campaign starts in. */ folderId?: string }
  /** A message template: an id to edit one, null to write a new one. */
  | { type: 'template'; template: string | null }
  | { type: 'more' | 'help' | 'account' | 'team' }

export interface Filters { inbox: string; calmode: 'day' | 'week' | 'month' | 'list'; /** Campaigns page: the campaigns or the message templates. */ campview: 'campaigns' | 'templates'; /** Campaigns page: the folder shown ('all', 'unfiled' or a folder id). */ campfolder: string }

interface Ui {
  /** Lead open in the side inspector. */
  /** Lead whose ticket (actions + activity) is open in the side panel. */
  open: string | null
  /** Lead whose profile (contact and enquiry details) is open in the side panel. */
  profile: string | null
  /** Open the profile straight into editing. */
  profileEdit: boolean
  /** Service open in the side panel, and whether it opens in edit mode. */
  service: string | null
  serviceEdit: boolean
  modal: Modal | null
  filter: Filters
  openLead: (id: string | null) => void
  openProfile: (id: string | null, edit?: boolean) => void
  openService: (id: string | null, edit?: boolean) => void
  openModal: (m: Modal | null) => void
  closeAll: () => void
  setFilter: (key: keyof Filters, val: string) => void
}
const Ctx = createContext<Ui | null>(null)
export const useUi = () => { const c = useContext(Ctx); if (!c) throw new Error('useUi outside UiProvider'); return c }

export function UiProvider({ children }: { children: ReactNode }) {
  const [open, openLead] = useState<string | null>(null)
  const [profileState, setProfile] = useState<{ id: string; edit: boolean } | null>(null)
  const openProfile = useCallback((id: string | null, edit = false) => setProfile(id ? { id, edit } : null), [])
  const profile = profileState?.id ?? null
  const [service, setService] = useState<{ id: string; edit: boolean } | null>(null)
  const openService = useCallback((id: string | null, edit = false) => setService(id ? { id, edit } : null), [])
  const [modal, openModal] = useState<Modal | null>(null)
  const [filter, setFilters] = useState<Filters>({ inbox: 'all', campview: 'campaigns', campfolder: 'all', calmode: matchMedia('(max-width: 760px)').matches ? 'day' : 'week' })
  const setFilter = useCallback((key: keyof Filters, val: string) => setFilters(f => ({ ...f, [key]: val })), [])
  const closeAll = useCallback(() => { openLead(null); openProfile(null); setService(null); openModal(null) }, [])
  const value = useMemo(() => ({ open, profile, profileEdit: !!profileState?.edit, service: service?.id ?? null, serviceEdit: !!service?.edit, modal, filter, openLead, openProfile, openService, openModal, closeAll, setFilter }), [open, profile, profileState, service, modal, filter, closeAll, setFilter, openService, openProfile])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
