import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  OPENROUTER_API_KEY?: string
}

type WikotUser = {
  id: number
  hotel_id: number | null
  email: string
  name: string
  role: string
  can_edit_procedures: number
  can_edit_info: number
  can_manage_chat: number
}

type Variables = {
  user: WikotUser
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())

// ============================================
// AUTH MIDDLEWARE
// ============================================
const authMiddleware = async (c: any, next: any) => {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!sessionToken) return c.json({ error: 'Non authentifié' }, 401)

  // Simple token = base64(userId:email)
  try {
    const decoded = atob(sessionToken)
    const [userId] = decoded.split(':')
    const user = await c.env.DB.prepare('SELECT id, hotel_id, email, name, role, can_edit_procedures, can_edit_info, can_manage_chat, is_active FROM users WHERE id = ? AND is_active = 1').bind(parseInt(userId)).first()
    if (!user) return c.json({ error: 'Utilisateur non trouvé' }, 401)
    c.set('user', user)
    await next()
  } catch {
    return c.json({ error: 'Token invalide' }, 401)
  }
}

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  const user = await c.env.DB.prepare('SELECT id, hotel_id, email, name, role, can_edit_procedures, can_edit_info, can_manage_chat, password_hash FROM users WHERE email = ? AND is_active = 1').bind(email).first() as any
  if (!user || user.password_hash !== password) {
    return c.json({ error: 'Email ou mot de passe incorrect' }, 401)
  }
  await c.env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run()
  const token = btoa(`${user.id}:${user.email}`)
  return c.json({
    token,
    user: { id: user.id, hotel_id: user.hotel_id, email: user.email, name: user.name, role: user.role, can_edit_procedures: user.can_edit_procedures, can_edit_info: user.can_edit_info, can_manage_chat: user.can_manage_chat }
  })
})

app.get('/api/auth/me', authMiddleware, async (c) => {
  return c.json({ user: c.get('user') })
})

app.put('/api/auth/change-password', authMiddleware, async (c) => {
  const user = c.get('user')
  const { current_password, new_password } = await c.req.json()
  if (!current_password || !new_password) return c.json({ error: 'Champs manquants' }, 400)
  if (new_password.length < 6) return c.json({ error: 'Le nouveau mot de passe doit faire au moins 6 caractères' }, 400)

  // Vérifier l'ancien mot de passe
  const dbUser = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first() as any
  if (!dbUser || dbUser.password_hash !== current_password) {
    return c.json({ error: 'Mot de passe actuel incorrect' }, 401)
  }

  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(new_password, user.id).run()
  return c.json({ success: true })
})

// ============================================
// HELPERS
// ============================================
// Le super_admin est purement gestionnaire d'infrastructure (hôtels + admins)
// Il ne touche PAS aux procédures, templates, suggestions, changelog
function isSuperAdmin(user: { role: string }) {
  return user.role === 'super_admin'
}

function canEditProcedures(user: { role: string; can_edit_procedures: number }) {
  // super_admin exclu : il ne gère pas les procédures des hôtels
  return user.role === 'admin' || user.can_edit_procedures === 1
}

function canEditInfo(user: { role: string; can_edit_info?: number }) {
  return user.role === 'admin' || user.can_edit_info === 1
}

function canManageChat(user: { role: string; can_manage_chat?: number }) {
  return user.role === 'admin' || user.can_manage_chat === 1
}

// ============================================
// HOTELS ROUTES
// ============================================
app.get('/api/hotels', authMiddleware, async (c) => {
  const user = c.get('user')
  let hotels
  if (user.role === 'super_admin') {
    hotels = await c.env.DB.prepare('SELECT * FROM hotels ORDER BY name').all()
  } else {
    hotels = await c.env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(user.hotel_id).all()
  }
  return c.json({ hotels: hotels.results })
})

app.post('/api/hotels', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const { name, address, logo_url } = await c.req.json()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const result = await c.env.DB.prepare('INSERT INTO hotels (name, slug, address, logo_url) VALUES (?, ?, ?, ?)').bind(name, slug, address || null, logo_url || null).run()
  return c.json({ id: result.meta.last_row_id, name, slug })
})

app.put('/api/hotels/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { name, address } = await c.req.json()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  await c.env.DB.prepare('UPDATE hotels SET name = ?, slug = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(name, slug, address || null, id).run()
  return c.json({ success: true })
})

