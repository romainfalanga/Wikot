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
  can_edit_clients: number
  can_edit_restaurant: number
  can_edit_settings: number
}

type ClientUser = {
  id: number              // client_account_id
  hotel_id: number
  room_id: number
  room_number: string
  guest_name: string
  hotel_name: string
}

type Variables = {
  user: WikotUser
  client: ClientUser
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())

// ============================================
// CRYPTO HELPERS — PBKDF2-SHA256 100k iter (Web Crypto API, compatible Workers)
// ============================================
const PBKDF2_ITER = 100_000
const PBKDF2_ALGO = 'pbkdf2-sha256-100k'

function bytesToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string; algo: string }> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await derivePbkdf2(password, salt)
  return { hash: bytesToHex(hash), salt: bytesToHex(salt), algo: PBKDF2_ALGO }
}

async function verifyPassword(password: string, hashHex: string, saltHex: string): Promise<boolean> {
  try {
    const expected = hexToBytes(hashHex)
    const computed = await derivePbkdf2(password, hexToBytes(saltHex))
    if (expected.length !== computed.length) return false
    // Comparaison à temps constant
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ computed[i]
    return diff === 0
  } catch {
    return false
  }
}

async function derivePbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    baseKey, 256
  )
  return new Uint8Array(bits)
}

// Génère un token de session admin (48 hex = 24 bytes random)
function generateSessionToken(): string {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return bytesToHex(arr)
}

// Sessions admin durent 30 jours (modifiable côté UX plus tard)
function sessionExpiration(days = 30): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

// ============================================
// AUTH MIDDLEWARE — tokens random stockés en DB (user_sessions)
// ============================================
const authMiddleware = async (c: any, next: any) => {
  const headerToken = c.req.header('Authorization')?.replace('Bearer ', '')
  // Refus immédiat des tokens client (préfixe client_) côté staff
  if (!headerToken || headerToken.startsWith('client_')) {
    return c.json({ error: 'Non authentifié' }, 401)
  }

  // Lookup session + user en une seule requête (perf)
  const row = await c.env.DB.prepare(`
    SELECT s.id as session_id, s.expires_at,
           u.id, u.hotel_id, u.email, u.name, u.role,
           u.can_edit_procedures, u.can_edit_info, u.can_manage_chat,
           u.can_edit_clients, u.can_edit_restaurant, u.can_edit_settings,
           u.is_active
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).bind(headerToken).first() as any

  if (!row) return c.json({ error: 'Session invalide' }, 401)
  if (row.is_active !== 1) return c.json({ error: 'Compte désactivé' }, 401)

  // Vérification expiration
  if (new Date() >= new Date(row.expires_at)) {
    await c.env.DB.prepare('DELETE FROM user_sessions WHERE id = ?').bind(row.session_id).run()
    return c.json({ error: 'Session expirée' }, 401)
  }

  // Touch last_active (non bloquant — on n'attend pas la promesse pour réduire la latence)
  c.executionCtx?.waitUntil?.(
    c.env.DB.prepare('UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.session_id).run()
  )

  c.set('user', {
    id: row.id, hotel_id: row.hotel_id, email: row.email, name: row.name, role: row.role,
    can_edit_procedures: row.can_edit_procedures, can_edit_info: row.can_edit_info,
    can_manage_chat: row.can_manage_chat, can_edit_clients: row.can_edit_clients,
    can_edit_restaurant: row.can_edit_restaurant, can_edit_settings: row.can_edit_settings,
    is_active: row.is_active
  })
  await next()
}

// ============================================
// CLIENT AUTH MIDDLEWARE (Front Wikot — comptes clients)
// ============================================
// Sépare l'authentification client (token Bearer commençant par "client_")
// de l'authentification staff. Vérifie l'expiration et la validité du compte.
const clientAuthMiddleware = async (c: any, next: any) => {
  const headerToken = c.req.header('Authorization')?.replace('Bearer ', '')
  const token = headerToken && headerToken.startsWith('client_') ? headerToken.slice(7) : null
  if (!token) return c.json({ error: 'Non authentifié' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT cs.id as session_id, cs.expires_at, cs.client_account_id,
           ca.id as account_id, ca.hotel_id, ca.room_id, ca.guest_name, ca.is_active,
           r.room_number,
           h.name as hotel_name
    FROM client_sessions cs
    JOIN client_accounts ca ON cs.client_account_id = ca.id
    JOIN rooms r ON ca.room_id = r.id
    JOIN hotels h ON ca.hotel_id = h.id
    WHERE cs.token = ?
  `).bind(token).first() as any
  if (!session) return c.json({ error: 'Session invalide' }, 401)
  if (session.is_active !== 1) return c.json({ error: 'Compte client désactivé' }, 401)

  // Vérification expiration (à midi)
  const now = new Date()
  const expires = new Date(session.expires_at)
  if (now >= expires) {
    await c.env.DB.prepare('DELETE FROM client_sessions WHERE id = ?').bind(session.session_id).run()
    return c.json({ error: 'Session expirée — veuillez vous reconnecter' }, 401)
  }

  await c.env.DB.prepare('UPDATE client_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?').bind(session.session_id).run()

  c.set('client', {
    id: session.account_id,
    hotel_id: session.hotel_id,
    room_id: session.room_id,
    room_number: session.room_number,
    guest_name: session.guest_name,
    hotel_name: session.hotel_name
  })
  await next()
}

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json() as { email?: string; password?: string }
  if (!email || !password) return c.json({ error: 'Email et mot de passe requis' }, 400)

  const user = await c.env.DB.prepare(`
    SELECT id, hotel_id, email, name, role,
           can_edit_procedures, can_edit_info, can_manage_chat,
           can_edit_clients, can_edit_restaurant, can_edit_settings,
           password_hash, password_hash_v2, password_salt, password_algo
    FROM users WHERE email = ? AND is_active = 1
  `).bind(email).first() as any

  if (!user) return c.json({ error: 'Email ou mot de passe incorrect' }, 401)

  // 1. Vérification : nouveau hash si présent, sinon legacy plaintext
  let valid = false
  let needsMigration = false

  if (user.password_hash_v2 && user.password_salt) {
    valid = await verifyPassword(password, user.password_hash_v2, user.password_salt)
  } else if (user.password_hash) {
    // Lazy migration : ancien stockage en clair
    valid = (user.password_hash === password)
    if (valid) needsMigration = true
  }

  if (!valid) return c.json({ error: 'Email ou mot de passe incorrect' }, 401)

  // 2. Lazy migration vers PBKDF2 si nécessaire
  // Note : password_hash reste NOT NULL au schéma → on stocke '' comme sentinelle
  // pour invalider l'ancien plaintext sans casser la contrainte / les FK.
  if (needsMigration) {
    const { hash, salt, algo } = await hashPassword(password)
    await c.env.DB.prepare(`
      UPDATE users SET password_hash_v2 = ?, password_salt = ?, password_algo = ?, password_hash = ''
      WHERE id = ?
    `).bind(hash, salt, algo, user.id).run()
  }

  // 3. Création de la session (token random non-prédictible)
  const token = generateSessionToken()
  const expiresAt = sessionExpiration(30)
  const ua = c.req.header('User-Agent') || null
  await c.env.DB.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, user_agent)
    VALUES (?, ?, ?, ?)
  `).bind(token, user.id, expiresAt, ua).run()

  await c.env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run()

  return c.json({
    token,
    expires_at: expiresAt,
    user: {
      id: user.id, hotel_id: user.hotel_id, email: user.email, name: user.name, role: user.role,
      can_edit_procedures: user.can_edit_procedures, can_edit_info: user.can_edit_info,
      can_manage_chat: user.can_manage_chat, can_edit_clients: user.can_edit_clients,
      can_edit_restaurant: user.can_edit_restaurant, can_edit_settings: user.can_edit_settings
    }
  })
})

// Logout — invalide la session courante
app.post('/api/auth/logout', authMiddleware, async (c) => {
  const headerToken = c.req.header('Authorization')?.replace('Bearer ', '') || ''
  await c.env.DB.prepare('DELETE FROM user_sessions WHERE token = ?').bind(headerToken).run()
  return c.json({ success: true })
})

// ============================================
// CLIENT AUTH ROUTES (Front Wikot)
// ============================================
// Le client tape : code hôtel (ex: GRDPARIS), numéro de chambre (ex: 12), nom du client.
// On vérifie que le client_account de cette chambre est actif et que le nom (normalisé)
// matche guest_name_normalized. Si OK, on crée une session valable jusqu'au prochain midi.
// Plusieurs sessions simultanées sont autorisées (chambre partagée → plusieurs téléphones).
app.post('/api/client/login', async (c) => {
  const body = await c.req.json() as { hotel_code?: string; room_number?: string; guest_name?: string }
  const hotelCode = (body.hotel_code || '').trim().toUpperCase()
  const roomNumber = (body.room_number || '').trim()
  const guestName = (body.guest_name || '').trim()

  if (!hotelCode || !roomNumber || !guestName) {
    return c.json({ error: 'Tous les champs sont obligatoires' }, 400)
  }

  const hotel = await c.env.DB.prepare('SELECT id, name FROM hotels WHERE client_login_code = ?').bind(hotelCode).first() as any
  if (!hotel) return c.json({ error: 'Code hôtel invalide' }, 401)

  const room = await c.env.DB.prepare('SELECT id, room_number FROM rooms WHERE hotel_id = ? AND room_number = ? AND is_active = 1').bind(hotel.id, roomNumber).first() as any
  if (!room) return c.json({ error: 'Numéro de chambre invalide' }, 401)

  const account = await c.env.DB.prepare('SELECT id, guest_name, guest_name_normalized, is_active FROM client_accounts WHERE hotel_id = ? AND room_id = ?').bind(hotel.id, room.id).first() as any
  if (!account || account.is_active !== 1) {
    return c.json({ error: 'Cette chambre n\'a pas encore de client enregistré aujourd\'hui' }, 401)
  }

  const normalizedInput = normalizeName(guestName)
  if (!account.guest_name_normalized || account.guest_name_normalized !== normalizedInput) {
    return c.json({ error: 'Le nom ne correspond pas au client de la chambre' }, 401)
  }

  // Création de la session — expire au prochain midi (UTC)
  const token = generateRandomToken()
  const expiresAt = nextNoonExpiration()
  await c.env.DB.prepare(`
    INSERT INTO client_sessions (token, client_account_id, hotel_id, room_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(token, account.id, hotel.id, room.id, expiresAt).run()

  await c.env.DB.prepare('UPDATE client_accounts SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(account.id).run()

  return c.json({
    token: `client_${token}`,
    client: {
      id: account.id,
      hotel_id: hotel.id,
      hotel_name: hotel.name,
      room_id: room.id,
      room_number: room.room_number,
      guest_name: account.guest_name,
      expires_at: expiresAt
    }
  })
})

app.get('/api/client/me', clientAuthMiddleware, async (c) => {
  return c.json({ client: c.get('client') })
})

app.post('/api/client/logout', clientAuthMiddleware, async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer client_', '') || ''
  await c.env.DB.prepare('DELETE FROM client_sessions WHERE token = ?').bind(token).run()
  return c.json({ success: true })
})

app.get('/api/auth/me', authMiddleware, async (c) => {
  return c.json({ user: c.get('user') })
})

