import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  OPENROUTER_API_KEY?: string
  AUDIO_BUCKET?: R2Bucket
  WIKOT_CACHE?: KVNamespace
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
  can_create_tasks: number
  can_assign_tasks: number
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
// SECURITY HEADERS — appliqués à toutes les réponses
// ============================================
// X-Content-Type-Options : empêche le MIME-sniffing (vector XSS classique)
// X-Frame-Options        : bloque le clickjacking (l'app ne doit pas être iframée)
// Referrer-Policy        : limite la fuite d'URL vers les domaines tiers
// Permissions-Policy     : désactive les API browser qu'on n'utilise pas
// Strict-Transport-Security : HSTS 1 an (forcé HTTPS, déjà géré par CF mais ceinture+bretelles)
// Cache-Control sur /api/* : pas de cache intermédiaire pour données auth
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=(self), payment=()')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // Pas de cache pour les routes API (données sensibles, multi-tenant)
  // Les audios R2 surchargent ce header avec leur propre Cache-Control private.
  const url = new URL(c.req.url)
  if (url.pathname.startsWith('/api/') && !url.pathname.includes('/audio/')) {
    c.header('Cache-Control', 'private, no-store, no-cache, must-revalidate')
  }
})

// ============================================
// CRYPTO HELPERS — PBKDF2-SHA256 (Web Crypto API, compatible Workers)
// Argon2 n'est pas dispo nativement sur l'edge runtime (pas de WASM crypto + fs).
// IMPORTANT : Cloudflare Workers limite le CPU à 30 ms (free) / 50 ms (paid).
// 600k itérations dépassent cette limite et font crasher login/verify (HTTP 500/401).
// On revient à 100k iter — résiste encore au cracking offline pour des MDP non-triviaux.
// Migration future possible vers Argon2-WASM si besoin de 2023+ strict.
// Le champ `algo` reste versionné pour permettre une future rotation propre.
// ============================================
const PBKDF2_ITER_V1 = 100_000          // legacy (pré-2026) — toujours supporté
const PBKDF2_ITER_CURRENT = 100_000     // edge-compatible (sous la limite CPU Workers)
const PBKDF2_ALGO_CURRENT = 'pbkdf2-sha256-100k'
const PBKDF2_ALGO_LEGACY = 'pbkdf2-sha256-100k'

function bytesToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

// Détermine le nombre d'itérations selon la valeur stockée en BDD (rétrocompat).
function iterationsFromAlgo(algo: string | null | undefined): number {
  if (algo === PBKDF2_ALGO_LEGACY) return PBKDF2_ITER_V1
  return PBKDF2_ITER_CURRENT
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string; algo: string }> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITER_CURRENT)
  return { hash: bytesToHex(hash), salt: bytesToHex(salt), algo: PBKDF2_ALGO_CURRENT }
}

async function verifyPassword(password: string, hashHex: string, saltHex: string, algo?: string | null): Promise<boolean> {
  try {
    const expected = hexToBytes(hashHex)
    const iter = iterationsFromAlgo(algo)
    const computed = await derivePbkdf2(password, hexToBytes(saltHex), iter)
    if (expected.length !== computed.length) return false
    // Comparaison à temps constant
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ computed[i]
    return diff === 0
  } catch {
    return false
  }
}

// Indique si un hash stocké est « obsolète » (algo legacy) et mérite une re-migration au prochain login.
function passwordNeedsRehash(algo: string | null | undefined): boolean {
  return algo !== PBKDF2_ALGO_CURRENT
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
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
// VALIDATION HELPERS — sanitisation + validation des bodies API
// Évite les 500 SQL et garantit des erreurs 400 lisibles. Pas de Zod (pas de
// dépendance lourde) : 4 helpers maison cohérents avec le style existant.
// ============================================

// Vérifie qu'une string non vide existe ; renvoie sa version trimmée + tronquée à maxLen.
function reqStr(v: any, field: string, maxLen = 500): string | { error: string } {
  if (typeof v !== 'string') return { error: `Le champ "${field}" doit être une chaîne de caractères` }
  const trimmed = v.trim()
  if (!trimmed) return { error: `Le champ "${field}" est requis` }
  if (trimmed.length > maxLen) return { error: `Le champ "${field}" dépasse ${maxLen} caractères` }
  return trimmed
}

// String optionnelle : null/undefined/empty → null, sinon trim + check longueur.
function optStr(v: any, field: string, maxLen = 5000): string | null | { error: string } {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') return { error: `Le champ "${field}" doit être une chaîne de caractères` }
  const trimmed = v.trim()
  if (trimmed.length > maxLen) return { error: `Le champ "${field}" dépasse ${maxLen} caractères` }
  return trimmed || null
}

// Entier dans une plage donnée. Tolère number et string numérique.
function reqInt(v: any, field: string, min = -2147483648, max = 2147483647): number | { error: string } {
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: `Le champ "${field}" doit être un entier` }
  }
  if (n < min || n > max) return { error: `Le champ "${field}" doit être entre ${min} et ${max}` }
  return n
}

// Vérifie qu'une valeur appartient à une liste fermée (enum).
function reqEnum<T extends string>(v: any, field: string, allowed: readonly T[]): T | { error: string } {
  if (!allowed.includes(v)) return { error: `Le champ "${field}" doit être l'un de : ${allowed.join(', ')}` }
  return v as T
}

// Helper : si l'un des resultats de validation contient { error }, renvoie une 400.
// Sinon, renvoie null (ok).
function isValidationError(r: any): r is { error: string } {
  return r && typeof r === 'object' && typeof r.error === 'string'
}

// ============================================
// MINI-VALIDATEUR NATIF — alternative légère à Zod (~50 lignes vs ~80 kB pour Zod)
// Usage : const v = validateBody(body, { name: 'string:1-100', age: 'int?:0-150' })
// Retourne { ok: true, data } ou { ok: false, error: 'champ name requis' }
// ============================================
type FieldRule =
  | `string:${number}-${number}`        // string:1-100   (longueur min-max)
  | `string?:${number}-${number}`       // string?:0-500  (optionnel)
  | `int:${number}-${number}`           // int:0-100
  | `int?:${number}-${number}`
  | `enum:${string}`                    // enum:active|draft|archived
  | `enum?:${string}`
  | 'email' | 'email?'
  | 'bool' | 'bool?'
  | 'array' | 'array?'                  // array sans typage interne (laisser route gérer)
  | 'object' | 'object?'
  | 'any' | 'any?'                      // tolère n'importe quoi (échappatoire)

interface ValidationResult<T> {
  ok: boolean
  data?: T
  error?: string
}

function validateBody<T = any>(body: any, schema: Record<string, FieldRule>): ValidationResult<T> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body invalide (objet attendu)' }
  }
  const out: any = {}
  for (const [field, rule] of Object.entries(schema)) {
    const optional = rule.includes('?')
    const value = body[field]
    const present = value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')
    if (!present) {
      if (optional) continue
      return { ok: false, error: `Champ requis : ${field}` }
    }
    // Parse type + contraintes
    if (rule.startsWith('string')) {
      if (typeof value !== 'string') return { ok: false, error: `${field} doit être une chaîne` }
      const m = rule.match(/(\d+)-(\d+)/)
      const min = m ? +m[1] : 0
      const max = m ? +m[2] : 10000
      const trimmed = value.trim()
      if (trimmed.length < min) return { ok: false, error: `${field} trop court (min ${min})` }
      if (trimmed.length > max) return { ok: false, error: `${field} trop long (max ${max})` }
      out[field] = trimmed
    } else if (rule.startsWith('int')) {
      const n = typeof value === 'number' ? value : parseInt(value, 10)
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `${field} doit être un entier` }
      const m = rule.match(/(-?\d+)-(-?\d+)/)
      const min = m ? +m[1] : -2147483648
      const max = m ? +m[2] : 2147483647
      if (n < min || n > max) return { ok: false, error: `${field} hors plage (${min}-${max})` }
      out[field] = n
    } else if (rule.startsWith('enum')) {
      const m = rule.match(/enum\??:(.+)/)
      const allowed = m ? m[1].split('|') : []
      if (!allowed.includes(String(value))) return { ok: false, error: `${field} invalide (attendu : ${allowed.join(', ')})` }
      out[field] = value
    } else if (rule.startsWith('email')) {
      // Regex email standard (RFC 5322 simplifié, suffisant en prod)
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { ok: false, error: `${field} email invalide` }
      }
      if (value.length > 254) return { ok: false, error: `${field} email trop long` }
      out[field] = value.toLowerCase().trim()
    } else if (rule.startsWith('bool')) {
      if (typeof value !== 'boolean' && value !== 0 && value !== 1) return { ok: false, error: `${field} doit être bool` }
      out[field] = !!value
    } else if (rule.startsWith('array')) {
      if (!Array.isArray(value)) return { ok: false, error: `${field} doit être un tableau` }
      out[field] = value
    } else if (rule.startsWith('object')) {
      if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: `${field} doit être un objet` }
      out[field] = value
    } else if (rule.startsWith('any')) {
      out[field] = value
    }
  }
  return { ok: true, data: out as T }
}

// Helper Hono : retourne directement la réponse 400 si invalide
function bad(c: any, error: string) {
  return c.json({ error }, 400)
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
           u.can_create_tasks, u.can_assign_tasks,
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
    can_create_tasks: row.can_create_tasks, can_assign_tasks: row.can_assign_tasks,
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

  // SÉCURITÉ : rate-limit anti-brute-force
  // 10 tentatives / 15 min / IP — laisse de la marge pour les fautes de frappe
  // mais bloque les attaques automatisées.
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const emailKey = String(email).trim().toLowerCase()
  const rlIp = await checkRateLimit(c.env, 'login_ip', ip, 10, 900)
  if (!rlIp.ok) return rateLimitedResponse(c, 900)
  // En plus : 5 tentatives / 15 min / email — protège un compte ciblé
  // même si l'attaquant change d'IP.
  const rlEmail = await checkRateLimit(c.env, 'login_email', emailKey, 5, 900)
  if (!rlEmail.ok) return rateLimitedResponse(c, 900)

  const user = await c.env.DB.prepare(`
    SELECT id, hotel_id, email, name, role,
           can_edit_procedures, can_edit_info, can_manage_chat,
           can_edit_clients, can_edit_restaurant, can_edit_settings,
           can_create_tasks, can_assign_tasks,
           password_hash, password_hash_v2, password_salt, password_algo
    FROM users WHERE email = ? AND is_active = 1
  `).bind(email).first() as any

  if (!user) return c.json({ error: 'Email ou mot de passe incorrect' }, 401)

  // 1. Vérification : nouveau hash si présent, sinon legacy plaintext
  let valid = false
  let needsMigration = false  // plaintext → hashé
  let needsRehash = false     // hashé v1 100k → v2 600k

  if (user.password_hash_v2 && user.password_salt) {
    valid = await verifyPassword(password, user.password_hash_v2, user.password_salt, user.password_algo)
    if (valid && passwordNeedsRehash(user.password_algo)) needsRehash = true
  } else if (user.password_hash) {
    // Lazy migration : ancien stockage en clair
    valid = (user.password_hash === password)
    if (valid) needsMigration = true
  }

  if (!valid) return c.json({ error: 'Email ou mot de passe incorrect' }, 401)

  // 2. Lazy migration vers PBKDF2 si nécessaire (plaintext → v2 ou v1 → v2)
  // Note : password_hash reste NOT NULL au schéma → on stocke '' comme sentinelle
  // pour invalider l'ancien plaintext sans casser la contrainte / les FK.
  if (needsMigration || needsRehash) {
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
      can_edit_restaurant: user.can_edit_restaurant, can_edit_settings: user.can_edit_settings,
      can_create_tasks: user.can_create_tasks, can_assign_tasks: user.can_assign_tasks
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

  // SÉCURITÉ : rate-limit anti-brute-force
  // 15 tentatives / 15 min / IP (clients tapent souvent mal au début)
  // 8 tentatives / 15 min / (hotel_code + room) pour protéger une chambre ciblée
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const rlIp = await checkRateLimit(c.env, 'client_login_ip', ip, 15, 900)
  if (!rlIp.ok) return rateLimitedResponse(c, 900)
  const roomKey = `${hotelCode}:${roomNumber}`
  const rlRoom = await checkRateLimit(c.env, 'client_login_room', roomKey, 8, 900)
  if (!rlRoom.ok) return rateLimitedResponse(c, 900)

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
    'SELECT password_hash, password_hash_v2, password_salt, password_algo FROM users WHERE id = ?'
  ).bind(user.id).first() as any
  if (!dbUser) return c.json({ error: 'Utilisateur introuvable' }, 404)

  let valid = false
  if (dbUser.password_hash_v2 && dbUser.password_salt) {
    valid = await verifyPassword(current_password, dbUser.password_hash_v2, dbUser.password_salt, dbUser.password_algo)
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
    // PERF: LIMIT 1000 — table globale (peu probable de dépasser, mais filet de sécurité)
    hotels = await c.env.DB.prepare('SELECT * FROM hotels ORDER BY name LIMIT 1000').all()
  } else {
    hotels = await c.env.DB.prepare('SELECT * FROM hotels WHERE id = ?').bind(user.hotel_id).all()
  }
  return c.json({ hotels: hotels.results })
})

app.post('/api/hotels', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const { name, address, logo_url } = await c.req.json() as { name?: string; address?: string; logo_url?: string }
  // VALIDATION stricte
  const nameTrim = typeof name === 'string' ? name.trim() : ''
  if (!nameTrim) return c.json({ error: 'Le nom est obligatoire' }, 400)
  if (nameTrim.length > 150) return c.json({ error: 'Nom trop long (max 150)' }, 400)
  const slug = nameTrim.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!slug) return c.json({ error: 'Nom invalide' }, 400)
  try {
    const result = await c.env.DB.prepare('INSERT INTO hotels (name, slug, address, logo_url) VALUES (?, ?, ?, ?)').bind(nameTrim, slug, address || null, logo_url || null).run()
    return c.json({ id: result.meta.last_row_id, name: nameTrim, slug })
  } catch (e: any) {
    return c.json({ error: 'Un hôtel avec ce nom existe déjà' }, 400)
  }
})

app.put('/api/hotels/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const { name, address } = await c.req.json() as { name?: string; address?: string }
  const nameTrim = typeof name === 'string' ? name.trim() : ''
  if (!nameTrim) return c.json({ error: 'Le nom est obligatoire' }, 400)
  if (nameTrim.length > 150) return c.json({ error: 'Nom trop long (max 150)' }, 400)
  const slug = nameTrim.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!slug) return c.json({ error: 'Nom invalide' }, 400)
  await c.env.DB.prepare('UPDATE hotels SET name = ?, slug = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(nameTrim, slug, address || null, id).run()
  return c.json({ success: true })
})