app.delete('/api/hotels/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  // Vérifier que l'hôtel existe
  const hotel = await c.env.DB.prepare('SELECT id, name FROM hotels WHERE id = ?').bind(id).first() as any
  if (!hotel) return c.json({ error: 'Hôtel non trouvé' }, 404)
  // Supprimer dans l'ordre : les données liées d'abord
  const users = await c.env.DB.prepare('SELECT id FROM users WHERE hotel_id = ?').bind(id).all()
  for (const u of users.results as any[]) {
    await c.env.DB.prepare('DELETE FROM changelog_reads WHERE user_id = ?').bind(u.id).run()
  }
  await c.env.DB.prepare('DELETE FROM changelog WHERE hotel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM suggestions WHERE hotel_id = ?').bind(id).run()
  const procedures = await c.env.DB.prepare('SELECT id FROM procedures WHERE hotel_id = ?').bind(id).all()
  for (const p of procedures.results as any[]) {
    const conditions = await c.env.DB.prepare('SELECT id FROM conditions WHERE procedure_id = ?').bind(p.id).all()
    for (const cond of conditions.results as any[]) {
      await c.env.DB.prepare('DELETE FROM condition_steps WHERE condition_id = ?').bind(cond.id).run()
    }
    await c.env.DB.prepare('DELETE FROM conditions WHERE procedure_id = ?').bind(p.id).run()
    await c.env.DB.prepare('DELETE FROM steps WHERE procedure_id = ?').bind(p.id).run()
  }
  await c.env.DB.prepare('DELETE FROM procedures WHERE hotel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM categories WHERE hotel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM users WHERE hotel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM hotels WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ============================================
// USERS ROUTES
// ============================================
app.get('/api/users', authMiddleware, async (c) => {
  const user = c.get('user')
  let users
  if (user.role === 'super_admin') {
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id ORDER BY u.name').all()
  } else if (user.role === 'admin') {
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id WHERE u.hotel_id = ? ORDER BY u.name').bind(user.hotel_id).all()
  } else {
    return c.json({ error: 'Non autorisé' }, 403)
  }
  return c.json({ users: users.results })
})

// Mise à jour des permissions granulaires (admin only)
// Body : { can_edit_procedures?, can_edit_info?, can_manage_chat? }
app.put('/api/users/:id/permissions', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json() as {
    can_edit_procedures?: boolean | number
    can_edit_info?: boolean | number
    can_manage_chat?: boolean | number
  }

  // Check the target user belongs to same hotel (for admin)
  const targetUser = await c.env.DB.prepare('SELECT id, hotel_id, role FROM users WHERE id = ?').bind(id).first() as any
  if (!targetUser) return c.json({ error: 'Utilisateur non trouvé' }, 404)
  if (currentUser.role === 'admin' && targetUser.hotel_id !== currentUser.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  if (targetUser.role !== 'employee') return c.json({ error: 'Ces permissions ne s\'appliquent qu\'aux employés' }, 400)

  // Construction dynamique de l'UPDATE selon les champs fournis
  const fields: string[] = []
  const values: any[] = []
  if (body.can_edit_procedures !== undefined) { fields.push('can_edit_procedures = ?'); values.push(body.can_edit_procedures ? 1 : 0) }
  if (body.can_edit_info !== undefined)       { fields.push('can_edit_info = ?');       values.push(body.can_edit_info ? 1 : 0) }
  if (body.can_manage_chat !== undefined)     { fields.push('can_manage_chat = ?');     values.push(body.can_manage_chat ? 1 : 0) }
  if (fields.length === 0) return c.json({ error: 'Aucune permission à mettre à jour' }, 400)

  values.push(id)
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

app.post('/api/users', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const { hotel_id, email, password, name, role } = await c.req.json()
  const targetHotel = currentUser.role === 'admin' ? currentUser.hotel_id : hotel_id
  if (currentUser.role === 'admin' && role === 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  try {
    const result = await c.env.DB.prepare('INSERT INTO users (hotel_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').bind(targetHotel, email, password, name, role || 'employee').run()
    return c.json({ id: result.meta.last_row_id, email, name, role })
  } catch (e: any) {
    return c.json({ error: 'Cet email est déjà utilisé' }, 400)
  }
})

app.delete('/api/users/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  // Impossible de se supprimer soi-même
  if (String(id) === String(currentUser.id)) return c.json({ error: 'Impossible de supprimer votre propre compte' }, 400)
  try {
    const targetUser = await c.env.DB.prepare('SELECT id, hotel_id, role FROM users WHERE id = ?').bind(id).first() as any
    if (!targetUser) return c.json({ error: 'Utilisateur non trouvé' }, 404)
    // Un admin ne peut supprimer que les users de son hôtel (pas les super_admins)
    if (currentUser.role === 'admin') {
      if (String(targetUser.hotel_id) !== String(currentUser.hotel_id)) return c.json({ error: 'Non autorisé' }, 403)
      if (targetUser.role === 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
    }
    // Supprimer les suggestions soumises par cet user (son contenu propre)
    await c.env.DB.prepare('DELETE FROM suggestions WHERE user_id = ?').bind(id).run()
    // Nullifier les autres références (on conserve l'historique collectif)
    await c.env.DB.prepare('DELETE FROM changelog_reads WHERE user_id = ?').bind(id).run()
    await c.env.DB.prepare('UPDATE suggestions SET reviewed_by = NULL WHERE reviewed_by = ?').bind(id).run()
    await c.env.DB.prepare('UPDATE changelog SET user_id = NULL WHERE user_id = ?').bind(id).run()
    await c.env.DB.prepare('UPDATE procedures SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await c.env.DB.prepare('UPDATE procedures SET approved_by = NULL WHERE approved_by = ?').bind(id).run()
    await c.env.DB.prepare('UPDATE templates SET created_by = NULL WHERE created_by = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e?.message || 'Erreur serveur' }, 500)
  }
})

// ============================================
// CATEGORIES ROUTES
// ============================================
app.get('/api/categories', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = c.req.query('hotel_id') || user.hotel_id
  const categories = await c.env.DB.prepare('SELECT * FROM categories WHERE hotel_id = ? ORDER BY sort_order, name').bind(hotelId).all()
  return c.json({ categories: categories.results })
})

app.post('/api/categories', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const { name, icon, color, parent_id } = await c.req.json()
  const hotelId = user.role === 'super_admin' ? (await c.req.json()).hotel_id || user.hotel_id : user.hotel_id
  const result = await c.env.DB.prepare('INSERT INTO categories (hotel_id, name, icon, color, parent_id) VALUES (?, ?, ?, ?, ?)').bind(hotelId, name, icon || 'fa-folder', color || '#3B82F6', parent_id || null).run()
  return c.json({ id: result.meta.last_row_id, name })
})

app.put('/api/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { name, icon, color } = await c.req.json()
  await c.env.DB.prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?').bind(name, icon, color, id).run()
  return c.json({ success: true })
})

app.delete('/api/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ============================================
// PROCEDURES ROUTES
// ============================================
app.get('/api/procedures', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = c.req.query('hotel_id') || user.hotel_id
  const categoryId = c.req.query('category_id')
  const search = c.req.query('search')
  const includeSubprocedures = c.req.query('include_subprocedures') === '1' // explicite, pour le détail

  // FILTRAGE DES SOUS-PROCÉDURES :
  // On utilise désormais le flag explicite procedures.is_subprocedure (cf. migration 0010).
  // - is_subprocedure=0 → procédure principale (visible dans la liste)
  // - is_subprocedure=1 → sous-procédure (cachée de la liste, accessible via le step parent)
  // Pour récupérer aussi les sous-procédures (par exemple pour le picker du modal),
  // utiliser ?include_subprocedures=1.
  let query = `SELECT p.*, c.name as category_name, c.icon as category_icon, c.color as category_color, 
    u1.name as created_by_name, u2.name as approved_by_name,
    (SELECT COUNT(*) FROM steps WHERE procedure_id = p.id) as step_count,
    (SELECT COUNT(*) FROM conditions WHERE procedure_id = p.id) as condition_count
    FROM procedures p 
    LEFT JOIN categories c ON p.category_id = c.id 
    LEFT JOIN users u1 ON p.created_by = u1.id
    LEFT JOIN users u2 ON p.approved_by = u2.id
    WHERE p.hotel_id = ?`
  const params: any[] = [hotelId]

  if (!includeSubprocedures) {
    query += ` AND p.is_subprocedure = 0`
  }

  if (categoryId) { query += ' AND p.category_id = ?'; params.push(categoryId) }
  if (search) { query += ' AND (p.title LIKE ? OR p.trigger_event LIKE ? OR p.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`) }

  query += ' ORDER BY c.sort_order, p.title'

  const stmt = c.env.DB.prepare(query)
  const procedures = await stmt.bind(...params).all()
  return c.json({ procedures: procedures.results })
})

app.get('/api/procedures/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const procedure = await c.env.DB.prepare(`SELECT p.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
    u1.name as created_by_name, u2.name as approved_by_name
    FROM procedures p 
    LEFT JOIN categories c ON p.category_id = c.id 
    LEFT JOIN users u1 ON p.created_by = u1.id
    LEFT JOIN users u2 ON p.approved_by = u2.id
    WHERE p.id = ?`).bind(id).first()

  if (!procedure) return c.json({ error: 'Procédure non trouvée' }, 404)

  // Steps avec linked_procedure (titre de la procédure liée)
  const steps = await c.env.DB.prepare(`
    SELECT s.*, lp.title as linked_procedure_title
    FROM steps s
    LEFT JOIN procedures lp ON s.linked_procedure_id = lp.id
    WHERE s.procedure_id = ?
    ORDER BY s.step_number
  `).bind(id).all()

  const conditions = await c.env.DB.prepare('SELECT * FROM conditions WHERE procedure_id = ? ORDER BY sort_order').bind(id).all()

  const conditionsWithSteps = await Promise.all((conditions.results as any[]).map(async (cond: any) => {
    const condSteps = await c.env.DB.prepare(`
      SELECT cs.*, lp.title as linked_procedure_title
      FROM condition_steps cs
      LEFT JOIN procedures lp ON cs.linked_procedure_id = lp.id
      WHERE cs.condition_id = ?
      ORDER BY cs.step_number
    `).bind(cond.id).all()
    return { ...cond, steps: condSteps.results }
  }))

  return c.json({ procedure, steps: steps.results, conditions: conditionsWithSteps })
})

app.post('/api/procedures', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json()
  const hotelId = user.role === 'super_admin' ? (body.hotel_id || user.hotel_id) : user.hotel_id

  // Note : trigger_icon (anciennement supprimé de l'UI) a default 'fa-bolt' en DB
  // Note : status (anciennement supprimé de l'UI) → on force 'active' (toutes les procédures sont actives)
  // priority forcé à 'normal' (champ supprimé de l'UI mais conservé en DB)
  // is_subprocedure : 0 par défaut, 1 si on crée explicitement une sous-procédure
  // depuis le modal "Lier à une nouvelle sous-procédure"
  const isSubproc = body.is_subprocedure ? 1 : 0
  const result = await c.env.DB.prepare(
    `INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, trigger_conditions, priority, status, is_subprocedure, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'normal', 'active', ?, ?)`
  ).bind(hotelId, body.category_id || null, body.title, body.description || null, body.trigger_event, body.trigger_conditions || null, isSubproc, user.id).run()

  const procId = result.meta.last_row_id

  // Insert steps : on utilise le champ "content" (fusion description + détails + warning + tip)
  // step_type est forcé à 'action' (champ supprimé de l'UI)
  if (body.steps && Array.isArray(body.steps)) {
    for (const step of body.steps) {
      await c.env.DB.prepare(
        `INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional, condition_text)
         VALUES (?, ?, ?, ?, ?, 'action', ?, ?, ?)`
      ).bind(procId, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0, step.condition_text || null).run()
    }
  }

  // Insert conditions
  if (body.conditions && Array.isArray(body.conditions)) {
    for (const cond of body.conditions) {
      const condResult = await c.env.DB.prepare(
        `INSERT INTO conditions (procedure_id, condition_text, description, sort_order) VALUES (?, ?, ?, ?)`
      ).bind(procId, cond.condition_text, cond.description || null, cond.sort_order || 0).run()

      if (cond.steps && Array.isArray(cond.steps)) {
        for (const step of cond.steps) {
          await c.env.DB.prepare(
            `INSERT INTO condition_steps (condition_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional)
             VALUES (?, ?, ?, ?, ?, 'action', ?, ?)`
          ).bind(condResult.meta.last_row_id, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0).run()
        }
      }
    }
  }

  // Synchronisation auto : toute procédure liée via une étape devient sous-procédure
  await syncSubprocedureFlags(c.env.DB, procId as number, hotelId)

  // Changelog
  await c.env.DB.prepare(
    `INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required) VALUES (?, ?, ?, 'created', ?, 0)`
  ).bind(hotelId, procId, user.id, `Procédure "${body.title}" créée`).run()

  return c.json({ id: procId })
})

// Helper : marque comme sous-procédure (is_subprocedure=1) toute procédure
// référencée par une étape (steps ou condition_steps) du parent donné, à
// condition qu'elle appartienne au même hôtel et soit ≠ du parent lui-même.
// Permet de garantir la cohérence après chaque POST/PUT d'une procédure.
async function syncSubprocedureFlags(db: D1Database, parentProcId: number, hotelId: any) {
  await db.prepare(`
    UPDATE procedures
    SET is_subprocedure = 1
    WHERE hotel_id = ?
      AND id <> ?
      AND id IN (
        SELECT linked_procedure_id FROM steps
          WHERE procedure_id = ? AND linked_procedure_id IS NOT NULL
        UNION
        SELECT cs.linked_procedure_id FROM condition_steps cs
          JOIN conditions cd ON cd.id = cs.condition_id
          WHERE cd.procedure_id = ? AND cs.linked_procedure_id IS NOT NULL
      )
  `).bind(hotelId, parentProcId, parentProcId, parentProcId).run()
}

app.put('/api/procedures/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json()

  // Status reste 'active', priority reste inchangé (champs supprimés de l'UI)
  await c.env.DB.prepare(
    `UPDATE procedures SET category_id = ?, title = ?, description = ?, trigger_event = ?, trigger_conditions = ?, status = 'active', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(body.category_id || null, body.title, body.description || null, body.trigger_event, body.trigger_conditions || null, id).run()

  // Re-create steps avec content + linked_procedure_id
  if (body.steps) {
    await c.env.DB.prepare('DELETE FROM steps WHERE procedure_id = ?').bind(id).run()
    for (const step of body.steps) {
      await c.env.DB.prepare(
        `INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional, condition_text)
         VALUES (?, ?, ?, ?, ?, 'action', ?, ?, ?)`
      ).bind(id, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0, step.condition_text || null).run()
    }
  }

  // Re-create conditions
  if (body.conditions) {
    // Delete old condition steps first
    const oldConditions = await c.env.DB.prepare('SELECT id FROM conditions WHERE procedure_id = ?').bind(id).all()
    for (const cond of oldConditions.results as any[]) {
      await c.env.DB.prepare('DELETE FROM condition_steps WHERE condition_id = ?').bind(cond.id).run()
    }
    await c.env.DB.prepare('DELETE FROM conditions WHERE procedure_id = ?').bind(id).run()

    for (const cond of body.conditions) {
      const condResult = await c.env.DB.prepare(
        `INSERT INTO conditions (procedure_id, condition_text, description, sort_order) VALUES (?, ?, ?, ?)`
      ).bind(id, cond.condition_text, cond.description || null, cond.sort_order || 0).run()
      if (cond.steps && Array.isArray(cond.steps)) {
        for (const step of cond.steps) {
          await c.env.DB.prepare(
            `INSERT INTO condition_steps (condition_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional)
             VALUES (?, ?, ?, ?, ?, 'action', ?, ?)`
          ).bind(condResult.meta.last_row_id, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0).run()
        }
      }
    }
  }

  // Synchronisation auto : toute procédure liée via une étape de CE parent
  // devient sous-procédure (is_subprocedure=1). Garantit qu'une modif du
  // parent ne fait jamais "remonter" une sous-procédure dans la liste.
  const proc = await c.env.DB.prepare('SELECT hotel_id, title FROM procedures WHERE id = ?').bind(id).first() as any
  await syncSubprocedureFlags(c.env.DB, Number(id), proc.hotel_id)

  // Changelog
  await c.env.DB.prepare(
    `INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required) VALUES (?, ?, ?, 'updated', ?, ?)`
  ).bind(proc.hotel_id, id, user.id, `Procédure "${proc.title}" mise à jour`, body.is_read_required ? 1 : 0).run()

  return c.json({ success: true })
})

app.put('/api/procedures/:id/status', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { status } = await c.req.json()

  let approvedBy = null
  let approvedAt = null
  if (status === 'active') {
    approvedBy = user.id
    approvedAt = new Date().toISOString()
  }

  await c.env.DB.prepare(
    `UPDATE procedures SET status = ?, approved_by = COALESCE(?, approved_by), approved_at = COALESCE(?, approved_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, approvedBy, approvedAt, id).run()

  const proc = await c.env.DB.prepare('SELECT hotel_id, title FROM procedures WHERE id = ?').bind(id).first() as any
  const actionMap: Record<string, string> = { active: 'activated', archived: 'archived', draft: 'updated' }
  await c.env.DB.prepare(
    `INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(proc.hotel_id, id, user.id, actionMap[status] || 'updated', `Procédure "${proc.title}" : statut changé en ${status}`, status === 'active' ? 1 : 0).run()

  return c.json({ success: true })
})

app.delete('/api/procedures/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')

  const proc = await c.env.DB.prepare('SELECT hotel_id, title FROM procedures WHERE id = ?').bind(id).first() as any
  
  // Delete condition steps first
  const conditions = await c.env.DB.prepare('SELECT id FROM conditions WHERE procedure_id = ?').bind(id).all()
  for (const cond of conditions.results as any[]) {
    await c.env.DB.prepare('DELETE FROM condition_steps WHERE condition_id = ?').bind(cond.id).run()
  }
  await c.env.DB.prepare('DELETE FROM conditions WHERE procedure_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM steps WHERE procedure_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM procedures WHERE id = ?').bind(id).run()

  if (proc) {
    await c.env.DB.prepare(
      `INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary) VALUES (?, NULL, ?, 'archived', ?)`
    ).bind(proc.hotel_id, user.id, `Procédure "${proc.title}" supprimée`).run()
  }
  return c.json({ success: true })
})

// ============================================
// SUGGESTIONS ROUTES
// ============================================
app.get('/api/suggestions', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = c.req.query('hotel_id') || user.hotel_id
  const status = c.req.query('status')

  let query = `SELECT s.*, u.name as user_name, p.title as procedure_title, u2.name as reviewed_by_name
    FROM suggestions s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN procedures p ON s.procedure_id = p.id
    LEFT JOIN users u2 ON s.reviewed_by = u2.id
    WHERE s.hotel_id = ?`
  const params: any[] = [hotelId]

  if (status) { query += ' AND s.status = ?'; params.push(status) }
  if (user.role === 'employee') { query += ' AND s.user_id = ?'; params.push(user.id) }

  query += ' ORDER BY s.created_at DESC'
  const suggestions = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ suggestions: suggestions.results })
})