app.put('/api/auth/change-password', authMiddleware, async (c) => {
  const user = c.get('user')
  const { current_password, new_password } = await c.req.json() as { current_password?: string; new_password?: string }
  if (!current_password || !new_password) return c.json({ error: 'Champs manquants' }, 400)
  if (new_password.length < 8) return c.json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères' }, 400)

  // Vérifier l'ancien mot de passe (compatible v1 plaintext et v2 PBKDF2)
  const dbUser = await c.env.DB.prepare(
    'SELECT password_hash, password_hash_v2, password_salt FROM users WHERE id = ?'
  ).bind(user.id).first() as any
  if (!dbUser) return c.json({ error: 'Utilisateur introuvable' }, 404)

  let valid = false
  if (dbUser.password_hash_v2 && dbUser.password_salt) {
    valid = await verifyPassword(current_password, dbUser.password_hash_v2, dbUser.password_salt)
  } else if (dbUser.password_hash) {
    valid = (dbUser.password_hash === current_password)
  }
  if (!valid) return c.json({ error: 'Mot de passe actuel incorrect' }, 401)

  // Hash du nouveau mot de passe + invalidation du legacy (sentinelle '' car NOT NULL)
  const { hash, salt, algo } = await hashPassword(new_password)
  await c.env.DB.prepare(`
    UPDATE users SET password_hash_v2 = ?, password_salt = ?, password_algo = ?,
                     password_hash = '', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(hash, salt, algo, user.id).run()

  // Invalide toutes les autres sessions (sauf celle en cours, par sécurité)
  const currentToken = c.req.header('Authorization')?.replace('Bearer ', '') || ''
  await c.env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token != ?')
    .bind(user.id, currentToken).run()

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

function canEditClients(user: { role: string; can_edit_clients?: number }) {
  return user.role === 'admin' || user.can_edit_clients === 1
}

function canEditRestaurant(user: { role: string; can_edit_restaurant?: number }) {
  return user.role === 'admin' || user.can_edit_restaurant === 1
}

function canEditSettings(user: { role: string; can_edit_settings?: number }) {
  return user.role === 'admin' || user.can_edit_settings === 1
}

// ============================================
// MULTI-TENANCY GUARD
// ============================================
// Vérifie qu'une ressource appartient bien à l'hôtel du user courant.
// Le super_admin contourne cette vérification.
// Retourne la ressource si OK, sinon une Response 403/404 à propager.
async function assertHotelOwnership(
  db: D1Database,
  table: string,
  id: number | string,
  user: { role: string; hotel_id: number | null },
  hotelColumn: string = 'hotel_id'
): Promise<any | Response> {
  const allowedTables = new Set([
    'procedures', 'categories', 'hotel_info_items', 'hotel_info_categories',
    'rooms', 'restaurant_week_templates', 'restaurant_schedule',
    'restaurant_exceptions', 'restaurant_reservations', 'suggestions',
    'templates', 'chat_groups', 'chat_channels', 'client_accounts',
    'wikot_conversations', 'users'
  ])
  if (!allowedTables.has(table)) {
    return new Response(JSON.stringify({ error: 'Table non autorisée' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  const row = await db.prepare(
    `SELECT * FROM ${table} WHERE id = ?`
  ).bind(id).first<any>()

  if (!row) {
    return new Response(JSON.stringify({ error: 'Ressource non trouvée' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    })
  }

  if (user.role === 'super_admin') return row

  if (row[hotelColumn] !== user.hotel_id) {
    return new Response(JSON.stringify({ error: 'Accès refusé' }), {
      status: 403, headers: { 'Content-Type': 'application/json' }
    })
  }

  return row
}

// Normalise un nom (suppression accents + lowercase + trim) pour comparaison
// insensible à la casse / aux accents.
function normalizeName(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Calcule l'instant de prochaine expiration (12h00 du lendemain le plus proche).
// Si on est avant midi, l'expiration est aujourd'hui à midi.
// Si on est après midi, l'expiration est demain à midi.
function nextNoonExpiration(): string {
  const now = new Date()
  const expires = new Date(now)
  expires.setUTCHours(12, 0, 0, 0)
  if (now >= expires) {
    expires.setUTCDate(expires.getUTCDate() + 1)
  }
  return expires.toISOString().replace('T', ' ').replace('Z', '')
}

// Génère un token aléatoire pour les sessions client
function generateRandomToken(): string {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
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
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.can_edit_clients, u.can_edit_restaurant, u.can_edit_settings, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id ORDER BY u.name').all()
  } else if (user.role === 'admin') {
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.can_edit_clients, u.can_edit_restaurant, u.can_edit_settings, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id WHERE u.hotel_id = ? ORDER BY u.name').bind(user.hotel_id).all()
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
    can_edit_clients?: boolean | number
    can_edit_restaurant?: boolean | number
    can_edit_settings?: boolean | number
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
  if (body.can_edit_clients !== undefined)    { fields.push('can_edit_clients = ?');    values.push(body.can_edit_clients ? 1 : 0) }
  if (body.can_edit_restaurant !== undefined) { fields.push('can_edit_restaurant = ?'); values.push(body.can_edit_restaurant ? 1 : 0) }
  if (body.can_edit_settings !== undefined)   { fields.push('can_edit_settings = ?');   values.push(body.can_edit_settings ? 1 : 0) }
  if (fields.length === 0) return c.json({ error: 'Aucune permission à mettre à jour' }, 400)

  values.push(id)
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

app.post('/api/users', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const { hotel_id, email, password, name, role } = await c.req.json() as {
    hotel_id?: number; email?: string; password?: string; name?: string; role?: string
  }
  if (!email || !password || !name) return c.json({ error: 'Champs manquants' }, 400)
  if (password.length < 8) return c.json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, 400)

  const targetHotel = currentUser.role === 'admin' ? currentUser.hotel_id : hotel_id
  if (currentUser.role === 'admin' && role === 'super_admin') return c.json({ error: 'Non autorisé' }, 403)

  // Hash PBKDF2 dès la création — pas de stockage plaintext
  // password_hash = '' (sentinelle) car la colonne est NOT NULL au schéma
  const { hash, salt, algo } = await hashPassword(password)
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO users (hotel_id, email, password_hash, password_hash_v2, password_salt, password_algo, name, role)
      VALUES (?, ?, '', ?, ?, ?, ?, ?)
    `).bind(targetHotel, email, hash, salt, algo, name, role || 'employee').run()
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
  const owned = await assertHotelOwnership(c.env.DB, 'categories', id, user)
  if (owned instanceof Response) return owned
  const { name, icon, color } = await c.req.json()
  await c.env.DB.prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?').bind(name, icon, color, id).run()
  return c.json({ success: true })
})

app.delete('/api/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const owned = await assertHotelOwnership(c.env.DB, 'categories', id, user)
  if (owned instanceof Response) return owned
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
    u1.name as created_by_name,
    (SELECT COUNT(*) FROM steps WHERE procedure_id = p.id) as step_count,
    (SELECT COUNT(*) FROM conditions WHERE procedure_id = p.id) as condition_count
    FROM procedures p 
    LEFT JOIN categories c ON p.category_id = c.id 
    LEFT JOIN users u1 ON p.created_by = u1.id
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
    u1.name as created_by_name
    FROM procedures p 
    LEFT JOIN categories c ON p.category_id = c.id 
    LEFT JOIN users u1 ON p.created_by = u1.id
    WHERE p.id = ?`).bind(id).first() as any

  if (!procedure) return c.json({ error: 'Procédure non trouvée' }, 404)
  // Multi-tenancy: vérifie que la procédure appartient à l'hôtel du user
  if (procedure.hotel_id !== user.hotel_id) return c.json({ error: 'Accès refusé' }, 403)

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
  const owned = await assertHotelOwnership(c.env.DB, 'procedures', id, user)
  if (owned instanceof Response) return owned
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
  const owned = await assertHotelOwnership(c.env.DB, 'procedures', id, user)
  if (owned instanceof Response) return owned
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
  const owned = await assertHotelOwnership(c.env.DB, 'procedures', id, user)
  if (owned instanceof Response) return owned

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
  const owned = await assertHotelOwnership(c.env.DB, 'suggestions', id, user)
  if (owned instanceof Response) return owned
  const { status, admin_response } = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE suggestions SET status = ?, admin_response = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, admin_response || null, user.id, id).run()

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
  const id = c.req.param('id')
  // Templates n'ont pas forcément hotel_id, mais on vérifie quand même
  const tpl = await c.env.DB.prepare('SELECT hotel_id FROM templates WHERE id = ?').bind(id).first() as any
  if (!tpl) return c.json({ error: 'Template non trouvé' }, 404)
  if (tpl.hotel_id && tpl.hotel_id !== user.hotel_id) return c.json({ error: 'Accès refusé' }, 403)
  await c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run()
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
  const totalUsers = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE hotel_id = ?').bind(hotelId).first() as any

  // Pages "Rechercher" et "Historique" supprimées : on ne calcule plus
  // unread_required ni recent_changes (changelog reste alimenté en interne
  // uniquement à des fins de log/audit, mais n'est plus affiché).
  return c.json({
    total_procedures: totalProc.count,
    active_procedures: activeProc.count,
    draft_procedures: draftProc.count,
    total_users: totalUsers.count
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
  const owned = await assertHotelOwnership(c.env.DB, 'hotel_info_categories', id, user)
  if (owned instanceof Response) return owned
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
  const owned = await assertHotelOwnership(c.env.DB, 'hotel_info_categories', id, user)
  if (owned instanceof Response) return owned

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
  const owned = await assertHotelOwnership(c.env.DB, 'hotel_info_items', id, user)
  if (owned instanceof Response) return owned
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
  const owned = await assertHotelOwnership(c.env.DB, 'hotel_info_items', id, user)
  if (owned instanceof Response) return owned

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
// workflowMode (max uniquement) : 'create_procedure' | 'update_procedure' | 'create_info' | 'update_info' | null
// formContext (max uniquement) : état actuel du formulaire visible côté UI (titre/contenu/étapes)
async function buildWikotSystemPrompt(db: D1Database, user: WikotUser, hotelName: string, mode: 'standard' | 'max', workflowMode?: string | null, formContext?: any): Promise<string> {
  const arborescence = await buildHotelArborescence(db, user.hotel_id!)

  if (mode === 'standard') {
    // ============================================
    // WIKOT CLASSIQUE — SÉLECTEUR DE CARTES (zéro texte libre)
    // ============================================
    return `Tu es **Wikot**, le moteur de recherche conversationnel du **${hotelName}**.

## Ta mission UNIQUE
Tu reçois une question d'employé. Tu identifies LA procédure ou L'information de l'hôtel la plus pertinente, et tu la retournes via l'outil \`select_answer\`. **Tu NE rédiges JAMAIS de texte de réponse.** L'interface affiche directement la carte de la ressource sélectionnée.

## Protocole strict (obligatoire à chaque message)
1. Appelle les outils de recherche pertinents :
   - \`search_procedures\` (procédures entières) ET/OU \`search_procedure_steps\` (étapes individuelles) si la question évoque une action / un processus.
   - \`search_hotel_info\` (infos précises) ET/OU \`list_info_categories\` (thèmes/catégories) si la question évoque une information de l'hôtel.
2. Si plusieurs résultats, appelle \`get_procedure\` ou \`get_hotel_info_item\` pour comparer.
3. Termine TOUJOURS par UN SEUL appel à \`select_answer\` à la BONNE GRANULARITÉ :
   - \`type: "procedure"\` + \`id\` → la question demande la procédure ENTIÈRE (« Comment je fais un check-in ? »).
   - \`type: "procedure_step"\` + \`procedure_id\` + \`step_number\` → la question demande UNE étape précise dans une procédure (« Comment vérifier la réservation pendant le check-in ? », « Comment vérifier l'identité d'un client ? »). Si l'étape pointe vers une sous-procédure, ce type affichera la sous-procédure complète.
   - \`type: "info_item"\` + \`id\` → la question demande UNE information précise (« Horaires de la piscine », « Code Wi-Fi »).
   - \`type: "info_category"\` + \`id\` → la question demande TOUT un thème regroupé en catégorie (« Quels sont les loisirs et activités ? », « Donne-moi tous les horaires »).
   - \`type: "none"\` → aucune ressource existante ne correspond, OU question hors-sujet (« bonjour »), OU demande de création/modification.

## Règles ABSOLUES
- **AUCUN texte de réponse écrit par toi.** Le seul output que tu produis est l'appel à \`select_answer\`. Pas de politesse, pas d'introduction.
- **GRANULARITÉ MAXIMALE** : choisis toujours le type le plus précis qui répond pleinement. Si l'employé demande une seule action, ne renvoie pas la procédure entière → renvoie \`procedure_step\`. Si l'employé demande un thème large, renvoie \`info_category\`, pas un seul \`info_item\`.
- **UNE SEULE ressource sélectionnée** (la plus pertinente).
- Si la question concerne une création/modification : sélectionne \`type: "none"\` (Wikot ne fait que de la lecture).

## Arborescence actuelle de l'hôtel
${arborescence}

Rappel : tu es un **sélecteur**, pas un rédacteur. \`select_answer\` à chaque tour, jamais de texte libre.`
  }

  // ============================================
  // WIKOT MAX — Back Wikot ultra-spécialisé en 4 workflows
  // ============================================
  const canEditProc = wikotUserCanEditProcedures(user)
  const canEditInf = wikotUserCanEditInfo(user)

  // Règles de style ANTI-IA, communes à tous les workflows.
  // Objectif : que le contenu rédigé ne ressemble PAS à du texte généré par IA.
  const styleRules = `## Règles de style strictes (CRITIQUE, applicables au CONTENU rédigé)
Tu rédiges comme un professionnel de l'hôtellerie qui écrit un manuel interne. Le contenu ne doit JAMAIS trahir une rédaction par IA.

### Ponctuation interdite
- **Aucun tiret cadratin** (em-dash : caractère "—" U+2014).
- **Aucun tiret demi-cadratin** (en-dash : caractère "–" U+2013).
- À la place, utilise une virgule, un deux-points, un point, ou des parenthèses selon le besoin.
- Aucun guillemet typographique exotique. Utilise les guillemets français normaux ou des doubles guillemets simples.

### Émoticônes et emojis : INTERDITS
- Aucun emoji dans le contenu rédigé (titres, descriptions, étapes, infos). Jamais.
- Exception très limitée : tu peux suggérer une icône Font Awesome FONCTIONNELLE en mentionnant son nom (ex : "fa-triangle-exclamation" pour un avertissement). Mais aucun smiley, aucun pictogramme décoratif.

### Style d'écriture
- Phrases courtes et directes. Pas de formules pompeuses ("n'hésitez pas à…", "je suis à votre disposition…").
- Vocabulaire concret de l'hôtellerie. Pas de jargon corporate vague.
- Voix active, jamais passive floue.
- Pas d'introductions du type "Voici…" ou "Dans cette procédure, nous allons…". On va droit au fait.
- Pas de conclusions du type "Pour toute question…".`

  // Contexte du formulaire en cours d'édition (état actuel des champs visibles côté UI)
  const formContextStr = formContext ? `

## État actuel du formulaire (ce que voit l'utilisateur en ce moment)
\`\`\`json
${JSON.stringify(formContext, null, 2)}
\`\`\`
Tu ÉCRIS DIRECTEMENT dans ce formulaire via l'outil \`update_form\`. L'utilisateur voit tes modifications en temps réel. Il valide ou ajuste manuellement avant d'enregistrer en cliquant sur le bouton "Enregistrer".` : ''

  // ============================================
  // 4 WORKFLOWS ULTRA-SPÉCIALISÉS
  // ============================================

  if (workflowMode === 'create_procedure') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **CRÉATION DE PROCÉDURES** pour le **${hotelName}**.