app.delete('/api/hotels/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  // Vérifier que l'hôtel existe
  const hotel = await c.env.DB.prepare('SELECT id, name FROM hotels WHERE id = ?').bind(id).first() as any
  if (!hotel) return c.json({ error: 'Hôtel non trouvé' }, 404)
  // Suppression hôtel — version optimisée avec batch.
  // CASCADE automatique sur : steps, conditions, condition_steps (procedures FK),
  // chat_messages, chat_channels (chat_groups FK), wikot_messages, wikot_pending_actions
  // (wikot_conversations FK), client_sessions (client_accounts FK),
  // hotel_info_categories/items, restaurant_week_templates (hotels FK).
  // Reste à supprimer manuellement les tables dont la FK hotels n'a pas CASCADE.
  // Tout est exécuté en 1 transaction batch (atomicité + perf).
  await c.env.DB.batch([
    // changelog_reads doit être nettoyé via les users de cet hôtel
    c.env.DB.prepare(`DELETE FROM changelog_reads WHERE user_id IN (SELECT id FROM users WHERE hotel_id = ?)`).bind(id),
    c.env.DB.prepare('DELETE FROM changelog WHERE hotel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM suggestions WHERE hotel_id = ?').bind(id),
    // procedures supprime CASCADE steps, conditions, condition_steps
    c.env.DB.prepare('DELETE FROM procedures WHERE hotel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM categories WHERE hotel_id = ?').bind(id),
    // chat: groups CASCADE channels qui CASCADE messages
    c.env.DB.prepare(`DELETE FROM chat_reads WHERE user_id IN (SELECT id FROM users WHERE hotel_id = ?)`).bind(id),
    c.env.DB.prepare('DELETE FROM chat_groups WHERE hotel_id = ?').bind(id),
    // wikot: conversations CASCADE messages + pending_actions
    c.env.DB.prepare('DELETE FROM wikot_conversations WHERE hotel_id = ?').bind(id),
    // client: client_accounts CASCADE sessions
    c.env.DB.prepare('DELETE FROM client_accounts WHERE hotel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM client_sessions WHERE hotel_id = ?').bind(id),
    // restaurant
    c.env.DB.prepare('DELETE FROM restaurant_reservations WHERE hotel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM restaurant_exceptions WHERE hotel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM restaurant_schedule WHERE hotel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM rooms WHERE hotel_id = ?').bind(id),
    // user_sessions liées aux users de cet hôtel
    c.env.DB.prepare(`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE hotel_id = ?)`).bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE hotel_id = ?').bind(id),
    // enfin l'hôtel lui-même
    c.env.DB.prepare('DELETE FROM hotels WHERE id = ?').bind(id),
  ])
  return c.json({ success: true })
})

// ============================================
// USERS ROUTES
// ============================================
app.get('/api/users', authMiddleware, async (c) => {
  const user = c.get('user')
  let users
  if (user.role === 'super_admin') {
    // PERF: LIMIT 2000 — table globale qui peut grossir avec tous les hôtels
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.can_edit_clients, u.can_edit_restaurant, u.can_edit_settings, u.can_create_tasks, u.can_assign_tasks, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id ORDER BY u.name LIMIT 2000').all()
  } else if (user.role === 'admin') {
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.can_edit_clients, u.can_edit_restaurant, u.can_edit_settings, u.can_create_tasks, u.can_assign_tasks, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id WHERE u.hotel_id = ? ORDER BY u.name LIMIT 500').bind(user.hotel_id).all()
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
    can_create_tasks?: boolean | number
    can_assign_tasks?: boolean | number
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
  if (body.can_create_tasks !== undefined)    { fields.push('can_create_tasks = ?');    values.push(body.can_create_tasks ? 1 : 0) }
  if (body.can_assign_tasks !== undefined)    { fields.push('can_assign_tasks = ?');    values.push(body.can_assign_tasks ? 1 : 0) }
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
  // VALIDATION stricte : format email + longueurs
  const emailTrim = String(email).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) return c.json({ error: 'Email invalide' }, 400)
  const nameTrim = String(name).trim()
  if (!nameTrim || nameTrim.length > 100) return c.json({ error: 'Nom invalide (1-100 caractères)' }, 400)
  if (password.length > 200) return c.json({ error: 'Mot de passe trop long' }, 400)
  // Rôle whitelist
  const allowedRoles = ['employee', 'admin', 'super_admin']
  const finalRole = allowedRoles.includes(role || '') ? role : 'employee'

  const targetHotel = currentUser.role === 'admin' ? currentUser.hotel_id : hotel_id
  if (currentUser.role === 'admin' && finalRole === 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  // Un super_admin doit avoir un hotel_id rattaché ou explicite (pour l'admin c'est forcé)
  if (currentUser.role === 'super_admin' && !targetHotel && finalRole !== 'super_admin') {
    return c.json({ error: 'hotel_id requis pour ce rôle' }, 400)
  }

  // Hash PBKDF2 dès la création — pas de stockage plaintext
  // password_hash = '' (sentinelle) car la colonne est NOT NULL au schéma
  const { hash, salt, algo } = await hashPassword(password)
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO users (hotel_id, email, password_hash, password_hash_v2, password_salt, password_algo, name, role)
      VALUES (?, ?, '', ?, ?, ?, ?, ?)
    `).bind(targetHotel, emailTrim, hash, salt, algo, nameTrim, finalRole).run()
    return c.json({ id: result.meta.last_row_id, email: emailTrim, name: nameTrim, role: finalRole })
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
  // SÉCURITÉ: on force le hotel_id du user (pas de query override pour éviter cross-tenant leak)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ categories: [] })
  const categories = await c.env.DB.prepare('SELECT * FROM categories WHERE hotel_id = ? ORDER BY sort_order, name').bind(hotelId).all()
  return c.json({ categories: categories.results })
})

app.post('/api/categories', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  // BUGFIX: lire le body UNE seule fois (avant : await c.req.json() était appelé 2x → erreur 'Body already read')
  const body = await c.req.json() as { name?: any; icon?: any; color?: any; parent_id?: any; hotel_id?: any }
  const name = reqStr(body.name, 'name', 100)
  if (isValidationError(name)) return c.json(name, 400)
  const icon = optStr(body.icon, 'icon', 60); if (isValidationError(icon)) return c.json(icon, 400)
  const color = optStr(body.color, 'color', 20); if (isValidationError(color)) return c.json(color, 400)
  // Sécurité : super_admin peut spécifier hotel_id, sinon on force celui de l'user
  const hotelId = user.role === 'super_admin' ? (body.hotel_id || user.hotel_id) : user.hotel_id
  if (!hotelId) return c.json({ error: 'hotel_id requis' }, 400)
  const result = await c.env.DB.prepare('INSERT INTO categories (hotel_id, name, icon, color, parent_id) VALUES (?, ?, ?, ?, ?)').bind(hotelId, name, icon || 'fa-folder', color || '#3B82F6', body.parent_id || null).run()
  return c.json({ id: result.meta.last_row_id, name })
})

app.put('/api/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const owned = await assertHotelOwnership(c.env.DB, 'categories', id, user)
  if (owned instanceof Response) return owned
  const body = await c.req.json() as { name?: any; icon?: any; color?: any }
  const name = reqStr(body.name, 'name', 100)
  if (isValidationError(name)) return c.json(name, 400)
  const icon = optStr(body.icon, 'icon', 60); if (isValidationError(icon)) return c.json(icon, 400)
  const color = optStr(body.color, 'color', 20); if (isValidationError(color)) return c.json(color, 400)
  await c.env.DB.prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?').bind(name, icon || 'fa-folder', color || '#3B82F6', id).run()
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
  // SÉCURITÉ: on force le hotel_id du user (pas de query override)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ procedures: [] })
  const categoryId = c.req.query('category_id')
  const search = c.req.query('search')
  const includeSubprocedures = c.req.query('include_subprocedures') === '1' // explicite, pour le détail

  // Pagination optionnelle (rétro-compatible : sans param = comportement actuel)
  // ?limit=50&offset=0 pour scaler quand un hôtel aura 500+ procédures
  const limitRaw = parseInt(c.req.query('limit') || '0')
  const offsetRaw = parseInt(c.req.query('offset') || '0')
  const limit = limitRaw > 0 && limitRaw <= 500 ? limitRaw : 0
  const offset = offsetRaw > 0 ? offsetRaw : 0

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

  if (limit > 0) {
    query += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)
  }

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
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)
  // VALIDATION stricte : title et trigger_event requis (NOT NULL en DB)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const triggerEvent = typeof body.trigger_event === 'string' ? body.trigger_event.trim() : ''
  if (!title) return c.json({ error: 'Le titre est obligatoire' }, 400)
  if (!triggerEvent) return c.json({ error: "L'événement déclencheur est obligatoire" }, 400)
  if (title.length > 200) return c.json({ error: 'Titre trop long (max 200 caractères)' }, 400)

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

  // PERF: tout batcher en 2 phases au lieu d'un INSERT par step/condition.
  // Phase 1 : steps + conditions + changelog en parallèle (batch unique).
  // Phase 2 : condition_steps une fois qu'on a les IDs des conditions.
  const phase1: D1PreparedStatement[] = []

  if (Array.isArray(body.steps)) {
    for (const step of body.steps) {
      phase1.push(
        c.env.DB.prepare(
          `INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional, condition_text)
           VALUES (?, ?, ?, ?, ?, 'action', ?, ?, ?)`
        ).bind(procId, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0, step.condition_text || null)
      )
    }
  }

  const conds: any[] = Array.isArray(body.conditions) ? body.conditions : []
  for (const cond of conds) {
    phase1.push(
      c.env.DB.prepare(
        `INSERT INTO conditions (procedure_id, condition_text, description, sort_order) VALUES (?, ?, ?, ?)`
      ).bind(procId, cond.condition_text, cond.description || null, cond.sort_order || 0)
    )
  }

  phase1.push(
    c.env.DB.prepare(
      `INSERT INTO changelog (hotel_id, procedure_id, user_id, action, summary, is_read_required) VALUES (?, ?, ?, 'created', ?, 0)`
    ).bind(hotelId, procId, user.id, `Procédure "${body.title}" créée`)
  )

  if (phase1.length > 0) {
    const results = await c.env.DB.batch(phase1)
    // Phase 2 : récup des condition_ids depuis les résultats batch
    // Les conditions sont insérées juste après les steps, dans l'ordre
    const stepsCount = Array.isArray(body.steps) ? body.steps.length : 0
    const phase2: D1PreparedStatement[] = []
    for (let i = 0; i < conds.length; i++) {
      const condId = results[stepsCount + i]?.meta?.last_row_id
      const cond = conds[i]
      if (condId && Array.isArray(cond.steps)) {
        for (const step of cond.steps) {
          phase2.push(
            c.env.DB.prepare(
              `INSERT INTO condition_steps (condition_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional)
               VALUES (?, ?, ?, ?, ?, 'action', ?, ?)`
            ).bind(condId, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0)
          )
        }
      }
    }
    if (phase2.length > 0) await c.env.DB.batch(phase2)
  }

  // Synchronisation auto : toute procédure liée via une étape devient sous-procédure
  await syncSubprocedureFlags(c.env.DB, procId as number, hotelId)

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

  // PERF: batch des DELETE + INSERT en 2 phases (au lieu de N+1 sequential)
  const phase1Put: D1PreparedStatement[] = []

  if (body.steps) {
    phase1Put.push(c.env.DB.prepare('DELETE FROM steps WHERE procedure_id = ?').bind(id))
    for (const step of body.steps) {
      phase1Put.push(
        c.env.DB.prepare(
          `INSERT INTO steps (procedure_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional, condition_text)
           VALUES (?, ?, ?, ?, ?, 'action', ?, ?, ?)`
        ).bind(id, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0, step.condition_text || null)
      )
    }
  }

  const condsPut: any[] = Array.isArray(body.conditions) ? body.conditions : []
  let condsStartIdx = -1
  if (body.conditions) {
    // CASCADE: condition_steps supprimés automatiquement (FK ON DELETE CASCADE)
    phase1Put.push(c.env.DB.prepare('DELETE FROM conditions WHERE procedure_id = ?').bind(id))
    condsStartIdx = phase1Put.length // index du premier INSERT condition
    for (const cond of condsPut) {
      phase1Put.push(
        c.env.DB.prepare(
          `INSERT INTO conditions (procedure_id, condition_text, description, sort_order) VALUES (?, ?, ?, ?)`
        ).bind(id, cond.condition_text, cond.description || null, cond.sort_order || 0)
      )
    }
  }

  if (phase1Put.length > 0) {
    const results = await c.env.DB.batch(phase1Put)
    if (condsStartIdx >= 0) {
      const phase2Put: D1PreparedStatement[] = []
      for (let i = 0; i < condsPut.length; i++) {
        const condId = results[condsStartIdx + i]?.meta?.last_row_id
        const cond = condsPut[i]
        if (condId && Array.isArray(cond.steps)) {
          for (const step of cond.steps) {
            phase2Put.push(
              c.env.DB.prepare(
                `INSERT INTO condition_steps (condition_id, step_number, title, content, linked_procedure_id, step_type, duration_minutes, is_optional)
                 VALUES (?, ?, ?, ?, ?, 'action', ?, ?)`
              ).bind(condId, step.step_number, step.title, step.content || null, step.linked_procedure_id || null, step.duration_minutes || null, step.is_optional ? 1 : 0)
            )
          }
        }
      }
      if (phase2Put.length > 0) await c.env.DB.batch(phase2Put)
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

  // CASCADE delete: steps, conditions, condition_steps sont supprimés automatiquement
  // grâce à ON DELETE CASCADE sur procedure_id (FK définie dans le schéma initial).
  // 1 requête au lieu de 4-N, gain perf majeur.
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
  // SÉCURITÉ: on force le hotel_id du user (pas de query override)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ suggestions: [] })
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

  // PERF: LIMIT pour éviter explosion mémoire si l'hôtel accumule des milliers de suggestions
  query += ' ORDER BY s.created_at DESC LIMIT 500'
  const suggestions = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ suggestions: suggestions.results })
})

app.post('/api/suggestions', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé — seuls les utilisateurs avec droits de modification peuvent soumettre des suggestions' }, 403)

  const body = await c.req.json() as { procedure_id?: any; type?: any; title?: any; description?: any }
  const type = reqStr(body.type, 'type', 50); if (isValidationError(type)) return c.json(type, 400)
  const title = reqStr(body.title, 'title', 200); if (isValidationError(title)) return c.json(title, 400)
  const description = optStr(body.description, 'description', 5000); if (isValidationError(description)) return c.json(description, 400)
  const hotelId = user.hotel_id

  const result = await c.env.DB.prepare(
    `INSERT INTO suggestions (hotel_id, procedure_id, user_id, type, title, description) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(hotelId, body.procedure_id || null, user.id, type, title, description).run()

  return c.json({ id: result.meta.last_row_id })
})