app.post('/api/suggestions', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé — seuls les utilisateurs avec droits de modification peuvent soumettre des suggestions' }, 403)

  const { procedure_id, type, title, description } = await c.req.json()
  const hotelId = user.hotel_id

  const result = await c.env.DB.prepare(
    `INSERT INTO suggestions (hotel_id, procedure_id, user_id, type, title, description) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(hotelId, procedure_id || null, user.id, type, title, description).run()

  return c.json({ id: result.meta.last_row_id })
})

app.put('/api/suggestions/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { status, admin_response } = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE suggestions SET status = ?, admin_response = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, admin_response || null, user.id, id).run()

  return c.json({ success: true })
})

// ============================================
// CHANGELOG ROUTES
// ============================================
app.get('/api/changelog', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = c.req.query('hotel_id') || user.hotel_id

  const changelog = await c.env.DB.prepare(
    `SELECT cl.*, u.name as user_name, p.title as procedure_title,
      (SELECT COUNT(*) FROM changelog_reads cr WHERE cr.changelog_id = cl.id AND cr.user_id = ?) as is_read
    FROM changelog cl
    LEFT JOIN users u ON cl.user_id = u.id
    LEFT JOIN procedures p ON cl.procedure_id = p.id
    WHERE cl.hotel_id = ?
    ORDER BY cl.created_at DESC
    LIMIT 50`
  ).bind(user.id, hotelId).all()

  const unreadRequired = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM changelog cl
     WHERE cl.hotel_id = ? AND cl.is_read_required = 1
     AND cl.id NOT IN (SELECT changelog_id FROM changelog_reads WHERE user_id = ?)`
  ).bind(hotelId, user.id).first() as any

  return c.json({ changelog: changelog.results, unread_required: unreadRequired?.count || 0 })
})

app.post('/api/changelog/:id/read', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO changelog_reads (changelog_id, user_id) VALUES (?, ?)').bind(id, user.id).run()
  } catch {}
  return c.json({ success: true })
})

// ============================================
// TEMPLATES ROUTES (admin hôtel uniquement — super_admin exclu)
// ============================================
app.get('/api/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const templates = await c.env.DB.prepare('SELECT t.*, u.name as created_by_name FROM templates t LEFT JOIN users u ON t.created_by = u.id ORDER BY t.name').all()
  return c.json({ templates: templates.results })
})

app.post('/api/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user) || user.role === 'employee') return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json()
  const result = await c.env.DB.prepare(
    `INSERT INTO templates (name, description, category_name, trigger_event, trigger_conditions, steps_json, conditions_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(body.name, body.description || null, body.category_name || null, body.trigger_event, body.trigger_conditions || null, JSON.stringify(body.steps || []), JSON.stringify(body.conditions || []), user.id).run()
  return c.json({ id: result.meta.last_row_id })
})

app.delete('/api/templates/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user) || user.role === 'employee') return c.json({ error: 'Non autorisé' }, 403)
  await c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

app.post('/api/templates/:id/import', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const template = await c.env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!template) return c.json({ error: 'Template non trouvé' }, 404)

  const hotelId = user.hotel_id
  let categoryId = null

  // Find or create category
  if (template.category_name) {
    const existingCat = await c.env.DB.prepare('SELECT id FROM categories WHERE hotel_id = ? AND name = ?').bind(hotelId, template.category_name).first() as any
    if (existingCat) {
      categoryId = existingCat.id
    } else {
      const catResult = await c.env.DB.prepare('INSERT INTO categories (hotel_id, name) VALUES (?, ?)').bind(hotelId, template.category_name).run()
      categoryId = catResult.meta.last_row_id
    }
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, trigger_conditions, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`
  ).bind(hotelId, categoryId, template.name, template.description, template.trigger_event, template.trigger_conditions, user.id).run()

  const procId = result.meta.last_row_id
  const steps = JSON.parse(template.steps_json || '[]')
  for (const step of steps) {
    await c.env.DB.prepare(
      `INSERT INTO steps (procedure_id, step_number, title, description, step_type) VALUES (?, ?, ?, ?, ?)`
    ).bind(procId, step.step_number, step.title, step.description || null, step.step_type || 'action').run()
  }

  return c.json({ id: procId, message: 'Template importé avec succès' })
})


// ============================================
// DASHBOARD STATS
// ============================================
app.get('/api/stats', authMiddleware, async (c) => {
  const user = c.get('user')
  const hotelId = c.req.query('hotel_id') || user.hotel_id

  if (user.role === 'super_admin') {
    // Super admin : stats infrastructure uniquement (hôtels + users)
    const hotels = await c.env.DB.prepare('SELECT COUNT(*) as count FROM hotels').first() as any
    const users = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first() as any
    return c.json({ hotels: hotels.count, users: users.count })
  }

  const totalProc = await c.env.DB.prepare('SELECT COUNT(*) as count FROM procedures WHERE hotel_id = ?').bind(hotelId).first() as any
  const activeProc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM procedures WHERE hotel_id = ? AND status = 'active'").bind(hotelId).first() as any
  const draftProc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM procedures WHERE hotel_id = ? AND status = 'draft'").bind(hotelId).first() as any
  const pendingSugg = await c.env.DB.prepare("SELECT COUNT(*) as count FROM suggestions WHERE hotel_id = ? AND status = 'pending'").bind(hotelId).first() as any
  const totalUsers = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE hotel_id = ?').bind(hotelId).first() as any

  const unreadRequired = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM changelog cl
     WHERE cl.hotel_id = ? AND cl.is_read_required = 1
     AND cl.id NOT IN (SELECT changelog_id FROM changelog_reads WHERE user_id = ?)`
  ).bind(hotelId, user.id).first() as any

  const recentChanges = await c.env.DB.prepare(
    `SELECT cl.*, u.name as user_name, p.title as procedure_title
     FROM changelog cl LEFT JOIN users u ON cl.user_id = u.id LEFT JOIN procedures p ON cl.procedure_id = p.id
     WHERE cl.hotel_id = ? ORDER BY cl.created_at DESC LIMIT 5`
  ).bind(hotelId).all()

  return c.json({
    total_procedures: totalProc.count,
    active_procedures: activeProc.count,
    draft_procedures: draftProc.count,
    pending_suggestions: pendingSugg.count,
    total_users: totalUsers.count,
    unread_required: unreadRequired?.count || 0,
    recent_changes: recentChanges.results
  })
})

// ============================================
// CHAT / CONVERSATIONS ROUTES
// ============================================

// Helper : peut gérer les salons (créer/modifier/supprimer)
function canManageChannels(user: { role: string; can_manage_chat?: number }) {
  // Basé sur la nouvelle permission can_manage_chat
  return user.role === 'admin' || user.can_manage_chat === 1
}

// Helper : a accès au chat (admin + tous employees)
function canAccessChat(user: { role: string }) {
  return user.role === 'admin' || user.role === 'employee'
}

// GET /api/chat/overview — Tous les groupes + salons + compteurs non-lus pour mon hôtel
app.get('/api/chat/overview', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user)) return c.json({ error: 'Non autorisé' }, 403)
  if (!user.hotel_id) return c.json({ groups: [], total_unread: 0 })

  const groups = await c.env.DB.prepare(
    'SELECT * FROM chat_groups WHERE hotel_id = ? ORDER BY sort_order, name'
  ).bind(user.hotel_id).all()

  const channels = await c.env.DB.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM chat_messages m 
        WHERE m.channel_id = c.id 
        AND m.id > COALESCE((SELECT last_read_message_id FROM chat_reads WHERE user_id = ? AND channel_id = c.id), 0)
      ) as unread_count,
      (SELECT MAX(created_at) FROM chat_messages WHERE channel_id = c.id) as last_message_at
    FROM chat_channels c
    WHERE c.hotel_id = ? AND c.is_archived = 0
    ORDER BY c.sort_order, c.name
  `).bind(user.id, user.hotel_id).all()

  // Group channels by group_id
  const groupsWithChannels = (groups.results as any[]).map((g: any) => ({
    ...g,
    channels: (channels.results as any[]).filter((c: any) => c.group_id === g.id)
  }))

  const totalUnread = (channels.results as any[]).reduce((sum, c: any) => sum + (c.unread_count || 0), 0)

  return c.json({ groups: groupsWithChannels, total_unread: totalUnread })
})

