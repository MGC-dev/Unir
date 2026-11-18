// Shared by every function: CORS, JSON replies, the two Supabase clients, the caller's firm, and audit entries.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'

export const env = (name: string, required = true): string => {
  const v = Deno.env.get(name) ?? ''
  if (required && !v) throw new HttpError(500, `Server is missing the ${name} secret`)
  return v
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Wraps a handler: answers CORS preflight, only allows POST, and turns errors into JSON. */
export function handle(fn: (req: Request) => Promise<Response>) {
  Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
    try { return await fn(req) } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      if (status >= 500) console.error(e)
      return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, status)
    }
  })
}

/** Service-role client: bypasses row level security. Only use it after checking who is asking. */
export const admin = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

export interface Caller {
  user: User
  /** A client acting as the caller, so row level security applies. */
  db: SupabaseClient
  firmId: string
  role: 'admin' | 'member'
  name: string
}

/** The signed-in person making the request, and their firm (the one they belong to, or firm_id in the body). */
export async function caller(req: Request, firmId?: string): Promise<Caller> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Sign in first')
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error } = await db.auth.getUser(auth.slice(7))
  if (error || !user) throw new HttpError(401, 'Your session has ended. Sign in again.')
  let q = db.from('firm_members').select('firm_id, role, full_name').eq('user_id', user.id)
  if (firmId) q = q.eq('firm_id', firmId)
  const { data: rows } = await q
  if (!rows?.length) throw new HttpError(403, 'You are not in a firm yet. Ask MGC to set your firm up.')
  if (rows.length > 1 && !firmId) throw new HttpError(400, 'You are in more than one firm: send firm_id')
  return { user, db, firmId: rows[0].firm_id, role: rows[0].role, name: rows[0].full_name || user.email || '' }
}

/** Writes a named event to the audit log (table changes are logged by the database itself). */
export async function audit(e: { firmId: string; actorType: 'user' | 'agent' | 'system'; actorId?: string; botId?: string | null; action: string; table?: string; recordId?: string; meta?: Record<string, unknown> }) {
  const { error } = await admin().from('audit_log').insert({
    firm_id: e.firmId, actor_type: e.actorType, actor_id: e.actorId ?? null, bot_id: e.botId ?? null,
    action: e.action, table_name: e.table ?? null, record_id: e.recordId ?? null, meta: e.meta ?? {},
  })
  if (error) console.error('audit failed', error)
}

export const body = async <T>(req: Request): Promise<T> => {
  try { return await req.json() as T } catch { throw new HttpError(400, 'Send a JSON body') }
}
