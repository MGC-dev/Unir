// Shared data contracts. The real backend should return these shapes.

export type StageId = 'new' | 'contacted' | 'consult' | 'contract' | 'signed' | 'payment' | 'delivered' | 'lost'
export type SourceId = 'web' | 'email' | 'text' | 'manual' | 'referral' | 'ads'
export type ActivityType = 'enquiry' | 'auto' | 'text' | 'email' | 'call' | 'meeting' | 'doc' | 'signed' | 'stage' | 'reminder' | 'lost'

export interface Activity {
  /** Set once saved to the server. */
  id?: string
  t: number
  type: ActivityType
  /** '' normal, 'auto' sent by automation, 'good' positive milestone, 'bad' held/failed/lost */
  cls: '' | 'auto' | 'good' | 'bad'
  title: string
  text?: string
  quote?: string
}

/** One document inside a signing packet, with the values the sender filled in from the ticket. */
export interface SentItem { templateId: string; name: string; values: Record<string, string> }

/** The documents sent to a lead for signature (a packet; signing completes all of them together). */
export interface EngagementDoc {
  /** Set once saved to the server. */
  id?: string
  status: 'sent' | 'signed'
  sent: number
  signed?: number
  by?: string
  items?: SentItem[]
}

/** Where a document input gets its value. 'manual' is typed in when the document is sent. */
export type FieldSource = 'name' | 'email' | 'phone' | 'matter' | 'practice' | 'fee' | 'owner' | 'source' | 'services' | 'today' | 'firm' | 'manual'
export type FieldKind = 'text' | 'longtext' | 'money' | 'date'
export interface DocField { id: string; label: string; source: FieldSource; kind: FieldKind; required?: boolean }
export interface DocFile { name: string; size: number; type: string; uploadedAt: number }
export const DOC_CATEGORIES = ['Engagement', 'Fees', 'Intake', 'Compliance', 'Other'] as const
export type DocCategory = typeof DOC_CATEGORIES[number]

/** A document in the library: the uploaded file plus the inputs it needs. */
export interface PortalDocument {
  id: string
  name: string
  category: DocCategory
  description: string
  file: DocFile | null
  fields: DocField[]
  /** Only active documents can be sent from a ticket. */
  active: boolean
  createdAt: number
  updatedAt: number
  updatedBy: string
}


export interface Lead {
  id: string
  name: string
  email: string
  phone: string
  matter: string
  practice: string
  source: SourceId
  value: number
  stage: StageId
  owner: string
  created: number
  activities: Activity[]
  doc: EngagementDoc | null
  lostReason: string | null
  optedOut?: boolean
  /** Free-text notes captured when the enquiry was added. */
  notes?: string
  /** The services the lead is taking, chosen from the Services catalog after the consultation. */
  serviceIds?: string[]
}

export type TaskType = 'task' | 'call' | 'meeting' | 'follow_up' | 'deadline'

export interface Task {
  id: string
  type: TaskType
  title: string
  dueAt: number
  done: boolean
  completedAt?: number
  assignedTo: string
  leadId?: string
  notes?: string
  /** Created by a pipeline stage change; closed automatically when the stage moves on. */
  auto?: boolean
}

export interface FirmEvent { id: string; t: number; dur: number; title: string; who: string }

export interface Integration { id: string; name: string; icon: string; on: boolean; desc: string; /** The connected account, e.g. the Gmail address. */ account?: string }

export interface Firm {
  name: string
  domain: string
  number: string
  domainStatus: 'unverified' | 'pending' | 'verified'
  textStatus: 'unregistered' | 'review' | 'registered'
  /** DNS records to add at the domain host, each with its own status (live mode). */
  domainRecords?: DnsRecord[]
  domainCheckedAt?: number
  /** The design wrapped around every email the firm sends (Settings → Email design). */
  brand?: FirmBrand
}

export interface DnsRecord {
  /** "SPF", "DKIM", "DMARC" */
  record: string
  type: string
  /** Relative to the domain: "send" means send.yourfirm.com. */
  name: string
  value: string
  priority?: number
  /** not_started, pending, verified, failed, temporary_failure */
  status: string
}

export interface FirmBrand {
  /** Public https link to the logo. */
  logoUrl?: string
  /** "#RRGGBB" */
  color: string
  signature: string
  /** Small print at the bottom, usually the firm's address. */
  footer: string
}

export type CampaignChannel = 'Text' | 'Email' | 'Text and Email'
export type AudienceKey = 'open' | 'consult' | 'clients' | 'lost' | 'all'