// GET /api/chat/unread-total — Juste le compteur global (pour rafraîchir la sidebar)
app.get('/api/chat/unread-total', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user) || !user.hotel_id) return c.json({ total: 0 })

  const result = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(unread), 0) as total FROM (
      SELECT (
        (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id) -
        COALESCE((SELECT last_read_message_id FROM chat_reads WHERE user_id = ? AND channel_id = c.id), 0)
      ) as unread
      FROM chat_channels c
      WHERE c.hotel_id = ? AND c.is_archived = 0
    )
  `).bind(user.id, user.hotel_id).first() as any

  // Note : cette formule simplifiée fonctionne car on suppose que les IDs sont monotones et qu'on n'a pas de skip
  // On la corrige pour être 100% fiable :
  const fix = await c.env.DB.prepare(`
    SELECT COUNT(*) as total
    FROM chat_messages m
    JOIN chat_channels c ON m.channel_id = c.id
    WHERE c.hotel_id = ? AND c.is_archived = 0
    AND m.id > COALESCE((SELECT last_read_message_id FROM chat_reads WHERE user_id = ? AND channel_id = m.channel_id), 0)
  `).bind(user.hotel_id, user.id).first() as any

  return c.json({ total: fix?.total || 0 })
})

// POST /api/chat/groups — Créer un groupe (admin/éditeur)
app.post('/api/chat/groups', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user) || !user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  const { name, icon, color } = await c.req.json()
  if (!name) return c.json({ error: 'Nom requis' }, 400)

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM chat_groups WHERE hotel_id = ?').bind(user.hotel_id).first() as any
  const result = await c.env.DB.prepare(
    'INSERT INTO chat_groups (hotel_id, name, icon, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(user.hotel_id, name, icon || 'fa-folder', color || '#3B82F6', (maxOrder?.m || 0) + 1).run()

  return c.json({ id: result.meta.last_row_id, name })
})

// PUT /api/chat/groups/:id — Renommer un groupe
app.put('/api/chat/groups/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { name, icon, color } = await c.req.json()

  const group = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(id).first() as any
  if (!group || group.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  await c.env.DB.prepare(
    'UPDATE chat_groups SET name = ?, icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?'
  ).bind(name, icon || null, color || null, id).run()

  return c.json({ success: true })
})

// DELETE /api/chat/groups/:id — Supprimer un groupe (sauf système)
app.delete('/api/chat/groups/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')

  const group = await c.env.DB.prepare('SELECT hotel_id, is_system FROM chat_groups WHERE id = ?').bind(id).first() as any
  if (!group || group.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  if (group.is_system) return c.json({ error: 'Impossible de supprimer un groupe par défaut' }, 400)

  // Supprimer les messages des salons du groupe puis les salons puis le groupe
  const channels = await c.env.DB.prepare('SELECT id FROM chat_channels WHERE group_id = ?').bind(id).all()
  for (const ch of channels.results as any[]) {
    await c.env.DB.prepare('DELETE FROM chat_messages WHERE channel_id = ?').bind(ch.id).run()
    await c.env.DB.prepare('DELETE FROM chat_reads WHERE channel_id = ?').bind(ch.id).run()
  }
  await c.env.DB.prepare('DELETE FROM chat_channels WHERE group_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM chat_groups WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// POST /api/chat/channels — Créer un salon
app.post('/api/chat/channels', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user) || !user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  const { group_id, name, description, icon } = await c.req.json()
  if (!name || !group_id) return c.json({ error: 'Nom et groupe requis' }, 400)

  // Vérifier que le groupe appartient à l'hôtel de l'utilisateur
  const group = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(group_id).first() as any
  if (!group || group.hotel_id !== user.hotel_id) return c.json({ error: 'Groupe invalide' }, 400)

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM chat_channels WHERE group_id = ?').bind(group_id).first() as any
  const result = await c.env.DB.prepare(
    'INSERT INTO chat_channels (hotel_id, group_id, name, description, icon, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.hotel_id, group_id, name, description || null, icon || 'fa-hashtag', (maxOrder?.m || 0) + 1, user.id).run()

  return c.json({ id: result.meta.last_row_id, name })
})

// PUT /api/chat/channels/:id — Modifier un salon
app.put('/api/chat/channels/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { name, description, icon, group_id } = await c.req.json()

  const channel = await c.env.DB.prepare('SELECT hotel_id FROM chat_channels WHERE id = ?').bind(id).first() as any
  if (!channel || channel.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  if (group_id) {
    const group = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(group_id).first() as any
    if (!group || group.hotel_id !== user.hotel_id) return c.json({ error: 'Groupe invalide' }, 400)
  }

  await c.env.DB.prepare(
    'UPDATE chat_channels SET name = ?, description = ?, icon = COALESCE(?, icon), group_id = COALESCE(?, group_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(name, description || null, icon || null, group_id || null, id).run()

  return c.json({ success: true })
})

// DELETE /api/chat/channels/:id — Supprimer un salon (et tous ses messages)
app.delete('/api/chat/channels/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')

  const channel = await c.env.DB.prepare('SELECT hotel_id FROM chat_channels WHERE id = ?').bind(id).first() as any
  if (!channel || channel.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  await c.env.DB.prepare('DELETE FROM chat_messages WHERE channel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM chat_reads WHERE channel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM chat_channels WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// GET /api/chat/channels/:id/messages — Lister les messages d'un salon
app.get('/api/chat/channels/:id/messages', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const after = c.req.query('after') // ID du dernier message connu pour le polling

  const channel = await c.env.DB.prepare('SELECT hotel_id, name, description, icon, group_id FROM chat_channels WHERE id = ?').bind(id).first() as any
  if (!channel || channel.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  let query = `SELECT m.*, u.name as user_name, u.role as user_role, u.can_edit_procedures as user_can_edit
    FROM chat_messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.channel_id = ?`
  const params: any[] = [id]

  if (after) {
    query += ' AND m.id > ?'
    params.push(after)
  }

  query += ' ORDER BY m.created_at ASC, m.id ASC LIMIT 200'

  const messages = await c.env.DB.prepare(query).bind(...params).all()

  return c.json({ channel, messages: messages.results })
})

// POST /api/chat/channels/:id/messages — Envoyer un message
app.post('/api/chat/channels/:id/messages', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { content } = await c.req.json()

  if (!content || !content.trim()) return c.json({ error: 'Message vide' }, 400)
  if (content.length > 5000) return c.json({ error: 'Message trop long (max 5000 caractères)' }, 400)

  const channel = await c.env.DB.prepare('SELECT hotel_id FROM chat_channels WHERE id = ?').bind(id).first() as any
  if (!channel || channel.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  const result = await c.env.DB.prepare(
    'INSERT INTO chat_messages (channel_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(id, user.id, content.trim()).run()

  // L'auteur a forcément lu son propre message → mettre à jour son chat_reads
  await c.env.DB.prepare(`
    INSERT INTO chat_reads (user_id, channel_id, last_read_message_id, last_read_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET 
      last_read_message_id = excluded.last_read_message_id,
      last_read_at = CURRENT_TIMESTAMP
  `).bind(user.id, id, result.meta.last_row_id).run()

  // Récupérer le message complet pour le retour
  const msg = await c.env.DB.prepare(`
    SELECT m.*, u.name as user_name, u.role as user_role, u.can_edit_procedures as user_can_edit
    FROM chat_messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.id = ?
  `).bind(result.meta.last_row_id).first()

  return c.json({ message: msg })
})

// PUT /api/chat/messages/:id — Éditer son propre message
app.put('/api/chat/messages/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { content } = await c.req.json()

  if (!content || !content.trim()) return c.json({ error: 'Message vide' }, 400)

  const msg = await c.env.DB.prepare('SELECT user_id FROM chat_messages WHERE id = ?').bind(id).first() as any
  if (!msg) return c.json({ error: 'Message non trouvé' }, 404)
  if (msg.user_id !== user.id) return c.json({ error: 'Vous ne pouvez modifier que vos propres messages' }, 403)

  await c.env.DB.prepare(
    'UPDATE chat_messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(content.trim(), id).run()

  return c.json({ success: true })
})

// POST /api/chat/channels/:id/read — Marquer un salon comme lu
app.post('/api/chat/channels/:id/read', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')

  const channel = await c.env.DB.prepare('SELECT hotel_id FROM chat_channels WHERE id = ?').bind(id).first() as any
  if (!channel || channel.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  const lastMsg = await c.env.DB.prepare('SELECT MAX(id) as max_id FROM chat_messages WHERE channel_id = ?').bind(id).first() as any
  const lastId = lastMsg?.max_id || 0

  await c.env.DB.prepare(`
    INSERT INTO chat_reads (user_id, channel_id, last_read_message_id, last_read_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET 
      last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id),
      last_read_at = CURRENT_TIMESTAMP
  `).bind(user.id, id, lastId).run()

  return c.json({ success: true })
})

// ============================================
// HOTEL INFO API
// ============================================
function getUserHotelId(c: any) {
  const user = c.get('user')
  if (!user) return null
  // Pour super_admin : on peut filtrer via query param ?hotel_id=
  if (user.role === 'super_admin') {
    const q = c.req.query('hotel_id')
    return q ? parseInt(q) : null
  }
  return user.hotel_id || null
}

// GET toutes les catégories + items d'un hôtel
app.get('/api/hotel-info', authMiddleware, async (c) => {
  const { env } = c
  const hotelId = getUserHotelId(c)
  if (!hotelId) return c.json({ categories: [], items: [] })

  const cats = await env.DB.prepare(`
    SELECT id, name, icon, color, sort_order
    FROM hotel_info_categories
    WHERE hotel_id = ?
    ORDER BY sort_order ASC, id ASC
  `).bind(hotelId).all()

  const items = await env.DB.prepare(`
    SELECT id, category_id, title, content, sort_order, updated_at
    FROM hotel_info_items
    WHERE hotel_id = ?
    ORDER BY sort_order ASC, id ASC
  `).bind(hotelId).all()

  return c.json({ categories: cats.results || [], items: items.results || [] })
})

// Recherche dans les infos
app.get('/api/hotel-info/search', authMiddleware, async (c) => {
  const { env } = c
  const hotelId = getUserHotelId(c)
  const q = (c.req.query('q') || '').trim()
  if (!hotelId || !q) return c.json({ results: [] })

  const like = `%${q}%`
  const results = await env.DB.prepare(`
    SELECT i.id, i.category_id, i.title, i.content, c.name as category_name, c.icon as category_icon, c.color as category_color
    FROM hotel_info_items i
    LEFT JOIN hotel_info_categories c ON c.id = i.category_id
    WHERE i.hotel_id = ? AND (i.title LIKE ? OR i.content LIKE ?)
    ORDER BY i.sort_order ASC
    LIMIT 50
  `).bind(hotelId, like, like).all()

  return c.json({ results: results.results || [] })
})

// POST nouvelle catégorie (admin + employé avec can_edit_info)
app.post('/api/hotel-info/categories', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const hotelId = user.role === 'super_admin' ? parseInt(c.req.query('hotel_id') || '0') : user.hotel_id
  if (!hotelId) return c.json({ error: 'Aucun hôtel' }, 400)

  const { name, icon, color, sort_order } = await c.req.json()
  if (!name) return c.json({ error: 'Nom requis' }, 400)

  const r = await c.env.DB.prepare(`
    INSERT INTO hotel_info_categories (hotel_id, name, icon, color, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(hotelId, name, icon || 'fa-circle-info', color || '#3B82F6', sort_order || 0).run()

  return c.json({ id: r.meta.last_row_id, success: true })
})

// PUT modifier catégorie
app.put('/api/hotel-info/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const id = parseInt(c.req.param('id'))
  const { name, icon, color, sort_order } = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE hotel_info_categories
    SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color), sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).bind(name, icon, color, sort_order, id).run()

  return c.json({ success: true })
})

// DELETE catégorie (les items deviennent sans catégorie)
app.delete('/api/hotel-info/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const id = parseInt(c.req.param('id'))

  await c.env.DB.prepare(`DELETE FROM hotel_info_categories WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// POST nouvel item (admin + employé avec can_edit_info)
app.post('/api/hotel-info/items', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const hotelId = user.role === 'super_admin' ? parseInt(c.req.query('hotel_id') || '0') : user.hotel_id
  if (!hotelId) return c.json({ error: 'Aucun hôtel' }, 400)

  const { category_id, title, content, sort_order } = await c.req.json()
  if (!title) return c.json({ error: 'Titre requis' }, 400)

  const r = await c.env.DB.prepare(`
    INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(hotelId, category_id || null, title, content || '', sort_order || 0).run()

  return c.json({ id: r.meta.last_row_id, success: true })
})

// PUT modifier item
app.put('/api/hotel-info/items/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const id = parseInt(c.req.param('id'))
  const { category_id, title, content, sort_order } = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE hotel_info_items
    SET category_id = ?, title = COALESCE(?, title), content = COALESCE(?, content), sort_order = COALESCE(?, sort_order),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(category_id || null, title, content, sort_order, id).run()

  return c.json({ success: true })
})

// DELETE item
app.delete('/api/hotel-info/items/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const id = parseInt(c.req.param('id'))

  await c.env.DB.prepare(`DELETE FROM hotel_info_items WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// ============================================
// WIKOT — AGENT IA (OpenRouter + Gemini 2.0 Flash)
// ============================================

const WIKOT_MODEL = 'google/gemini-2.0-flash-001'
const WIKOT_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Helper : récupère les permissions effectives d'un utilisateur
function wikotUserCanEditProcedures(user: WikotUser): boolean {
  return user.role === 'admin' || user.can_edit_procedures === 1
}
function wikotUserCanEditInfo(user: WikotUser): boolean {
  return user.role === 'admin' || user.can_edit_info === 1
}

// Helper : normalise un texte pour le matching algorithmique
// (minuscules, sans accents, espaces simples, ponctuation virée)
function normalizeForMatch(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // virer les accents
    .replace(/[^\w\s]/g, ' ')        // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim()
}

// Helper : un titre apparait-il dans un texte normalisé ?
// Stratégie : on normalise le titre, on regarde s'il apparait tel quel,
// sinon on découpe en mots significatifs (>3 lettres) et on demande
// qu'au moins 60% des mots-clés du titre soient présents.
function titleMatchesText(title: string, normalizedText: string): boolean {
  const normTitle = normalizeForMatch(title)
  if (!normTitle || !normalizedText) return false
  // Match exact du titre complet
  if (normalizedText.includes(normTitle)) return true
  // Match par mots-clés significatifs
  const STOPWORDS = new Set(['le','la','les','un','une','des','de','du','d','l','et','ou','a','au','aux','en','dans','pour','par','sur','avec','sans','que','qui','est','son','sa','ses','ce','cette','ces','quand','lors','lorsque'])
  const words = normTitle.split(' ').filter(w => w.length > 3 && !STOPWORDS.has(w))
  if (words.length === 0) return false
  let hits = 0
  for (const w of words) {
    if (normalizedText.includes(w)) hits++
  }
  return hits / words.length >= 0.6
}

// Helper : construit l'arborescence courte de l'hôtel pour le system prompt
async function buildHotelArborescence(db: D1Database, hotelId: number): Promise<string> {
  const cats = await db.prepare('SELECT id, name FROM categories WHERE hotel_id = ? ORDER BY sort_order, name').bind(hotelId).all()
  const procs = await db.prepare('SELECT id, title, category_id, trigger_event FROM procedures WHERE hotel_id = ? ORDER BY title').bind(hotelId).all()
  const infoCats = await db.prepare('SELECT id, name FROM hotel_info_categories WHERE hotel_id = ? ORDER BY sort_order, name').bind(hotelId).all()
  const infoItems = await db.prepare('SELECT id, title, category_id FROM hotel_info_items WHERE hotel_id = ? ORDER BY title').bind(hotelId).all()

  let tree = '## Procédures de l\'hôtel\n'
  for (const cat of cats.results as any[]) {
    tree += `- **Catégorie #${cat.id} : ${cat.name}**\n`
    const inCat = (procs.results as any[]).filter(p => p.category_id === cat.id)
    for (const p of inCat) {
      tree += `  - Procédure #${p.id} : « ${p.title} » (déclencheur : ${p.trigger_event || '—'})\n`
    }
  }
  const orphanProcs = (procs.results as any[]).filter(p => !p.category_id)
  if (orphanProcs.length > 0) {
    tree += `- **Sans catégorie**\n`
    for (const p of orphanProcs) tree += `  - Procédure #${p.id} : « ${p.title} »\n`
  }

  tree += '\n## Informations de l\'hôtel\n'
  for (const cat of infoCats.results as any[]) {
    tree += `- **Catégorie info #${cat.id} : ${cat.name}**\n`
    const inCat = (infoItems.results as any[]).filter(i => i.category_id === cat.id)
    for (const i of inCat) tree += `  - Info #${i.id} : « ${i.title} »\n`
  }
  const orphanInfos = (infoItems.results as any[]).filter(i => !i.category_id)
  if (orphanInfos.length > 0) {
    tree += `- **Sans catégorie**\n`
    for (const i of orphanInfos) tree += `  - Info #${i.id} : « ${i.title} »\n`
  }

  return tree
}