## Ta mission UNIQUE pour cette session
Aider l'utilisateur à créer une nouvelle procédure de A à Z. Tu rédiges, tu structures, tu remplis directement le formulaire visible à l'écran via l'outil \`update_form\`. L'utilisateur valide à la fin en cliquant "Enregistrer".

## Tu ne fais QUE ça
- Tu ne crées pas d'information (autre workflow).
- Tu ne modifies pas une procédure existante (autre workflow).
- Tu ne réponds pas aux questions générales (c'est le rôle de Wikot).
${!canEditProc ? '- ATTENTION : cet utilisateur N\'EST PAS autorisé à créer des procédures. Refuse poliment.' : ''}

## Protocole en 3 étapes

### 1. Cadrer la procédure
Pose 1 ou 2 questions ciblées pour comprendre : quel évènement déclenche cette procédure, quel est l'objectif, quelles sont les grandes étapes que l'utilisateur a en tête. Si l'utilisateur a déjà tout dit dans son premier message, passe directement à l'étape 2.

### 2. Vérifier qu'elle n'existe pas déjà
Appelle \`search_procedures\` avec les mots-clés évidents. Si une procédure proche existe, propose plutôt à l'utilisateur de la modifier (et oriente vers le workflow Modifier).

### 3. Rédiger directement dans le formulaire
Utilise \`update_form\` pour remplir CHAQUE champ. Tu peux faire plusieurs appels successifs (un par champ ou par groupe de champs). Champs disponibles :
- \`title\` : verbe d'action à l'infinitif + sujet clair (ex : "Effectuer un check-in client").
- \`trigger_event\` : commence par "Quand" ou "Lorsque" (ex : "Quand un client se présente à la réception pour son arrivée").
- \`description\` : 1 à 2 phrases qui expliquent le contexte et l'objectif.
- \`steps\` : tableau d'objets {title, content, linked_procedure_id?}. 3 à 10 étapes. Titre d'étape = verbe à l'impératif, 8 mots max. Contenu = instructions concrètes à la 2e personne ("Demande…", "Vérifie…"). Pour lier une étape à une sous-procédure existante, mets son id dans linked_procedure_id (le contenu peut alors être vide).

Après chaque update_form, écris UNE phrase courte qui décrit ce que tu viens de remplir et propose la suite. Pas de récap pompeux.

${styleRules}

## Arborescence actuelle de l'hôtel (pour repérer les sous-procédures existantes)
${arborescence}
${formContextStr}

Rappel : tu remplis le formulaire en temps réel via update_form. L'utilisateur enregistre lui-même quand il est satisfait.`
  }

  if (workflowMode === 'update_procedure') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **MODIFICATION DE PROCÉDURES** pour le **${hotelName}**.

## Ta mission UNIQUE pour cette session
Aider l'utilisateur à modifier une procédure existante. La procédure cible est déjà chargée dans le formulaire. Tu écoutes ce qu'il veut changer, tu rédiges les ajustements, tu remplis directement le formulaire visible à l'écran via l'outil \`update_form\`. L'utilisateur valide à la fin en cliquant "Enregistrer".

## Tu ne fais QUE ça
- Tu ne crées pas une nouvelle procédure (autre workflow).
- Tu ne modifies pas d'information (autre workflow).
- Tu ne réponds pas aux questions générales.
${!canEditProc ? '- ATTENTION : cet utilisateur N\'EST PAS autorisé à modifier les procédures. Refuse poliment.' : ''}

## Protocole en 3 étapes

### 1. Comprendre la modification souhaitée
Lis attentivement la demande. Si c'est précis ("change le titre en X", "ajoute une étape Y"), exécute directement. Si c'est vague ("améliore"), pose UNE question pour cibler ce qu'il faut changer en priorité.

### 2. Préserver les liens vers les sous-procédures
ATTENTION CRITIQUE : si tu modifies le tableau \`steps\`, tu DOIS conserver les \`linked_procedure_id\` des étapes existantes qui pointaient vers une sous-procédure, sauf si l'utilisateur demande explicitement de retirer ce lien. Sinon les sous-procédures seront orphelines.

### 3. Modifier directement dans le formulaire
Utilise \`update_form\` pour mettre à jour les champs concernés UNIQUEMENT (pas besoin de tout réécrire). Champs disponibles : \`title\`, \`trigger_event\`, \`description\`, \`steps\` (tableau complet d'objets {title, content, linked_procedure_id?}).

Quand tu remplis \`steps\`, tu remplaces tout le tableau, donc reprends bien les étapes existantes que l'utilisateur veut conserver, et ajoute/modifie/supprime selon sa demande.

Après chaque update_form, écris UNE phrase courte qui décrit le changement. Pas de récap pompeux.

${styleRules}

## Arborescence actuelle de l'hôtel (pour repérer les sous-procédures existantes)
${arborescence}
${formContextStr}

Rappel : tu modifies le formulaire en temps réel via update_form. L'utilisateur enregistre lui-même quand il est satisfait.`
  }

  if (workflowMode === 'create_info') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **CRÉATION D'INFORMATIONS** pour le **${hotelName}**.

## Ta mission UNIQUE pour cette session
Aider l'utilisateur à créer une nouvelle information de l'hôtel (horaires, services, équipements, contacts, etc.). Tu rédiges et tu remplis directement le formulaire visible à l'écran via l'outil \`update_form\`. L'utilisateur valide à la fin en cliquant "Enregistrer".

## Tu ne fais QUE ça
- Tu ne crées pas de procédure (autre workflow).
- Tu ne modifies pas d'information existante (autre workflow).
- Tu ne réponds pas aux questions générales.
${!canEditInf ? '- ATTENTION : cet utilisateur N\'EST PAS autorisé à créer des informations. Refuse poliment.' : ''}

## Protocole en 3 étapes

### 1. Cadrer l'information
Pose 1 ou 2 questions ciblées : de quel sujet parle-t-on, quelles sont les valeurs précises (horaires exacts, numéros, tarifs, lieux). Si tout est déjà dans le premier message, passe à l'étape 2.

### 2. Vérifier qu'elle n'existe pas déjà
Appelle \`search_hotel_info\` avec les mots-clés évidents. Si une info proche existe, propose plutôt de la modifier.

### 3. Rédiger directement dans le formulaire
Utilise \`update_form\` pour remplir les champs. Champs disponibles :
- \`title\` : court, factuel, sans verbe (ex : "Horaires du restaurant", "Code Wi-Fi", "Numéros utiles").
- \`content\` : structuré, factuel, scannable. Listes à puces avec le caractère "•". Gras avec **double étoile** pour les valeurs importantes.
  - Horaires au format hh:mm puis le séparateur, puis hh:mm (ex : 07:00 à 10:30, ou 07:00, 10:30 selon le contexte).
  - Numéros de téléphone formatés "01 23 45 67 89".
  - Tarifs en euros avec le symbole € (ex : "12 €").
  - Lieux précis (ex : "salle Méditerranée, RDC").
- \`category_id\` : choisis l'id de la catégorie existante la plus adaptée parmi celles qui te sont visibles. Si aucune ne convient, dis-le à l'utilisateur, il créera une catégorie à la main.

Après chaque update_form, écris UNE phrase courte qui décrit ce que tu viens de remplir.

${styleRules}

## Arborescence actuelle de l'hôtel (pour repérer les catégories d'infos existantes)
${arborescence}
${formContextStr}

Rappel : tu remplis le formulaire en temps réel via update_form. L'utilisateur enregistre lui-même quand il est satisfait.`
  }

  if (workflowMode === 'update_info') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **MODIFICATION D'INFORMATIONS** pour le **${hotelName}**.

## Ta mission UNIQUE pour cette session
Aider l'utilisateur à modifier une information existante de l'hôtel. L'information cible est déjà chargée dans le formulaire. Tu écoutes ce qu'il veut changer, tu rédiges les ajustements, tu remplis directement le formulaire visible à l'écran via l'outil \`update_form\`. L'utilisateur valide à la fin en cliquant "Enregistrer".

## Tu ne fais QUE ça
- Tu ne crées pas une nouvelle information (autre workflow).
- Tu ne modifies pas de procédure (autre workflow).
- Tu ne réponds pas aux questions générales.
${!canEditInf ? '- ATTENTION : cet utilisateur N\'EST PAS autorisé à modifier les informations. Refuse poliment.' : ''}

## Protocole en 2 étapes

### 1. Comprendre la modification souhaitée
Lis attentivement la demande. Si c'est précis, exécute directement. Si c'est vague, pose UNE question pour cibler.

### 2. Modifier directement dans le formulaire
Utilise \`update_form\` pour mettre à jour les champs concernés UNIQUEMENT. Champs disponibles : \`title\`, \`content\`, \`category_id\`.

Quand tu modifies \`content\`, conserve la structure existante (listes, gras, formats horaires) sauf si l'utilisateur demande explicitement de la changer.

Après chaque update_form, écris UNE phrase courte qui décrit le changement.

${styleRules}

## Arborescence actuelle de l'hôtel (pour repérer les catégories d'infos existantes)
${arborescence}
${formContextStr}

Rappel : tu modifies le formulaire en temps réel via update_form. L'utilisateur enregistre lui-même quand il est satisfait.`
  }

  // ============================================
  // FALLBACK : pas de workflow_mode (entrée Back Wikot sans workflow choisi)
  // → Demander à l'utilisateur de choisir un des 4 boutons d'entonnoir
  // ============================================
  return `Tu es **Back Wikot**, agent de rédaction et d'édition pour le **${hotelName}**.

Tu fais EXACTEMENT 4 choses, et rien d'autre :
1. Créer une procédure
2. Modifier une procédure
3. Créer une information
4. Modifier une information

Si l'utilisateur t'écrit sans avoir choisi un de ces 4 workflows, demande-lui poliment de cliquer sur l'un des 4 boutons d'entonnoir affichés à l'écran ("Créer une procédure", "Modifier une procédure", "Créer une information", "Modifier une information"). Reste très bref.

${styleRules}`
}