app.put('/api/suggestions/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditProcedures(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const owned = await assertHotelOwnership(c.env.DB, 'suggestions', id, user)
  if (owned instanceof Response) return owned
  const body = await c.req.json() as { status?: any; admin_response?: any }
  const status = reqEnum(body.status, 'status', ['pending', 'in_review', 'approved', 'rejected', 'implemented'] as const)
  if (isValidationError(status)) return c.json(status, 400)
  const adminResponse = optStr(body.admin_response, 'admin_response', 5000); if (isValidationError(adminResponse)) return c.json(adminResponse, 400)

  await c.env.DB.prepare(
    `UPDATE suggestions SET status = ?, admin_response = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, adminResponse, user.id, id).run()

  return c.json({ success: true })
})

// ============================================
// TEMPLATES ROUTES (admin hôtel uniquement — super_admin exclu)
// ============================================
app.get('/api/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  // PERF: LIMIT pour éviter explosion mémoire à long terme (table globale, croît avec tous les hôtels)
  const templates = await c.env.DB.prepare('SELECT t.*, u.name as created_by_name FROM templates t LEFT JOIN users u ON t.created_by = u.id ORDER BY t.name LIMIT 500').all()
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
  // SÉCURITÉ: on force le hotel_id du user (pas de query override)
  const hotelId = user.hotel_id

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
    'SELECT id, hotel_id, name, icon, color, sort_order, is_system, created_at FROM chat_groups WHERE hotel_id = ? ORDER BY sort_order, name'
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
  const body = await c.req.json().catch(() => null)
  const v = validateBody<{ name: string; icon?: string; color?: string }>(body, {
    name: 'string:1-60',
    icon: 'string?:1-40',
    color: 'string?:1-20'
  })
  if (!v.ok) return bad(c, v.error!)

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM chat_groups WHERE hotel_id = ?').bind(user.hotel_id).first() as any
  const result = await c.env.DB.prepare(
    'INSERT INTO chat_groups (hotel_id, name, icon, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, 0)'
  ).bind(user.hotel_id, v.data!.name, v.data!.icon || 'fa-folder', v.data!.color || '#3B82F6', (maxOrder?.m || 0) + 1).run()

  return c.json({ id: result.meta.last_row_id, name: v.data!.name })
})

// PUT /api/chat/groups/:id — Renommer un groupe
app.put('/api/chat/groups/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user)) return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json()
  const v = validateBody<{ name: string; icon?: string; color?: string }>(body, {
    name: 'string:1-100',
    icon: 'string?:0-60',
    color: 'string?:0-20',
  })
  if (!v.ok) return bad(c, v.error)
  const { name, icon, color } = v.data

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

  // OPTIM : supprimer en 1 seul batch atomique (au lieu de 2*N+2 round-trips D1)
  const channels = await c.env.DB.prepare('SELECT id FROM chat_channels WHERE group_id = ?').bind(id).all()
  const chIds = (channels.results as any[]).map(r => r.id)
  const ops: D1PreparedStatement[] = []
  if (chIds.length > 0) {
    const ph = chIds.map(() => '?').join(',')
    ops.push(c.env.DB.prepare(`DELETE FROM chat_messages WHERE channel_id IN (${ph})`).bind(...chIds))
    ops.push(c.env.DB.prepare(`DELETE FROM chat_reads    WHERE channel_id IN (${ph})`).bind(...chIds))
  }
  ops.push(c.env.DB.prepare('DELETE FROM chat_channels WHERE group_id = ?').bind(id))
  ops.push(c.env.DB.prepare('DELETE FROM chat_groups   WHERE id = ?').bind(id))
  await c.env.DB.batch(ops)

  return c.json({ success: true })
})

// POST /api/chat/channels — Créer un salon
app.post('/api/chat/channels', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canManageChannels(user) || !user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json().catch(() => null)
  const v = validateBody<{ group_id: number; name: string; description?: string; icon?: string }>(body, {
    group_id: 'int:1-2147483647',
    name: 'string:1-80',
    description: 'string?:0-500',
    icon: 'string?:1-40'
  })
  if (!v.ok) return bad(c, v.error!)

  // Vérifier que le groupe appartient à l'hôtel de l'utilisateur
  const group = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(v.data!.group_id).first() as any
  if (!group || group.hotel_id !== user.hotel_id) return c.json({ error: 'Groupe invalide' }, 400)

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM chat_channels WHERE group_id = ?').bind(v.data!.group_id).first() as any
  const result = await c.env.DB.prepare(
    'INSERT INTO chat_channels (hotel_id, group_id, name, description, icon, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.hotel_id, v.data!.group_id, v.data!.name, v.data!.description || null, v.data!.icon || 'fa-hashtag', (maxOrder?.m || 0) + 1, user.id).run()

  return c.json({ id: result.meta.last_row_id, name: v.data!.name })
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
  const body = await c.req.json().catch(() => null)
  const v = validateBody<{ content: string }>(body, { content: 'string:1-5000' })
  if (!v.ok) return bad(c, v.error!)
  const content = v.data!.content

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

  const body = await c.req.json() as { name?: any; icon?: any; color?: any; sort_order?: any }
  const name = reqStr(body.name, 'name', 100)
  if (isValidationError(name)) return c.json(name, 400)
  const icon = optStr(body.icon, 'icon', 60); if (isValidationError(icon)) return c.json(icon, 400)
  const color = optStr(body.color, 'color', 20); if (isValidationError(color)) return c.json(color, 400)

  const r = await c.env.DB.prepare(`
    INSERT INTO hotel_info_categories (hotel_id, name, icon, color, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(hotelId, name, icon || 'fa-circle-info', color || '#3B82F6', body.sort_order || 0).run()

  await invalidateWikotCache(c.env, hotelId)
  return c.json({ id: r.meta.last_row_id, success: true })
})

// PUT modifier catégorie
app.put('/api/hotel-info/categories/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const id = parseInt(c.req.param('id'))
  const owned = await assertHotelOwnership(c.env.DB, 'hotel_info_categories', id, user)
  if (owned instanceof Response) return owned
  const body = await c.req.json() as { name?: any; icon?: any; color?: any; sort_order?: any }
  // Champs optionnels en édition (UPDATE COALESCE) : on valide seulement ce qui est fourni
  if (body.name !== undefined) {
    const r = reqStr(body.name, 'name', 100); if (isValidationError(r)) return c.json(r, 400)
  }
  if (body.icon !== undefined && body.icon !== null) {
    const r = optStr(body.icon, 'icon', 60); if (isValidationError(r)) return c.json(r, 400)
  }
  if (body.color !== undefined && body.color !== null) {
    const r = optStr(body.color, 'color', 20); if (isValidationError(r)) return c.json(r, 400)
  }

  await c.env.DB.prepare(`
    UPDATE hotel_info_categories
    SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color), sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).bind(body.name || null, body.icon || null, body.color || null, body.sort_order, id).run()

  await invalidateWikotCache(c.env, (owned as any).hotel_id || user.hotel_id || 0)
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
  await invalidateWikotCache(c.env, (owned as any).hotel_id || user.hotel_id || 0)
  return c.json({ success: true })
})

// POST nouvel item (admin + employé avec can_edit_info)
app.post('/api/hotel-info/items', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const hotelId = user.role === 'super_admin' ? parseInt(c.req.query('hotel_id') || '0') : user.hotel_id
  if (!hotelId) return c.json({ error: 'Aucun hôtel' }, 400)

  const body = await c.req.json() as { category_id?: any; title?: any; content?: any; sort_order?: any }
  const title = reqStr(body.title, 'title', 200)
  if (isValidationError(title)) return c.json(title, 400)
  const content = optStr(body.content, 'content', 10000); if (isValidationError(content)) return c.json(content, 400)

  const r = await c.env.DB.prepare(`
    INSERT INTO hotel_info_items (hotel_id, category_id, title, content, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(hotelId, body.category_id || null, title, content || '', body.sort_order || 0).run()

  await invalidateWikotCache(c.env, hotelId)
  return c.json({ id: r.meta.last_row_id, success: true })
})

// PUT modifier item
app.put('/api/hotel-info/items/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditInfo(user) && user.role !== 'super_admin') return c.json({ error: 'Accès refusé' }, 403)
  const id = parseInt(c.req.param('id'))
  const owned = await assertHotelOwnership(c.env.DB, 'hotel_info_items', id, user)
  if (owned instanceof Response) return owned
  const body = await c.req.json() as { category_id?: any; title?: any; content?: any; sort_order?: any }
  if (body.title !== undefined && body.title !== null) {
    const r = reqStr(body.title, 'title', 200); if (isValidationError(r)) return c.json(r, 400)
  }
  if (body.content !== undefined && body.content !== null) {
    const r = optStr(body.content, 'content', 10000); if (isValidationError(r)) return c.json(r, 400)
  }

  await c.env.DB.prepare(`
    UPDATE hotel_info_items
    SET category_id = ?, title = COALESCE(?, title), content = COALESCE(?, content), sort_order = COALESCE(?, sort_order),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(body.category_id || null, body.title || null, body.content || null, body.sort_order, id).run()

  await invalidateWikotCache(c.env, (owned as any).hotel_id || user.hotel_id || 0)
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
  await invalidateWikotCache(c.env, (owned as any).hotel_id || user.hotel_id || 0)
  return c.json({ success: true })
})

// ============================================
// CACHE — invalidation du knowledgeBase Front Wikot
// ============================================
// Le cache KV a un TTL de 5 min. Pour les modifs admin (hotel_info), on flush manuellement
// pour que le client voit la nouvelle info immédiatement sans attendre l'expiration TTL.
async function invalidateWikotCache(env: Bindings, hotelId: number) {
  if (!env.WIKOT_CACHE || !hotelId) return
  try { await env.WIKOT_CACHE.delete(`kb:${hotelId}`) } catch {}
}

// ============================================
// RATE LIMITING — KV-based, fenêtre glissante simple
// ============================================
// Limite le nombre de requêtes par identité (user/client/IP) sur des fenêtres temporelles.
// Si KV indisponible → fail-open (on laisse passer pour ne jamais casser l'app).
// Renvoie true si la requête est autorisée, false si elle dépasse la limite.
async function checkRateLimit(
  env: Bindings,
  bucket: string,
  identity: string,
  limit: number,
  windowSec: number
): Promise<{ ok: boolean; remaining: number }> {
  if (!env.WIKOT_CACHE || !identity) return { ok: true, remaining: limit }
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / windowSec) * windowSec
  const key = `rl:${bucket}:${identity}:${windowStart}`
  try {
    const raw = await env.WIKOT_CACHE.get(key)
    const count = raw ? parseInt(raw, 10) || 0 : 0
    if (count >= limit) return { ok: false, remaining: 0 }
    // TTL = fin de fenêtre + 1s, KV minimum 60s
    const ttl = Math.max(60, (windowStart + windowSec) - now + 1)
    await env.WIKOT_CACHE.put(key, String(count + 1), { expirationTtl: ttl })
    return { ok: true, remaining: limit - count - 1 }
  } catch {
    return { ok: true, remaining: limit } // fail-open
  }
}

// Helper pour réponse 429
function rateLimitedResponse(c: any, retryAfter: number) {
  return c.json(
    { error: 'Trop de requêtes, veuillez patienter quelques instants.' },
    429,
    { 'Retry-After': String(retryAfter) }
  )
}

// ============================================
// WIKOT — AGENT IA (OpenRouter + Gemini 2.0 Flash)
// ============================================

const WIKOT_MODEL = 'google/gemini-2.0-flash-001'
// Modèle multimodal (vision + audio) — utilisé dès qu'il y a une image/audio dans la requête.
// Coût input ~$0.30/M tok (vs $0.10 pour 2.0 Flash) → on bascule auto seulement quand nécessaire.
const WIKOT_MODEL_MULTIMODAL = 'google/gemini-2.5-flash'
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
// OPTIMISATION : les 4 requêtes sont exécutées en parallèle (Promise.all)
// au lieu de séquentiellement → divise le temps réseau D1 par ~4 (~30ms gagnés).
async function buildHotelArborescence(db: D1Database, hotelId: number): Promise<string> {
  const [cats, procs, infoCats, infoItems] = await Promise.all([
    db.prepare('SELECT id, name FROM categories WHERE hotel_id = ? ORDER BY sort_order, name').bind(hotelId).all(),
    db.prepare('SELECT id, title, category_id, trigger_event FROM procedures WHERE hotel_id = ? ORDER BY title').bind(hotelId).all(),
    db.prepare('SELECT id, name FROM hotel_info_categories WHERE hotel_id = ? ORDER BY sort_order, name').bind(hotelId).all(),
    db.prepare('SELECT id, title, category_id FROM hotel_info_items WHERE hotel_id = ? ORDER BY title').bind(hotelId).all()
  ])

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

// Détecte si un message OpenAI contient au moins une partie multimodale
// (image_url ou input_audio). Si oui, on doit basculer sur un modèle multimodal.
function messagesHaveMultimodalContent(messages: any[]): boolean {
  for (const m of messages) {
    if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part && typeof part === 'object' && (part.type === 'image_url' || part.type === 'input_audio' || part.type === 'audio_url')) {
          return true
        }
      }
    }
  }
  return false
}

// Appelle OpenRouter — choisit automatiquement le modèle :
// - texte pur : Gemini 2.0 Flash (rapide, $0.10/M)
// - dès qu'il y a une image OU un audio : Gemini 2.5 Flash (multimodal, $0.30/M)
async function callOpenRouter(apiKey: string, messages: any[], tools: any[]): Promise<any> {
  const useMultimodal = messagesHaveMultimodalContent(messages)
  const model = useMultimodal ? WIKOT_MODEL_MULTIMODAL : WIKOT_MODEL
  const res = await fetch(WIKOT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wikot.fr',
      'X-Title': 'Wikot'
    },
    body: JSON.stringify({
      model,
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

// Appel direct multimodal (sans tools) — utilisé pour l'extraction structurée
// d'informations depuis un document image/PDF (Code Wikot, Restaurant import).
// Force le modèle 2.5 Flash et réclame une réponse JSON pure.
async function callGeminiVisionExtraction(
  apiKey: string,
  systemPrompt: string,
  userText: string,
  fileBase64: string,
  fileMime: string
): Promise<any> {
  // Pour un PDF ou une image, on utilise le format OpenAI image_url avec data URL.
  // OpenRouter route ça vers Gemini qui sait lire image/* et application/pdf.
  const dataUrl = `data:${fileMime};base64,${fileBase64}`
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ]
  const res = await fetch(WIKOT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wikot.fr',
      'X-Title': 'Wikot Vision'
    },
    body: JSON.stringify({
      model: WIKOT_MODEL_MULTIMODAL,
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter vision ${res.status}: ${text}`)
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

// Diagnostic OpenRouter — protégé par authMiddleware + super-admin uniquement
// (avant : public ; risque de fuite de la prefix/suffix de la clé + abus de quota)
app.get('/api/_diag/openrouter', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!isSuperAdmin(user)) return c.json({ error: 'Non autorisé' }, 403)
  const apiKey = c.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return c.json({ ok: false, stage: 'binding', error: 'OPENROUTER_API_KEY not bound' }, 503)
  }
  const keyInfo = { length: apiKey.length, prefix: apiKey.slice(0, 6) + '...', suffix: '...' + apiKey.slice(-2) }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wikot.fr',
        'X-Title': 'Wikot Diag'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5
      })
    })
    return c.json({ ok: res.ok, stage: 'openrouter', status: res.status, keyInfo })
  } catch (e: any) {
    return c.json({ ok: false, stage: 'fetch', keyInfo, error: e.message }, 500)
  }
})

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
    WHERE user_id = ? AND mode = ?
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

// GET détail d'une conversation
// STATELESS : on n'enregistre plus la mémoire des messages → messages: [].
// On retourne toujours les pending_actions (workflow Back Wikot) qui restent persistées.
app.get('/api/wikot/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const conv = await c.env.DB.prepare('SELECT * FROM wikot_conversations WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!conv) return c.json({ error: 'Conversation introuvable' }, 404)

  const actions = await c.env.DB.prepare(`
    SELECT id, message_id, action_type, payload, before_snapshot, status, result_id
    FROM wikot_pending_actions
    WHERE conversation_id = ?
    ORDER BY created_at
  `).bind(id).all()

  return c.json({ conversation: conv, messages: [], actions: actions.results })
})