// Helper : construit le system prompt de Wikot, selon le mode
// mode = 'standard' → Wikot classique : recherche + sourcing, AUCUNE modification
// mode = 'max'      → Back Wikot : rédaction/création/modification optimisée
async function buildWikotSystemPrompt(db: D1Database, user: WikotUser, hotelName: string, mode: 'standard' | 'max'): Promise<string> {
  const arborescence = await buildHotelArborescence(db, user.hotel_id!)

  if (mode === 'standard') {
    // ============================================
    // WIKOT CLASSIQUE — SÉLECTEUR DE CARTES (zéro texte libre)
    // ============================================
    return `Tu es **Wikot**, le moteur de recherche conversationnel du **${hotelName}**.

## Ta mission UNIQUE
Tu reçois une question d'employé. Tu identifies LA procédure ou L'information de l'hôtel la plus pertinente, et tu la retournes via l'outil \`select_answer\`. **Tu NE rédiges JAMAIS de texte de réponse.** L'interface affiche directement la carte de la ressource sélectionnée.

## Protocole strict (obligatoire à chaque message)
1. Appelle \`search_procedures\` ET/OU \`search_hotel_info\` avec des mots-clés issus de la question.
2. Si plusieurs résultats, appelle \`get_procedure\` ou \`get_hotel_info_item\` pour comparer et choisir le plus pertinent.
3. Termine TOUJOURS par UN SEUL appel à \`select_answer\` avec :
   - \`type: "procedure"\` + \`id\` → si une procédure répond à la question
   - \`type: "info_item"\` + \`id\` → si une information répond à la question
   - \`type: "none"\` → si aucune procédure ni information existante ne correspond

## Règles ABSOLUES
- **AUCUN texte de réponse écrit par toi.** Le seul output que tu produis pour l'utilisateur est l'appel à \`select_answer\`. Pas de phrase de politesse, pas d'introduction, pas de conclusion.
- **UNE SEULE ressource sélectionnée** (la plus pertinente). Pas de liste, pas de comparatif.
- Si la question concerne une création/modification : sélectionne \`type: "none"\` (Wikot ne fait que de la lecture).
- Si la question est vague ou hors-sujet (ex : « bonjour ») : sélectionne \`type: "none"\`.
- Si une sous-procédure répond mieux qu'une procédure mère, choisis la sous-procédure.

## Arborescence actuelle de l'hôtel
${arborescence}

Rappel : tu es un **sélecteur**, pas un rédacteur. \`select_answer\` à chaque tour, jamais de texte libre.`
  }

  // ============================================
  // WIKOT MAX — Rédaction / création / modification
  // ============================================
  const canEditProc = wikotUserCanEditProcedures(user)
  const canEditInf = wikotUserCanEditInfo(user)

  return `Tu es **Back Wikot**, l'assistant IA de rédaction et d'édition du **${hotelName}**. Tu es l'agent spécialisé dans la **création** et la **modification** des procédures et informations de l'hôtel.

## Identité et ton
- Tu tutoies l'utilisateur tout en restant **très poli et professionnel**.
- Tu réponds **exclusivement en français**.
- Tu es **précis, structuré, méthodique**. Tu rédiges comme un professionnel de l'hôtellerie qui formalise les procédures internes.

## Ta mission UNIQUE
Aider l'utilisateur à **créer** ou **modifier** des procédures et des informations de l'hôtel. Tu ne réponds pas aux questions générales — pour cela il y a **Wikot** (l'agent d'information). Si la demande n'est pas une création/modification, oriente : « Pour les questions d'information, utilise **Wikot** depuis le menu. »

## Permissions de cet utilisateur
- Procédures : ${canEditProc ? '✅ autorisé' : '❌ NON autorisé — refuse poliment toute demande sur les procédures'}
- Informations : ${canEditInf ? '✅ autorisé' : '❌ NON autorisé — refuse poliment toute demande sur les informations'}
- **Suppression : INTERDITE** — toujours, pour tout le monde via Back Wikot. La suppression se fait à la main par un responsable.

## Protocole strict en 4 étapes

### 1. Comprendre l'intention
Reformule la demande en une phrase claire pour confirmer ce que tu vas faire. Si c'est ambigu, pose UNE seule question de clarification avant d'agir.

### 2. Récupérer le contexte (modification uniquement)
Pour modifier : appelle d'abord \`search_procedures\` ou \`search_hotel_info\` pour identifier la cible, puis \`get_procedure\` ou \`get_hotel_info_item\` pour lire l'état actuel. Privilégie TOUJOURS la modification d'une procédure existante plutôt que la création d'un doublon.

### 3. Rédiger en respectant le guide de style ci-dessous (CRITIQUE)
${canEditProc ? `
#### Guide de rédaction des PROCÉDURES
- **Titre** : verbe d'action à l'infinitif + sujet clair. Ex : « Effectuer un check-in client », « Gérer une carte démagnétisée ».
- **Trigger event** : commence par « Quand… » ou « Lorsque… ». Ex : « Quand un client se présente à la réception pour son arrivée. »
- **Description** : 1 à 2 phrases maximum, qui explique le contexte et l'objectif.
- **Étapes** : 3 à 10 étapes. Numérotation gérée automatiquement.
  - **Titre d'étape** : verbe d'action à l'impératif + complément, **8 mots max**. Ex : « Accueillir le client », « Vérifier la réservation au PMS ».
  - **Contenu d'étape** : instructions concrètes, actionnables, à la 2ᵉ personne (« Demande… », « Vérifie… »). Tu peux utiliser \`**gras**\` sparingly et des listes \`•\` à puces pour énumérer les sous-points (montants, lieux, horaires).
  - **Pas de jargon technique** non expliqué, pas de phrases passives floues.
  - Si une étape correspond à une sous-procédure existante, mentionne-le dans le contenu (« Voir la sous-procédure : Vérification d'identité »).
` : ''}${canEditInf ? `
#### Guide de rédaction des INFORMATIONS
- **Titre** : court, factuel, sans verbe. Ex : « Horaires du restaurant », « Code Wi-Fi », « Numéros utiles ».
- **Contenu** : structuré, factuel, scannable. Privilégie listes à puces \`•\` et **gras** pour les valeurs importantes.
  - Horaires au format \`hh:mm – hh:mm\` (ex : \`07:00 – 10:30\`).
  - Numéros de téléphone formatés \`01 23 45 67 89\`.
  - Tarifs en euros avec symbole \`€\` (ex : \`12 €\`).
  - Lieux précis (ex : « salle Méditerranée, RDC »).
- **Pas de salutations** ni de phrases introductives type « Voici les informations… ». Va droit au fait.
- **Catégorie** : choisis la catégorie existante la plus adaptée. Si aucune ne convient, propose-en une nouvelle via \`propose_create_info_category\`.
` : ''}
### 4. Proposer (jamais appliquer directement)
Tu n'écris jamais en base directement. Tu utilises les outils \`propose_create_*\` ou \`propose_update_*\`. Le frontend affiche alors une carte avec un **diff avant/après** et l'utilisateur valide ou refuse. Avant l'appel d'outil, écris une phrase courte qui annonce : « Je te propose de créer/modifier… valide ci-dessous. »

## Sourcing
Si tu cites une procédure ou information existante dans ta réponse (par ex. pour expliquer ton choix de réutilisation), appelle \`add_reference(type, id)\` pour faire apparaître un bouton « Voir la procédure » ou « Voir l'information ». Pas d'URL en clair dans le texte.

## Arborescence actuelle de l'hôtel
${arborescence}

Rappel : tu es **Back Wikot**, agent de rédaction/édition. Tu rédiges du contenu de qualité professionnelle et tu proposes — l'utilisateur valide.`
}