// Helper : tools disponibles selon le mode et les permissions
// mode='standard' → Wikot lecture (search/get/list/add_reference uniquement)
// mode='max'      → Back Wikot (lecture + update_form uniquement, scope par workflowMode)
// workflowMode = 'create_procedure' | 'update_procedure' | 'create_info' | 'update_info' | null
function buildWikotTools(mode: 'standard' | 'max', canEditProc: boolean, canEditInf: boolean, workflowMode?: string | null): any[] {
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
        name: 'search_procedure_steps',
        description: 'Recherche dans les ÉTAPES individuelles des procédures (par titre ou contenu d\'étape). Utile quand l\'utilisateur demande UNE action précise au sein d\'une procédure (ex: « Comment vérifier la réservation lors d\'un check-in »). Retourne {procedure_id, procedure_title, step_id, step_number, step_title, step_content, linked_procedure_id, linked_title}.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Termes de recherche pour les étapes' } },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_info_categories',
        description: 'Liste les catégories d\'informations avec, pour chacune, la liste des informations qu\'elle contient. Utile quand l\'utilisateur demande TOUTES les informations d\'un thème (ex: « les loisirs et activités », « les horaires »). Retourne pour chaque catégorie {id, name, color, icon, items: [{id, title}]}.',
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
        description: `Sélectionne LA réponse la plus pertinente, à la BONNE GRANULARITÉ. UTILISE-LE OBLIGATOIREMENT à chaque message après tes recherches.

Types disponibles :
- "procedure" + id : la question porte sur la procédure entière (ex: « Comment je fais un check-in ? »)
- "procedure_step" + procedure_id + step_number : la question porte sur UNE étape précise d'une procédure (ex: « Comment vérifier la réservation pendant le check-in ? »). Si l'étape est liée à une sous-procédure, renvoie ce type pour afficher uniquement la sous-procédure dans son contexte.
- "info_item" + id : la question porte sur UNE information précise (ex: « Horaires de la piscine »)
- "info_category" + category_id : la question porte sur TOUT un thème regroupé en catégorie (ex: « Les loisirs et activités », « Tous les horaires »)
- "none" : aucune ressource ne correspond.

RÈGLE DE GRANULARITÉ : choisis toujours le type le plus précis qui répond pleinement à la question. Si l'employé demande une seule étape, ne renvoie pas la procédure entière. Si l'employé demande un thème large, renvoie la catégorie complète.`,
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['procedure', 'procedure_step', 'info_item', 'info_category', 'none'] },
            id: { type: 'integer', description: 'ID de la procédure (type=procedure) ou de l\'info (type=info_item) ou de la catégorie (type=info_category)' },
            procedure_id: { type: 'integer', description: '[type=procedure_step] ID de la procédure parente' },
            step_number: { type: 'integer', description: '[type=procedure_step] numéro de l\'étape (1, 2, 3…)' }
          },
          required: ['type']
        }
      }
    })
    return tools
  }

  // ============================================
  // MODE MAX (Back Wikot) — Tool update_form ultra-spécialisé selon workflow
  // L'IA n'écrit plus en base directement. Elle remplit le formulaire visible
  // côté UI, et l'utilisateur clique sur "Enregistrer" pour valider.
  // ============================================

  // Schéma update_form adapté au workflow en cours
  const isProcedureWorkflow = workflowMode === 'create_procedure' || workflowMode === 'update_procedure'
  const isInfoWorkflow = workflowMode === 'create_info' || workflowMode === 'update_info'

  if (isProcedureWorkflow && canEditProc) {
    tools.push({
      type: 'function',
      function: {
        name: 'update_form',
        description: 'Met à jour le formulaire procédure visible à l\'écran. Tu peux passer un ou plusieurs champs à la fois. Les champs non passés ne sont pas modifiés. Pour steps, tu remplaces tout le tableau (donc reprends bien les étapes existantes à conserver).',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titre de la procédure (verbe à l\'infinitif)' },
            trigger_event: { type: 'string', description: 'Évènement déclencheur (commence par "Quand" ou "Lorsque")' },
            description: { type: 'string', description: 'Description courte (1-2 phrases)' },
            category_id: { type: 'integer', description: 'ID de la catégorie procédure (optionnel)' },
            steps: {
              type: 'array',
              description: 'Tableau complet des étapes. Tu remplaces TOUTES les étapes existantes par ce tableau.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Verbe à l\'impératif + complément, 8 mots max' },
                  content: { type: 'string', description: 'Instructions concrètes à la 2e personne. Peut contenir **gras** et listes avec •. Vide si l\'étape pointe vers une sous-procédure.' },
                  linked_procedure_id: { type: 'integer', description: 'ID d\'une sous-procédure existante à lier (optionnel). À CONSERVER si l\'étape en avait déjà un, sauf demande explicite contraire.' }
                },
                required: ['title']
              }
            }
          }
        }
      }
    })
  }

  if (isInfoWorkflow && canEditInf) {
    tools.push({
      type: 'function',
      function: {
        name: 'update_form',
        description: 'Met à jour le formulaire information visible à l\'écran. Tu peux passer un ou plusieurs champs à la fois. Les champs non passés ne sont pas modifiés.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titre de l\'information (court, factuel, sans verbe)' },
            content: { type: 'string', description: 'Contenu structuré, factuel, scannable. Listes à puces avec •, gras avec **. Pas d\'introduction ni de conclusion.' },
            category_id: { type: 'integer', description: 'ID de la catégorie d\'information' }
          }
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
    case 'search_procedure_steps': {
      const q = `%${args.query}%`
      const r = await db.prepare(`
        SELECT s.id as step_id, s.step_number, s.title as step_title, s.content as step_content,
               s.linked_procedure_id, lp.title as linked_title,
               p.id as procedure_id, p.title as procedure_title
        FROM steps s
        JOIN procedures p ON p.id = s.procedure_id
        LEFT JOIN procedures lp ON lp.id = s.linked_procedure_id
        WHERE p.hotel_id = ? AND (s.title LIKE ? OR s.content LIKE ?)
        ORDER BY p.title, s.step_number LIMIT 30
      `).bind(hotelId, q, q).all()
      return { results: r.results }
    }
    case 'list_info_categories': {
      const cats = await db.prepare(`
        SELECT id, name, color, icon FROM hotel_info_categories
        WHERE hotel_id = ? ORDER BY name
      `).bind(hotelId).all()
      const items = await db.prepare(`
        SELECT id, title, category_id FROM hotel_info_items
        WHERE hotel_id = ? ORDER BY title
      `).bind(hotelId).all()
      const itemsByCat: Record<number, any[]> = {}
      for (const it of (items.results as any[])) {
        if (!itemsByCat[it.category_id]) itemsByCat[it.category_id] = []
        itemsByCat[it.category_id].push({ id: it.id, title: it.title })
      }
      const result = (cats.results as any[]).map(c => ({
        id: c.id, name: c.name, color: c.color, icon: c.icon,
        items: itemsByCat[c.id] || []
      }))
      return { categories: result }
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
  // Filtre optionnel par workflow_mode (create_procedure / update_procedure / create_info / update_info)
  const workflowMode = c.req.query('workflow_mode')
  let query = `
    SELECT id, title, updated_at, created_at, mode, workflow_mode, target_kind, target_id
    FROM wikot_conversations
    WHERE user_id = ? AND is_archived = 0 AND mode = ?
  `
  const params: any[] = [user.id, mode]
  if (workflowMode) {
    query += ` AND workflow_mode = ?`
    params.push(workflowMode)
  }
  query += ` ORDER BY updated_at DESC LIMIT 50`
  const r = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ conversations: r.results })
})