// DELETE supprime définitivement une conversation (staff)
// La mémoire des anciennes conversations Wikot a été retirée → on supprime
// vraiment au lieu d'archiver, et on nettoie les audios R2 associés.
app.delete('/api/wikot/conversations/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const conv = await c.env.DB.prepare(
    'SELECT id, user_id, hotel_id FROM wikot_conversations WHERE id = ?'
  ).bind(id).first<any>()
  if (!conv) return c.json({ error: 'Conversation introuvable' }, 404)
  if (conv.user_id !== user.id) return c.json({ error: 'Accès refusé' }, 403)
  if (conv.hotel_id !== user.hotel_id && user.role !== 'super_admin') {
    return c.json({ error: 'Accès refusé' }, 403)
  }

  // STATELESS : on ne stocke plus les messages → plus d'audio_key persistés en DB
  // (les audios R2 sont nettoyés par le cron cleanup périodique).
  // Suppression DB en cascade (pending_actions via FK CASCADE).
  await c.env.DB.prepare('DELETE FROM wikot_conversations WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// POST envoyer un message → réponse Wikot
app.post('/api/wikot/conversations/:id/message', authMiddleware, async (c) => {
  const user = c.get('user')
  // Rate-limit : max 30 messages Wikot / minute / user
  const rl = await checkRateLimit(c.env, 'wikot_msg', `u:${user.id}`, 30, 60)
  if (!rl.ok) return rateLimitedResponse(c, 60)
  const convId = parseInt(c.req.param('id'))
  const body = await c.req.json() as any
  const content = body.content
  // Audio optionnel : le frontend a uploadé l'audio puis nous passe la clé
  const audioKey: string | null = body.audio_key || null
  const audioMime: string | null = body.audio_mime || null
  const audioDurationMs: number = parseInt(body.audio_duration_ms || 0, 10) || 0
  const audioSizeBytes: number = parseInt(body.audio_size_bytes || 0, 10) || 0
  // Le frontend envoie l'état actuel du formulaire (Back Wikot uniquement) pour que
  // l'IA voie ce que voit l'utilisateur en ce moment et puisse écrire dedans.
  const formContext = body.form_context || null

  // Au moins du texte OU un audio (un message vocal seul est valide)
  const hasText = !!(content && String(content).trim())
  const hasAudio = !!audioKey
  if (!hasText && !hasAudio) return c.json({ error: 'Message vide' }, 400)
  if (!user.hotel_id) return c.json({ error: 'Aucun hôtel' }, 400)

  // Vérifier que l'audio (si fourni) appartient bien à cet hôtel
  if (audioKey) {
    const parts = audioKey.split('/')
    if (parts.length < 3 || parts[1] !== String(user.hotel_id)) {
      return c.json({ error: 'Audio non autorisé' }, 403)
    }
  }

  const apiKey = c.env.OPENROUTER_API_KEY
  if (!apiKey) return c.json({ error: 'Wikot indisponible : clé API non configurée' }, 503)

  // Vérifier que la conversation appartient bien à l'utilisateur
  const conv = await c.env.DB.prepare('SELECT * FROM wikot_conversations WHERE id = ? AND user_id = ?').bind(convId, user.id).first() as any
  if (!conv) return c.json({ error: 'Conversation introuvable' }, 404)

  // STATELESS : pas de persistance message. Chaque message est traité indépendamment.
  // → moins de tokens OpenRouter, moins de CPU, moins d'écritures D1, UX plus simple.
  // On garde uniquement le message courant (user) en mémoire pour l'envoyer au LLM.
  const history = { results: [{
    role: 'user',
    content: hasText ? content : '',
    tool_calls: null,
    tool_call_id: null,
    audio_key: audioKey,
    audio_mime: audioMime
  }] as any[] }

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
  // Pour le DERNIER message utilisateur uniquement, si audio présent, on inline en multimodal.
  // (On évite d'inliner toute la conversation pour éviter de payer le coût audio à chaque tour.)
  const historyArr = history.results as any[]
  const oaiMessages: any[] = [{ role: 'system', content: systemPrompt }]
  for (let i = 0; i < historyArr.length; i++) {
    const m = historyArr[i]
    const isLastUser = (i === historyArr.length - 1) && m.role === 'user' && m.audio_key
    if (m.role === 'user') {
      if (isLastUser && c.env.AUDIO_BUCKET) {
        // Construit un message multimodal avec parts texte + audio
        const audio = await r2AudioToDataUri(c.env.AUDIO_BUCKET, m.audio_key)
        const parts: any[] = []
        const txt = (m.content && m.content.trim()) ? m.content : 'Voici un message vocal. Réponds à son contenu.'
        parts.push({ type: 'text', text: txt })
        if (audio) {
          // Format compatible OpenRouter / Gemini multimodal : data URI dans audio_url
          parts.push({ type: 'audio_url', audio_url: { url: audio.dataUri } })
        }
        oaiMessages.push({ role: 'user', content: parts })
      } else {
        // Si message ancien avec audio mais pas inliné, on l'indique en texte pour le contexte
        const prefix = m.audio_key ? '[message vocal] ' : ''
        oaiMessages.push({ role: 'user', content: prefix + (m.content || '') })
      }
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
        // OPTIM N+1 → 1 seule requête : on récupère TOUTES les étapes des sous-procédures
        // d'un coup avec un IN (...) plutôt qu'un SELECT par étape liée.
        const linkedIds = Array.from(new Set(
          (stepsRes.results as any[])
            .map(s => s.linked_procedure_id)
            .filter((v): v is number => Number.isInteger(v))
        ))
        const linkedStepsByProc = new Map<number, any[]>()
        if (linkedIds.length > 0) {
          const placeholders = linkedIds.map(() => '?').join(',')
          const allSubSteps = await c.env.DB.prepare(`
            SELECT procedure_id, step_number, title, content
            FROM steps
            WHERE procedure_id IN (${placeholders})
            ORDER BY procedure_id, step_number
          `).bind(...linkedIds).all()
          for (const ss of (allSubSteps.results as any[])) {
            const arr = linkedStepsByProc.get(ss.procedure_id) || []
            arr.push({ step_number: ss.step_number, title: ss.title, content: ss.content })
            linkedStepsByProc.set(ss.procedure_id, arr)
          }
        }
        const steps: any[] = []
        for (const st of (stepsRes.results as any[])) {
          const linkedSteps = st.linked_procedure_id
            ? (linkedStepsByProc.get(st.linked_procedure_id) || [])
            : []
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
  // STATELESS : on ne persiste plus les messages. On utilise des IDs synthétiques
  // (timestamp + random) pour que le frontend puisse continuer à les référencer en mémoire.
  const now = Date.now()
  const userMsgId = now
  const assistantMsgId = now + 1

  // Sauvegarder les propositions en pending_actions (table conservée : workflow réel)
  // message_id est désormais nullable (FK vers wikot_messages supprimée par migration).
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
      VALUES (?, NULL, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      convId, user.hotel_id, user.id,
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

  // STATELESS : pas de re-titrage à chaque message. On met juste à jour updated_at
  // (utile pour purger les conversations inactives si besoin).
  await c.env.DB.prepare('UPDATE wikot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(convId).run()

  return c.json({
    user_message_id: userMsgId,
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
  // SÉCURITÉ: on force le hotel_id du user (pas de query override)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ rooms: [] })
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
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const raw = await c.req.json().catch(() => null)
  const v = validateBody<{ room_number: string; floor?: string; capacity?: number; sort_order?: number }>(raw, {
    room_number: 'string:1-30',
    floor: 'string?:0-30',
    capacity: 'int?:1-20',
    sort_order: 'int?:0-100000'
  })
  if (!v.ok) return bad(c, v.error!)

  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO rooms (hotel_id, room_number, floor, capacity, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).bind(hotelId, v.data!.room_number, v.data!.floor || null, v.data!.capacity || 2, v.data!.sort_order || 0).run()
    const roomId = result.meta.last_row_id

    // Création automatique du compte client associé (inactif au départ)
    await c.env.DB.prepare(`
      INSERT INTO client_accounts (hotel_id, room_id, is_active) VALUES (?, ?, 0)
    `).bind(hotelId, roomId).run()

    return c.json({ id: roomId, room_number: v.data!.room_number })
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
// LEGACY — conservé pour rétrocompatibilité, mais le bouton frontend a été retiré.
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
// CODE HÔTEL — Mise à jour du code de connexion client
// ============================================
app.put('/api/occupancy/hotel-code', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Non autorisé' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const body = await c.req.json() as { code?: string }
  const rawCode = (body.code || '').trim().toUpperCase()
  if (rawCode.length < 3 || rawCode.length > 32) {
    return c.json({ error: 'Code invalide (3 à 32 caractères)' }, 400)
  }
  // Caractères autorisés : alphanumérique + tirets/underscores
  if (!/^[A-Z0-9_-]+$/.test(rawCode)) {
    return c.json({ error: 'Caractères autorisés : A-Z, 0-9, tirets et underscores' }, 400)
  }
  // Unicité globale
  const existing = await c.env.DB.prepare(
    'SELECT id FROM hotels WHERE client_login_code = ? AND id != ?'
  ).bind(rawCode, hotelId).first()
  if (existing) return c.json({ error: 'Ce code est déjà utilisé par un autre hôtel' }, 409)

  await c.env.DB.prepare(
    'UPDATE hotels SET client_login_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(rawCode, hotelId).run()

  return c.json({ success: true, code: rawCode })
})

// ============================================
// IMPORT IA — Documents clients (Code Wikot) & réservations (Restaurant)
// Reçoit un fichier (image/PDF) en multipart, l'envoie à Gemini 2.5 Flash
// avec un prompt structuré, renvoie un JSON de lignes pré-remplies.
// L'utilisateur doit ensuite valider manuellement avant application.
// ============================================

const OCCUPANCY_EXTRACTION_PROMPT = `Tu es un expert en extraction de données depuis des documents hôteliers.
Tu analyses un document (image, PDF, capture d'écran) listant les clients présents dans un hôtel.

OBJECTIF : Extraire pour chaque client occupant une chambre :
- room_number : numéro de chambre (string, garder le format exact, ex : "101", "12B")
- guest_name : nom complet du client (string, en respectant la casse "Prénom NOM" ou "M. DUPONT")
- checkout_date : date de départ au format ISO YYYY-MM-DD (string)

ADAPTABILITÉ :
- Le document peut être une capture d'écran d'un PMS (Mews, Opera, Misterbooking, ASTERIO, Thais, etc.)
- Il peut être au format tableau, liste, planning Gantt, fichier Excel exporté
- Les colonnes peuvent avoir des noms variés : "Chambre"/"Room"/"N°", "Nom"/"Client"/"Guest"/"Hôte", "Départ"/"Check-out"/"Out"/"Sortie"
- Les dates peuvent être au format DD/MM/YYYY, MM/DD/YYYY, "5 mai 2026", "05-05-26"
- Tu dois CHERCHER chirurgicalement ces 3 informations même si la mise en page est inhabituelle

RÈGLES :
- Si une date est ambiguë (DD/MM vs MM/DD), considère le format européen DD/MM par défaut
- Si l'année n'est pas indiquée, utilise l'année courante
- Ignore les chambres marquées "libre", "vide", "vacant", "available", "OOO" (out of order)
- Conserve les majuscules/minuscules du nom telles qu'écrites dans le document
- Si tu ne trouves aucun client : renvoie une liste vide

FORMAT DE RÉPONSE — JSON STRICT uniquement, sans texte autour :
{
  "rows": [
    { "room_number": "101", "guest_name": "Jean DUPONT", "checkout_date": "2026-05-09" },
    ...
  ]
}`

const RESTAURANT_EXTRACTION_PROMPT = `Tu es un expert en extraction de données depuis des documents de réservations restaurant/petit-déjeuner d'un hôtel.

OBJECTIF : Extraire chaque réservation avec :
- date : date de la réservation au format ISO YYYY-MM-DD
- meal_type : "breakfast" (petit-déj), "lunch" (déjeuner) ou "dinner" (dîner)
- time : heure au format HH:MM (24h)
- guest_name : nom du client (string)
- guests_count : nombre de personnes (entier, défaut 1)
- room_number : numéro de chambre si mentionné (string, sinon "")
- notes : note libre si présente (allergies, préférences, etc., sinon "")

ADAPTABILITÉ :
- Le document peut être un export PMS, un tableau Word/Excel, un planning manuscrit photographié
- Les libellés peuvent varier : "Petit-déj"/"Breakfast"/"PDJ", "Déj"/"Lunch"/"Midi", "Dîner"/"Dinner"/"Soir"
- Les heures peuvent être 8h, 8:00, 08:00, "à 20h30"
- Tu dois t'adapter à toutes les mises en page possibles

RÈGLES :
- Format européen DD/MM par défaut pour les dates ambiguës
- Si le repas est seulement implicite (heure < 11h = breakfast, 11h-15h = lunch, >18h = dinner)
- Si guests_count absent, défaut = 1
- Ignore les réservations annulées (rayées, "annulé", "cancelled")
- Si aucune réservation : liste vide

FORMAT DE RÉPONSE — JSON STRICT uniquement :
{
  "rows": [
    { "date": "2026-05-08", "meal_type": "breakfast", "time": "08:00", "guest_name": "Jean DUPONT", "guests_count": 2, "room_number": "101", "notes": "" },
    ...
  ]
}`

// Helper : convertir un ArrayBuffer en base64 (compatible Workers, sans Buffer)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(chunk) as any)
  }
  return btoa(binary)
}

// Helper : SHA-256 d'un ArrayBuffer → hex (32 caractères suffisent pour clé KV)
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer)
  const hashArr = Array.from(new Uint8Array(hashBuf))
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

// POST /api/ai-import/occupancy — extraction clients (Code Wikot)
app.post('/api/ai-import/occupancy', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Permission requise' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)
  // Rate-limit : max 10 imports IA / minute / user (gros consommateur tokens)
  const rl = await checkRateLimit(c.env, 'ai_import', `u:${user.id}`, 10, 60)
  if (!rl.ok) return rateLimitedResponse(c, 60)

  const apiKey = c.env.OPENROUTER_API_KEY
  if (!apiKey) return c.json({ error: 'Wikot indisponible : clé API non configurée' }, 503)

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'Fichier manquant' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Fichier trop lourd (max 10 Mo)' }, 413)

  const mime = file.type || 'application/octet-stream'
  const buf = await file.arrayBuffer()

  // PERF/COÛT : cache OpenRouter par hash SHA-256 du fichier (1h)
  // Évite de relancer une extraction identique si l'utilisateur réimporte le même PDF.
  // Économie typique 50-80% sur la facture OpenRouter en usage normal (les imports
  // sont souvent retentés en cas d'erreur d'application côté UI).
  const fileHash = await sha256Hex(buf)
  const aiCacheKey = `ai:occupancy:${fileHash}`
  let parsed: any = null
  if (c.env.WIKOT_CACHE) {
    try {
      const cached = await c.env.WIKOT_CACHE.get(aiCacheKey, 'json')
      if (cached) parsed = cached
    } catch {}
  }

  if (!parsed) {
    const b64 = arrayBufferToBase64(buf)
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      const userText = `Aujourd'hui : ${todayStr}. Extrais tous les clients en chambre de ce document.`
      const resp = await callGeminiVisionExtraction(apiKey, OCCUPANCY_EXTRACTION_PROMPT, userText, b64, mime)
      const content = resp?.choices?.[0]?.message?.content || ''
      parsed = typeof content === 'string' ? JSON.parse(content) : content
    } catch (e: any) {
      return c.json({ error: 'Échec de l\'analyse : ' + (e?.message || 'erreur inconnue') }, 500)
    }
    if (c.env.WIKOT_CACHE && parsed) {
      try { await c.env.WIKOT_CACHE.put(aiCacheKey, JSON.stringify(parsed), { expirationTtl: 3600 }) } catch {}
    }
  }

  const rows = Array.isArray(parsed?.rows) ? parsed.rows : []

  // On persiste l'import brut pour audit / replay
  const ins = await c.env.DB.prepare(
    `INSERT INTO ai_imports (hotel_id, import_type, source_filename, source_mime, raw_extraction, rows_count, created_by)
     VALUES (?, 'occupancy', ?, ?, ?, ?, ?)`
  ).bind(hotelId, file.name || null, mime, JSON.stringify(parsed), rows.length, user.id).run()

  return c.json({ import_id: ins.meta.last_row_id, rows })
})

// POST /api/ai-import/restaurant — extraction réservations (Restaurant)
app.post('/api/ai-import/restaurant', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Permission requise' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)
  // Rate-limit : max 10 imports IA / minute / user
  const rl = await checkRateLimit(c.env, 'ai_import', `u:${user.id}`, 10, 60)
  if (!rl.ok) return rateLimitedResponse(c, 60)

  const apiKey = c.env.OPENROUTER_API_KEY
  if (!apiKey) return c.json({ error: 'Wikot indisponible : clé API non configurée' }, 503)

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'Fichier manquant' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Fichier trop lourd (max 10 Mo)' }, 413)

  const mime = file.type || 'application/octet-stream'
  const buf = await file.arrayBuffer()

  // PERF/COÛT : cache OpenRouter par hash SHA-256 du fichier (1h)
  const fileHash = await sha256Hex(buf)
  const aiCacheKey = `ai:restaurant:${fileHash}`
  let parsed: any = null
  if (c.env.WIKOT_CACHE) {
    try {
      const cached = await c.env.WIKOT_CACHE.get(aiCacheKey, 'json')
      if (cached) parsed = cached
    } catch {}
  }

  if (!parsed) {
    const b64 = arrayBufferToBase64(buf)
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      const userText = `Aujourd'hui : ${todayStr}. Extrais toutes les réservations de ce document.`
      const resp = await callGeminiVisionExtraction(apiKey, RESTAURANT_EXTRACTION_PROMPT, userText, b64, mime)
      const content = resp?.choices?.[0]?.message?.content || ''
      parsed = typeof content === 'string' ? JSON.parse(content) : content
    } catch (e: any) {
      return c.json({ error: 'Échec de l\'analyse : ' + (e?.message || 'erreur inconnue') }, 500)
    }
    if (c.env.WIKOT_CACHE && parsed) {
      try { await c.env.WIKOT_CACHE.put(aiCacheKey, JSON.stringify(parsed), { expirationTtl: 3600 }) } catch {}
    }
  }

  const rows = Array.isArray(parsed?.rows) ? parsed.rows : []
  const ins = await c.env.DB.prepare(
    `INSERT INTO ai_imports (hotel_id, import_type, source_filename, source_mime, raw_extraction, rows_count, created_by)
     VALUES (?, 'restaurant', ?, ?, ?, ?, ?)`
  ).bind(hotelId, file.name || null, mime, JSON.stringify(parsed), rows.length, user.id).run()

  return c.json({ import_id: ins.meta.last_row_id, rows })
})

// POST /api/ai-import/occupancy/apply — applique les lignes validées par l'utilisateur
app.post('/api/ai-import/occupancy/apply', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditClients(user)) return c.json({ error: 'Permission requise' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const body = await c.req.json() as { import_id?: number; rows: Array<{ room_number: string; guest_name: string; checkout_date?: string }> }
  if (!Array.isArray(body.rows)) return c.json({ error: 'Format invalide' }, 400)

  const todayStr = new Date().toISOString().slice(0, 10)
  let applied = 0
  const errors: any[] = []

  // OPTIMISATION : on charge en 1 seule requête toutes les chambres actives
  // de l'hôtel pour faire le lookup en mémoire (évite N requêtes SELECT).
  const allRooms = await c.env.DB.prepare(
    'SELECT id, room_number FROM rooms WHERE hotel_id = ? AND is_active = 1'
  ).bind(hotelId).all()
  const roomMap = new Map<string, number>()
  for (const room of (allRooms.results || []) as any[]) {
    roomMap.set(String(room.room_number).trim(), room.id)
  }

  // Préparer les statements une seule fois (réutilisables avec bind)
  const updateStmt = c.env.DB.prepare(`
    UPDATE client_accounts
    SET guest_name = ?, guest_name_normalized = ?, checkout_date = ?, is_active = 1,
        session_valid_until = ?, updated_at = CURRENT_TIMESTAMP
    WHERE hotel_id = ? AND room_id = ?
  `)
  const deleteSessStmt = c.env.DB.prepare(
    'DELETE FROM client_sessions WHERE client_account_id IN (SELECT id FROM client_accounts WHERE hotel_id = ? AND room_id = ?)'
  )
  const insertOccStmt = c.env.DB.prepare(`
    INSERT INTO room_occupancy (hotel_id, room_id, occupancy_date, guest_name, guest_name_normalized, checkout_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  // OPTIMISATION : on accumule toutes les writes pour les exécuter en 1 seul batch
  // (atomique + 1 seul round-trip au lieu de 3*N).
  const batchOps: D1PreparedStatement[] = []
  for (const r of body.rows) {
    const roomNum = String(r.room_number || '').trim()
    const guest = String(r.guest_name || '').trim()
    if (!roomNum || !guest) { errors.push({ row: r, error: 'Champs incomplets' }); continue }
    const roomId = roomMap.get(roomNum)
    if (!roomId) { errors.push({ row: r, error: `Chambre ${roomNum} introuvable` }); continue }

    const normalized = normalizeName(guest)
    const checkoutDate = r.checkout_date || todayStr

    batchOps.push(updateStmt.bind(guest, normalized, checkoutDate, checkoutDate + ' 12:00:00', hotelId, roomId))
    batchOps.push(deleteSessStmt.bind(hotelId, roomId))
    batchOps.push(insertOccStmt.bind(hotelId, roomId, todayStr, guest, normalized, checkoutDate, user.id))
    applied++
  }

  if (body.import_id) {
    batchOps.push(c.env.DB.prepare(
      'UPDATE ai_imports SET applied_at = CURRENT_TIMESTAMP, applied_by = ? WHERE id = ? AND hotel_id = ?'
    ).bind(user.id, body.import_id, hotelId))
  }

  if (batchOps.length > 0) {
    await c.env.DB.batch(batchOps)
  }

  return c.json({ success: true, applied, errors })
})

// POST /api/ai-import/restaurant/apply — applique les réservations validées
app.post('/api/ai-import/restaurant/apply', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canEditRestaurant(user)) return c.json({ error: 'Permission requise' }, 403)
  const hotelId = user.hotel_id
  if (!hotelId) return c.json({ error: 'Hôtel non défini' }, 400)

  const body = await c.req.json() as { import_id?: number; rows: Array<{ date: string; meal_type: string; time?: string; guest_name: string; guests_count?: number; room_number?: string; notes?: string }> }
  if (!Array.isArray(body.rows)) return c.json({ error: 'Format invalide' }, 400)

  let applied = 0
  const errors: any[] = []

  // OPTIMISATION : on charge en 1 seule requête toutes les chambres actives
  // pour faire le mapping room_number -> id en mémoire (évite N requêtes).
  const allRooms = await c.env.DB.prepare(
    'SELECT id, room_number FROM rooms WHERE hotel_id = ? AND is_active = 1'
  ).bind(hotelId).all()
  const roomMap = new Map<string, number>()
  for (const room of (allRooms.results || []) as any[]) {
    roomMap.set(String(room.room_number).trim(), room.id)
  }

  // Statement préparé réutilisable
  const insertStmt = c.env.DB.prepare(`
    INSERT INTO restaurant_reservations
      (hotel_id, room_id, reservation_date, meal_type, time_slot, guest_count, guest_name, notes, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `)

  // OPTIMISATION : batch toutes les insertions
  const batchOps: D1PreparedStatement[] = []
  for (const r of body.rows) {
    if (!r.date || !r.guest_name) { errors.push({ row: r, error: 'Champs incomplets' }); continue }
    const meal = ['breakfast', 'lunch', 'dinner'].includes(r.meal_type) ? r.meal_type : 'breakfast'

    const roomId = r.room_number ? (roomMap.get(String(r.room_number).trim()) || null) : null

    const noteWithTag = (r.notes || '').toString().trim()
    const finalNotes = noteWithTag ? `${noteWithTag} [import IA]` : '[import IA]'

    batchOps.push(insertStmt.bind(
      hotelId,
      roomId,
      r.date,
      meal,
      r.time || null,
      r.guests_count || 1,
      String(r.guest_name).trim(),
      finalNotes,
      user.id
    ))
    applied++
  }

  if (batchOps.length > 0) {
    try {
      await c.env.DB.batch(batchOps)
    } catch (e: any) {
      // En cas d'échec batch, on retombe en mode unitaire pour identifier les rows fautives
      applied = 0
      for (let i = 0; i < batchOps.length; i++) {
        try {
          await batchOps[i].run()
          applied++
        } catch (err: any) {
          errors.push({ row_index: i, error: err?.message || 'Insert failed' })
        }
      }
    }
  }

  if (body.import_id) {
    await c.env.DB.prepare(
      'UPDATE ai_imports SET applied_at = CURRENT_TIMESTAMP, applied_by = ? WHERE id = ? AND hotel_id = ?'
    ).bind(user.id, body.import_id, hotelId).run()
  }

  return c.json({ success: true, applied, errors })
})

// ============================================
// MODULE TASKS — "À faire" (templates récurrents + instances datées + assignments)
// Permissions : can_create_tasks (créer/éditer), can_assign_tasks (attribuer)
// Voir + valider sa tâche = par défaut pour tous (rôle admin/employee)
// ============================================

function canCreateTasks(user: WikotUser): boolean {
  return user.role === 'admin' || user.can_create_tasks === 1
}
function canAssignTasks(user: WikotUser): boolean {
  return user.role === 'admin' || user.can_assign_tasks === 1
}

// Helpers récurrence v2
// - 'daily'   → match toujours (dans la fenêtre active_from/to)
// - 'weekly'  → bitmask 7 bits (lun=bit0..dim=bit6) sur recurrence_days
// - 'monthly' → match si date.day === monthly_day (ou dernier jour du mois si monthly_day === -1)
function dateMatchesRecurrence(
  dateStr: string,
  recurrenceDays: number,
  activeFrom?: string | null,
  activeTo?: string | null,
  recurrenceType: string = 'weekly',
  monthlyDay?: number | null
): boolean {
  if (activeFrom && dateStr < activeFrom) return false
  if (activeTo && dateStr > activeTo) return false
  const d = new Date(dateStr + 'T12:00:00Z')

  if (recurrenceType === 'daily') return true

  if (recurrenceType === 'monthly') {
    if (monthlyDay == null) return false
    const dayOfMonth = d.getUTCDate()
    if (monthlyDay === -1) {
      // Dernier jour du mois : tester si demain est dans un autre mois
      const tomorrow = new Date(d.getTime() + 24 * 3600 * 1000)
      return tomorrow.getUTCMonth() !== d.getUTCMonth()
    }
    return dayOfMonth === monthlyDay
  }

  // 'weekly' (par défaut, rétrocompatible)
  const dow = d.getUTCDay()
  const mondayBased = dow === 0 ? 6 : dow - 1
  return ((recurrenceDays >> mondayBased) & 1) === 1
}

// Matérialise les instances pour une date donnée + propage les pré-assignations.
// Idempotent grâce à idx_task_instances_template_date (UNIQUE).
// Utilisée par GET /api/tasks et GET /api/tasks/week.
async function materializeTasksForDate(db: D1Database, hotelId: number, dateStr: string): Promise<void> {
  const templates = await db.prepare(
    `SELECT id, title, description, recurrence_type, recurrence_days, monthly_day,
            active_from, active_to, suggested_time, category, priority, duration_min
     FROM task_templates WHERE hotel_id = ? AND is_active = 1`
  ).bind(hotelId).all()

  const eligibleTemplates = ((templates.results || []) as any[]).filter(t =>
    dateMatchesRecurrence(dateStr, t.recurrence_days, t.active_from, t.active_to, t.recurrence_type, t.monthly_day)
  )
  if (eligibleTemplates.length === 0) return

  const tplIds = eligibleTemplates.map(t => t.id)
  const ph = tplIds.map(() => '?').join(',')
  const existing = await db.prepare(
    `SELECT template_id FROM task_instances WHERE task_date = ? AND template_id IN (${ph})`
  ).bind(dateStr, ...tplIds).all()
  const existingSet = new Set(((existing.results || []) as any[]).map((r: any) => r.template_id))
  const toCreate = eligibleTemplates.filter(t => !existingSet.has(t.id))
  if (toCreate.length === 0) return

  // Précharge les pré-assignés de tous les templates à matérialiser (1 seule requête)
  const createIds = toCreate.map(t => t.id)
  const cph = createIds.map(() => '?').join(',')
  const preAssigns = await db.prepare(
    `SELECT template_id, user_id FROM task_template_assignees WHERE template_id IN (${cph})`
  ).bind(...createIds).all()
  const assignByTpl = new Map<number, number[]>()
  for (const r of (preAssigns.results || []) as any[]) {
    if (!assignByTpl.has(r.template_id)) assignByTpl.set(r.template_id, [])
    assignByTpl.get(r.template_id)!.push(r.user_id)
  }

  // INSERT instances en batch
  const insStmts = toCreate.map(t => db.prepare(
    `INSERT OR IGNORE INTO task_instances
       (hotel_id, template_id, task_date, title, description, suggested_time, category, priority, duration_min, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(hotelId, t.id, dateStr, t.title, t.description, t.suggested_time, t.category, t.priority || 'normal', t.duration_min || null, null))
  await db.batch(insStmts)

  // Récupère les ids des instances qu'on vient de créer pour propager les assignments
  const createdRows = await db.prepare(
    `SELECT id, template_id FROM task_instances
     WHERE task_date = ? AND template_id IN (${cph})`
  ).bind(dateStr, ...createIds).all()

  const assignStmts: D1PreparedStatement[] = []
  for (const row of (createdRows.results || []) as any[]) {
    const userIds = assignByTpl.get(row.template_id) || []
    for (const uid of userIds) {
      assignStmts.push(db.prepare(
        `INSERT OR IGNORE INTO task_assignments (task_instance_id, user_id, status, assigned_by)
         VALUES (?, ?, 'pending', NULL)`
      ).bind(row.id, uid))
    }
  }
  if (assignStmts.length > 0) await db.batch(assignStmts)
}

// GET /api/tasks?date=YYYY-MM-DD — toutes les tâches du jour pour l'hôtel
// Renvoie aussi les templates manquants à générer (matérialisation lazy).
app.get('/api/tasks', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const dateStr = c.req.query('date') || new Date().toISOString().slice(0, 10)

  // 1) Matérialisation lazy : génère les instances + propage les pré-assignations
  await materializeTasksForDate(c.env.DB, user.hotel_id, dateStr)

  // 2) Récupère toutes les instances du jour avec leurs assignments
  const instances = await c.env.DB.prepare(
    `SELECT ti.id, ti.template_id, ti.task_date, ti.title, ti.description, ti.suggested_time, ti.category, ti.status, ti.is_unassigned_visible, ti.priority, ti.duration_min, ti.created_at
     FROM task_instances ti
     WHERE ti.hotel_id = ? AND ti.task_date = ?
     ORDER BY
       CASE ti.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
       COALESCE(ti.suggested_time,'99:99'),
       ti.id`
  ).bind(user.hotel_id, dateStr).all()

  const instanceIds = (instances.results || []).map((i: any) => i.id)
  let assignments: any[] = []
  if (instanceIds.length > 0) {
    const placeholders = instanceIds.map(() => '?').join(',')
    const r = await c.env.DB.prepare(
      `SELECT ta.id, ta.task_instance_id, ta.user_id, ta.status, ta.completed_at, ta.notes, ta.assigned_by, u.name as user_name
       FROM task_assignments ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.task_instance_id IN (${placeholders})`
    ).bind(...instanceIds).all()
    assignments = r.results || []
  }

  // Liste des employés du staff pour l'attribution (admin + employees)
  const staff = await c.env.DB.prepare(
    `SELECT id, name, role FROM users WHERE hotel_id = ? AND role IN ('admin','employee') ORDER BY name`
  ).bind(user.hotel_id).all()

  return c.json({
    date: dateStr,
    instances: instances.results,
    assignments,
    staff: staff.results,
    me: { id: user.id, can_create_tasks: canCreateTasks(user) ? 1 : 0, can_assign_tasks: canAssignTasks(user) ? 1 : 0 }
  })
})

// GET /api/tasks/templates — liste des modèles récurrents
app.get('/api/tasks/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const r = await c.env.DB.prepare(
    `SELECT id, title, description, recurrence_type, recurrence_days, monthly_day,
            active_from, active_to, suggested_time, category, priority, duration_min,
            is_active, created_at
     FROM task_templates WHERE hotel_id = ? ORDER BY is_active DESC, title`
  ).bind(user.hotel_id).all()
  // Charge tous les pré-assignés en 1 requête (joint pour avoir les noms)
  const tplIds = (r.results || []).map((t: any) => t.id)
  let assignsByTpl: Record<number, Array<{ user_id: number; user_name: string }>> = {}
  if (tplIds.length > 0) {
    const ph = tplIds.map(() => '?').join(',')
    const a = await c.env.DB.prepare(
      `SELECT tta.template_id, tta.user_id, u.name AS user_name
       FROM task_template_assignees tta
       JOIN users u ON u.id = tta.user_id
       WHERE tta.template_id IN (${ph})`
    ).bind(...tplIds).all()
    for (const row of (a.results || []) as any[]) {
      if (!assignsByTpl[row.template_id]) assignsByTpl[row.template_id] = []
      assignsByTpl[row.template_id].push({ user_id: row.user_id, user_name: row.user_name })
    }
  }
  const templates = (r.results || []).map((t: any) => ({ ...t, assignees: assignsByTpl[t.id] || [] }))
  return c.json({ templates })
})

// Helper : valide & normalise les champs de récurrence
function validateRecurrence(body: any): { ok: true; recurrence_type: string; recurrence_days: number; monthly_day: number | null } | { ok: false; error: string } {
  const type = body.recurrence_type || 'weekly'
  if (!['daily', 'weekly', 'monthly'].includes(type)) return { ok: false, error: 'recurrence_type invalide' }
  const recDays = Number.isFinite(body.recurrence_days) ? body.recurrence_days : 127
  if (recDays < 0 || recDays > 127) return { ok: false, error: 'recurrence_days hors plage (0-127)' }
  let monthlyDay: number | null = null
  if (type === 'monthly') {
    const md = Number.isFinite(body.monthly_day) ? body.monthly_day : null
    if (md === null || (md !== -1 && (md < 1 || md > 31))) return { ok: false, error: 'monthly_day requis (1-31 ou -1)' }
    monthlyDay = md
  }
  if (type === 'weekly' && recDays === 0) return { ok: false, error: 'Sélectionne au moins un jour de la semaine' }
  return { ok: true, recurrence_type: type, recurrence_days: recDays, monthly_day: monthlyDay }
}

// Helper : remplace les pré-assignés d'un template (delete-all + insert)
async function setTemplateAssignees(db: D1Database, hotelId: number, templateId: number, userIds: number[]): Promise<void> {
  // Sécurité : ne garder que les users de l'hôtel
  let validIds: number[] = []
  if (userIds.length > 0) {
    const ph = userIds.map(() => '?').join(',')
    const r = await db.prepare(
      `SELECT id FROM users WHERE hotel_id = ? AND id IN (${ph})`
    ).bind(hotelId, ...userIds).all()
    validIds = ((r.results || []) as any[]).map(u => u.id)
  }
  const ops: D1PreparedStatement[] = [
    db.prepare('DELETE FROM task_template_assignees WHERE template_id = ?').bind(templateId)
  ]
  for (const uid of validIds) {
    ops.push(db.prepare(
      'INSERT OR IGNORE INTO task_template_assignees (template_id, user_id) VALUES (?, ?)'
    ).bind(templateId, uid))
  }
  await db.batch(ops)
}

// POST /api/tasks/templates — créer un modèle récurrent (avec pré-assignation optionnelle)
app.post('/api/tasks/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canCreateTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const body = await c.req.json() as any
  const title = String(body.title || '').trim()
  if (!title) return c.json({ error: 'Titre requis' }, 400)
  if (title.length > 200) return c.json({ error: 'Titre trop long (max 200)' }, 400)

  const rec = validateRecurrence(body)
  if (!rec.ok) return c.json({ error: rec.error }, 400)

  const priority = ['normal', 'high', 'urgent'].includes(body.priority) ? body.priority : 'normal'
  const durationMin = Number.isFinite(body.duration_min) && body.duration_min > 0 && body.duration_min < 1440 ? body.duration_min : null
  const assigneeIds = Array.isArray(body.assignee_ids)
    ? body.assignee_ids.filter((n: any) => Number.isInteger(n))
    : []

  const r = await c.env.DB.prepare(
    `INSERT INTO task_templates
       (hotel_id, title, description, recurrence_type, recurrence_days, monthly_day,
        active_from, active_to, suggested_time, category, priority, duration_min, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.hotel_id, title,
    body.description || null, rec.recurrence_type, rec.recurrence_days, rec.monthly_day,
    body.active_from || null, body.active_to || null,
    body.suggested_time || null, body.category || null,
    priority, durationMin,
    user.id
  ).run()
  const newId = r.meta.last_row_id as number

  if (assigneeIds.length > 0) {
    await setTemplateAssignees(c.env.DB, user.hotel_id, newId, assigneeIds)
  }
  return c.json({ id: newId, success: true })
})

// PUT /api/tasks/templates/:id — modifier un modèle (incl. pré-assignation)
app.put('/api/tasks/templates/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canCreateTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  const id = parseInt(c.req.param('id'))
  const tpl = await c.env.DB.prepare('SELECT id, hotel_id FROM task_templates WHERE id = ?').bind(id).first() as any
  if (!tpl || tpl.hotel_id !== user.hotel_id) return c.json({ error: 'Template introuvable' }, 404)
  const body = await c.req.json() as any

  // Validation conditionnelle de la récurrence (seulement si fournie)
  let recType: string | null = null, recDays: number | null = null, monthlyDay: number | null | undefined = undefined
  if (body.recurrence_type !== undefined || body.recurrence_days !== undefined || body.monthly_day !== undefined) {
    const rec = validateRecurrence({
      recurrence_type: body.recurrence_type || 'weekly',
      recurrence_days: Number.isFinite(body.recurrence_days) ? body.recurrence_days : 127,
      monthly_day: body.monthly_day
    })
    if (!rec.ok) return c.json({ error: rec.error }, 400)
    recType = rec.recurrence_type
    recDays = rec.recurrence_days
    monthlyDay = rec.monthly_day
  }
  const priority = body.priority && ['normal', 'high', 'urgent'].includes(body.priority) ? body.priority : null
  const durationMin = Number.isFinite(body.duration_min) && body.duration_min > 0 && body.duration_min < 1440
    ? body.duration_min
    : (body.duration_min === null ? null : undefined)

  await c.env.DB.prepare(
    `UPDATE task_templates SET
       title = COALESCE(?, title),
       description = ?,
       recurrence_type = COALESCE(?, recurrence_type),
       recurrence_days = COALESCE(?, recurrence_days),
       monthly_day = ${monthlyDay !== undefined ? '?' : 'monthly_day'},
       active_from = ?,
       active_to = ?,
       suggested_time = ?,
       category = ?,
       priority = COALESCE(?, priority),
       duration_min = ${durationMin !== undefined ? '?' : 'duration_min'},
       is_active = COALESCE(?, is_active),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    body.title || null,
    body.description ?? null,
    recType,
    recDays,
    ...(monthlyDay !== undefined ? [monthlyDay] : []),
    body.active_from ?? null,
    body.active_to ?? null,
    body.suggested_time ?? null,
    body.category ?? null,
    priority,
    ...(durationMin !== undefined ? [durationMin] : []),
    typeof body.is_active === 'number' ? body.is_active : null,
    id
  ).run()

  // Mise à jour pré-assignés si fournie
  if (Array.isArray(body.assignee_ids)) {
    const ids = body.assignee_ids.filter((n: any) => Number.isInteger(n))
    await setTemplateAssignees(c.env.DB, user.hotel_id, id, ids)
  }
  return c.json({ success: true })
})

// DELETE /api/tasks/templates/:id — supprimer un modèle (les instances futures non générées disparaissent)
app.delete('/api/tasks/templates/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canCreateTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  const id = parseInt(c.req.param('id'))
  const tpl = await c.env.DB.prepare('SELECT id, hotel_id FROM task_templates WHERE id = ?').bind(id).first() as any
  if (!tpl || tpl.hotel_id !== user.hotel_id) return c.json({ error: 'Template introuvable' }, 404)
  await c.env.DB.prepare('DELETE FROM task_templates WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// POST /api/tasks/instances — créer une tâche ponctuelle pour une date donnée
app.post('/api/tasks/instances', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canCreateTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const body = await c.req.json() as any
  const title = String(body.title || '').trim()
  if (!title) return c.json({ error: 'Titre requis' }, 400)
  if (title.length > 200) return c.json({ error: 'Titre trop long (max 200)' }, 400)
  const date = String(body.task_date || new Date().toISOString().slice(0, 10))
  const priority = ['normal', 'high', 'urgent'].includes(body.priority) ? body.priority : 'normal'
  const durationMin = Number.isFinite(body.duration_min) && body.duration_min > 0 && body.duration_min < 1440 ? body.duration_min : null
  const assigneeIds = Array.isArray(body.assignee_ids)
    ? body.assignee_ids.filter((n: any) => Number.isInteger(n))
    : []

  const r = await c.env.DB.prepare(
    `INSERT INTO task_instances
       (hotel_id, template_id, task_date, title, description, suggested_time, category, priority, duration_min, created_by)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.hotel_id, date, title,
    body.description || null, body.suggested_time || null, body.category || null,
    priority, durationMin, user.id
  ).run()
  const newId = r.meta.last_row_id as number

  // Assignation directe à la création (gain UX énorme : 1 seul aller-retour)
  if (assigneeIds.length > 0 && canAssignTasks(user)) {
    const ph = assigneeIds.map(() => '?').join(',')
    const valid = await c.env.DB.prepare(
      `SELECT id FROM users WHERE hotel_id = ? AND id IN (${ph})`
    ).bind(user.hotel_id, ...assigneeIds).all()
    const validIds = ((valid.results || []) as any[]).map(u => u.id)
    if (validIds.length > 0) {
      const stmts = validIds.map(uid => c.env.DB.prepare(
        `INSERT OR IGNORE INTO task_assignments (task_instance_id, user_id, status, assigned_by)
         VALUES (?, ?, 'pending', ?)`
      ).bind(newId, uid, user.id))
      await c.env.DB.batch(stmts)
    }
  }
  return c.json({ id: newId, success: true })
})

// PUT /api/tasks/instances/:id — modifier une instance (titre, description, heure, priorité, etc.)
app.put('/api/tasks/instances/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canCreateTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  const id = parseInt(c.req.param('id'))
  const inst = await c.env.DB.prepare('SELECT id, hotel_id FROM task_instances WHERE id = ?').bind(id).first() as any
  if (!inst || inst.hotel_id !== user.hotel_id) return c.json({ error: 'Tâche introuvable' }, 404)
  const body = await c.req.json() as any
  const priority = body.priority && ['normal', 'high', 'urgent'].includes(body.priority) ? body.priority : null
  const durationMin = Number.isFinite(body.duration_min) && body.duration_min > 0 && body.duration_min < 1440
    ? body.duration_min
    : (body.duration_min === null ? null : undefined)
  await c.env.DB.prepare(
    `UPDATE task_instances SET
       title = COALESCE(?, title),
       description = ?,
       suggested_time = ?,
       category = ?,
       priority = COALESCE(?, priority),
       duration_min = ${durationMin !== undefined ? '?' : 'duration_min'},
       task_date = COALESCE(?, task_date),
       status = COALESCE(?, status),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    body.title || null,
    body.description ?? null,
    body.suggested_time ?? null,
    body.category ?? null,
    priority,
    ...(durationMin !== undefined ? [durationMin] : []),
    body.task_date || null,
    body.status || null,
    id
  ).run()
  return c.json({ success: true })
})

// DELETE /api/tasks/instances/:id
app.delete('/api/tasks/instances/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canCreateTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  const id = parseInt(c.req.param('id'))
  const inst = await c.env.DB.prepare('SELECT id, hotel_id FROM task_instances WHERE id = ?').bind(id).first() as any
  if (!inst || inst.hotel_id !== user.hotel_id) return c.json({ error: 'Tâche introuvable' }, 404)
  await c.env.DB.prepare('DELETE FROM task_instances WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// POST /api/tasks/instances/:id/assign — assigner ou désassigner des users
// Body : { user_ids: [1, 2, 3] } — remplace l'ensemble des assignments
app.post('/api/tasks/instances/:id/assign', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAssignTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  const id = parseInt(c.req.param('id'))
  const inst = await c.env.DB.prepare('SELECT id, hotel_id FROM task_instances WHERE id = ?').bind(id).first() as any
  if (!inst || inst.hotel_id !== user.hotel_id) return c.json({ error: 'Tâche introuvable' }, 404)
  const body = await c.req.json() as { user_ids: number[] }
  const userIds = Array.isArray(body.user_ids) ? body.user_ids.filter(n => Number.isInteger(n)) : []

  // Vérifie que tous les users appartiennent à l'hôtel
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',')
    const r = await c.env.DB.prepare(
      `SELECT id FROM users WHERE hotel_id = ? AND id IN (${placeholders})`
    ).bind(user.hotel_id, ...userIds).all()
    const valid = new Set((r.results || []).map((u: any) => u.id))
    for (const uid of userIds) {
      if (!valid.has(uid)) return c.json({ error: `User ${uid} invalide` }, 400)
    }
  }

  // Replace : delete tous puis re-insert (préserver les statuses pending sur ré-assignation
  // n'a pas de sens car on remplace l'ensemble — l'utilisateur le veut explicitement)
  // On préserve toutefois les "done" pour ne pas perdre l'historique.
  const existing = await c.env.DB.prepare(
    'SELECT user_id, status, completed_at, notes FROM task_assignments WHERE task_instance_id = ?'
  ).bind(id).all()
  const doneMap = new Map<number, any>()
  for (const a of (existing.results || []) as any[]) {
    if (a.status === 'done') doneMap.set(a.user_id, a)
  }

  // OPTIM : un seul batch atomique (DELETE + N INSERT) au lieu de N+1 round-trips D1
  const batchOps: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM task_assignments WHERE task_instance_id = ?').bind(id)
  ]
  for (const uid of userIds) {
    const previous = doneMap.get(uid)
    if (previous) {
      batchOps.push(c.env.DB.prepare(
        `INSERT INTO task_assignments (task_instance_id, user_id, status, completed_at, notes, assigned_by)
         VALUES (?, ?, 'done', ?, ?, ?)`
      ).bind(id, uid, previous.completed_at, previous.notes, user.id))
    } else {
      batchOps.push(c.env.DB.prepare(
        `INSERT INTO task_assignments (task_instance_id, user_id, status, assigned_by)
         VALUES (?, ?, 'pending', ?)`
      ).bind(id, uid, user.id))
    }
  }
  await c.env.DB.batch(batchOps)

  // Mise à jour du statut global de l'instance
  await refreshInstanceStatus(c.env.DB, id)

  return c.json({ success: true })
})

// POST /api/tasks/instances/:id/complete — l'utilisateur courant valide SA tâche
// Body : { notes?: string } — n'importe quel user assigné peut valider la sienne.
app.post('/api/tasks/instances/:id/complete', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const inst = await c.env.DB.prepare('SELECT id, hotel_id FROM task_instances WHERE id = ?').bind(id).first() as any
  if (!inst || inst.hotel_id !== user.hotel_id) return c.json({ error: 'Tâche introuvable' }, 404)
  const body = await c.req.json().catch(() => ({})) as any
  const notes = (body.notes || '').toString().trim() || null

  // Si l'utilisateur n'est pas encore assigné, on l'auto-assigne (cas tâche libre prise au vol)
  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM task_assignments WHERE task_instance_id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any

  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO task_assignments (task_instance_id, user_id, status, completed_at, notes, assigned_by)
       VALUES (?, ?, 'done', CURRENT_TIMESTAMP, ?, ?)`
    ).bind(id, user.id, notes, user.id).run()
  } else {
    await c.env.DB.prepare(
      `UPDATE task_assignments SET status = 'done', completed_at = CURRENT_TIMESTAMP, notes = ? WHERE id = ?`
    ).bind(notes, existing.id).run()
  }

  await refreshInstanceStatus(c.env.DB, id)
  return c.json({ success: true })
})

// POST /api/tasks/instances/:id/uncomplete — annule la validation de l'utilisateur courant
app.post('/api/tasks/instances/:id/uncomplete', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const inst = await c.env.DB.prepare('SELECT id, hotel_id FROM task_instances WHERE id = ?').bind(id).first() as any
  if (!inst || inst.hotel_id !== user.hotel_id) return c.json({ error: 'Tâche introuvable' }, 404)
  await c.env.DB.prepare(
    `UPDATE task_assignments SET status = 'pending', completed_at = NULL WHERE task_instance_id = ? AND user_id = ?`
  ).bind(id, user.id).run()
  await refreshInstanceStatus(c.env.DB, id)
  return c.json({ success: true })
})

// GET /api/tasks/week?start=YYYY-MM-DD — vue semaine (matrice 7 jours)
// Renvoie les instances pour 7 jours consécutifs en une seule requête.
// Matérialise les tâches récurrentes pour chaque jour de la semaine.
app.get('/api/tasks/week', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const startStr = c.req.query('start') || new Date().toISOString().slice(0, 10)

  // Calcule les 7 dates
  const dates: string[] = []
  const start = new Date(startStr + 'T12:00:00Z')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 24 * 3600 * 1000)
    dates.push(d.toISOString().slice(0, 10))
  }

  // Matérialise pour chaque jour (lazy, idempotent)
  for (const dateStr of dates) {
    await materializeTasksForDate(c.env.DB, user.hotel_id, dateStr)
  }

  // Récupère toutes les instances de la semaine en 1 seule requête
  const endStr = dates[6]
  const instances = await c.env.DB.prepare(
    `SELECT ti.id, ti.template_id, ti.task_date, ti.title, ti.description,
            ti.suggested_time, ti.category, ti.status, ti.priority, ti.duration_min
     FROM task_instances ti
     WHERE ti.hotel_id = ? AND ti.task_date >= ? AND ti.task_date <= ?
     ORDER BY ti.task_date,
       CASE ti.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
       COALESCE(ti.suggested_time,'99:99'), ti.id`
  ).bind(user.hotel_id, dates[0], endStr).all()

  const instanceIds = (instances.results || []).map((i: any) => i.id)
  let assignments: any[] = []
  if (instanceIds.length > 0) {
    const ph = instanceIds.map(() => '?').join(',')
    const r = await c.env.DB.prepare(
      `SELECT ta.task_instance_id, ta.user_id, ta.status, u.name as user_name
       FROM task_assignments ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.task_instance_id IN (${ph})`
    ).bind(...instanceIds).all()
    assignments = r.results || []
  }

  return c.json({
    start: dates[0], end: endStr, dates,
    instances: instances.results, assignments,
    me: { id: user.id, can_create_tasks: canCreateTasks(user) ? 1 : 0, can_assign_tasks: canAssignTasks(user) ? 1 : 0 }
  })
})

// GET /api/tasks/my-pending-count — badge sidebar : nombre de tâches en attente pour moi (aujourd'hui + retard)
app.get('/api/tasks/my-pending-count', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ count: 0 })
  const today = new Date().toISOString().slice(0, 10)
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt
     FROM task_assignments ta
     JOIN task_instances ti ON ti.id = ta.task_instance_id
     WHERE ta.user_id = ? AND ta.status = 'pending'
       AND ti.hotel_id = ? AND ti.task_date <= ? AND ti.status != 'cancelled'`
  ).bind(user.id, user.hotel_id, today).first() as any
  return c.json({ count: r?.cnt || 0 })
})