// Helper : tools disponibles selon le mode et les permissions
// mode='standard' → Wikot lecture (search/get/list/add_reference uniquement)
// mode='max'      → Back Wikot (lecture + outils propose_* selon permissions)
function buildWikotTools(mode: 'standard' | 'max', canEditProc: boolean, canEditInf: boolean): any[] {
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'search_procedures',
        description: 'Recherche dans les procédures de l\'hôtel par mots-clés (titre, déclencheur, description). Retourne une liste {id, title, trigger_event}.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Termes de recherche' } },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_procedure',
        description: 'Récupère le détail complet d\'une procédure : titre, description, déclencheur, étapes ordonnées avec contenu, sous-procédures liées.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'integer', description: 'ID de la procédure' } },
          required: ['id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_hotel_info',
        description: 'Recherche dans les informations de l\'hôtel par mots-clés (titre, contenu).',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_hotel_info_item',
        description: 'Récupère le détail complet d\'une information : titre, contenu, catégorie.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'integer' } },
          required: ['id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_categories',
        description: 'Liste toutes les catégories de procédures et d\'informations de l\'hôtel.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_reference',
        description: '[Mode max uniquement] Ajoute un bouton de sourcing pour permettre à l\'utilisateur de voir la procédure ou l\'information complète.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['procedure', 'info_item'] },
            id: { type: 'integer' }
          },
          required: ['type', 'id']
        }
      }
    }
  ]

  // ============================================
  // MODE STANDARD (Wikot) — UN SEUL outil de finalisation : select_answer
  // ============================================
  if (mode !== 'max') {
    // En mode standard, on remplace add_reference par select_answer
    // (l'utilisateur ne reçoit qu'une carte structurée, pas de texte libre)
    tools.pop() // Retirer add_reference
    tools.push({
      type: 'function',
      function: {
        name: 'select_answer',
        description: 'Sélectionne LA procédure ou L\'information la plus pertinente pour répondre à la question. UTILISE-LE OBLIGATOIREMENT à chaque message après tes recherches. type="none" si aucune ressource ne correspond.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['procedure', 'info_item', 'none'], description: 'procedure / info_item / none (aucune ressource pertinente)' },
            id: { type: 'integer', description: 'ID de la ressource (omettre si type=none)' }
          },
          required: ['type']
        }
      }
    })
    return tools
  }

  if (canEditProc) {
    tools.push({
      type: 'function',
      function: {
        name: 'propose_create_procedure',
        description: 'Propose la création d\'une nouvelle procédure. L\'utilisateur devra valider avant que la procédure soit réellement créée. Pour créer une sous-procédure (qui n\'apparaîtra pas dans la liste principale), passe is_subprocedure=true.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            trigger_event: { type: 'string', description: 'Quand cette procédure se déclenche' },
            description: { type: 'string' },
            category_id: { type: 'integer', description: 'ID de la catégorie (optionnel)' },
            is_subprocedure: { type: 'boolean', description: 'true si c\'est une sous-procédure (cachée de la liste principale, accessible uniquement via une étape parent)' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  content: { type: 'string', description: 'Contenu détaillé de l\'étape (peut contenir **gras** et listes • à puces). Vide si l\'étape pointe vers une sous-procédure.' },
                  linked_procedure_id: { type: 'integer', description: 'ID d\'une sous-procédure existante à lier à cette étape (optionnel)' }
                },
                required: ['title']
              }
            }
          },
          required: ['title', 'trigger_event', 'steps']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'propose_update_procedure',
        description: 'Propose la modification d\'une procédure existante. L\'utilisateur verra un diff avant/après et devra valider. IMPORTANT : si la procédure existante avait des étapes liées à des sous-procédures (linked_procedure_id), tu DOIS les renvoyer dans steps[] sinon le lien sera perdu.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            trigger_event: { type: 'string' },
            description: { type: 'string' },
            category_id: { type: 'integer' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  content: { type: 'string' },
                  linked_procedure_id: { type: 'integer', description: 'ID d\'une sous-procédure liée (à conserver tel quel si l\'étape était déjà liée)' }
                }
              }
            }
          },
          required: ['id']
        }
      }
    })
  }

  if (canEditInf) {
    tools.push({
      type: 'function',
      function: {
        name: 'propose_create_info_item',
        description: 'Propose la création d\'une nouvelle information dans une catégorie.',
        parameters: {
          type: 'object',
          properties: {
            category_id: { type: 'integer' },
            title: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['title', 'content']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'propose_update_info_item',
        description: 'Propose la modification d\'une information existante.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            content: { type: 'string' },
            category_id: { type: 'integer' }
          },
          required: ['id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'propose_create_info_category',
        description: 'Propose la création d\'une nouvelle catégorie d\'informations.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            color: { type: 'string', description: 'Couleur hex (ex: #3B82F6)' }
          },
          required: ['name']
        }
      }
    })
  }

  return tools
}

// Exécute un tool de lecture côté serveur
async function executeReadTool(db: D1Database, hotelId: number, toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'search_procedures': {
      const q = `%${args.query}%`
      const r = await db.prepare(`
        SELECT id, title, trigger_event FROM procedures
        WHERE hotel_id = ? AND (title LIKE ? OR trigger_event LIKE ? OR description LIKE ?)
        ORDER BY title LIMIT 20
      `).bind(hotelId, q, q, q).all()
      return { results: r.results }
    }
    case 'get_procedure': {
      const proc = await db.prepare('SELECT * FROM procedures WHERE id = ? AND hotel_id = ?').bind(args.id, hotelId).first() as any
      if (!proc) return { error: 'Procédure introuvable' }
      const steps = await db.prepare(`
        SELECT s.id, s.step_number, s.title, s.content, s.linked_procedure_id, lp.title as linked_title
        FROM steps s
        LEFT JOIN procedures lp ON lp.id = s.linked_procedure_id
        WHERE s.procedure_id = ? ORDER BY s.step_number
      `).bind(args.id).all()
      return { procedure: proc, steps: steps.results }
    }
    case 'search_hotel_info': {
      const q = `%${args.query}%`
      const r = await db.prepare(`
        SELECT i.id, i.title, c.name as category_name
        FROM hotel_info_items i
        LEFT JOIN hotel_info_categories c ON c.id = i.category_id
        WHERE i.hotel_id = ? AND (i.title LIKE ? OR i.content LIKE ?)
        ORDER BY i.title LIMIT 20
      `).bind(hotelId, q, q).all()
      return { results: r.results }
    }
    case 'get_hotel_info_item': {
      const item = await db.prepare(`
        SELECT i.*, c.name as category_name
        FROM hotel_info_items i
        LEFT JOIN hotel_info_categories c ON c.id = i.category_id
        WHERE i.id = ? AND i.hotel_id = ?
      `).bind(args.id, hotelId).first()
      return item || { error: 'Information introuvable' }
    }
    case 'list_categories': {
      const procCats = await db.prepare('SELECT id, name FROM categories WHERE hotel_id = ? ORDER BY name').bind(hotelId).all()
      const infoCats = await db.prepare('SELECT id, name FROM hotel_info_categories WHERE hotel_id = ? ORDER BY name').bind(hotelId).all()
      return { procedure_categories: procCats.results, info_categories: infoCats.results }
    }
    case 'add_reference': {
      // C'est un "side-effect" tool : on retourne juste une confirmation, le frontend gérera l'affichage
      return { ok: true, type: args.type, id: args.id }
    }
    default:
      return { error: 'Tool inconnu' }
  }
}