// POST nouvelle conversation (avec mode + workflow_mode + target pour Back Wikot)
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
  // Workflow mode (Back Wikot uniquement) : create_procedure / update_procedure / create_info / update_info
  const allowedWorkflows = ['create_procedure', 'update_procedure', 'create_info', 'update_info']
  const workflowMode = (mode === 'max' && allowedWorkflows.includes(body.workflow_mode)) ? body.workflow_mode : null
  // Normalisation : le frontend peut envoyer 'info' ou 'info_item' → on stocke 'info_item' pour cohérence
  let rawTargetKind = body.target_kind
  if (rawTargetKind === 'info') rawTargetKind = 'info_item'
  const targetKind = (workflowMode && (rawTargetKind === 'procedure' || rawTargetKind === 'info_item')) ? rawTargetKind : null
  const targetId = (workflowMode && body.target_id) ? parseInt(body.target_id) : null

  // Titre par défaut explicite selon le workflow
  let defaultTitle = mode === 'max' ? 'Nouvelle session Back Wikot' : 'Nouvelle conversation'
  if (workflowMode === 'create_procedure') defaultTitle = 'Création procédure'
  else if (workflowMode === 'update_procedure') defaultTitle = 'Modification procédure'
  else if (workflowMode === 'create_info') defaultTitle = 'Création information'
  else if (workflowMode === 'update_info') defaultTitle = 'Modification information'

  const r = await c.env.DB.prepare(`
    INSERT INTO wikot_conversations (hotel_id, user_id, title, mode, workflow_mode, target_kind, target_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(user.hotel_id, user.id, defaultTitle, mode, workflowMode, targetKind, targetId).run()
  return c.json({ id: r.meta.last_row_id, mode, workflow_mode: workflowMode, target_kind: targetKind, target_id: targetId })
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

// DELETE archive une conversation (staff)
app.delete('/api/wikot/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  // Vérifie que la conversation appartient bien au user (staff) et à son hôtel
  const conv = await c.env.DB.prepare(
    'SELECT id, user_id, hotel_id FROM wikot_conversations WHERE id = ?'
  ).bind(id).first<any>()
  if (!conv) return c.json({ error: 'Conversation introuvable' }, 404)
  if (conv.user_id !== user.id) return c.json({ error: 'Accès refusé' }, 403)
  if (conv.hotel_id !== user.hotel_id && user.role !== 'super_admin') {
    return c.json({ error: 'Accès refusé' }, 403)
  }
  await c.env.DB.prepare('UPDATE wikot_conversations SET is_archived = 1 WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// POST envoyer un message → réponse Wikot
app.post('/api/wikot/conversations/:id/message', authMiddleware, async (c) => {
  const user = c.get('user')
  const convId = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const content = body.content
  // Le frontend envoie l'état actuel du formulaire (Back Wikot uniquement) pour que
  // l'IA voie ce que voit l'utilisateur en ce moment et puisse écrire dedans.
  const formContext = body.form_context || null

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

  // Récupérer le workflow_mode de la conversation (Back Wikot uniquement)
  const workflowMode = conv.workflow_mode || null

  // Construire system prompt + tools selon le mode, les permissions et le workflow
  const systemPrompt = await buildWikotSystemPrompt(c.env.DB, user, hotel?.name || 'l\'hôtel', mode, workflowMode, formContext)
  const canEditProc = wikotUserCanEditProcedures(user)
  const canEditInf = wikotUserCanEditInfo(user)
  const tools = buildWikotTools(mode, canEditProc, canEditInf, workflowMode)

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
  // Mises à jour du formulaire (Back Wikot mode max) : on accumule les updates
  // et on les renvoie au frontend pour qu'il applique les changements en direct.
  const formUpdates: any[] = []
  // IDs vus dans les résultats des tools de lecture (filet de sécurité mode standard)
  const seenProcedureIds = new Set<number>()
  const seenInfoItemIds = new Set<number>()
  // Sélection finale du mode standard (Wikot = sélecteur de cartes)
  let selectedAnswer: { type: 'procedure' | 'procedure_step' | 'info_item' | 'info_category' | 'none'; id?: number; procedure_id?: number; step_number?: number } | null = null
  let assistantText = ''
  let lastToolCalls: any[] | null = null
  // Mode max (Back Wikot) : patches de formulaire à appliquer côté UI.
  // Chaque appel à update_form ajoute un patch ; le frontend mergera dans l'ordre.
  const formPatches: any[] = []

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
      if (['search_procedures', 'get_procedure', 'search_hotel_info', 'get_hotel_info_item', 'list_categories', 'search_procedure_steps', 'list_info_categories', 'add_reference'].includes(fnName)) {
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
        const pId = typeof fnArgs.procedure_id === 'number' ? fnArgs.procedure_id : (fnArgs.procedure_id ? parseInt(fnArgs.procedure_id) : undefined)
        const sNum = typeof fnArgs.step_number === 'number' ? fnArgs.step_number : (fnArgs.step_number ? parseInt(fnArgs.step_number) : undefined)
        if (t === 'procedure' && aId) {
          selectedAnswer = { type: 'procedure', id: aId }
        } else if (t === 'procedure_step' && pId && sNum) {
          selectedAnswer = { type: 'procedure_step', procedure_id: pId, step_number: sNum }
        } else if (t === 'info_item' && aId) {
          selectedAnswer = { type: 'info_item', id: aId }
        } else if (t === 'info_category' && aId) {
          selectedAnswer = { type: 'info_category', id: aId }
        } else {
          selectedAnswer = { type: 'none' }
        }
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: true }) })
        stopAfterThisIter = true
      }
      // === MODE MAX (Back Wikot) : update_form === l'IA écrit dans le formulaire UI
      else if (fnName === 'update_form') {
        // Filtrer les champs autorisés selon le workflow (sécurité serveur)
        const allowed = workflowMode === 'create_procedure' || workflowMode === 'update_procedure'
          ? ['title', 'trigger_event', 'description', 'category_id', 'steps']
          : workflowMode === 'create_info' || workflowMode === 'update_info'
            ? ['title', 'content', 'category_id']
            : []
        const cleanPatch: any = {}
        for (const k of allowed) {
          if (fnArgs[k] !== undefined) cleanPatch[k] = fnArgs[k]
        }
        if (Object.keys(cleanPatch).length > 0) {
          formPatches.push(cleanPatch)
        }
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: true, applied_fields: Object.keys(cleanPatch) }) })
      }
      // Tools de proposition (legacy mode max, plus utilisé en workflow mais conservé pour compat)
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
    } else if (selectedAnswer.type === 'procedure_step' && selectedAnswer.procedure_id && selectedAnswer.step_number) {
      // Carte d'UNE étape précise d'une procédure (ex: « comment vérifier la réservation »)
      const p = await c.env.DB.prepare(`
        SELECT p.id, p.title, p.trigger_event,
               c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM procedures p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.id = ? AND p.hotel_id = ?
      `).bind(selectedAnswer.procedure_id, user.hotel_id).first() as any
      const stepRow = await c.env.DB.prepare(`
        SELECT s.id, s.step_number, s.title, s.content, s.linked_procedure_id, lp.title as linked_title
        FROM steps s
        LEFT JOIN procedures lp ON lp.id = s.linked_procedure_id
        WHERE s.procedure_id = ? AND s.step_number = ?
      `).bind(selectedAnswer.procedure_id, selectedAnswer.step_number).first() as any
      if (p && stepRow) {
        let linkedSteps: any[] = []
        let linkedTrigger: string | null = null
        let linkedDescription: string | null = null
        if (stepRow.linked_procedure_id) {
          const lp = await c.env.DB.prepare('SELECT trigger_event, description FROM procedures WHERE id = ?')
            .bind(stepRow.linked_procedure_id).first() as any
          linkedTrigger = lp?.trigger_event || null
          linkedDescription = lp?.description || null
          const subRes = await c.env.DB.prepare(`
            SELECT step_number, title, content FROM steps
            WHERE procedure_id = ? ORDER BY step_number
          `).bind(stepRow.linked_procedure_id).all()
          linkedSteps = subRes.results as any[]
        }
        answerCard = {
          kind: 'procedure_step',
          parent_id: p.id, parent_title: p.title, parent_trigger_event: p.trigger_event,
          category_name: p.category_name, category_color: p.category_color, category_icon: p.category_icon,
          step: {
            id: stepRow.id, step_number: stepRow.step_number, title: stepRow.title, content: stepRow.content,
            linked_procedure_id: stepRow.linked_procedure_id, linked_title: stepRow.linked_title,
            linked_trigger_event: linkedTrigger, linked_description: linkedDescription,
            linked_steps: linkedSteps
          }
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
    } else if (selectedAnswer.type === 'info_category' && selectedAnswer.id) {
      // Carte qui regroupe TOUTES les infos d'une catégorie (ex: « les loisirs et activités »)
      const cat = await c.env.DB.prepare(`
        SELECT id, name, color, icon FROM hotel_info_categories
        WHERE id = ? AND hotel_id = ?
      `).bind(selectedAnswer.id, user.hotel_id).first() as any
      if (cat) {
        const itemsRes = await c.env.DB.prepare(`
          SELECT id, title, content FROM hotel_info_items
          WHERE category_id = ? AND hotel_id = ? ORDER BY title
        `).bind(cat.id, user.hotel_id).all()
        const items = (itemsRes.results as any[]).map(it => ({
          id: it.id, title: it.title, content: it.content
        }))
        answerCard = {
          kind: 'info_category',
          id: cat.id, name: cat.name, color: cat.color, icon: cat.icon,
          item_count: items.length, items
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
    actions: createdActions,
    // Mises à jour du formulaire envoyées par l'IA via update_form (Back Wikot uniquement).
    // Le frontend applique ces patches sur le formulaire visible à l'utilisateur.
    // On expose sous deux noms pour compat (form_patches historique + form_updates utilisé par le nouveau front).
    form_patches: formPatches,
    form_updates: formPatches
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
// HOTELS — extension : code client + capacités resto
// ============================================
// Liste blanche des champs settings éditables
const HOTEL_SETTINGS_FIELDS: Record<string, 'text' | 'int' | 'code' | 'time' | 'color'> = {
  // Identité
  name: 'text',
  description: 'text',
  brand_color: 'color',
  currency: 'text',
  timezone: 'text',
  language: 'text',
  logo_url: 'text',
  // Contact
  address: 'text',
  phone: 'text',
  email: 'text',
  website: 'text',
  instagram_url: 'text',
  facebook_url: 'text',
  tripadvisor_url: 'text',
  booking_url: 'text',
  // Séjour
  checkin_time: 'time',
  checkout_time: 'time',
  cancellation_policy: 'text',
  welcome_message: 'text',
  client_login_code: 'code',
  breakfast_capacity: 'int',
  lunch_capacity: 'int',
  dinner_capacity: 'int',
  // Wifi
  wifi_ssid: 'text',
  wifi_password: 'text',
  wifi_instructions: 'text',
}

app.get('/api/hotels/:id/settings', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  if (!isSuperAdmin(user) && user.hotel_id !== id) return c.json({ error: 'Non autorisé' }, 403)
  const cols = ['id', 'name', 'slug', ...Object.keys(HOTEL_SETTINGS_FIELDS).filter(k => k !== 'name')]
  const sql = `SELECT ${cols.join(', ')} FROM hotels WHERE id = ?`
  const hotel = await c.env.DB.prepare(sql).bind(id).first()
  if (!hotel) return c.json({ error: 'Hôtel non trouvé' }, 404)
  return c.json({ hotel })
})

app.put('/api/hotels/:id/settings', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  // Super admin OU (admin/employé du même hôtel avec can_edit_settings)
  if (!isSuperAdmin(user)) {
    if (user.hotel_id !== id) return c.json({ error: 'Non autorisé' }, 403)
    if (!canEditSettings(user)) return c.json({ error: 'Non autorisé — permission paramètres requise' }, 403)
  }
  const body = await c.req.json() as Record<string, any>

  const fields: string[] = []
  const values: any[] = []

  for (const [key, kind] of Object.entries(HOTEL_SETTINGS_FIELDS)) {
    if (body[key] === undefined) continue
    let v = body[key]

    if (kind === 'code') {
      const code = String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (code.length < 3 || code.length > 16) return c.json({ error: 'Le code hôtel doit faire entre 3 et 16 caractères alphanumériques' }, 400)
      const existing = await c.env.DB.prepare('SELECT id FROM hotels WHERE client_login_code = ? AND id != ?').bind(code, id).first()
      if (existing) return c.json({ error: 'Ce code est déjà utilisé par un autre hôtel' }, 400)
      v = code
    } else if (kind === 'int') {
      v = parseInt(String(v)) || 0
    } else if (kind === 'time') {
      const s = String(v || '').trim()
      if (s && !/^\d{2}:\d{2}$/.test(s)) return c.json({ error: `Heure invalide pour ${key} (HH:MM)` }, 400)
      v = s || null
    } else if (kind === 'color') {
      const s = String(v || '').trim()
      if (s && !/^#[0-9a-fA-F]{6}$/.test(s)) return c.json({ error: `Couleur invalide (format #RRGGBB)` }, 400)
      v = s || null
    } else {
      const s = String(v ?? '')
      v = s.trim() === '' ? null : s.trim()
    }

    fields.push(`${key} = ?`)
    values.push(v)
  }

  if (fields.length === 0) return c.json({ error: 'Aucune modification' }, 400)
  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)
  await c.env.DB.prepare(`UPDATE hotels SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// ============================================
// ROOMS ROUTES — chambres de l'hôtel
// ============================================
// Chaque chambre crée automatiquement un client_account associé (inactif tant
// qu'aucun client n'est saisi). Le nombre de comptes clients = nombre de chambres.
app.get('/api/rooms', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = c.req.query('hotel_id') || user.hotel_id
  const rooms = await c.env.DB.prepare(`
    SELECT r.*,
      ca.id as client_account_id,
      ca.guest_name as current_guest,
      ca.checkout_date,
      ca.is_active as client_active,
      ca.last_login as client_last_login
    FROM rooms r
    LEFT JOIN client_accounts ca ON ca.room_id = r.id
    WHERE r.hotel_id = ?
    ORDER BY r.sort_order, r.room_number
  `).bind(hotelId).all()
  return c.json({ rooms: rooms.results })
})

app.post('/api/rooms', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json() as { room_number: string; floor?: string; capacity?: number; sort_order?: number }
  if (!body.room_number || !String(body.room_number).trim()) return c.json({ error: 'Numéro de chambre obligatoire' }, 400)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO rooms (hotel_id, room_number, floor, capacity, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).bind(hotelId, String(body.room_number).trim(), body.floor || null, body.capacity || 2, body.sort_order || 0).run()
    const roomId = result.meta.last_row_id

    // Création automatique du compte client associé (inactif au départ)
    await c.env.DB.prepare(`
      INSERT INTO client_accounts (hotel_id, room_id, is_active) VALUES (?, ?, 0)
    `).bind(hotelId, roomId).run()

    return c.json({ id: roomId, room_number: body.room_number })
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return c.json({ error: 'Ce numéro de chambre existe déjà' }, 400)
    return c.json({ error: e?.message || 'Erreur serveur' }, 500)
  }
})

// Création en masse de chambres (import textarea OU seed initial)
// body: { rooms: [{ room_number, floor?, capacity?, sort_order? }, ...] }
// Skip silencieusement les chambres dont le numéro existe déjà (idempotent).
app.post('/api/rooms/bulk', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)
  const body = await c.req.json() as { rooms: Array<{ room_number: string; floor?: string; capacity?: number; sort_order?: number }> }
  if (!Array.isArray(body.rooms) || body.rooms.length === 0) return c.json({ error: 'Liste vide' }, 400)
  if (body.rooms.length > 500) return c.json({ error: 'Maximum 500 chambres par lot' }, 400)

  // Charge les numéros existants pour skip
  const existing = await c.env.DB.prepare('SELECT room_number FROM rooms WHERE hotel_id = ?').bind(hotelId).all()
  const existingSet = new Set((existing.results as any[]).map(r => String(r.room_number).trim()))

  let created = 0
  let skipped = 0
  const errors: string[] = []

  for (const r of body.rooms) {
    const num = String(r.room_number || '').trim()
    if (!num) { skipped++; continue }
    if (existingSet.has(num)) { skipped++; continue }

    try {
      const result = await c.env.DB.prepare(`
        INSERT INTO rooms (hotel_id, room_number, floor, capacity, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(
        hotelId,
        num,
        r.floor ? String(r.floor).trim() : null,
        parseInt(String(r.capacity)) || 2,
        parseInt(String(r.sort_order)) || 0
      ).run()
      const roomId = result.meta.last_row_id
      await c.env.DB.prepare(`INSERT INTO client_accounts (hotel_id, room_id, is_active) VALUES (?, ?, 0)`).bind(hotelId, roomId).run()
      existingSet.add(num)
      created++
    } catch (e: any) {
      errors.push(`${num}: ${e?.message || 'erreur'}`)
    }
  }

  return c.json({ success: true, created, skipped, errors })
})