export interface Recipient {
  id: string
  name: string
  channel: 'Text' | 'Email'
  status: 'delivered' | 'held' | 'skipped'
  at?: number
  opened?: boolean
  replied?: boolean
  /** The score this person gave a survey: 0 to 10 for NPS, 1 to 5 for CSAT. */
  score?: number
}

/** An input a campaign message can use, e.g. {phone}: filled from the person's ticket (or the firm) for each recipient. */
export interface CampaignTag { id: string; label: string; source: FieldSource }

export type CampaignKind = 'auto' | 'broadcast' | 'survey'
export type SurveyMetric = 'nps' | 'csat'

export interface Campaign {
  id: string
  kind: CampaignKind
  /** For surveys: NPS (0 to 10) or CSAT (1 to 5). */
  metric?: SurveyMetric
  /** Inputs added to this campaign beyond the built-in first name, matter and firm name. */
  tags?: CampaignTag[]
  /** The folder it is filed in; none means Unfiled. */
  folderId?: string
  name: string
  channel: CampaignChannel
  steps: number
  sent: number
  subject?: string
  body: string
  recipients: Recipient[]
  trigger?: string
  active?: boolean
  /** Saved but not sent or running yet. Turning it on sends it (or starts it, for an automatic campaign). */
  draft?: boolean
  audience?: AudienceKey
  sentAt?: number
}

/** A saved message people reuse: in campaigns, or when texting or emailing one lead. Uses the same inputs as campaigns. */
export type TemplateChannel = 'Text' | 'Email'
export interface MessageTemplate {
  id: string
  name: string
  channel: TemplateChannel
  /** Email only. */
  subject?: string
  body: string
  /** Inputs added to this template beyond the built-in first name, matter and firm name. */
  tags?: CampaignTag[]
  createdAt: number
  updatedAt: number
  updatedBy: string
}

/** A folder for organising campaigns. Each campaign is in at most one folder. */
export interface CampaignFolder { id: string; name: string; createdAt: number }

export interface SendProgress { id: string; total: number; done: number }

export interface TeamMember {
  name: string; role: string; permission: 'Admin' | 'Member'
  /** pending: invited, hasn't opened the invite email yet. Unknown when the server can't say. */
  status?: 'pending' | 'accepted'; email?: string; invitedAt?: number
}

export interface NewLeadInput {
  name: string; phone?: string; email?: string; practice: string; matter: string; value?: number; note?: string
}
export interface NewCampaignInput {
  kind: CampaignKind; name: string; channel: CampaignChannel; subject?: string; body: string
  audience?: AudienceKey; trigger?: string; metric?: SurveyMetric; draft?: boolean; tags?: CampaignTag[]; folderId?: string
}

/** Metadata the UI needs to render forms and labels. Served by the backend as configuration. */
export interface PortalConfig {
  stages: { id: StageId; label: string; next: string }[]
  sources: Record<SourceId, string>
  owners: string[]
  lostReasons: string[]
  practiceAreas: string[]
  triggers: string[]
  audiences: Record<AudienceKey, { label: string; hint: string }>
}

export interface SearchHit {
  group: 'Leads' | 'Tasks' | 'Messages' | 'Documents' | 'Services' | 'Campaigns'
  title: string
  subtitle: string
  /** What the UI should open: a lead, an task (opens Tasks), or a campaign. */
  target: { type: 'lead' | 'tasks' | 'campaign' | 'document' | 'service'; id: string }
}

export type PricingModel = 'flat' | 'hourly' | 'monthly' | 'contingency'
export const PRICING_MODELS: Record<PricingModel, string> = { flat: 'Flat fee', hourly: 'Hourly', monthly: 'Monthly', contingency: 'Contingency' }

/** A service the firm provides, with its default pricing. Picking one when adding an enquiry starts from these numbers. */
export interface Service {
  id: string
  name: string
  /** One of the firm's practice areas. */
  practice: string
  description: string
  pricingModel: PricingModel
  /** flat: fee ($) · hourly: rate ($/hr) · monthly: fee ($/mo) · contingency: percentage (%) */
  price: number
  /** Upfront retainer collected before work starts (the Payment Pending stage). */
  retainer: number
  active: boolean
  createdAt: number
  updatedAt: number
}

/* ---------- intelligence: AI bots and chat ---------- */

