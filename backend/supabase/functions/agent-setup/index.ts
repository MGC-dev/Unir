// Agents set themselves up: from a one-line description, Claude writes the agent's name, description and instructions
// and picks the model and the fewest permissions it needs. Nothing is saved here: the person reviews the draft and saves.
// POST { description, firm_id? }
import { HttpError, audit, body, caller, env, handle, json } from '../_shared/core.ts'

const TOOLS = ['leads', 'tasks', 'documents', 'campaigns', 'messages', 'services']
const ACTIONS = ['create_lead', 'move_stage', 'book_task', 'send_text', 'set_services']
const EXTERNAL = ['web', 'pages', 'browser', 'email', 'calendar', 'files', 'api']

const SETUP_TOOL = {
  name: 'configure_agent',
  description: 'Set up the agent. Switch on only the permissions its job needs: each one makes every message use more tokens.',
  input_schema: {
    type: 'object',
    required: ['name', 'description', 'instructions', 'model', 'tools', 'actions', 'external'],
    properties: {
      name: { type: 'string', description: 'Short name, 1 to 3 words, e.g. "Intake Assistant"' },
      description: { type: 'string', description: 'One sentence: what the agent is for' },
      instructions: { type: 'string', description: 'Its standing instructions, written to the agent: its job, tone, what to report, and what it must never do. Always include that it never gives legal advice.' },
      model: { type: 'string', enum: ['fast', 'balanced', 'advanced'], description: 'fast for simple lookups, balanced by default, advanced for careful drafting or analysis' },
      tools: { type: 'array', items: { type: 'string', enum: TOOLS }, description: 'Portal data it may read' },
      actions: { type: 'array', items: { type: 'string', enum: ACTIONS }, description: 'Portal changes it may propose (each needs approval)' },
      external: { type: 'array', items: { type: 'string', enum: EXTERNAL }, description: 'Things outside the portal it may use' },
    },
  },
}

handle(async req => {
  const b = await body<{ description?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  const text = (b.description ?? '').trim()
  if (!text) throw new HttpError(400, 'Describe what the agent should do')
  if (text.length > 2000) throw new HttpError(413, 'Keep the description under 2,000 characters')
  const { data: firm } = await me.db.from('firms').select('name').eq('id', me.firmId).single()

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('MODEL_BALANCED') || 'claude-sonnet-5-5',
      max_tokens: 1500,
      system: `You set up AI agents inside the lead portal of ${firm?.name ?? 'a law firm'}, a law firm. Read what the person wants the agent to do and call configure_agent. Keep permissions to the minimum the job needs.`,
      messages: [{ role: 'user', content: text }],
      tools: [SETUP_TOOL],
      tool_choice: { type: 'tool', name: 'configure_agent' },
    }),
  })
  const out = await res.json()
  if (!res.ok) throw new HttpError(502, `Claude: ${out?.error?.message ?? res.statusText}`)
  const call = (out.content ?? []).find((x: { type: string; name?: string }) => x.type === 'tool_use' && x.name === 'configure_agent')
  if (!call) throw new HttpError(502, 'The agent couldn’t set itself up. Try describing it differently.')

  const i = call.input as Record<string, unknown>
  const pick = (v: unknown, allowed: string[]) => (Array.isArray(v) ? v.filter((x): x is string => allowed.includes(x as string)) : [])
  const draft = {
    name: String(i.name ?? '').slice(0, 60) || 'New agent',
    description: String(i.description ?? '').slice(0, 300),
    instructions: String(i.instructions ?? '').slice(0, 6000),
    model: ['fast', 'balanced', 'advanced'].includes(i.model as string) ? i.model : 'balanced',
    tools: pick(i.tools, TOOLS),
    actions: pick(i.actions, ACTIONS),
    external: pick(i.external, EXTERNAL),
  }
  await audit({ firmId: me.firmId, actorType: 'user', actorId: me.user.id, action: 'agent.setup',
    meta: { model: out.model, input_tokens: out.usage?.input_tokens, output_tokens: out.usage?.output_tokens } })
  return json({ draft })
})