app.put('/api/rooms/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json() as { room_number?: string; floor?: string; capacity?: number; is_active?: boolean | number; sort_order?: number }

  const room = await c.env.DB.prepare('SELECT id, hotel_id FROM rooms WHERE id = ?').bind(id).first() as any
  if (!room) return c.json({ error: 'Chambre non trouvée' }, 404)
  if (user.role !== 'super_admin' && room.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  const fields: string[] = []
  const values: any[] = []
  if (body.room_number !== undefined) { fields.push('room_number = ?'); values.push(String(body.room_number).trim()) }
  if (body.floor !== undefined) { fields.push('floor = ?'); values.push(body.floor || null) }
  if (body.capacity !== undefined) { fields.push('capacity = ?'); values.push(parseInt(String(body.capacity)) || 2) }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active ? 1 : 0) }
  if (body.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(parseInt(String(body.sort_order)) || 0) }
  if (fields.length === 0) return c.json({ error: 'Aucune modification' }, 400)
  fields.push("updated_at = CURRENT_TIMESTAMP")
  values.push(id)
  try {
    await c.env.DB.prepare(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return c.json({ error: 'Ce numéro de chambre existe déjà' }, 400)
    return c.json({ error: e?.message || 'Erreur serveur' }, 500)
  }
})

app.delete('/api/rooms/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const room = await c.env.DB.prepare('SELECT id, hotel_id FROM rooms WHERE id = ?').bind(id).first() as any
  if (!room) return c.json({ error: 'Chambre non trouvée' }, 404)
  if (user.role !== 'super_admin' && room.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  // Cascade : on supprime les sessions, comptes et historiques liés
  await c.env.DB.prepare('DELETE FROM client_sessions WHERE room_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM client_accounts WHERE room_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ============================================
// OCCUPANCY ROUTES — saisie quotidienne des clients (rotation 12h00)
// ============================================
// Vue d'ensemble du jour : pour chaque chambre, afficher si occupée ou libre,
// + nom du client courant + date de checkout.
app.get('/api/occupancy/today', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const todayStr = new Date().toISOString().slice(0, 10)
  const rooms = await c.env.DB.prepare(`
    SELECT r.id as room_id, r.room_number, r.floor, r.capacity,
      ca.id as account_id, ca.guest_name, ca.checkout_date, ca.is_active, ca.last_login
    FROM rooms r
    LEFT JOIN client_accounts ca ON ca.room_id = r.id
    WHERE r.hotel_id = ? AND r.is_active = 1
    ORDER BY r.sort_order, r.room_number
  `).bind(hotelId).all()

  const hotel = await c.env.DB.prepare('SELECT id, name, client_login_code FROM hotels WHERE id = ?').bind(hotelId).first()
  return c.json({ today: todayStr, hotel, rooms: rooms.results })
})

// Saisie groupée du jour (12h00, par admin ou employé autorisé).
// Body : { entries: [{room_id, guest_name, checkout_date, action?: 'set'|'clear'}] }
// - action='set' (défaut si guest_name présent) : enregistre le nom = MdP du jour
// - action='clear' : marque la chambre comme libre (compte désactivé)
app.post('/api/occupancy/day', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const body = await c.req.json() as { entries: Array<{ room_id: number; guest_name?: string; checkout_date?: string; action?: string }> }
  if (!Array.isArray(body.entries)) return c.json({ error: 'Format invalide' }, 400)

  const todayStr = new Date().toISOString().slice(0, 10)
  const results: any[] = []

  for (const entry of body.entries) {
    const room = await c.env.DB.prepare('SELECT id, hotel_id FROM rooms WHERE id = ?').bind(entry.room_id).first() as any
    if (!room || room.hotel_id !== hotelId) {
      results.push({ room_id: entry.room_id, ok: false, error: 'Chambre invalide' })
      continue
    }

    if (entry.action === 'clear' || (!entry.guest_name && entry.action !== 'set')) {
      // Libération : on désactive le compte (toutes les sessions tombent)
      await c.env.DB.prepare(`
        UPDATE client_accounts
        SET guest_name = NULL, guest_name_normalized = NULL, checkout_date = NULL,
            is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE hotel_id = ? AND room_id = ?
      `).bind(hotelId, entry.room_id).run()
      await c.env.DB.prepare('DELETE FROM client_sessions WHERE client_account_id IN (SELECT id FROM client_accounts WHERE hotel_id = ? AND room_id = ?)').bind(hotelId, entry.room_id).run()
      results.push({ room_id: entry.room_id, ok: true, status: 'cleared' })
      continue
    }

    const guestName = String(entry.guest_name || '').trim()
    if (!guestName) {
      results.push({ room_id: entry.room_id, ok: false, error: 'Nom manquant' })
      continue
    }
    const normalized = normalizeName(guestName)
    const checkoutDate = entry.checkout_date || todayStr  // défaut : aujourd'hui (1 nuit)

    // Mise à jour du compte client (1 par chambre, déjà créé à la création de la chambre)
    await c.env.DB.prepare(`
      UPDATE client_accounts
      SET guest_name = ?, guest_name_normalized = ?, checkout_date = ?, is_active = 1,
          session_valid_until = ?, updated_at = CURRENT_TIMESTAMP
      WHERE hotel_id = ? AND room_id = ?
    `).bind(guestName, normalized, checkoutDate, checkoutDate + ' 12:00:00', hotelId, entry.room_id).run()

    // Tuer les sessions précédentes (changement de client = nouveau MdP)
    await c.env.DB.prepare('DELETE FROM client_sessions WHERE client_account_id IN (SELECT id FROM client_accounts WHERE hotel_id = ? AND room_id = ?)').bind(hotelId, entry.room_id).run()

    // Journal d'occupation
    await c.env.DB.prepare(`
      INSERT INTO room_occupancy (hotel_id, room_id, occupancy_date, guest_name, guest_name_normalized, checkout_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(hotelId, entry.room_id, todayStr, guestName, normalized, checkoutDate, user.id).run()

    results.push({ room_id: entry.room_id, ok: true, status: 'set', guest_name: guestName })
  }

  return c.json({ success: true, results })
})

// Régénérer / réinitialiser une chambre individuellement
app.post('/api/occupancy/room/:room_id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const roomId = parseInt(c.req.param('room_id'))
  const body = await c.req.json() as { guest_name?: string; checkout_date?: string; action?: string }
  // Réutilise la logique groupée
  const fakeReq = { room_id: roomId, guest_name: body.guest_name, checkout_date: body.checkout_date, action: body.action }
  // Inline pour simplicité
  const room = await c.env.DB.prepare('SELECT id, hotel_id FROM rooms WHERE id = ?').bind(roomId).first() as any
  if (!room || room.hotel_id !== user.hotel_id) return c.json({ error: 'Chambre invalide' }, 404)

  if (fakeReq.action === 'clear' || !fakeReq.guest_name) {
    await c.env.DB.prepare(`
      UPDATE client_accounts SET guest_name = NULL, guest_name_normalized = NULL, checkout_date = NULL, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE hotel_id = ? AND room_id = ?
    `).bind(user.hotel_id, roomId).run()
    await c.env.DB.prepare('DELETE FROM client_sessions WHERE client_account_id IN (SELECT id FROM client_accounts WHERE hotel_id = ? AND room_id = ?)').bind(user.hotel_id, roomId).run()
    return c.json({ success: true, status: 'cleared' })
  }

  const guestName = String(fakeReq.guest_name || '').trim()
  const normalized = normalizeName(guestName)
  const todayStr = new Date().toISOString().slice(0, 10)
  const checkoutDate = fakeReq.checkout_date || todayStr

  await c.env.DB.prepare(`
    UPDATE client_accounts SET guest_name = ?, guest_name_normalized = ?, checkout_date = ?, is_active = 1, session_valid_until = ?, updated_at = CURRENT_TIMESTAMP WHERE hotel_id = ? AND room_id = ?
  `).bind(guestName, normalized, checkoutDate, checkoutDate + ' 12:00:00', user.hotel_id, roomId).run()
  await c.env.DB.prepare('DELETE FROM client_sessions WHERE client_account_id IN (SELECT id FROM client_accounts WHERE hotel_id = ? AND room_id = ?)').bind(user.hotel_id, roomId).run()
  await c.env.DB.prepare(`
    INSERT INTO room_occupancy (hotel_id, room_id, occupancy_date, guest_name, guest_name_normalized, checkout_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(user.hotel_id, roomId, todayStr, guestName, normalized, checkoutDate, user.id).run()
  return c.json({ success: true, status: 'set' })
})

// Données pour les fiches plastifiées (1 par chambre active occupée)
// Renvoie chambre + code hôtel + nom client courant. Le HTML imprimable
// est généré côté front (template print).
app.get('/api/occupancy/print-cards', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const hotel = await c.env.DB.prepare('SELECT id, name, client_login_code FROM hotels WHERE id = ?').bind(hotelId).first() as any
  const rooms = await c.env.DB.prepare(`
    SELECT r.id as room_id, r.room_number, ca.guest_name, ca.checkout_date, ca.is_active
    FROM rooms r
    LEFT JOIN client_accounts ca ON ca.room_id = r.id
    WHERE r.hotel_id = ? AND r.is_active = 1
    ORDER BY r.sort_order, r.room_number
  `).bind(hotelId).all()
  return c.json({ hotel, rooms: rooms.results })
})

// ============================================
// RESTAURANT ROUTES — planning + exceptions + réservations
// ============================================
app.get('/api/restaurant/schedule', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = user.hotel_id
  const schedule = await c.env.DB.prepare(`
    SELECT id, weekday, meal_type, is_open, open_time, close_time, capacity
    FROM restaurant_schedule WHERE hotel_id = ?
    ORDER BY weekday, CASE meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 ELSE 3 END
  `).bind(hotelId).all()
  return c.json({ schedule: schedule.results })
})

app.put('/api/restaurant/schedule/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json() as { is_open?: boolean | number; open_time?: string; close_time?: string; capacity?: number }
  const row = await c.env.DB.prepare('SELECT hotel_id FROM restaurant_schedule WHERE id = ?').bind(id).first() as any
  if (!row || row.hotel_id !== user.hotel_id) return c.json({ error: 'Non trouvé' }, 404)
  const fields: string[] = []
  const values: any[] = []
  if (body.is_open !== undefined)   { fields.push('is_open = ?');   values.push(body.is_open ? 1 : 0) }
  if (body.open_time !== undefined) { fields.push('open_time = ?'); values.push(body.open_time || null) }
  if (body.close_time !== undefined){ fields.push('close_time = ?');values.push(body.close_time || null) }
  if (body.capacity !== undefined)  { fields.push('capacity = ?');  values.push(parseInt(String(body.capacity)) || 0) }
  if (fields.length === 0) return c.json({ error: 'Aucune modification' }, 400)
  fields.push("updated_at = CURRENT_TIMESTAMP")
  values.push(id)
  await c.env.DB.prepare(`UPDATE restaurant_schedule SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// ============================================
// RESTAURANT WEEK TEMPLATES — CRUD + apply
// ============================================
// Liste les templates d'un hôtel
app.get('/api/restaurant/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const rows = await c.env.DB.prepare(`
    SELECT id, name, description, is_default, days_json, created_at, updated_at
    FROM restaurant_week_templates WHERE hotel_id = ? ORDER BY is_default DESC, name
  `).bind(user.hotel_id).all()
  // Parser days_json côté serveur pour simplifier le client
  const templates = (rows.results || []).map((t: any) => ({
    ...t,
    days: (() => { try { return JSON.parse(t.days_json) } catch { return [] } })()
  }))
  return c.json({ templates })
})

// Créer un template
app.post('/api/restaurant/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json() as { name: string; description?: string; days: any[] }
  if (!body.name || !Array.isArray(body.days) || body.days.length !== 7) {
    return c.json({ error: 'Nom et 7 jours requis' }, 400)
  }
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO restaurant_week_templates (hotel_id, name, description, is_default, days_json, created_by)
      VALUES (?, ?, ?, 0, ?, ?)
    `).bind(user.hotel_id, body.name.trim(), body.description || null, JSON.stringify(body.days), user.id).run()
    return c.json({ id: result.meta.last_row_id })
  } catch (e: any) {
    return c.json({ error: e?.message || 'Erreur serveur' }, 500)
  }
})

