// A firm admin invites a teammate. The person gets Supabase's invite email, opens it, chooses a password on the
// portal's "Choose a password" page (/auth/set-password), and is a member of the firm from then on.
// POST { email, full_name?, role?: 'admin' | 'member', firm_id? }
import { HttpError, admin, audit, body, caller, env, handle, json } from '../_shared/core.ts'

handle(async req => {
  const b = await body<{ email?: string; full_name?: string; role?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  if (me.role !== 'admin') throw new HttpError(403, 'Only your firm’s admins can invite people')
  const email = (b.email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address')
  const role = b.role === 'admin' ? 'admin' : 'member'
  const db = admin()

  // Existing account (e.g. already in another firm): just add them. Otherwise send an invite.
  const { data: existing } = await db.rpc('user_id_by_email', { p_email: email })
  let userId = existing as string | null
  if (!userId) {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { full_name: b.full_name ?? '' },
      redirectTo: `${env('SITE_URL').replace(/\/$/, '')}/auth/set-password`,
    })
    if (error) throw new HttpError(400, error.message)
    userId = data.user.id
  }

  const { error } = await db.from('firm_members').insert({ firm_id: me.firmId, user_id: userId, role, full_name: b.full_name ?? '' })
  if (error && !/duplicate key/.test(error.message)) throw new HttpError(400, error.message)
  if (error) throw new HttpError(409, 'That person is already in your firm')

  await audit({ firmId: me.firmId, actorType: 'user', actorId: me.user.id, action: 'member.invited', table: 'firm_members', recordId: userId!, meta: { email, role, invited: !existing } })
  return json({ user_id: userId, invited: !existing })
})