// Appelle OpenRouter
async function callOpenRouter(apiKey: string, messages: any[], tools: any[]): Promise<any> {
  const res = await fetch(WIKOT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wikot.fr',
      'X-Title': 'Wikot'
    },
    body: JSON.stringify({
      model: WIKOT_MODEL,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      temperature: 0.4
    })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${text}`)
  }
  return await res.json()
}

// ============================================
// WIKOT ROUTES
// ============================================

// Helper : valide qu'un utilisateur peut accéder à un mode donné
// 'standard' → tout le monde (lecture/sourcing seulement)
// 'max' → admin OU employé avec can_edit_procedures OU can_edit_info
function userCanUseMaxMode(user: WikotUser): boolean {
  return wikotUserCanEditProcedures(user) || wikotUserCanEditInfo(user)
}

// Normalise le mode envoyé par le client (sécurité : valeurs autorisées seulement)
function normalizeWikotMode(rawMode: any): 'standard' | 'max' {
  return rawMode === 'max' ? 'max' : 'standard'
}

// GET liste des conversations de l'utilisateur courant, filtrées par mode
// ?mode=standard (défaut) ou ?mode=max
app.get('/api/wikot/conversations', authMiddleware, async (c) => {
  const user = c.get('user')
  const mode = normalizeWikotMode(c.req.query('mode'))
  // Si mode=max mais pas autorisé → liste vide (pas d'erreur, l'UI ne devrait pas appeler)
  if (mode === 'max' && !userCanUseMaxMode(user)) return c.json({ conversations: [] })
  const r = await c.env.DB.prepare(`
    SELECT id, title, updated_at, created_at, mode
    FROM wikot_conversations
    WHERE user_id = ? AND is_archived = 0 AND mode = ?
    ORDER BY updated_at DESC LIMIT 50
  `).bind(user.id, mode).all()
  return c.json({ conversations: r.results })
})

// POST nouvelle conversation (avec mode)
app.post('/api/wikot/conversations', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ error: 'Aucun hôtel assigné' }, 400)
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const mode = normalizeWikotMode(body.mode)
  // Vérification de permission server-side pour le mode 'max'
  if (mode === 'max' && !userCanUseMaxMode(user)) {
    return c.json({ error: 'Back Wikot nécessite des droits d\'édition (procédures ou informations)' }, 403)
  }
  const defaultTitle = mode === 'max' ? 'Nouvelle session Back Wikot' : 'Nouvelle conversation'
  const r = await c.env.DB.prepare(`
    INSERT INTO wikot_conversations (hotel_id, user_id, title, mode) VALUES (?, ?, ?, ?)
  `).bind(user.hotel_id, user.id, defaultTitle, mode).run()
  return c.json({ id: r.meta.last_row_id, mode })
})

// GET détail d'une conversation + messages
app.get('/api/wikot/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const conv = await c.env.DB.prepare('SELECT * FROM wikot_conversations WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!conv) return c.json({ error: 'Conversation introuvable' }, 404)

  const messages = await c.env.DB.prepare(`
    SELECT id, role, content, references_json, created_at
    FROM wikot_messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY created_at, id
  `).bind(id).all()

  // Décoder references_json : si c'est { answer_card: ... } → on expose answer_card,
  // sinon c'est un tableau de références sourcing classiques (mode max).
  const decodedMessages = (messages.results as any[]).map(m => {
    let refs: any[] = []
    let answerCard: any = null
    if (m.references_json) {
      try {
        const parsed = JSON.parse(m.references_json)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.answer_card) {
          answerCard = parsed.answer_card
        } else if (Array.isArray(parsed)) {
          refs = parsed
        }
      } catch {}
    }
    return { ...m, references: refs, answer_card: answerCard }
  })

  // Joindre les pending actions à leur message
  const actions = await c.env.DB.prepare(`
    SELECT id, message_id, action_type, payload, before_snapshot, status, result_id
    FROM wikot_pending_actions
    WHERE conversation_id = ?
    ORDER BY created_at
  `).bind(id).all()

  return c.json({ conversation: conv, messages: decodedMessages, actions: actions.results })
})

// DELETE archive une conversation
app.delete('/api/wikot/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare('UPDATE wikot_conversations SET is_archived = 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// POST envoyer un message → réponse Wikot
app.post('/api/wikot/conversations/:id/message', authMiddleware, async (c) => {
  const user = c.get('user')
  const convId = parseInt(c.req.param('id'))
  const { content } = await c.req.json()

  if (!content || !content.trim()) return c.json({ error: 'Message vide' }, 400)
  if (!user.hotel_id) return c.json({ error: 'Aucun hôtel' }, 400)

  const apiKey = c.env.OPENROUTER_API_KEY
  if (!apiKey) return c.json({ error: 'Wikot indisponible : clé API non configurée' }, 503)

  // Vérifier que la conversation appartient bien à l'utilisateur
  const conv = await c.env.DB.prepare('SELECT * FROM wikot_conversations WHERE id = ? AND user_id = ?').bind(convId, user.id).first() as any
  if (!conv) return c.json({ error: 'Conversation introuvable' }, 404)

  // Sauvegarder le message utilisateur
  const userMsgRes = await c.env.DB.prepare(`
    INSERT INTO wikot_messages (conversation_id, role, content) VALUES (?, 'user', ?)
  `).bind(convId, content).run()

  // Récupérer l'historique des messages (limité aux 30 derniers pour économiser les tokens)
  const history = await c.env.DB.prepare(`
    SELECT role, content, tool_calls, tool_call_id
    FROM wikot_messages WHERE conversation_id = ?
    ORDER BY created_at, id
  `).bind(convId).all()

  // Récupérer infos hôtel
  const hotel = await c.env.DB.prepare('SELECT name FROM hotels WHERE id = ?').bind(user.hotel_id).first() as any

  // Récupérer le mode de la conversation (standard / max)
  const mode: 'standard' | 'max' = conv.mode === 'max' ? 'max' : 'standard'
  // Re-vérification permission server-side pour le mode max
  if (mode === 'max' && !userCanUseMaxMode(user)) {
    return c.json({ error: 'Back Wikot nécessite des droits d\'édition' }, 403)
  }

  // Construire system prompt + tools selon le mode et les permissions
  const systemPrompt = await buildWikotSystemPrompt(c.env.DB, user, hotel?.name || 'l\'hôtel', mode)
  const canEditProc = wikotUserCanEditProcedures(user)
  const canEditInf = wikotUserCanEditInfo(user)
  const tools = buildWikotTools(mode, canEditProc, canEditInf)

  // Construire les messages OpenAI-compatible
  const oaiMessages: any[] = [{ role: 'system', content: systemPrompt }]
  for (const m of history.results as any[]) {
    if (m.role === 'user') {
      oaiMessages.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.content || '' }
      if (m.tool_calls) msg.tool_calls = JSON.parse(m.tool_calls)
      oaiMessages.push(msg)
    } else if (m.role === 'tool') {
      oaiMessages.push({ role: 'tool', content: m.content || '', tool_call_id: m.tool_call_id })
    }
  }

  // Boucle d'appels avec tools (max 5 itérations pour éviter une boucle infinie)
  const referencesCollected: any[] = []
  const proposalsCollected: { tool_name: string; args: any }[] = []
  // IDs vus dans les résultats des tools de lecture (filet de sécurité mode standard)
  const seenProcedureIds = new Set<number>()
  const seenInfoItemIds = new Set<number>()
  // Sélection finale du mode standard (Wikot = sélecteur de cartes)
  let selectedAnswer: { type: 'procedure' | 'info_item' | 'none'; id?: number } | null = null
  let assistantText = ''
  let lastToolCalls: any[] | null = null

  for (let iter = 0; iter < 5; iter++) {
    let response
    try {
      response = await callOpenRouter(apiKey, oaiMessages, tools)
    } catch (e: any) {
      console.error('OpenRouter error:', e.message)
      return c.json({ error: 'Erreur Wikot : ' + e.message }, 500)
    }

    const choice = response.choices?.[0]
    if (!choice) return c.json({ error: 'Réponse Wikot vide' }, 500)
    const msg = choice.message

    // Cas 1 : pas de tool_calls → réponse finale
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      assistantText = msg.content || ''
      break
    }

    // Cas 2 : tool_calls présents → exécuter chaque tool
    lastToolCalls = msg.tool_calls
    oaiMessages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })

    let stopAfterThisIter = false

    for (const tc of msg.tool_calls) {
      const fnName = tc.function?.name
      let fnArgs: any = {}
      try { fnArgs = JSON.parse(tc.function?.arguments || '{}') } catch {}

      // Tools de lecture
      if (['search_procedures', 'get_procedure', 'search_hotel_info', 'get_hotel_info_item', 'list_categories', 'add_reference'].includes(fnName)) {
        const result = await executeReadTool(c.env.DB, user.hotel_id, fnName, fnArgs)
        if (fnName === 'add_reference') {
          referencesCollected.push({ type: fnArgs.type, id: fnArgs.id })
        }
        // Tracking IDs vus
        if (fnName === 'search_procedures' && Array.isArray(result)) {
          for (const r of result) { if (r && r.id) seenProcedureIds.add(r.id) }
        } else if (fnName === 'get_procedure' && result && (result as any).procedure?.id) {
          seenProcedureIds.add((result as any).procedure.id)
        } else if (fnName === 'search_hotel_info' && Array.isArray(result)) {
          for (const r of result) { if (r && r.id) seenInfoItemIds.add(r.id) }
        } else if (fnName === 'get_hotel_info_item' && result && (result as any).id) {
          seenInfoItemIds.add((result as any).id)
        }
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
      }
      // === MODE STANDARD : select_answer === outil de finalisation
      else if (fnName === 'select_answer') {
        const t = fnArgs.type
        const aId = typeof fnArgs.id === 'number' ? fnArgs.id : (fnArgs.id ? parseInt(fnArgs.id) : undefined)
        if (t === 'procedure' && aId) {
          selectedAnswer = { type: 'procedure', id: aId }
        } else if (t === 'info_item' && aId) {
          selectedAnswer = { type: 'info_item', id: aId }
        } else {
          selectedAnswer = { type: 'none' }
        }
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: true }) })
        stopAfterThisIter = true
      }
      // Tools de proposition (mode max)
      else if (fnName.startsWith('propose_')) {
        proposalsCollected.push({ tool_name: fnName, args: fnArgs })
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: true, message: 'Proposition enregistrée, l\'utilisateur va voir un diff et pouvoir valider.' }) })
      }
      else {
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'Tool non reconnu' }) })
      }
    }

    // Mode standard : dès que select_answer est appelé, on arrête la boucle
    if (stopAfterThisIter) break
  }

  // ============================================
  // MODE STANDARD : on construit la answer_card à partir de selectedAnswer
  // ============================================
  let answerCard: any = null
  if (mode === 'standard') {
    // Filet de sécurité : si le modèle n'a pas appelé select_answer, on déduit
    if (!selectedAnswer) {
      if (seenProcedureIds.size > 0) {
        const firstProc = Array.from(seenProcedureIds)[0]
        selectedAnswer = { type: 'procedure', id: firstProc }
      } else if (seenInfoItemIds.size > 0) {
        const firstInfo = Array.from(seenInfoItemIds)[0]
        selectedAnswer = { type: 'info_item', id: firstInfo }
      } else {
        selectedAnswer = { type: 'none' }
      }
    }

    // Construire la carte structurée selon le type
    if (selectedAnswer.type === 'procedure' && selectedAnswer.id) {
      const p = await c.env.DB.prepare(`
        SELECT p.id, p.title, p.description, p.trigger_event, p.category_id,
               c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM procedures p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.id = ? AND p.hotel_id = ?
      `).bind(selectedAnswer.id, user.hotel_id).first() as any
      if (p) {
        // Récupération de toutes les étapes (titre + contenu + sous-procédures liées)
        const stepsRes = await c.env.DB.prepare(`
          SELECT s.id, s.step_number, s.title, s.content, s.linked_procedure_id, lp.title as linked_title
          FROM steps s
          LEFT JOIN procedures lp ON lp.id = s.linked_procedure_id
          WHERE s.procedure_id = ? ORDER BY s.step_number
        `).bind(p.id).all()
        const steps: any[] = []
        for (const st of (stepsRes.results as any[])) {
          // Si l'étape pointe vers une sous-procédure, on récupère aussi les étapes de la sous-procédure
          let linkedSteps: any[] = []
          if (st.linked_procedure_id) {
            const subRes = await c.env.DB.prepare(`
              SELECT step_number, title, content
              FROM steps WHERE procedure_id = ? ORDER BY step_number
            `).bind(st.linked_procedure_id).all()
            linkedSteps = subRes.results as any[]
          }
          steps.push({
            id: st.id, step_number: st.step_number, title: st.title, content: st.content,
            linked_procedure_id: st.linked_procedure_id, linked_title: st.linked_title,
            linked_steps: linkedSteps
          })
        }
        answerCard = {
          kind: 'procedure',
          id: p.id, title: p.title, description: p.description, trigger_event: p.trigger_event,
          category_name: p.category_name, category_color: p.category_color, category_icon: p.category_icon,
          step_count: steps.length, steps
        }
      } else {
        answerCard = { kind: 'not_found' }
      }
    } else if (selectedAnswer.type === 'info_item' && selectedAnswer.id) {
      const i = await c.env.DB.prepare(`
        SELECT i.id, i.title, i.content, i.category_id,
               c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM hotel_info_items i
        LEFT JOIN hotel_info_categories c ON i.category_id = c.id
        WHERE i.id = ? AND i.hotel_id = ?
      `).bind(selectedAnswer.id, user.hotel_id).first() as any
      if (i) {
        answerCard = {
          kind: 'info_item',
          id: i.id, title: i.title, content: i.content, category_id: i.category_id,
          category_name: i.category_name, category_color: i.category_color, category_icon: i.category_icon
        }
      } else {
        answerCard = { kind: 'not_found' }
      }
    } else {
      answerCard = { kind: 'not_found' }
    }

    // En mode standard, on n'utilise PAS le texte libre du modèle (zéro texte libre)
    assistantText = ''
  }

  // ============================================
  // MODE MAX : on garde l'ancien sourcing (références multiples + texte libre)
  // ============================================
  const enrichedRefs: any[] = []
  if (mode === 'max') {
    const seenRefKeys = new Set<string>()
    for (const ref of referencesCollected) {
      const key = `${ref.type}:${ref.id}`
      if (seenRefKeys.has(key)) continue
      if (ref.type === 'procedure') {
        const p = await c.env.DB.prepare('SELECT id, title FROM procedures WHERE id = ? AND hotel_id = ?').bind(ref.id, user.hotel_id).first() as any
        if (p) { enrichedRefs.push({ type: 'procedure', id: p.id, title: p.title }); seenRefKeys.add(key) }
      } else if (ref.type === 'info_item') {
        const i = await c.env.DB.prepare('SELECT id, title FROM hotel_info_items WHERE id = ? AND hotel_id = ?').bind(ref.id, user.hotel_id).first() as any
        if (i) { enrichedRefs.push({ type: 'info_item', id: i.id, title: i.title }); seenRefKeys.add(key) }
      }
    }
  }

  // Sauvegarder le message assistant
  // Pour mode standard : on stocke la answer_card dans references_json (réutilisation du champ existant)
  // Pour mode max : on stocke les références sourcing classiques
  const referencesJson = mode === 'standard'
    ? (answerCard ? JSON.stringify({ answer_card: answerCard }) : null)
    : (enrichedRefs.length > 0 ? JSON.stringify(enrichedRefs) : null)
  const assistantMsgRes = await c.env.DB.prepare(`
    INSERT INTO wikot_messages (conversation_id, role, content, tool_calls, references_json)
    VALUES (?, 'assistant', ?, ?, ?)
  `).bind(
    convId,
    assistantText || '',
    lastToolCalls ? JSON.stringify(lastToolCalls) : null,
    referencesJson
  ).run()
  const assistantMsgId = assistantMsgRes.meta.last_row_id

  // Sauvegarder les propositions en pending_actions
  const createdActions: any[] = []
  for (const proposal of proposalsCollected) {
    let beforeSnapshot: any = null
    // Pour les updates, snapshot de l'état actuel
    if (proposal.tool_name === 'propose_update_procedure' && proposal.args.id) {
      const cur = await c.env.DB.prepare('SELECT * FROM procedures WHERE id = ? AND hotel_id = ?').bind(proposal.args.id, user.hotel_id).first() as any
      if (cur) {
        const curSteps = await c.env.DB.prepare('SELECT step_number, title, content FROM steps WHERE procedure_id = ? ORDER BY step_number').bind(proposal.args.id).all()
        beforeSnapshot = { ...cur, steps: curSteps.results }
      }
    } else if (proposal.tool_name === 'propose_update_info_item' && proposal.args.id) {
      const cur = await c.env.DB.prepare('SELECT * FROM hotel_info_items WHERE id = ? AND hotel_id = ?').bind(proposal.args.id, user.hotel_id).first() as any
      if (cur) beforeSnapshot = cur
    }

    const aRes = await c.env.DB.prepare(`
      INSERT INTO wikot_pending_actions (conversation_id, message_id, hotel_id, user_id, action_type, payload, before_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      convId, assistantMsgId, user.hotel_id, user.id,
      proposal.tool_name.replace('propose_', ''),
      JSON.stringify(proposal.args),
      beforeSnapshot ? JSON.stringify(beforeSnapshot) : null
    ).run()
    createdActions.push({
      id: aRes.meta.last_row_id,
      message_id: assistantMsgId,
      action_type: proposal.tool_name.replace('propose_', ''),
      payload: proposal.args,
      before_snapshot: beforeSnapshot,
      status: 'pending'
    })
  }

  // Mettre à jour updated_at de la conversation + auto-titre si c'est le 1er échange
  if ((history.results as any[]).filter(m => m.role === 'user').length === 0) {
    const autoTitle = content.length > 60 ? content.substring(0, 57) + '...' : content
    await c.env.DB.prepare('UPDATE wikot_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(autoTitle, convId).run()
  } else {
    await c.env.DB.prepare('UPDATE wikot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(convId).run()
  }

  return c.json({
    user_message_id: userMsgRes.meta.last_row_id,
    assistant_message: {
      id: assistantMsgId,
      role: 'assistant',
      content: assistantText,
      references: enrichedRefs,
      answer_card: answerCard
    },
    actions: createdActions
  })
})

