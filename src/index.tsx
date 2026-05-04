import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
}

type Variables = {
  user: { id: number; hotel_id: number | null; email: string; name: string; role: string; can_edit_procedures: number }
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
    const user = await c.env.DB.prepare('SELECT id, hotel_id, email, name, role, can_edit_procedures, is_active FROM users WHERE id = ? AND is_active = 1').bind(parseInt(userId)).first()
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
  const user = await c.env.DB.prepare('SELECT id, hotel_id, email, name, role, can_edit_procedures, password_hash FROM users WHERE email = ? AND is_active = 1').bind(email).first() as any
  if (!user || user.password_hash !== password) {
    return c.json({ error: 'Email ou mot de passe incorrect' }, 401)
  }
  await c.env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run()
  const token = btoa(`${user.id}:${user.email}`)
  return c.json({
    token,
    user: { id: user.id, hotel_id: user.hotel_id, email: user.email, name: user.name, role: user.role, can_edit_procedures: user.can_edit_procedures }
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
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id ORDER BY u.name').all()
  } else if (user.role === 'admin') {
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id WHERE u.hotel_id = ? ORDER BY u.name').bind(user.hotel_id).all()
  } else {
    return c.json({ error: 'Non autorisé' }, 403)
  }
  return c.json({ users: users.results })
})

// Toggle can_edit_procedures permission (admin only)
app.put('/api/users/:id/permissions', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { can_edit_procedures } = await c.req.json()

  // Check the target user belongs to same hotel (for admin)
  const targetUser = await c.env.DB.prepare('SELECT id, hotel_id, role FROM users WHERE id = ?').bind(id).first() as any
  if (!targetUser) return c.json({ error: 'Utilisateur non trouvé' }, 404)
  if (currentUser.role === 'admin' && targetUser.hotel_id !== currentUser.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  // Can only grant to employees
  if (targetUser.role !== 'employee') return c.json({ error: 'Cette permission ne s\'applique qu\'aux employés' }, 400)

  await c.env.DB.prepare('UPDATE users SET can_edit_procedures = ? WHERE id = ?').bind(can_edit_procedures ? 1 : 0, id).run()
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
  const status = c.req.query('status')
  const search = c.req.query('search')

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

  if (categoryId) { query += ' AND p.category_id = ?'; params.push(categoryId) }
  if (status) { query += ' AND p.status = ?'; params.push(status) }
  if (search) { query += ' AND (p.title LIKE ? OR p.trigger_event LIKE ? OR p.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`) }

  query += ' ORDER BY p.priority DESC, c.sort_order, p.title'

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

  const steps = await c.env.DB.prepare('SELECT * FROM steps WHERE procedure_id = ? ORDER BY step_number').bind(id).all()
  const conditions = await c.env.DB.prepare('SELECT * FROM conditions WHERE procedure_id = ? ORDER BY sort_order').bind(id).all()

  const conditionsWithSteps = await Promise.all((conditions.results as any[]).map(async (cond: any) => {
    const condSteps = await c.env.DB.prepare('SELECT * FROM condition_steps WHERE condition_id = ? ORDER BY step_number').bind(cond.id).all()
    return { ...cond, steps: condSteps.results }
  }))

  return c.json({ procedure, steps: steps.results, conditions: conditionsWithSteps })
})

app.post('/api/procedures', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json()
  const hotelId = user.role === 'super_admin' ? (body.hotel_id || user.hotel_id) : user.hotel_id

  const result = await c.env.DB.prepare(
    `INSERT INTO procedures (hotel_id, category_id, title, description, trigger_event, trigger_icon, trigger_conditions, priority, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(hotelId, body.category_id || null, body.title, body.description || null, body.trigger_event, body.trigger_icon || 'fa-bolt', body.trigger_conditions || null, body.priority || 'normal', body.status || 'draft', user.id).run()

  const procId = result.meta.last_row_id

  // Insert steps
  if (body.steps && Array.isArray(body.steps)) {
    for (const step of body.steps) {
      await c.env.DB.prepare(
        `INSERT INTO steps (procedure_id, step_number, title, description, step_type, details, warning, tip, duration_minutes, is_optional, condition_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(procId, step.step_number, step.title, step.description || null, step.step_type || 'action', step.details || null, step.warning || null, step.tip || null, step.duration_minutes || null, step.is_optional ? 1 : 0, step.condition_text || null).run()
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
            `INSERT INTO condition_steps (condition_id, step_number, title, description, step_type, details, warning, tip, duration_minutes, is_optional)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(condResult.meta.last_row_id, step.step_number, step.title, step.description || null, step.step_type || 'action', step.details || null, step.warning || null, step.tip || null, step.duration_minutes || null, step.is_optional ? 1 : 0).run()
        }
      }
    }
  }

  // Changelog
  await c.env.DB.prepare(
    `INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required) VALUES (?, ?, ?, 'created', ?, 0)`
  ).bind(hotelId, procId, user.id, `Procédure "${body.title}" créée`).run()

  return c.json({ id: procId })
})

app.put('/api/procedures/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE procedures SET category_id = ?, title = ?, description = ?, trigger_event = ?, trigger_icon = ?, trigger_conditions = ?, priority = ?, status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(body.category_id || null, body.title, body.description || null, body.trigger_event, body.trigger_icon || 'fa-bolt', body.trigger_conditions || null, body.priority || 'normal', body.status || 'draft', id).run()

  // Re-create steps
  if (body.steps) {
    await c.env.DB.prepare('DELETE FROM steps WHERE procedure_id = ?').bind(id).run()
    for (const step of body.steps) {
      await c.env.DB.prepare(
        `INSERT INTO steps (procedure_id, step_number, title, description, step_type, details, warning, tip, duration_minutes, is_optional, condition_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, step.step_number, step.title, step.description || null, step.step_type || 'action', step.details || null, step.warning || null, step.tip || null, step.duration_minutes || null, step.is_optional ? 1 : 0, step.condition_text || null).run()
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
            `INSERT INTO condition_steps (condition_id, step_number, title, description, step_type, details, warning, tip, duration_minutes, is_optional)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(condResult.meta.last_row_id, step.step_number, step.title, step.description || null, step.step_type || 'action', step.details || null, step.warning || null, step.tip || null, step.duration_minutes || null, step.is_optional ? 1 : 0).run()
        }
      }
    }
  }

  // Changelog
  const proc = await c.env.DB.prepare('SELECT hotel_id, title FROM procedures WHERE id = ?').bind(id).first() as any
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
function canManageChannels(user: { role: string; can_edit_procedures: number }) {
  return user.role === 'admin' || (user.role === 'employee' && user.can_edit_procedures === 1)
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
    .priority-critical { border-left: 4px solid #DC2626; }
    .priority-high { border-left: 4px solid #F59E0B; }
    .priority-normal { border-left: 4px solid #3B82F6; }
    .priority-low { border-left: 4px solid #9CA3AF; }
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