// Helper : recalcule le statut global de l'instance basé sur les assignments
async function refreshInstanceStatus(db: D1Database, instanceId: number) {
  const r = await db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done_count
     FROM task_assignments WHERE task_instance_id = ?`
  ).bind(instanceId).first() as any
  let status = 'pending'
  if (r && r.total > 0 && r.done_count === r.total) status = 'done'
  else if (r && r.done_count > 0) status = 'in_progress'
  await db.prepare('UPDATE task_instances SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, instanceId).run()
}

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
  // OPTIM N+1 → 2 requêtes globales : on récupère TOUTES les exceptions + le schedule
  // d'un coup, puis on calcule la capacité en mémoire (au lieu de 14j × 3 repas = 42 SELECTs).
  const days: string[] = []
  const dStart = new Date(from + 'T00:00:00Z')
  const dEnd = new Date(to + 'T00:00:00Z')
  for (let d = new Date(dStart); d <= dEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  const meals = ['breakfast', 'lunch', 'dinner']
  const [exceptionsRes, scheduleRes] = await Promise.all([
    c.env.DB.prepare(`
      SELECT exception_date, meal_type, is_open, capacity
      FROM restaurant_exceptions
      WHERE hotel_id = ? AND exception_date BETWEEN ? AND ?
    `).bind(user.hotel_id, from, to).all(),
    c.env.DB.prepare(`
      SELECT weekday, meal_type, is_open, capacity
      FROM restaurant_schedule
      WHERE hotel_id = ?
    `).bind(user.hotel_id).all()
  ])
  // Index par clé pour lookup O(1)
  const exMap = new Map<string, any>()
  for (const e of (exceptionsRes.results as any[])) exMap.set(`${e.exception_date}|${e.meal_type}`, e)
  const schMap = new Map<string, any>()
  for (const s of (scheduleRes.results as any[])) schMap.set(`${s.weekday}|${s.meal_type}`, s)

  const capacityMap: Record<string, number> = {}
  for (const day of days) {
    const weekday = new Date(day + 'T00:00:00Z').getUTCDay()
    for (const m of meals) {
      const ex = exMap.get(`${day}|${m}`)
      const cfg = ex || schMap.get(`${weekday}|${m}`)
      capacityMap[`${day}|${m}`] = (cfg && cfg.is_open) ? (cfg.capacity || 0) : 0
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
    WHERE client_account_id = ? AND mode = 'concierge'
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
  // STATELESS : pas de mémoire des anciens messages côté client → messages: [].
  return c.json({ conversation: conv, messages: [] })
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
  // Rate-limit : max 20 messages / minute / client account
  const rl = await checkRateLimit(c.env, 'wikot_msg_client', `c:${client.id}`, 20, 60)
  if (!rl.ok) return rateLimitedResponse(c, 60)
  const convId = c.req.param('id')
  const body = await c.req.json() as any
  const userMessage = String(body.content || '').trim()
  const audioKey: string | null = body.audio_key || null
  const audioMime: string | null = body.audio_mime || null
  const audioDurationMs: number = parseInt(body.audio_duration_ms || 0, 10) || 0
  const audioSizeBytes: number = parseInt(body.audio_size_bytes || 0, 10) || 0

  const hasText = !!userMessage
  const hasAudio = !!audioKey
  if (!hasText && !hasAudio) return c.json({ error: 'Message vide' }, 400)

  // Vérifier que l'audio appartient bien à cet hôtel
  if (audioKey) {
    const parts = audioKey.split('/')
    if (parts.length < 3 || parts[1] !== String(client.hotel_id)) {
      return c.json({ error: 'Audio non autorisé' }, 403)
    }
  }

  const conv = await c.env.DB.prepare(`
    SELECT id, title FROM wikot_conversations WHERE id = ? AND client_account_id = ? AND mode = 'concierge'
  `).bind(convId, client.id).first()
  if (!conv) return c.json({ error: 'Conversation non trouvée' }, 404)

  // STATELESS : on ne persiste plus le message utilisateur (mémoire retirée).
  // ID synthétique pour que le frontend puisse continuer à le référencer.
  const nowMsg = Date.now()
  const userMsgId = nowMsg

  // OPTIM : cache KV (TTL 5 min) du couple { itemsList, knowledgeBase }
  // Le catalogue change rarement (modifs côté admin) ; on évite 2 SELECT D1 par message.
  // Invalidation : on flush le cache à chaque écriture sur hotel_info_items / categories
  // (voir helper invalidateWikotCache) → ainsi le client voit ses modifs immédiatement.
  const cacheKey = `kb:${client.hotel_id}`
  let knowledgeBase = ''
  let itemsList: any[] = []
  let cached: { itemsList: any[]; knowledgeBase: string } | null = null
  if (c.env.WIKOT_CACHE) {
    try { cached = await c.env.WIKOT_CACHE.get(cacheKey, 'json') } catch {}
  }
  if (cached && Array.isArray(cached.itemsList) && typeof cached.knowledgeBase === 'string') {
    itemsList = cached.itemsList
    knowledgeBase = cached.knowledgeBase
  } else {
    const categories = await c.env.DB.prepare(`
      SELECT id, name FROM hotel_info_categories WHERE hotel_id = ? ORDER BY sort_order, name
    `).bind(client.hotel_id).all()
    const items = await c.env.DB.prepare(`
      SELECT id, category_id, title, content FROM hotel_info_items
      WHERE hotel_id = ? ORDER BY sort_order, title
    `).bind(client.hotel_id).all()
    const catMap: Record<number, string> = {}
    for (const cat of categories.results as any[]) catMap[cat.id] = cat.name
    itemsList = items.results as any[]
    knowledgeBase = itemsList.map((it: any) => {
      const preview = String(it.content || '').slice(0, 220).replace(/\s+/g, ' ').trim()
      return `[id=${it.id}] (${catMap[it.category_id] || 'Général'}) ${it.title} — ${preview}`
    }).join('\n')
    if (c.env.WIKOT_CACHE) {
      try { await c.env.WIKOT_CACHE.put(cacheKey, JSON.stringify({ itemsList, knowledgeBase }), { expirationTtl: 300 }) } catch {}
    }
  }

  // STATELESS : pas d'historique côté Front Wikot client non plus.
  // Chaque message est traité indépendamment → moins de tokens, UX plus simple.
  const historyMessages: any[] = []

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
      // Construction des messages : on inline l'audio uniquement sur le dernier message user
      const messages: any[] = [{ role: 'system', content: systemPrompt }]
      for (let i = 0; i < historyMessages.length; i++) {
        const m: any = historyMessages[i]
        const isLastUser = (i === historyMessages.length - 1) && m.role === 'user' && m.audio_key
        if (isLastUser && c.env.AUDIO_BUCKET) {
          const audio = await r2AudioToDataUri(c.env.AUDIO_BUCKET, m.audio_key)
          const parts: any[] = []
          const txt = (m.content && m.content.trim()) ? m.content : 'Voici un message vocal du client. Réponds à son contenu.'
          parts.push({ type: 'text', text: txt })
          if (audio) parts.push({ type: 'audio_url', audio_url: { url: audio.dataUri } })
          messages.push({ role: 'user', content: parts })
        } else {
          const prefix = (m.role === 'user' && m.audio_key) ? '[message vocal] ' : ''
          messages.push({ role: m.role, content: prefix + (m.content || '') })
        }
      }
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

  // STATELESS : pas de persistance message (mémoire retirée).
  // ID synthétique pour que le frontend puisse référencer le bubble en mémoire.
  const assistantMsgId = nowMsg + 1

  // Mettre à jour le titre seulement si la conversation est encore "Nouvelle conversation"
  // (premier vrai message). Plus besoin de COUNT D1 puisque pas de mémoire.
  if (hasText && conv && (conv as any).title === 'Nouvelle conversation') {
    const newTitle = userMessage.slice(0, 60)
    await c.env.DB.prepare(`UPDATE wikot_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(newTitle, convId).run()
  } else {
    await c.env.DB.prepare(`UPDATE wikot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(convId).run()
  }

  return c.json({
    user_message_id: userMsgId,
    assistant_message: {
      id: assistantMsgId,
      role: 'assistant',
      content: assistantContent,
      references_json: JSON.stringify(referencesJson)
    }
  })
})

// ============================================
// AUDIO — Upload et lecture des messages vocaux (R2 wikot-audio)
// ============================================

// Limites raisonnables pour un message vocal Wikot
const AUDIO_MAX_BYTES = 8 * 1024 * 1024 // 8 MB → ~5 min en webm/opus
const AUDIO_ALLOWED_MIME = new Set([
  'audio/webm', 'audio/webm;codecs=opus',
  'audio/ogg', 'audio/ogg;codecs=opus',
  'audio/mp4', 'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/aac'
])

function genAudioKey(scope: string, hotelId: number, ownerId: number | string): string {
  const ts = Date.now()
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${scope}/${hotelId}/${ownerId}/${ts}-${rnd}.audio`
}

function normalizeAudioMime(raw: string | null): string {
  if (!raw) return 'audio/webm'
  const m = raw.toLowerCase().split(';')[0].trim()
  return m || 'audio/webm'
}

// Upload audio (staff) — retourne audio_key à passer ensuite avec le message
app.post('/api/audio/upload', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  if (!c.env.AUDIO_BUCKET) return c.json({ error: 'Stockage audio indisponible' }, 503)
  // Rate-limit : max 30 uploads audio / minute / user
  const rl = await checkRateLimit(c.env, 'audio_up', `u:${user.id}`, 30, 60)
  if (!rl.ok) return rateLimitedResponse(c, 60)

  const contentType = normalizeAudioMime(c.req.header('Content-Type'))
  if (!AUDIO_ALLOWED_MIME.has(contentType)) {
    return c.json({ error: `Format audio non supporté (${contentType})` }, 415)
  }

  const buf = await c.req.arrayBuffer()
  if (!buf || buf.byteLength === 0) return c.json({ error: 'Audio vide' }, 400)
  if (buf.byteLength > AUDIO_MAX_BYTES) {
    return c.json({ error: `Audio trop volumineux (${Math.round(buf.byteLength/1024)} KB, max ${Math.round(AUDIO_MAX_BYTES/1024)} KB)` }, 413)
  }

  const durationMs = parseInt(c.req.header('X-Audio-Duration-Ms') || '0', 10) || 0
  const key = genAudioKey('staff', user.hotel_id, user.id)

  await c.env.AUDIO_BUCKET.put(key, buf, {
    httpMetadata: { contentType },
    customMetadata: {
      hotel_id: String(user.hotel_id),
      user_id: String(user.id),
      duration_ms: String(durationMs),
      origin: 'staff'
    }
  })

  return c.json({
    audio_key: key,
    audio_mime: contentType,
    audio_size_bytes: buf.byteLength,
    audio_duration_ms: durationMs
  })
})