// Mettre à jour un template (nom, description, jours)
app.put('/api/restaurant/templates/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json() as { name?: string; description?: string; days?: any[] }
  const row = await c.env.DB.prepare('SELECT hotel_id FROM restaurant_week_templates WHERE id = ?').bind(id).first() as any
  if (!row || row.hotel_id !== user.hotel_id) return c.json({ error: 'Non trouvé' }, 404)
  const fields: string[] = []
  const values: any[] = []
  if (body.name !== undefined)        { fields.push('name = ?');        values.push(String(body.name).trim()) }
  if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description || null) }
  if (body.days !== undefined && Array.isArray(body.days)) {
    if (body.days.length !== 7) return c.json({ error: '7 jours requis' }, 400)
    fields.push('days_json = ?'); values.push(JSON.stringify(body.days))
  }
  if (fields.length === 0) return c.json({ error: 'Aucune modification' }, 400)
  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)
  await c.env.DB.prepare(`UPDATE restaurant_week_templates SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// Supprimer un template
app.delete('/api/restaurant/templates/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT hotel_id, is_default FROM restaurant_week_templates WHERE id = ?').bind(id).first() as any
  if (!row || row.hotel_id !== user.hotel_id) return c.json({ error: 'Non trouvé' }, 404)
  if (row.is_default === 1) return c.json({ error: 'Impossible de supprimer le template par défaut' }, 400)
  await c.env.DB.prepare('DELETE FROM restaurant_week_templates WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// Appliquer un template au planning hebdo (UPSERT sur restaurant_schedule)
app.post('/api/restaurant/templates/:id/apply', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const tpl = await c.env.DB.prepare('SELECT hotel_id, days_json FROM restaurant_week_templates WHERE id = ?').bind(id).first() as any
  if (!tpl || tpl.hotel_id !== user.hotel_id) return c.json({ error: 'Non trouvé' }, 404)
  let days: any[]
  try { days = JSON.parse(tpl.days_json) } catch { return c.json({ error: 'Template invalide' }, 400) }

  // Helper : extrait la liste {meal_type, is_open, open_time, close_time, capacity} d'un jour.
  // Supporte 2 formats JSON :
  //   - format A : { weekday, breakfast: {...}, lunch: {...}, dinner: {...} }
  //   - format B : { weekday, meals: [{ meal_type, ... }, ...] }
  const extractMeals = (d: any): any[] => {
    if (Array.isArray(d.meals)) return d.meals
    const out: any[] = []
    for (const k of ['breakfast', 'lunch', 'dinner']) {
      if (d[k] && typeof d[k] === 'object') out.push({ meal_type: k, ...d[k] })
    }
    return out
  }

  let updated = 0
  let inserted = 0
  for (const d of days) {
    const weekday = parseInt(d.weekday)
    if (isNaN(weekday) || weekday < 0 || weekday > 6) continue
    for (const m of extractMeals(d)) {
      if (!['breakfast', 'lunch', 'dinner'].includes(m.meal_type)) continue
      // Vérifier si une ligne existe déjà
      const existing = await c.env.DB.prepare(
        'SELECT id FROM restaurant_schedule WHERE hotel_id = ? AND weekday = ? AND meal_type = ?'
      ).bind(user.hotel_id, weekday, m.meal_type).first() as any
      if (existing) {
        await c.env.DB.prepare(`
          UPDATE restaurant_schedule SET is_open = ?, open_time = ?, close_time = ?, capacity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(m.is_open ? 1 : 0, m.open_time || null, m.close_time || null, parseInt(m.capacity) || 0, existing.id).run()
        updated++
      } else {
        await c.env.DB.prepare(`
          INSERT INTO restaurant_schedule (hotel_id, weekday, meal_type, is_open, open_time, close_time, capacity)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(user.hotel_id, weekday, m.meal_type, m.is_open ? 1 : 0, m.open_time || null, m.close_time || null, parseInt(m.capacity) || 0).run()
        inserted++
      }
    }
  }
  return c.json({ success: true, updated, inserted })
})

app.get('/api/restaurant/exceptions', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const from = c.req.query('from') || new Date().toISOString().slice(0, 10)
  const exceptions = await c.env.DB.prepare(`
    SELECT id, exception_date, meal_type, is_open, open_time, close_time, capacity, notes
    FROM restaurant_exceptions WHERE hotel_id = ? AND exception_date >= ?
    ORDER BY exception_date, meal_type
  `).bind(user.hotel_id, from).all()
  return c.json({ exceptions: exceptions.results })
})

app.post('/api/restaurant/exceptions', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json() as { exception_date: string; meal_type: string; is_open: boolean; open_time?: string; close_time?: string; capacity?: number; notes?: string }
  if (!body.exception_date || !body.meal_type) return c.json({ error: 'Champs manquants' }, 400)
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO restaurant_exceptions (hotel_id, exception_date, meal_type, is_open, open_time, close_time, capacity, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(user.hotel_id, body.exception_date, body.meal_type, body.is_open ? 1 : 0, body.open_time || null, body.close_time || null, body.capacity || null, body.notes || null, user.id).run()
    return c.json({ id: result.meta.last_row_id })
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return c.json({ error: 'Une exception existe déjà pour cette date et ce repas' }, 400)
    return c.json({ error: e?.message || 'Erreur serveur' }, 500)
  }
})

app.delete('/api/restaurant/exceptions/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT hotel_id FROM restaurant_exceptions WHERE id = ?').bind(id).first() as any
  if (!row || row.hotel_id !== user.hotel_id) return c.json({ error: 'Non trouvé' }, 404)
  await c.env.DB.prepare('DELETE FROM restaurant_exceptions WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// Helper : pour un hôtel + une date + un repas, retourne {is_open, capacity, current_count, slots_left}
async function getMealAvailability(db: D1Database, hotelId: number, date: string, mealType: string) {
  const d = new Date(date + 'T00:00:00')
  const weekday = d.getUTCDay()
  // Exception prioritaire
  const exception = await db.prepare(`
    SELECT is_open, open_time, close_time, capacity FROM restaurant_exceptions
    WHERE hotel_id = ? AND exception_date = ? AND meal_type = ?
  `).bind(hotelId, date, mealType).first() as any
  let baseConfig: any
  if (exception) {
    baseConfig = exception
  } else {
    baseConfig = await db.prepare(`
      SELECT is_open, open_time, close_time, capacity FROM restaurant_schedule
      WHERE hotel_id = ? AND weekday = ? AND meal_type = ?
    `).bind(hotelId, weekday, mealType).first()
  }
  if (!baseConfig) return { is_open: false, capacity: 0, current_count: 0, slots_left: 0, open_time: null, close_time: null }

  // Réservations existantes confirmées
  const counter = await db.prepare(`
    SELECT COALESCE(SUM(guest_count), 0) as total FROM restaurant_reservations
    WHERE hotel_id = ? AND reservation_date = ? AND meal_type = ? AND status = 'confirmed'
  `).bind(hotelId, date, mealType).first() as any
  const current = parseInt(counter?.total || 0)

  return {
    is_open: baseConfig.is_open === 1,
    capacity: baseConfig.capacity || 0,
    current_count: current,
    slots_left: Math.max(0, (baseConfig.capacity || 0) - current),
    open_time: baseConfig.open_time,
    close_time: baseConfig.close_time
  }
}

// Disponibilité globale sur une date (les 3 repas)
app.get('/api/restaurant/availability', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const meals = ['breakfast', 'lunch', 'dinner']
  const out: any = { date }
  for (const m of meals) {
    out[m] = await getMealAvailability(c.env.DB, user.hotel_id!, date, m)
  }
  return c.json(out)
})

// Liste des réservations (admin/staff)
app.get('/api/restaurant/reservations', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const from = c.req.query('from') || new Date().toISOString().slice(0, 10)
  const to = c.req.query('to') || from
  const meal = c.req.query('meal')

  let query = `
    SELECT rr.*,
      r.room_number,
      u.name as created_by_user_name,
      ca.guest_name as client_guest_name
    FROM restaurant_reservations rr
    LEFT JOIN rooms r ON rr.room_id = r.id
    LEFT JOIN users u ON rr.created_by_user_id = u.id
    LEFT JOIN client_accounts ca ON rr.created_by_client_id = ca.id
    WHERE rr.hotel_id = ? AND rr.reservation_date BETWEEN ? AND ? AND rr.status = 'confirmed'
  `
  const params: any[] = [user.hotel_id, from, to]
  if (meal) { query += ' AND rr.meal_type = ?'; params.push(meal) }
  query += ' ORDER BY rr.reservation_date, rr.meal_type, rr.time_slot'

  const reservations = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ reservations: reservations.results })
})

// Création staff d'une réservation (pour un client externe ou interne)
app.post('/api/restaurant/reservations', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json() as { room_id?: number; reservation_date: string; meal_type: string; time_slot?: string; guest_count: number; guest_name?: string; notes?: string }
  if (!body.reservation_date || !body.meal_type || !body.guest_count) return c.json({ error: 'Champs manquants' }, 400)

  const avail = await getMealAvailability(c.env.DB, user.hotel_id!, body.reservation_date, body.meal_type)
  if (!avail.is_open) return c.json({ error: 'Le service est fermé ce jour-là' }, 400)
  if (avail.slots_left < body.guest_count) return c.json({ error: `Plus que ${avail.slots_left} place(s) disponible(s)` }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO restaurant_reservations (hotel_id, room_id, reservation_date, meal_type, time_slot, guest_count, guest_name, notes, status, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).bind(user.hotel_id, body.room_id || null, body.reservation_date, body.meal_type, body.time_slot || null, body.guest_count, body.guest_name || null, body.notes || null, user.id).run()
  return c.json({ id: result.meta.last_row_id })
})

app.delete('/api/restaurant/reservations/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT hotel_id FROM restaurant_reservations WHERE id = ?').bind(id).first() as any
  if (!row || row.hotel_id !== user.hotel_id) return c.json({ error: 'Non trouvée' }, 404)
  await c.env.DB.prepare(`UPDATE restaurant_reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// Tableau de bord agrégé : stats par jour × repas pour visualisation
app.get('/api/restaurant/dashboard', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const from = c.req.query('from') || new Date().toISOString().slice(0, 10)
  const toDefault = new Date()
  toDefault.setUTCDate(toDefault.getUTCDate() + 13)
  const to = c.req.query('to') || toDefault.toISOString().slice(0, 10)

  const stats = await c.env.DB.prepare(`
    SELECT reservation_date, meal_type,
           COUNT(*) as bookings,
           COALESCE(SUM(guest_count), 0) as total_guests
    FROM restaurant_reservations
    WHERE hotel_id = ? AND reservation_date BETWEEN ? AND ? AND status = 'confirmed'
    GROUP BY reservation_date, meal_type
    ORDER BY reservation_date, meal_type
  `).bind(user.hotel_id, from, to).all()

  // Capacité prévue par jour × repas (en tenant compte des exceptions)
  const days: string[] = []
  const dStart = new Date(from + 'T00:00:00Z')
  const dEnd = new Date(to + 'T00:00:00Z')
  for (let d = new Date(dStart); d <= dEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  const meals = ['breakfast', 'lunch', 'dinner']
  const capacityMap: Record<string, number> = {}
  for (const day of days) {
    for (const m of meals) {
      const a = await getMealAvailability(c.env.DB, user.hotel_id!, day, m)
      capacityMap[`${day}|${m}`] = a.is_open ? a.capacity : 0
    }
  }

  return c.json({ from, to, stats: stats.results, capacityMap })
})

// ============================================
// CLIENT ROUTES — Front Wikot (chambre client)
// ============================================
// Hotel info accessible au client (lecture seule, items publiés uniquement)
app.get('/api/client/hotel-info', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const categories = await c.env.DB.prepare(`
    SELECT id, name, icon, color FROM hotel_info_categories WHERE hotel_id = ? ORDER BY sort_order, name
  `).bind(client.hotel_id).all()
  const items = await c.env.DB.prepare(`
    SELECT id, category_id, title, content FROM hotel_info_items WHERE hotel_id = ? ORDER BY sort_order, title
  `).bind(client.hotel_id).all()
  return c.json({ categories: categories.results, items: items.results })
})

// Disponibilité resto (côté client) — même logique que côté staff
app.get('/api/client/restaurant/availability', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const meals = ['breakfast', 'lunch', 'dinner']
  const out: any = { date }
  for (const m of meals) {
    out[m] = await getMealAvailability(c.env.DB, client.hotel_id, date, m)
  }
  return c.json(out)
})

// Mes réservations (du client connecté)
app.get('/api/client/restaurant/reservations', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const reservations = await c.env.DB.prepare(`
    SELECT id, reservation_date, meal_type, time_slot, guest_count, guest_name, notes, status, created_at
    FROM restaurant_reservations
    WHERE created_by_client_id = ? AND status = 'confirmed'
      AND reservation_date >= date('now', '-1 day')
    ORDER BY reservation_date, meal_type
  `).bind(client.id).all()
  return c.json({ reservations: reservations.results })
})