/** What a bot is allowed to look at. A bot can only answer from the tools switched on for it. */
export type BotTool = 'leads' | 'tasks' | 'documents' | 'campaigns' | 'messages' | 'services'
export const BOT_TOOLS: Record<BotTool, { label: string; hint: string }> = {
  leads: { label: 'Leads and contacts', hint: 'Read tickets, stages, fees and activity' },
  tasks: { label: 'Tasks', hint: 'Read and book calls, meetings and deadlines' },
  documents: { label: 'Documents', hint: 'Read the library and what has been sent or signed' },
  campaigns: { label: 'Campaigns', hint: 'Read campaigns, surveys and their results' },
  messages: { label: 'Messages', hint: 'Read texts and emails, and draft replies' },
  services: { label: 'Services', hint: 'Read the service catalog and default pricing' },
}
/** Changes a bot may make inside the portal. Anything not listed is read-only for it. */
export type BotAction = 'create_lead' | 'move_stage' | 'book_task' | 'send_text' | 'set_services'
export const BOT_ACTIONS: Record<BotAction, { label: string; hint: string }> = {
  create_lead: { label: 'Create an enquiry', hint: 'Add a new lead to the pipeline' },
  move_stage: { label: 'Move a ticket', hint: 'Change a ticket’s stage' },
  book_task: { label: 'Book a task', hint: 'Add a call, meeting, reminder or deadline' },
  send_text: { label: 'Send a text', hint: 'Text a lead from the firm’s number' },
  set_services: { label: 'Set services', hint: 'Choose the services a ticket takes from the catalog' },
}
/** What a bot can reach outside the portal. */
export type ExternalTool = 'web' | 'pages' | 'browser' | 'email' | 'calendar' | 'files' | 'api'
export const EXTERNAL_TOOLS: Record<ExternalTool, { label: string; hint: string }> = {
  web: { label: 'Search the web', hint: 'Look things up online, such as legal updates or court information' },
  pages: { label: 'Read web pages', hint: 'Open a link you paste and read it' },
  browser: { label: 'Use a browser', hint: 'Open websites and do things on them for you, like filling a form' },
  email: { label: 'Email', hint: 'Read and send from a connected inbox outside the portal' },
  calendar: { label: 'Calendar', hint: 'Read and book on your Google or Outlook calendar' },
  files: { label: 'Files and drives', hint: 'Read and write documents in Drive, Dropbox or OneDrive' },
  api: { label: 'Call external APIs', hint: 'Send requests to other services and webhooks you connect' },
}
export type BotModel = 'fast' | 'balanced' | 'advanced'
export const BOT_MODELS: Record<BotModel, { label: string; hint: string }> = {
  fast: { label: 'Fast', hint: 'Quick answers for simple work' },
  balanced: { label: 'Balanced', hint: 'A good default for most agents' },
  advanced: { label: 'Advanced', hint: 'Careful reasoning for complex work' },
}

export interface Bot {
  id: string
  name: string
  description: string
  /** The standing instructions the bot follows (its system prompt). */
  instructions: string
  model: BotModel
  tools: BotTool[]
  /** What it may change inside the portal. */
  actions: BotAction[]
  /** What it may use outside the portal. */
  external: ExternalTool[]
  /** Only active bots can be chatted with. */
  active: boolean
  runs: number
  createdAt: number
  updatedAt: number
  updatedBy: string
  /** Running by itself on a schedule and emailing the result. */
  schedule?: BotSchedule
  lastRunAt?: number
}

/** When an agent runs by itself, and who gets the result by email. */
export interface BotSchedule {
  enabled: boolean
  /** 0 = Sunday … 6 = Saturday */
  days: number[]
  /** Local time, "HH:MM". */
  time: string
  /** IANA time zone, e.g. Africa/Johannesburg. */
  tz: string
  /** Team members (by name) who get the result by email. */
  to: string[]
}

/** One time an agent ran by itself (on its schedule, or with Run now). */
export interface BotRun {
  id: string
  at: number
  trigger: 'schedule' | 'manual'
  status: 'done' | 'failed'
  output: string
  recipients: string[]
  emailStatus: 'none' | 'sent' | 'held' | 'failed'
  error?: string
}

/** A change the assistant proposes to make in the portal. It only happens once the person approves it. */
export interface ChatAction {
  kind: BotAction
  summary: string
  params: Record<string, string>
  status: 'proposed' | 'done' | 'cancelled' | 'failed'
  result?: string
}
export interface ChatMessage {
  id: string; role: 'user' | 'assistant'; text: string; at: number
  /** The tools the assistant used to answer, shown above the answer. */
  steps?: string[]
  action?: ChatAction
}
export interface ChatConversation {
  id: string
  title: string
  /** The bot answering, or none for the general assistant. */
  botId: string | null
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /** True while the assistant is working on a reply. */
  pending?: boolean
  /** The bot has replied and the thread has not been opened since. */
  unread?: boolean
}