// Upload audio (client en chambre)
app.post('/api/client/audio/upload', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  if (!c.env.AUDIO_BUCKET) return c.json({ error: 'Stockage audio indisponible' }, 503)
  // Rate-limit : max 20 uploads audio / minute / client account
  const rl = await checkRateLimit(c.env, 'audio_up_client', `c:${client.id}`, 20, 60)
  if (!rl.ok) return rateLimitedResponse(c, 60)

  const contentType = normalizeAudioMime(c.req.header('Content-Type'))
  if (!AUDIO_ALLOWED_MIME.has(contentType)) {
    return c.json({ error: `Format audio non supporté (${contentType})` }, 415)
  }

  const buf = await c.req.arrayBuffer()
  if (!buf || buf.byteLength === 0) return c.json({ error: 'Audio vide' }, 400)
  if (buf.byteLength > AUDIO_MAX_BYTES) {
    return c.json({ error: `Audio trop volumineux (max ${Math.round(AUDIO_MAX_BYTES/1024)} KB)` }, 413)
  }

  const durationMs = parseInt(c.req.header('X-Audio-Duration-Ms') || '0', 10) || 0
  const key = genAudioKey('client', client.hotel_id, client.id)

  await c.env.AUDIO_BUCKET.put(key, buf, {
    httpMetadata: { contentType },
    customMetadata: {
      hotel_id: String(client.hotel_id),
      client_id: String(client.id),
      duration_ms: String(durationMs),
      origin: 'client'
    }
  })

  return c.json({
    audio_key: key,
    audio_mime: contentType,
    audio_size_bytes: buf.byteLength,
    audio_duration_ms: durationMs
  })
})