// Création réservation client
app.post('/api/client/restaurant/reservations', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const body = await c.req.json() as { reservation_date: string; meal_type: string; time_slot?: string; guest_count: number; notes?: string }
  if (!body.reservation_date || !body.meal_type || !body.guest_count) return c.json({ error: 'Champs manquants' }, 400)
  if (body.guest_count < 1 || body.guest_count > 20) return c.json({ error: 'Nombre de personnes invalide (1 à 20)' }, 400)

  const avail = await getMealAvailability(c.env.DB, client.hotel_id, body.reservation_date, body.meal_type)
  if (!avail.is_open) return c.json({ error: 'Le service est fermé ce jour-là' }, 400)
  if (avail.slots_left < body.guest_count) return c.json({ error: `Plus que ${avail.slots_left} place(s) disponible(s)` }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO restaurant_reservations (hotel_id, room_id, reservation_date, meal_type, time_slot, guest_count, guest_name, notes, status, created_by_client_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).bind(client.hotel_id, client.room_id, body.reservation_date, body.meal_type, body.time_slot || null, body.guest_count, client.guest_name, body.notes || null, client.id).run()
  return c.json({ id: result.meta.last_row_id })
})

// Annulation client
app.delete('/api/client/restaurant/reservations/:id', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id, created_by_client_id FROM restaurant_reservations WHERE id = ?').bind(id).first() as any
  if (!row || row.created_by_client_id !== client.id) return c.json({ error: 'Non autorisée' }, 403)
  await c.env.DB.prepare(`UPDATE restaurant_reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// ============================================
// FRONT WIKOT — chat IA pour le client (mode 'concierge')
// ============================================
// Le client peut poser des questions sur l'hôtel, l'IA répond UNIQUEMENT depuis
// les hotel_info_items déjà publiés. Conversations isolées par client_account.
app.get('/api/client/wikot/conversations', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const conversations = await c.env.DB.prepare(`
    SELECT id, title, created_at, updated_at
    FROM wikot_conversations
    WHERE client_account_id = ? AND mode = 'concierge' AND is_archived = 0
    ORDER BY updated_at DESC
    LIMIT 20
  `).bind(client.id).all()
  return c.json({ conversations: conversations.results })
})

app.post('/api/client/wikot/conversations', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const result = await c.env.DB.prepare(`
    INSERT INTO wikot_conversations (hotel_id, user_id, client_account_id, title, mode)
    VALUES (?, NULL, ?, ?, 'concierge')
  `).bind(client.hotel_id, client.id, 'Nouvelle conversation').run()
  return c.json({ id: result.meta.last_row_id })
})

app.get('/api/client/wikot/conversations/:id', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const id = c.req.param('id')
  const conv = await c.env.DB.prepare(`
    SELECT id, title, created_at, updated_at
    FROM wikot_conversations
    WHERE id = ? AND client_account_id = ? AND mode = 'concierge'
  `).bind(id, client.id).first()
  if (!conv) return c.json({ error: 'Conversation non trouvée' }, 404)
  const messages = await c.env.DB.prepare(`
    SELECT id, role, content, references_json, created_at
    FROM wikot_messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY created_at ASC
  `).bind(id).all()
  return c.json({ conversation: conv, messages: messages.results })
})

// ============================================
// FRONT WIKOT — moteur tool-calling Gemini 2.0 Flash via OpenRouter
// ============================================
// 2 tools uniquement :
//  - respond_with_info_card(item_id) : renvoie une carte info existante
//  - propose_reservation(meal_type)  : carte action "Réserver" avec lien direct
// Pas de génération de texte libre, pas d'accès aux procédures.

const FRONT_WIKOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'respond_with_info_card',
      description: "Sélectionne UNE information existante dans le catalogue de l'hôtel et la présente au client comme une carte. Utilise cette fonction dès que la question du client correspond à une information référencée (horaires petit-déjeuner, wifi, parking, équipements de la chambre, services, etc.).",
      parameters: {
        type: 'object',
        properties: {
          item_id: {
            type: 'integer',
            description: "ID de l'info à afficher, choisi STRICTEMENT dans le catalogue fourni dans le system prompt."
          }
        },
        required: ['item_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_reservation',
      description: "Affiche un bouton de réservation pour le restaurant. À utiliser UNIQUEMENT si le client demande explicitement à réserver un repas (petit-déjeuner, déjeuner ou dîner).",
      parameters: {
        type: 'object',
        properties: {
          meal_type: {
            type: 'string',
            enum: ['breakfast', 'lunch', 'dinner'],
            description: "Type de repas à réserver."
          }
        },
        required: ['meal_type']
      }
    }
  }
]

app.post('/api/client/wikot/conversations/:id/message', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  const convId = c.req.param('id')
  const body = await c.req.json() as { content: string }
  const userMessage = String(body.content || '').trim()
  if (!userMessage) return c.json({ error: 'Message vide' }, 400)

  const conv = await c.env.DB.prepare(`
    SELECT id FROM wikot_conversations WHERE id = ? AND client_account_id = ? AND mode = 'concierge'
  `).bind(convId, client.id).first()
  if (!conv) return c.json({ error: 'Conversation non trouvée' }, 404)

  // Stocker le message utilisateur
  const userInsert = await c.env.DB.prepare(`
    INSERT INTO wikot_messages (conversation_id, role, content) VALUES (?, 'user', ?)
  `).bind(convId, userMessage).run()

  // Construire le catalogue : toutes les hotel_info de l'hôtel (id + cat + titre + contenu)
  const categories = await c.env.DB.prepare(`
    SELECT id, name FROM hotel_info_categories WHERE hotel_id = ? ORDER BY sort_order, name
  `).bind(client.hotel_id).all()
  const items = await c.env.DB.prepare(`
    SELECT id, category_id, title, content FROM hotel_info_items
    WHERE hotel_id = ? ORDER BY sort_order, title
  `).bind(client.hotel_id).all()

  const catMap: Record<number, string> = {}
  for (const cat of categories.results as any[]) catMap[cat.id] = cat.name

  // Catalogue compact pour le LLM : id, catégorie, titre, début du contenu
  const itemsList = items.results as any[]
  const knowledgeBase = itemsList.map((it: any) => {
    const preview = String(it.content || '').slice(0, 220).replace(/\s+/g, ' ').trim()
    return `[id=${it.id}] (${catMap[it.category_id] || 'Général'}) ${it.title} — ${preview}`
  }).join('\n')

  // Historique récent (8 derniers messages user/assistant)
  const history = await c.env.DB.prepare(`
    SELECT role, content FROM wikot_messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY created_at DESC LIMIT 8
  `).bind(convId).all()
  const historyMessages = (history.results as any[]).reverse()

  const systemPrompt = `Tu es Front Wikot, le concierge virtuel de l'hôtel ${client.hotel_name}.
Tu aides ${client.guest_name} (chambre ${client.room_number}).

## Ton fonctionnement (STRICT)
Tu n'écris JAMAIS de texte libre. Tu DOIS appeler exactement UN tool parmi :
1. respond_with_info_card(item_id) — pour répondre avec une info du catalogue ci-dessous.
2. propose_reservation(meal_type) — UNIQUEMENT si le client demande à réserver un repas.

## Comment choisir
- Question sur l'hôtel, équipements, horaires, wifi, services → respond_with_info_card avec l'id le plus pertinent.
- Demande explicite de réservation petit-déj / déjeuner / dîner → propose_reservation.
- Si AUCUNE info ne correspond raisonnablement → choisis l'info la plus proche du sujet (ex: "Maintenance" pour un problème en chambre, ou la première info de la catégorie pertinente).

## Catalogue d'informations (utilise UNIQUEMENT ces id)
${knowledgeBase || '(Aucune information publiée par l\'hôtel.)'}

## Règles strictes
- TOUJOURS appeler un tool, JAMAIS répondre en texte.
- L'item_id DOIT exister dans le catalogue ci-dessus.
- Ne révèle jamais que tu es une IA / LLM.`

  let toolCall: { name: string; args: any } | null = null
  let fallbackInfoItemId: number | null = null
  const apiKey = c.env.OPENROUTER_API_KEY

  if (apiKey && itemsList.length > 0) {
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...historyMessages.map((m: any) => ({ role: m.role, content: m.content }))
      ]
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wikot.fr',
          'X-Title': 'Front Wikot'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          messages,
          tools: FRONT_WIKOT_TOOLS,
          tool_choice: 'required',
          temperature: 0.2
        })
      })
      if (resp.ok) {
        const data: any = await resp.json()
        const tc = data?.choices?.[0]?.message?.tool_calls?.[0]
        if (tc?.function?.name) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
          toolCall = { name: tc.function.name, args }
        }
      }
    } catch (e) {
      // Silencieux — on tombe sur le fallback
    }
  }

  // Validation et fallback
  if (toolCall?.name === 'respond_with_info_card') {
    const requestedId = parseInt((toolCall.args as any)?.item_id)
    const exists = itemsList.some(it => it.id === requestedId)
    if (!exists) {
      // Fallback : prendre la 1ère info disponible
      fallbackInfoItemId = itemsList[0]?.id || null
      toolCall = null
    }
  } else if (toolCall?.name === 'propose_reservation') {
    const mt = (toolCall.args as any)?.meal_type
    if (!['breakfast', 'lunch', 'dinner'].includes(mt)) {
      toolCall = null
      fallbackInfoItemId = itemsList[0]?.id || null
    }
  } else if (!toolCall && itemsList.length > 0) {
    fallbackInfoItemId = itemsList[0].id
  }

  // Construction de la réponse structurée (stockée en references_json côté assistant)
  let assistantContent = ''
  let referencesJson: any = null

  if (toolCall?.name === 'respond_with_info_card' || fallbackInfoItemId !== null) {
    const itemId = toolCall?.name === 'respond_with_info_card'
      ? parseInt((toolCall.args as any).item_id)
      : fallbackInfoItemId
    const item = itemsList.find(it => it.id === itemId)
    if (item) {
      assistantContent = `[info_card:${item.id}]`
      referencesJson = {
        kind: 'info_card',
        item: {
          id: item.id,
          category: catMap[item.category_id] || 'Général',
          title: item.title,
          content: item.content || ''
        }
      }
    }
  } else if (toolCall?.name === 'propose_reservation') {
    const mealType = (toolCall.args as any).meal_type
    const labels: Record<string, string> = { breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', dinner: 'Dîner' }
    assistantContent = `[reservation_card:${mealType}]`
    referencesJson = {
      kind: 'reservation_card',
      meal_type: mealType,
      meal_label: labels[mealType] || mealType
    }
  }

  // Si vraiment rien, message d'erreur courtois
  if (!referencesJson) {
    assistantContent = '[empty]'
    referencesJson = {
      kind: 'fallback',
      message: "Je n'ai pas trouvé d'information correspondante. Contactez la réception pour plus d'aide."
    }
  }

  // Stocker la réponse (content = marqueur, references_json = données structurées)
  const assistantInsert = await c.env.DB.prepare(`
    INSERT INTO wikot_messages (conversation_id, role, content, references_json)
    VALUES (?, 'assistant', ?, ?)
  `).bind(convId, assistantContent, JSON.stringify(referencesJson)).run()

  // Mettre à jour le titre si premier message
  const msgCount = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM wikot_messages WHERE conversation_id = ? AND role='user'`).bind(convId).first() as any
  if (msgCount?.n === 1) {
    const newTitle = userMessage.slice(0, 60)
    await c.env.DB.prepare(`UPDATE wikot_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(newTitle, convId).run()
  } else {
    await c.env.DB.prepare(`UPDATE wikot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(convId).run()
  }

  return c.json({
    user_message_id: userInsert.meta.last_row_id,
    assistant_message: {
      id: assistantInsert.meta.last_row_id,
      role: 'assistant',
      content: assistantContent,
      references_json: JSON.stringify(referencesJson)
    }
  })
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
    /* Highlight visuel pour les champs Back Wikot que l'IA vient de modifier */
    .back-wikot-touched {
      animation: backWikotTouched 1.8s ease-out;
      box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.55);
    }
    @keyframes backWikotTouched {
      0%   { background-color: #fff7ed; box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.85); }
      40%  { background-color: #ffedd5; box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.65); }
      100% { background-color: inherit; box-shadow: 0 0 0 0 rgba(251, 146, 60, 0); }
    }
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