// POST accepter une action proposée par Wikot
app.post('/api/wikot/actions/:id/accept', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))

  const action = await c.env.DB.prepare('SELECT * FROM wikot_pending_actions WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!action) return c.json({ error: 'Action introuvable' }, 404)
  if (action.status !== 'pending') return c.json({ error: 'Action déjà traitée' }, 400)

  const payload = JSON.parse(action.payload)
  const hotelId = action.hotel_id
  let resultId: number | null = null
  let errorMsg: string | null = null

  try {
    switch (action.action_type) {
      case 'create_procedure': {
        if (!wikotUserCanEditProcedures(user)) throw new Error('Permission refusée')
        // is_subprocedure : permet à Back Wikot de créer directement des sous-procédures
        const isSub = payload.is_subprocedure ? 1 : 0
        const r = await c.env.DB.prepare(`
          INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, priority, status, is_subprocedure, created_by)
          VALUES (?, ?, ?, ?, ?, 'normal', 'active', ?, ?)
        `).bind(hotelId, payload.category_id || null, payload.title, payload.description || null, payload.trigger_event, isSub, user.id).run()
        resultId = r.meta.last_row_id as number
        if (payload.steps && Array.isArray(payload.steps)) {
          for (let i = 0; i < payload.steps.length; i++) {
            const s = payload.steps[i]
            // BUG FIX : on persiste linked_procedure_id pour que les sous-procédures
            // proposées par Back Wikot ne soient pas perdues à la validation.
            await c.env.DB.prepare(`
              INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type)
              VALUES (?, ?, ?, ?, ?, 'action')
            `).bind(resultId, i + 1, s.title, s.content || null, s.linked_procedure_id || null).run()
          }
        }
        // Synchro auto : les enfants liés deviennent sous-procédures
        await syncSubprocedureFlags(c.env.DB, resultId, hotelId)
        await c.env.DB.prepare(`INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary) VALUES (?, ?, ?, 'created', ?)`)
          .bind(hotelId, resultId, user.id, `Procédure "${payload.title}" créée par Wikot`).run()
        break
      }
      case 'update_procedure': {
        if (!wikotUserCanEditProcedures(user)) throw new Error('Permission refusée')
        const procId = payload.id
        const cur = await c.env.DB.prepare('SELECT * FROM procedures WHERE id = ? AND hotel_id = ?').bind(procId, hotelId).first() as any
        if (!cur) throw new Error('Procédure introuvable')
        await c.env.DB.prepare(`
          UPDATE procedures SET
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            trigger_event = COALESCE(?, trigger_event),
            category_id = COALESCE(?, category_id),
            version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(payload.title, payload.description, payload.trigger_event, payload.category_id, procId).run()
        if (payload.steps && Array.isArray(payload.steps)) {
          await c.env.DB.prepare('DELETE FROM steps WHERE procedure_id = ?').bind(procId).run()
          for (let i = 0; i < payload.steps.length; i++) {
            const s = payload.steps[i]
            // BUG FIX : on persiste linked_procedure_id (sinon une simple modif
            // efface le lien parent → sous-procédure, qui réapparaît dans la liste)
            await c.env.DB.prepare(`INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type) VALUES (?, ?, ?, ?, ?, 'action')`)
              .bind(procId, i + 1, s.title, s.content || null, s.linked_procedure_id || null).run()
          }
        }
        // Synchro auto : reverrouille les enfants comme sous-procédures
        await syncSubprocedureFlags(c.env.DB, procId, hotelId)
        resultId = procId
        await c.env.DB.prepare(`INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary) VALUES (?, ?, ?, 'updated', ?)`)
          .bind(hotelId, procId, user.id, `Procédure modifiée par Wikot`).run()
        break
      }
      case 'create_info_item': {
        if (!wikotUserCanEditInfo(user)) throw new Error('Permission refusée')
        const r = await c.env.DB.prepare(`INSERT INTO hotel_info_items (hotel_id, category_id, title, content) VALUES (?, ?, ?, ?)`)
          .bind(hotelId, payload.category_id || null, payload.title, payload.content || '').run()
        resultId = r.meta.last_row_id as number
        break
      }
      case 'update_info_item': {
        if (!wikotUserCanEditInfo(user)) throw new Error('Permission refusée')
        await c.env.DB.prepare(`
          UPDATE hotel_info_items SET
            title = COALESCE(?, title),
            content = COALESCE(?, content),
            category_id = COALESCE(?, category_id),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND hotel_id = ?
        `).bind(payload.title, payload.content, payload.category_id, payload.id, hotelId).run()
        resultId = payload.id
        break
      }
      case 'create_info_category': {
        if (!wikotUserCanEditInfo(user)) throw new Error('Permission refusée')
        const r = await c.env.DB.prepare(`INSERT INTO hotel_info_categories (hotel_id, name, color) VALUES (?, ?, ?)`)
          .bind(hotelId, payload.name, payload.color || '#3B82F6').run()
        resultId = r.meta.last_row_id as number
        break
      }
      default:
        throw new Error('Type d\'action non supporté')
    }
  } catch (e: any) {
    errorMsg = e.message
  }

  if (errorMsg) {
    await c.env.DB.prepare(`UPDATE wikot_pending_actions SET status = 'failed', error_message = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(errorMsg, id).run()
    return c.json({ error: errorMsg }, 400)
  }

  await c.env.DB.prepare(`UPDATE wikot_pending_actions SET status = 'accepted', result_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(resultId, id).run()
  return c.json({ success: true, result_id: resultId })
})

// POST refuser une action
app.post('/api/wikot/actions/:id/reject', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const action = await c.env.DB.prepare('SELECT * FROM wikot_pending_actions WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!action) return c.json({ error: 'Action introuvable' }, 404)
  if (action.status !== 'pending') return c.json({ error: 'Action déjà traitée' }, 400)
  await c.env.DB.prepare(`UPDATE wikot_pending_actions SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// ============================================
// MAIN HTML PAGE
// ============================================
app.get('*', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wikot - Gestion des procédures hôtelières</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50:'#fef3e2',100:'#fde4b9',200:'#fbc970',300:'#f9ae28',400:'#f59e0b',500:'#d97706',600:'#b45309',700:'#92400e',800:'#78350f',900:'#451a03' },
            navy: { 50:'#f0f4f8',100:'#d9e2ec',200:'#bcccdc',300:'#9fb3c8',400:'#829ab1',500:'#627d98',600:'#486581',700:'#334e68',800:'#243b53',900:'#102a43' }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { font-family: 'Inter', sans-serif; }
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .slide-in { animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { transform: translateX(-20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .pulse-dot { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .step-connector { position: relative; }
    .step-connector::before { content: ''; position: absolute; left: 19px; top: 40px; bottom: -8px; width: 2px; background: #e5e7eb; }
    .step-connector:last-child::before { display: none; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #f1f5f9; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
    .sidebar-item { transition: all 0.15s ease; }
    .sidebar-item:hover { background: rgba(255,255,255,0.1); }
    .sidebar-item.active { background: rgba(255,255,255,0.15); border-right: 3px solid #f59e0b; }

    /* === RESPONSIVE — variables globales === */
    :root {
      --mobile-header-h: 56px;
      --mobile-bottomnav-h: 64px;
      --desktop-header-h: 0px;
    }
    /* Hauteur fiable cross-device : utilise 100dvh quand supporté (iOS/Android), fallback sur 100vh */
    .app-shell { height: 100vh; height: 100dvh; }
    /* Vue chat — full height moins header mobile et bottom nav */
    .chat-view-shell {
      height: calc(100vh - var(--mobile-header-h) - var(--mobile-bottomnav-h));
      height: calc(100dvh - var(--mobile-header-h) - var(--mobile-bottomnav-h));
    }
    @media (min-width: 1024px) {
      .chat-view-shell { height: calc(100vh - 4rem); height: calc(100dvh - 4rem); }
    }
    /* === MOBILE — vue salon ouverte en plein écran fixe === */
    /* Le salon prend tout le viewport entre le header mobile et la bottom nav.
       Évite le bug où la barre d'envoi est sous la bottom nav et invisible. */
    .chat-mobile-fullscreen {
      position: fixed;
      top: var(--mobile-header-h);
      left: 0;
      right: 0;
      bottom: var(--mobile-bottomnav-h);
      bottom: calc(var(--mobile-bottomnav-h) + env(safe-area-inset-bottom));
      z-index: 15;
      background: white;
      display: flex;
      flex-direction: column;
    }
    @media (min-width: 1024px) {
      /* Sur desktop on revient à un layout in-flow (2 colonnes) */
      .chat-mobile-fullscreen {
        position: relative;
        top: auto; left: auto; right: auto; bottom: auto;
        z-index: auto;
        height: 100%;
      }
    }
    /* Zone messages doit pouvoir scroller indépendamment */
    .chat-messages-scroll {
      flex: 1 1 auto;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      min-height: 0;
    }
    /* Barre d'envoi toujours visible en bas */
    .chat-input-bar { flex-shrink: 0; }
    /* Tables avec scroll horizontal + indicateur visuel d'ombre */
    .table-scroll-wrapper {
      position: relative;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      background:
        linear-gradient(to right, white 30%, rgba(255,255,255,0)),
        linear-gradient(to right, rgba(255,255,255,0), white 70%) 100% 0,
        radial-gradient(farthest-side at 0 50%, rgba(0,0,0,0.12), rgba(0,0,0,0)),
        radial-gradient(farthest-side at 100% 50%, rgba(0,0,0,0.12), rgba(0,0,0,0)) 100% 0;
      background-repeat: no-repeat;
      background-size: 40px 100%, 40px 100%, 14px 100%, 14px 100%;
      background-attachment: local, local, scroll, scroll;
    }
    /* Empêche le contenu d'être collé sous la bottom nav mobile */
    .mobile-content-padding { padding-bottom: calc(var(--mobile-bottomnav-h) + 16px); }
    @media (min-width: 1024px) { .mobile-content-padding { padding-bottom: 2rem; } }
    /* Évite le scroll de fond quand le sidebar mobile est ouvert */
    body.sidebar-open { overflow: hidden; }
    /* Bottom nav — un peu plus généreux et safe-area iOS */
    .mobile-bottomnav {
      padding-bottom: env(safe-area-inset-bottom);
      min-height: var(--mobile-bottomnav-h);
    }
    /* Texte tronqué multi-lignes utilitaire */
    .truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

    /* === MODAL RESPONSIVE === */
    /* Sur mobile : modal en bas, full width, hauteur quasi-totale (bottom-sheet style) */
    /* Sur desktop : centré classique avec coins arrondis */
    .modal-panel {
      max-height: 95vh;
      max-height: 95dvh;
      display: flex;
      flex-direction: column;
      border-radius: 1rem 1rem 0 0;
      overflow: hidden;
    }
    .modal-header { flex-shrink: 0; border-radius: 1rem 1rem 0 0; }
    .modal-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    @media (min-width: 640px) {
      .modal-panel {
        max-height: 90vh;
        max-height: 90dvh;
        border-radius: 1rem;
      }
      .modal-header { border-radius: 1rem 1rem 0 0; }
    }

    /* === INPUTS MOBILES === */
    /* Empêche le zoom iOS quand on focus un champ : font-size minimum 16px */
    .form-input-mobile {
      font-size: 16px !important;
      line-height: 1.5;
      min-height: 44px;            /* taille tactile recommandée Apple/Google */
      -webkit-appearance: none;
      appearance: none;
    }
    textarea.form-input-mobile {
      min-height: 80px;
      line-height: 1.5;
      resize: vertical;
    }
    /* Sur desktop on peut revenir à un texte un peu plus tassé pour densité */
    @media (min-width: 1024px) {
      .form-input-mobile { font-size: 14px !important; min-height: 38px; }
      textarea.form-input-mobile { min-height: 70px; }
    }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="app"></div>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