// Lecture audio (staff authentifié) — restreint à son hôtel
app.get('/api/audio/:key{.+}', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!c.env.AUDIO_BUCKET) return c.json({ error: 'Stockage audio indisponible' }, 503)
  const key = c.req.param('key')
  if (!key) return c.json({ error: 'Clé manquante' }, 400)

  // Sécurité : la clé doit contenir le hotel_id de l'utilisateur (pattern scope/hotelId/...)
  const parts = key.split('/')
  if (parts.length < 3 || String(user.hotel_id) !== parts[1]) {
    return c.json({ error: 'Accès refusé' }, 403)
  }

  const obj = await c.env.AUDIO_BUCKET.get(key)
  if (!obj) return c.json({ error: 'Audio introuvable' }, 404)

  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'audio/webm')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('Content-Length', String(obj.size))
  return new Response(obj.body, { headers })
})

// Lecture audio (client en chambre)
app.get('/api/client/audio/:key{.+}', clientAuthMiddleware, async (c) => {
  const client = c.get('client')
  if (!c.env.AUDIO_BUCKET) return c.json({ error: 'Stockage audio indisponible' }, 503)
  const key = c.req.param('key')
  if (!key) return c.json({ error: 'Clé manquante' }, 400)

  const parts = key.split('/')
  if (parts.length < 3 || String(client.hotel_id) !== parts[1]) {
    return c.json({ error: 'Accès refusé' }, 403)
  }

  const obj = await c.env.AUDIO_BUCKET.get(key)
  if (!obj) return c.json({ error: 'Audio introuvable' }, 404)

  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'audio/webm')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('Content-Length', String(obj.size))
  return new Response(obj.body, { headers })
})

// Helper : convertit un objet R2 audio en data-URI base64 (pour l'envoyer au modèle multimodal)
async function r2AudioToDataUri(bucket: R2Bucket, key: string): Promise<{ dataUri: string; mime: string } | null> {
  const obj = await bucket.get(key)
  if (!obj) return null
  const mime = obj.httpMetadata?.contentType || 'audio/webm'
  const buf = await obj.arrayBuffer()
  // Encodage base64 — Workers supporte btoa avec un binary string
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any)
  }
  const b64 = btoa(binary)
  return { dataUri: `data:${mime};base64,${b64}`, mime }
}

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
            // === PALETTE PREMIUM HÔTELLERIE ===
            // brand = or champagne (CTA, badges premium, accents)
            brand: { 50:'#FBF7EE',100:'#F5ECD2',200:'#EBD8A4',300:'#DFC076',400:'#D4AC54',500:'#C9A961',600:'#A68845',700:'#7E682F',800:'#56481F',900:'#2E2611' },
            // navy = bleu nuit profond (texte, sidebar, éléments forts)
            navy: { 50:'#F4F6F9',100:'#E2E7EE',200:'#C2CCD9',300:'#94A3B8',400:'#5C7185',500:'#3A4F66',600:'#1F3147',700:'#162536',800:'#0F1B28',900:'#0A1628' },
            // cream = ivoire chaleureux (fond principal)
            cream: { 50:'#FDFCF9',100:'#FAF8F5',200:'#F5F1EA',300:'#EDE7DB',400:'#DCD3C0',500:'#C8BCA3' },
            // gold = synonyme brand pour clarté sémantique
            gold: { 400:'#D4AC54',500:'#C9A961',600:'#A68845' },
            // wine = bordeaux pour alertes premium
            wine: { 500:'#8B2635',600:'#6E1E2A',700:'#52171F' }
          },
          fontFamily: {
            display: ['Fraunces', 'Georgia', 'serif'],
            sans: ['Inter', 'system-ui', 'sans-serif']
          },
          boxShadow: {
            'premium-sm': '0 1px 2px rgba(15,27,40,0.04), 0 1px 3px rgba(15,27,40,0.06)',
            'premium': '0 4px 12px rgba(15,27,40,0.06), 0 1px 3px rgba(15,27,40,0.04)',
            'premium-lg': '0 8px 24px rgba(15,27,40,0.08), 0 2px 6px rgba(15,27,40,0.04)',
            'premium-xl': '0 16px 40px rgba(15,27,40,0.10), 0 4px 12px rgba(15,27,40,0.05)'
          }
        }
      }
    }
  </script>
  <style>
    /* === POLICES — Inter (UI) + Fraunces (titres premium) === */
    /* Une seule requête CSS pour les 2 polices, swap natif (pas de FOIT) */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap');
    * { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .font-display { font-family: 'Fraunces', Georgia, serif; letter-spacing: -0.01em; }

    /* === PALETTE CSS VARIABLES (utilisable partout) === */
    :root {
      --c-cream: #FAF8F5;
      --c-cream-deep: #F5F1EA;
      --c-navy: #0A1628;
      --c-navy-soft: #1F3147;
      --c-gold: #C9A961;
      --c-gold-light: #D4AC54;
      --c-gold-deep: #A68845;
      --c-wine: #8B2635;
      --c-line: rgba(15,27,40,0.08);
      --c-line-strong: rgba(15,27,40,0.14);
    }

    /* === ANIMATIONS LÉGÈRES (mobile-friendly, GPU only) === */
    .fade-in { animation: fadeIn 0.18s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .slide-in { animation: slideIn 0.18s ease-out; }
    @keyframes slideIn { from { transform: translateX(-8px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .pulse-dot { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

    /* === COMPOSANTS PREMIUM RÉUTILISABLES === */
    /* Card premium : fond clair, bordure subtile, ombre douce, hover-lift léger */
    .card-premium {
      background: #fff;
      border: 1px solid var(--c-line);
      border-radius: 12px;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .card-premium:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(15,27,40,0.06), 0 1px 3px rgba(15,27,40,0.04);
      border-color: var(--c-line-strong);
    }
    /* Bouton primary or champagne */
    .btn-gold {
      background: var(--c-gold);
      color: var(--c-navy);
      font-weight: 600;
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .btn-gold:hover { background: var(--c-gold-deep); color: #fff; }
    .btn-gold:active { transform: translateY(0.5px); }
    /* Bouton primary navy */
    .btn-navy {
      background: var(--c-navy);
      color: #fff;
      font-weight: 600;
      transition: background 0.15s ease;
    }
    .btn-navy:hover { background: var(--c-navy-soft); }
    /* Bouton secondaire ghost */
    .btn-ghost {
      background: transparent;
      color: var(--c-navy);
      border: 1px solid var(--c-line-strong);
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .btn-ghost:hover { background: var(--c-cream-deep); border-color: var(--c-navy-soft); }

    /* === COMPOSANTS PREMIUM (login, modals, formulaires) === */
    .input-premium {
      background: #fff;
      border: 1px solid var(--c-line-strong);
      color: var(--c-navy);
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .input-premium::placeholder { color: rgba(15,27,40,0.35); }
    .input-premium:hover { border-color: rgba(15,27,40,0.25); }
    .input-premium:focus {
      border-color: var(--c-gold);
      box-shadow: 0 0 0 3px rgba(201,169,97,0.18);
      background: #fff;
    }

    .btn-premium {
      position: relative;
      overflow: hidden;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
      box-shadow: 0 1px 2px rgba(10,22,40,0.08), 0 4px 12px rgba(10,22,40,0.06);
    }
    .btn-premium:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(10,22,40,0.10), 0 10px 24px rgba(10,22,40,0.12);
      background: var(--c-navy-soft) !important;
    }
    .btn-premium:active { transform: translateY(0); }

    /* Variante navy : alias pratique pour les CTA principaux */
    .btn-premium-navy {
      background: var(--c-navy);
      color: #fff;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
      box-shadow: 0 1px 2px rgba(10,22,40,0.08), 0 4px 12px rgba(10,22,40,0.06);
    }
    .btn-premium-navy:hover {
      transform: translateY(-1px);
      background: var(--c-navy-soft);
      box-shadow: 0 2px 4px rgba(10,22,40,0.10), 0 10px 24px rgba(10,22,40,0.12);
    }
    .btn-premium-navy:active { transform: translateY(0); }

    /* Ombrages premium pour cartes / panneaux */
    .shadow-premium-sm { box-shadow: 0 1px 2px rgba(10,22,40,0.04), 0 2px 6px rgba(10,22,40,0.04); }
    .shadow-premium    { box-shadow: 0 2px 4px rgba(10,22,40,0.05), 0 8px 20px rgba(10,22,40,0.06); }
    .shadow-premium-lg { box-shadow: 0 4px 8px rgba(10,22,40,0.06), 0 24px 48px rgba(10,22,40,0.10); }

    /* === CARTES PREMIUM === */
    .card-premium {
      background: #fff;
      border: 1px solid var(--c-line);
      border-radius: 14px;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
      overflow: hidden;
    }
    .card-premium:hover {
      border-color: rgba(201,169,97,0.35);
      box-shadow: 0 2px 4px rgba(10,22,40,0.04), 0 12px 32px rgba(10,22,40,0.08);
    }
    .card-row-premium {
      background: #fff;
      border-bottom: 1px solid var(--c-line);
      transition: background 0.15s ease, transform 0.15s ease;
    }
    .card-row-premium:last-child { border-bottom: none; }
    .card-row-premium:hover {
      background: var(--c-cream);
    }

    /* En-têtes de section façon palace */
    .section-eyebrow {
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--c-gold-deep);
      font-weight: 600;
    }
    .section-title-premium {
      font-family: 'Fraunces', Georgia, serif;
      font-weight: 600;
      letter-spacing: -0.015em;
      color: var(--c-navy);
    }
    .divider-gold {
      height: 1px;
      background: linear-gradient(to right, var(--c-gold) 0%, var(--c-gold) 40px, transparent 40px);
    }

    /* Badges & pills premium */
    .pill-premium {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: var(--c-cream-deep);
      color: var(--c-navy);
      border: 1px solid var(--c-line-strong);
    }
    .pill-gold {
      background: rgba(201,169,97,0.12);
      color: var(--c-gold-deep);
      border-color: rgba(201,169,97,0.25);
    }

    /* Modals premium */
    .modal-premium {
      background: #fff;
      border-radius: 16px;
      border: 1px solid var(--c-line);
      box-shadow: 0 4px 8px rgba(10,22,40,0.06), 0 32px 64px rgba(10,22,40,0.18);
      overflow: hidden;
    }
    .modal-header-premium {
      padding: 20px 24px;
      border-bottom: 1px solid var(--c-line);
      background: linear-gradient(180deg, #fff 0%, var(--c-cream) 100%);
      position: relative;
    }
    .modal-header-premium::after {
      content: '';
      position: absolute;
      left: 24px;
      bottom: -1px;
      width: 36px;
      height: 2px;
      background: var(--c-gold);
    }

    /* Empty state premium */
    .empty-state-premium {
      text-align: center;
      padding: 48px 24px;
    }
    .empty-state-premium .empty-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--c-cream-deep);
      color: var(--c-gold-deep);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 22px;
    }

    /* === SKELETONS (CSS pur, ultra-léger) === */
    .skeleton {
      background: linear-gradient(90deg, #ECE7DB 0%, #F5F1EA 50%, #ECE7DB 100%);
      background-size: 200% 100%;
      animation: skeletonShimmer 1.4s linear infinite;
      border-radius: 6px;
    }
    @keyframes skeletonShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    /* Désactiver les anims pour les utilisateurs qui les refusent (accessibilité + batterie) */
    @media (prefers-reduced-motion: reduce) {
      .fade-in, .slide-in, .pulse-dot, .skeleton, .card-premium { animation: none !important; transition: none !important; }
    }
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
    /* Scrollbar premium discrète, harmonisée avec la palette ivoire */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--c-cream-deep); }
    ::-webkit-scrollbar-thumb { background: #C8BCA3; border-radius: 4px; border: 2px solid var(--c-cream-deep); }
    ::-webkit-scrollbar-thumb:hover { background: var(--c-gold-deep); }
    /* Firefox */
    html { scrollbar-color: #C8BCA3 var(--c-cream-deep); scrollbar-width: thin; }
    .sidebar-item { transition: all 0.15s ease; }
    .sidebar-item:hover { background: rgba(255,255,255,0.1); }
    .sidebar-item.active { background: rgba(255,255,255,0.15); border-right: 3px solid #f59e0b; }

    /* === SIDEBAR PREMIUM (navy + champagne) === */
    .sidebar-premium {
      background: linear-gradient(180deg, var(--c-navy) 0%, #07101D 100%);
      color: #fff;
      position: relative;
    }
    .sidebar-premium::after {
      content: '';
      position: absolute;
      right: 0; top: 0; bottom: 0;
      width: 1px;
      background: linear-gradient(to bottom, transparent, rgba(201,169,97,0.25), transparent);
      pointer-events: none;
    }
    .sidebar-item-premium {
      position: relative;
      color: rgba(255,255,255,0.62);
      transition: color 0.15s ease, background 0.15s ease;
      border-left: 2px solid transparent;
    }
    .sidebar-item-premium .sidebar-icon { color: rgba(255,255,255,0.45); transition: color 0.15s ease; }
    .sidebar-item-premium:hover {
      color: #fff;
      background: rgba(255,255,255,0.04);
    }
    .sidebar-item-premium:hover .sidebar-icon { color: var(--c-gold); }
    .sidebar-item-premium.active {
      color: #fff;
      background: rgba(201,169,97,0.10);
      border-left-color: var(--c-gold);
    }
    .sidebar-item-premium.active .sidebar-icon { color: var(--c-gold); }
    .sidebar-item-premium.active .sidebar-label { font-weight: 600; }

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
<body class="min-h-screen" style="background-color: var(--c-cream); color: var(--c-navy);">
  <div id="app"></div>
  <!-- Frontend découpé en 9 modules (scope global partagé). Chargement en cascade dans l'ordre des dépendances. -->
  <script src="/static/modules/01-core.js"></script>
  <script src="/static/modules/02-auth.js"></script>
  <script src="/static/modules/03-layout.js"></script>
  <script src="/static/modules/04-procedures.js"></script>
  <script src="/static/modules/05-users-info.js"></script>
  <script src="/static/modules/06-wikot.js"></script>
  <script src="/static/modules/07-chat-modals.js"></script>
  <script src="/static/modules/08-rooms-restaurant.js"></script>
  <script src="/static/modules/09-client-init.js"></script>
</body>
</html>`)
})

// ============================================
// CRON R2 CLEANUP — supprime les audios orphelins > 24h
// ============================================
// Mode STATELESS : aucun audio n'est référencé en DB après l'envoi du message
// → tous les audios deviennent orphelins après usage. On les purge à 24h.
// La clé contient le timestamp : {scope}/{hotelId}/{ownerId}/{ts}-{rnd}.audio
async function scheduledCleanup(env: Bindings) {
  if (!env.AUDIO_BUCKET) return
  const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24h
  let cursor: string | undefined = undefined
  let deleted = 0
  let scanned = 0
  // Limite de sécurité : 50 batches max (50 * 1000 = 50k objets/exécution)
  for (let i = 0; i < 50; i++) {
    const list: R2Objects = await env.AUDIO_BUCKET.list({ limit: 1000, cursor })
    scanned += list.objects.length
    const toDelete: string[] = []
    for (const obj of list.objects) {
      // Parse le timestamp depuis la clé : .../{ts}-{rnd}.audio
      const m = obj.key.match(/\/(\d{13})-[a-z0-9]+\.audio$/)
      if (m) {
        const ts = parseInt(m[1], 10)
        if (ts < cutoff) toDelete.push(obj.key)
      } else if (obj.uploaded && obj.uploaded.getTime() < cutoff) {
        // Fallback : ancien format → on se fie à uploaded
        toDelete.push(obj.key)
      }
    }
    if (toDelete.length > 0) {
      await env.AUDIO_BUCKET.delete(toDelete)
      deleted += toDelete.length
    }
    if (!list.truncated) break
    cursor = list.cursor
  }
  console.log(`[cron] R2 cleanup: scanned=${scanned}, deleted=${deleted}`)
}

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduledCleanup(env))
  }
}
