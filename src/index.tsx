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
  can_edit_settings: number
  can_create_tasks: number
  can_assign_tasks: number
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
           u.can_edit_settings,
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
    can_manage_chat: row.can_manage_chat, can_edit_settings: row.can_edit_settings,
    can_create_tasks: row.can_create_tasks, can_assign_tasks: row.can_assign_tasks,
    is_active: row.is_active
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
           can_edit_settings,
           can_create_tasks, can_assign_tasks,
           password_hash, password_hash_v2, password_salt, password_algo
    FROM users WHERE LOWER(email) = ? AND is_active = 1
  `).bind(emailKey).first() as any

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
      can_manage_chat: user.can_manage_chat, can_edit_settings: user.can_edit_settings,
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
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.job_role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.can_edit_settings, u.can_create_tasks, u.can_assign_tasks, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id ORDER BY u.name LIMIT 2000').all()
  } else if (user.role === 'admin') {
    users = await c.env.DB.prepare('SELECT u.id, u.hotel_id, u.email, u.name, u.role, u.job_role, u.can_edit_procedures, u.can_edit_info, u.can_manage_chat, u.can_edit_settings, u.can_create_tasks, u.can_assign_tasks, u.is_active, u.last_login, u.created_at, h.name as hotel_name FROM users u LEFT JOIN hotels h ON u.hotel_id = h.id WHERE u.hotel_id = ? ORDER BY u.name LIMIT 500').bind(user.hotel_id).all()
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
  if (body.can_edit_settings !== undefined)   { fields.push('can_edit_settings = ?');   values.push(body.can_edit_settings ? 1 : 0) }
  if (body.can_create_tasks !== undefined)    { fields.push('can_create_tasks = ?');    values.push(body.can_create_tasks ? 1 : 0) }
  if (body.can_assign_tasks !== undefined)    { fields.push('can_assign_tasks = ?');    values.push(body.can_assign_tasks ? 1 : 0) }
  if (fields.length === 0) return c.json({ error: 'Aucune permission à mettre à jour' }, 400)

  values.push(id)
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// Rôles métier (différents du rôle système employee/admin/super_admin)
// Désormais dynamiques par hôtel (table job_roles). null = non défini.
// Normalisation : on convertit en slug (lowercase + alphanumérique + tirets) puis
// on valide qu'il existe pour CE hôtel. Si invalide → null.
function slugifyJobRole(v: any): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim().toLowerCase()
  if (!s) return null
  // garde lettres/chiffres/tirets/underscores
  const slug = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || null
}
async function normalizeJobRole(db: D1Database, hotelId: number | null | undefined, v: any): Promise<string | null> {
  const slug = slugifyJobRole(v)
  if (!slug || !hotelId) return null
  const row = await db.prepare('SELECT slug FROM job_roles WHERE hotel_id = ? AND slug = ?').bind(hotelId, slug).first<any>()
  return row ? row.slug : null
}

// === CRUD job_roles (admin only, scope hôtel) ===
// GET /api/job-roles → liste des rôles métiers de l'hôtel
app.get('/api/job-roles', authMiddleware, async (c) => {
  const user = c.get('user')
  // Tous les users authentifiés peuvent lire (sélecteurs dans la création utilisateur, etc.)
  if (!user.hotel_id && user.role !== 'super_admin') return c.json({ job_roles: [] })
  const hotelId = c.req.query('hotel_id')
  const targetHotel = (user.role === 'super_admin' && hotelId) ? parseInt(hotelId) : user.hotel_id
  if (!targetHotel) return c.json({ job_roles: [] })
  const r = await c.env.DB.prepare(`
    SELECT jr.id, jr.slug, jr.name, jr.created_at,
           (SELECT COUNT(*) FROM users u WHERE u.hotel_id = jr.hotel_id AND u.job_role = jr.slug) as user_count
    FROM job_roles jr
    WHERE jr.hotel_id = ?
    ORDER BY jr.name
  `).bind(targetHotel).all()
  return c.json({ job_roles: r.results })
})

// POST /api/job-roles → créer un nouveau rôle métier (admin/super_admin)
app.post('/api/job-roles', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin' && user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const body = await c.req.json() as { name?: string; hotel_id?: number }
  const name = String(body.name || '').trim()
  if (!name || name.length > 60) return c.json({ error: 'Nom requis (1-60 caractères)' }, 400)
  const targetHotel = (user.role === 'super_admin' && body.hotel_id) ? parseInt(String(body.hotel_id)) : user.hotel_id
  if (!targetHotel) return c.json({ error: 'hotel_id requis' }, 400)
  const slug = slugifyJobRole(name)
  if (!slug) return c.json({ error: 'Nom invalide' }, 400)
  // Évite les doublons (slug ou name)
  const existing = await c.env.DB.prepare('SELECT id FROM job_roles WHERE hotel_id = ? AND (slug = ? OR LOWER(name) = LOWER(?))').bind(targetHotel, slug, name).first()
  if (existing) return c.json({ error: 'Un rôle avec ce nom existe déjà' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO job_roles (hotel_id, slug, name) VALUES (?, ?, ?)').bind(targetHotel, slug, name).run()
  return c.json({ id: r.meta.last_row_id, slug, name })
})

// PUT /api/job-roles/:id → renommer un rôle (admin/super_admin)
app.put('/api/job-roles/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin' && user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json() as { name?: string }
  const name = String(body.name || '').trim()
  if (!name || name.length > 60) return c.json({ error: 'Nom requis (1-60 caractères)' }, 400)
  const target = await c.env.DB.prepare('SELECT id, hotel_id, slug FROM job_roles WHERE id = ?').bind(id).first<any>()
  if (!target) return c.json({ error: 'Rôle introuvable' }, 404)
  if (user.role === 'admin' && target.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  // On NE change PAS le slug (sinon il faudrait MAJ tous les users.job_role). On ne change que le label.
  // Vérifie doublon de name dans l'hôtel
  const dup = await c.env.DB.prepare('SELECT id FROM job_roles WHERE hotel_id = ? AND LOWER(name) = LOWER(?) AND id != ?').bind(target.hotel_id, name, id).first()
  if (dup) return c.json({ error: 'Un autre rôle a déjà ce nom' }, 400)
  await c.env.DB.prepare('UPDATE job_roles SET name = ? WHERE id = ?').bind(name, id).run()
  return c.json({ success: true, id, slug: target.slug, name })
})

// DELETE /api/job-roles/:id → supprimer un rôle (et nullifier sur les users concernés)
app.delete('/api/job-roles/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin' && user.role !== 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = parseInt(c.req.param('id'))
  const target = await c.env.DB.prepare('SELECT id, hotel_id, slug FROM job_roles WHERE id = ?').bind(id).first<any>()
  if (!target) return c.json({ error: 'Rôle introuvable' }, 404)
  if (user.role === 'admin' && target.hotel_id !== user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)
  // Nullifie le job_role des users qui l'utilisaient (pas de FK stricte, on fait à la main)
  await c.env.DB.prepare('UPDATE users SET job_role = NULL WHERE hotel_id = ? AND job_role = ?').bind(target.hotel_id, target.slug).run()
  await c.env.DB.prepare('DELETE FROM job_roles WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

app.post('/api/users', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const { hotel_id, email, password, name, role, job_role } = await c.req.json() as {
    hotel_id?: number; email?: string; password?: string; name?: string; role?: string; job_role?: string | null
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
  const finalJobRole = await normalizeJobRole(c.env.DB, targetHotel, job_role)
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
      INSERT INTO users (hotel_id, email, password_hash, password_hash_v2, password_salt, password_algo, name, role, job_role)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)
    `).bind(targetHotel, emailTrim, hash, salt, algo, nameTrim, finalRole, finalJobRole).run()
    return c.json({ id: result.meta.last_row_id, email: emailTrim, name: nameTrim, role: finalRole, job_role: finalJobRole })
  } catch (e: any) {
    return c.json({ error: 'Cet email est déjà utilisé' }, 400)
  }
})

// PUT /api/users/:id — modifier les infos d'un utilisateur (nom, email, rôle, job_role)
// Admin ne peut modifier que les users de son hôtel ; super_admin peut tout.
app.put('/api/users/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user')
  if (currentUser.role !== 'super_admin' && currentUser.role !== 'admin') return c.json({ error: 'Non autorisé' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json() as {
    name?: any; email?: any; role?: any; job_role?: any; is_active?: any
  }
  const target = await c.env.DB.prepare('SELECT id, hotel_id, role FROM users WHERE id = ?').bind(id).first() as any
  if (!target) return c.json({ error: 'Utilisateur non trouvé' }, 404)
  // Admin ne peut toucher que son hôtel et pas un super_admin
  if (currentUser.role === 'admin') {
    if (String(target.hotel_id) !== String(currentUser.hotel_id)) return c.json({ error: 'Non autorisé' }, 403)
    if (target.role === 'super_admin') return c.json({ error: 'Non autorisé' }, 403)
  }

  const fields: string[] = []
  const values: any[] = []
  if (body.name !== undefined) {
    const n = String(body.name).trim()
    if (!n || n.length > 100) return c.json({ error: 'Nom invalide' }, 400)
    fields.push('name = ?'); values.push(n)
  }
  if (body.email !== undefined) {
    const em = String(body.email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return c.json({ error: 'Email invalide' }, 400)
    fields.push('email = ?'); values.push(em)
  }
  if (body.role !== undefined) {
    const allowed = currentUser.role === 'super_admin'
      ? ['employee', 'admin', 'super_admin']
      : ['employee', 'admin'] // admin ne peut pas créer un super_admin
    const r = String(body.role)
    if (!allowed.includes(r)) return c.json({ error: 'Rôle invalide' }, 400)
    fields.push('role = ?'); values.push(r)
  }
  if (body.job_role !== undefined) {
    const normalizedJobRole = await normalizeJobRole(c.env.DB, target.hotel_id, body.job_role)
    fields.push('job_role = ?'); values.push(normalizedJobRole)
  }
  if (body.is_active !== undefined && currentUser.role === 'super_admin') {
    fields.push('is_active = ?'); values.push(body.is_active ? 1 : 0)
  }
  if (fields.length === 0) return c.json({ error: 'Aucun champ à mettre à jour' }, 400)

  values.push(id)
  try {
    await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    if (String(e?.message || '').toLowerCase().includes('unique')) {
      return c.json({ error: 'Cet email est déjà utilisé' }, 400)
    }
    return c.json({ error: 'Erreur serveur' }, 500)
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
  return user.role === 'super_admin' || user.role === 'admin' || user.can_manage_chat === 1
}

// Helper : a accès au chat (super_admin + admin + tous employees)
function canAccessChat(user: { role: string }) {
  return user.role === 'super_admin' || user.role === 'admin' || user.role === 'employee'
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

// GET /api/chat/search — Recherche globale dans les messages de l'hôtel
// Filtres optionnels : q (mot-clé), channel_id, group_id, author_id, after/before (YYYY-MM-DD), limit (1-50, défaut 20)
app.get('/api/chat/search', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user) || !user.hotel_id) return c.json({ error: 'Non autorisé' }, 403)

  const q = c.req.query('q')
  const channelId = c.req.query('channel_id')
  const groupId = c.req.query('group_id')
  const authorId = c.req.query('author_id')
  const after = c.req.query('after')
  const before = c.req.query('before')
  const limitRaw = parseInt(c.req.query('limit') || '20')
  const limit = Math.max(1, Math.min(50, isNaN(limitRaw) ? 20 : limitRaw))

  const conds: string[] = ['m.hotel_id = ?']
  const params: any[] = [user.hotel_id]
  if (q && q.trim()) { conds.push('m.content LIKE ?'); params.push('%' + q.trim() + '%') }
  if (channelId) { conds.push('m.channel_id = ?'); params.push(parseInt(channelId)) }
  if (groupId) { conds.push('ch.group_id = ?'); params.push(parseInt(groupId)) }
  if (authorId) { conds.push('m.user_id = ?'); params.push(parseInt(authorId)) }
  if (after && /^\d{4}-\d{2}-\d{2}$/.test(after)) { conds.push('date(m.created_at) >= ?'); params.push(after) }
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) { conds.push('date(m.created_at) <= ?'); params.push(before) }

  const rows = await c.env.DB.prepare(`
    SELECT m.id, m.channel_id, m.user_id, m.content, m.created_at,
           ch.name as channel_name, ch.group_id, g.name as group_name,
           u.name as author_name
    FROM chat_messages m
    JOIN chat_channels ch ON ch.id = m.channel_id
    JOIN chat_groups g ON g.id = ch.group_id
    LEFT JOIN users u ON u.id = m.user_id
    WHERE ${conds.join(' AND ')}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).bind(...params, limit).all()
  return c.json({ results: rows.results })
})

// GET /api/chat/groups — Arborescence pure (groupes + channels) sans unread, pour Back Wikot "gérer les conversations"
app.get('/api/chat/groups', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAccessChat(user)) return c.json({ error: 'Non autorisé' }, 403)
  if (!user.hotel_id) return c.json({ groups: [] })

  const groups = await c.env.DB.prepare(
    'SELECT id, name, icon, color, sort_order, is_system FROM chat_groups WHERE hotel_id = ? ORDER BY sort_order, id'
  ).bind(user.hotel_id).all()

  const channels = await c.env.DB.prepare(
    'SELECT id, group_id, name, description, icon, sort_order FROM chat_channels WHERE hotel_id = ? AND is_archived = 0 ORDER BY sort_order, id'
  ).bind(user.hotel_id).all()

  const chByGroup: Record<number, any[]> = {}
  for (const ch of (channels.results as any[])) {
    if (!chByGroup[ch.group_id]) chByGroup[ch.group_id] = []
    chByGroup[ch.group_id].push({
      id: ch.id, group_id: ch.group_id, name: ch.name,
      description: ch.description || '', icon: ch.icon || 'fa-comment'
    })
  }

  const groupsWithChannels = (groups.results as any[]).map((g: any) => ({
    id: g.id, name: g.name, icon: g.icon || 'fa-folder', color: g.color,
    sort_order: g.sort_order, is_system: !!g.is_system,
    channels: chByGroup[g.id] || []
  }))

  return c.json({ groups: groupsWithChannels })
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
// workflowMode (max uniquement) : 'gerer_procedures' | 'gerer_infos' | 'gerer_conversations' | 'gerer_taches' | null
// formContext (max uniquement) : état actuel du formulaire visible côté UI (titre/contenu/étapes)
async function buildWikotSystemPrompt(db: D1Database, user: WikotUser, hotelName: string, mode: 'standard' | 'max', workflowMode?: string | null, formContext?: any): Promise<string> {
  const arborescence = await buildHotelArborescence(db, user.hotel_id!)

  if (mode === 'standard') {
    // ============================================
    // WIKOT CLASSIQUE — SÉLECTEUR DE CARTES (zéro texte libre)
    // ============================================
    // Date du jour (pour les questions « ma prochaine tâche », « aujourd'hui », etc.)
    const todayISO = new Date().toISOString().slice(0, 10)
    return `Tu es **Wikot**, le moteur de recherche conversationnel du **${hotelName}**.

## Ta mission UNIQUE
Tu reçois une question d'employé. Tu identifies LE OU LES bloc(s) le(s) plus pertinent(s) parmi : procédures, informations, MESSAGES de chat, TÂCHES. Tu les retournes via l'outil \`select_answer\` sous forme de tableau \`blocks\`. **Tu NE rédiges JAMAIS de texte de réponse.** L'interface affiche directement les cartes des ressources sélectionnées.

## Contexte utilisateur
- ID utilisateur courant : **${user.id}** (à utiliser pour "mes tâches", "messages qui m'ont été destinés", etc.)
- Nom : ${user.name}
- Date du jour : **${todayISO}**

## Outils disponibles
- \`search_procedures\` / \`search_procedure_steps\` / \`get_procedure\` : procédures et étapes
- \`search_hotel_info\` / \`list_info_categories\` / \`get_hotel_info_item\` : informations de l'hôtel
- \`list_groups\` : arborescence des salons/channels (à appeler AVANT \`search_messages\` si besoin de filtrer par salon)
- \`list_employees\` : annuaire (à appeler AVANT \`search_messages\` ou \`search_tasks\` pour résoudre un prénom en \`user_id\`)
- \`search_messages\` : messages du chat. Filtres : \`q\`, \`channel_id\`, \`group_id\`, \`author_id\`, \`mentions_user_id\` (← pour "messages qui m'ont été destinés", passe \`mentions_user_id: ${user.id}\`), \`after\`, \`before\`
- \`search_tasks\` : tâches (templates récurrents + instances ponctuelles). Filtres : \`q\`, \`assignee_id\` (← pour "mes tâches", passe \`assignee_id: ${user.id}\`), \`status\` (pending/done/all), \`after\`, \`before\`

## Protocole strict
1. Appelle les outils de recherche pertinents selon le sujet de la question.
2. Si plusieurs résultats possibles, affine avec \`get_procedure\` / \`get_hotel_info_item\`.
3. Termine TOUJOURS par UN appel à \`select_answer\` avec un tableau \`blocks\` (1 à 5 blocs).

## Types de blocs disponibles dans \`blocks\`
- \`{type:"procedure", id}\` → procédure ENTIÈRE (« Comment je fais un check-in ? »)
- \`{type:"procedure_step", procedure_id, step_number}\` → UNE étape précise (« Comment vérifier la réservation pendant le check-in ? »). Si l'étape pointe vers une sous-procédure, la carte affichera la sous-procédure.
- \`{type:"info_item", id}\` → UNE information précise (« Code Wi-Fi », « Horaires piscine »)
- \`{type:"info_category", id}\` → TOUT un thème (« Donne-moi tous les horaires »)
- \`{type:"chat_message", id}\` → UN message du chat sélectionné comme réponse (« Qui devait faire X ? » → renvoie le message original sans le reformuler)
- \`{type:"task", task_kind:"template"|"instance", id}\` → UNE tâche
- \`{type:"none"}\` → SEUL, quand rien ne correspond ou question hors-sujet

## Règles ABSOLUES
- **AUCUN texte libre.** Le seul output produit est l'appel à \`select_answer\`. Pas de politesse, pas d'introduction.
- **PLUSIEURS BLOCS si pertinent.** Exemples :
  - « Quelles sont mes tâches aujourd'hui ? » → 1 bloc \`task\` par tâche assignée (max 5).
  - « Quels messages m'ont été destinés récemment ? » → 1 bloc \`chat_message\` par message pertinent.
  - « Qui était responsable de la livraison hier ? » → 1 bloc \`chat_message\` (le message d'origine) — Wikot ne réécrit pas, il cite.
- **GRANULARITÉ MAXIMALE.** Si l'employé demande UNE action précise, ne renvoie pas la procédure entière → renvoie \`procedure_step\`. Si l'employé demande un thème large, renvoie \`info_category\`.
- **MAX 5 blocs** par réponse. Trie par pertinence décroissante.
- Si demande de création/modification : sélectionne \`type:"none"\` (Wikot ne fait que de la lecture).

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

  if (workflowMode === 'gerer_procedures') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **GESTION DES PROCÉDURES** pour le **${hotelName}**.

## Ta mission UNIQUE pour cette session
Aider l'utilisateur à **créer OU modifier** une procédure. Selon le contexte :
- Si le formulaire est vide (aucun \`id\`) → tu **crées** une nouvelle procédure.
- Si le formulaire contient déjà un \`id\` (procédure cible chargée) → tu **modifies** cette procédure existante.

Tu rédiges, tu structures, tu remplis directement le formulaire visible à l'écran via l'outil \`update_form\`. L'utilisateur valide à la fin en cliquant "Enregistrer".

## Tu ne fais QUE ça
- Tu ne crées pas d'information (autre workflow).
- Tu ne réponds pas aux questions générales (c'est le rôle de Wikot).
${!canEditProc ? '- ATTENTION : cet utilisateur N\'EST PAS autorisé à éditer les procédures. Refuse poliment.' : ''}

## Protocole

### Si CRÉATION (formulaire vide)
1. **Cadrer** : pose 1 ou 2 questions ciblées (déclencheur, objectif, grandes étapes). Si tout est déjà dit, passe à l'étape suivante.
2. **Vérifier l'existant** : appelle \`search_procedures\` avec les mots-clés évidents. Si une procédure proche existe, propose plutôt de la charger pour modification (l'utilisateur peut la sélectionner depuis la liste).
3. **Rédiger** : utilise \`update_form\` pour remplir CHAQUE champ.

### Si MODIFICATION (formulaire avec id pré-rempli)
1. **Comprendre la demande**. Si c'est précis ("change le titre en X", "ajoute une étape Y"), exécute directement. Si c'est vague ("améliore"), pose UNE question pour cibler.
2. **Préserver les liens vers les sous-procédures** : si tu modifies le tableau \`steps\`, conserve les \`linked_procedure_id\` existants sauf si l'utilisateur demande explicitement de les retirer. Sinon les sous-procédures seront orphelines.
3. **Modifier** : utilise \`update_form\` pour mettre à jour les champs concernés UNIQUEMENT.

## Champs du formulaire
- \`title\` : verbe d'action à l'infinitif + sujet clair (ex : "Effectuer un check-in client").
- \`trigger_event\` : commence par "Quand" ou "Lorsque" (ex : "Quand un client se présente à la réception pour son arrivée").
- \`description\` : 1 à 2 phrases qui expliquent le contexte et l'objectif.
- \`steps\` : tableau d'objets {title, content, linked_procedure_id?}. 3 à 10 étapes. Titre d'étape = verbe à l'impératif, 8 mots max. Contenu = instructions concrètes à la 2e personne ("Demande…", "Vérifie…"). Pour lier une étape à une sous-procédure existante, mets son id dans linked_procedure_id (le contenu peut alors être vide).
- En modification, quand tu remplis \`steps\`, tu remplaces tout le tableau : reprends bien les étapes existantes à conserver.

Après chaque update_form, écris UNE phrase courte qui décrit ce que tu viens de remplir/changer. Pas de récap pompeux.

${styleRules}

## Arborescence actuelle de l'hôtel (pour repérer les sous-procédures existantes)
${arborescence}
${formContextStr}

Rappel : tu remplis le formulaire en temps réel via update_form. L'utilisateur enregistre lui-même quand il est satisfait.`
  }

  if (workflowMode === 'gerer_infos') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **GESTION DES INFORMATIONS** pour le **${hotelName}**.

## Ta mission UNIQUE pour cette session
Aider l'utilisateur à **créer OU modifier** une information de l'hôtel (horaires, services, équipements, contacts, etc.). Selon le contexte :
- Si le formulaire est vide (aucun \`id\`) → tu **crées** une nouvelle information.
- Si le formulaire contient déjà un \`id\` (info cible chargée) → tu **modifies** cette information existante.

Tu rédiges et tu remplis directement le formulaire visible à l'écran via l'outil \`update_form\`. L'utilisateur valide à la fin en cliquant "Enregistrer".

## Tu ne fais QUE ça
- Tu ne crées pas de procédure (autre workflow).
- Tu ne réponds pas aux questions générales.
${!canEditInf ? '- ATTENTION : cet utilisateur N\'EST PAS autorisé à éditer les informations. Refuse poliment.' : ''}

## Protocole

### Si CRÉATION (formulaire vide)
1. **Cadrer** : pose 1 ou 2 questions ciblées (sujet, valeurs précises : horaires, numéros, tarifs, lieux). Si tout est déjà dans le premier message, passe à l'étape suivante.
2. **Vérifier l'existant** : appelle \`search_hotel_info\` avec les mots-clés évidents. Si une info proche existe, propose plutôt de la charger pour modification.
3. **Rédiger** : utilise \`update_form\` pour remplir les champs.

### Si MODIFICATION (formulaire avec id pré-rempli)
1. **Comprendre la demande**. Si c'est précis, exécute directement. Si c'est vague, pose UNE question pour cibler.
2. **Modifier** : utilise \`update_form\` pour mettre à jour les champs concernés UNIQUEMENT. Conserve la structure existante (listes, gras, formats horaires) sauf si l'utilisateur demande explicitement de la changer.

## Champs du formulaire
- \`title\` : court, factuel, sans verbe (ex : "Horaires du restaurant", "Code Wi-Fi", "Numéros utiles").
- \`content\` : structuré, factuel, scannable. Listes à puces avec le caractère "•". Gras avec **double étoile** pour les valeurs importantes.
  - Horaires au format hh:mm puis le séparateur, puis hh:mm (ex : 07:00 à 10:30, ou 07:00, 10:30 selon le contexte).
  - Numéros de téléphone formatés "01 23 45 67 89".
  - Tarifs en euros avec le symbole € (ex : "12 €").
  - Lieux précis (ex : "salle Méditerranée, RDC").
- \`category_id\` : choisis l'id de la catégorie existante la plus adaptée. Si aucune ne convient, dis-le à l'utilisateur, il créera une catégorie à la main.

Après chaque update_form, écris UNE phrase courte qui décrit ce que tu viens de remplir/changer.

${styleRules}

## Arborescence actuelle de l'hôtel (pour repérer les catégories d'infos existantes)
${arborescence}
${formContextStr}

Rappel : tu remplis le formulaire en temps réel via update_form. L'utilisateur enregistre lui-même quand il est satisfait.`
  }

  // ============================================
  // WORKFLOW : GÉRER LES CONVERSATIONS (CRUD live salons + channels)
  // L'IA exécute live via tools. L'arborescence est aussi rendue dans le formulaire.
  // ============================================
  if (workflowMode === 'gerer_conversations') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **gestion des espaces de discussion** du **${hotelName}**.

## Ta mission UNIQUE pour cette session
Modifier directement (en base) l'arborescence des salons et channels de l'application Wikot :
- Créer / renommer / supprimer un **salon** (groupe).
- Créer / renommer / déplacer / supprimer un **channel** (sous-salon).

## Outils disponibles
- \`list_groups\` : liste l'arborescence courante (groupes + channels).
- \`create_group\` : crée un nouveau salon (groupe).
- \`rename_group\` : renomme un salon existant.
- \`delete_group\` : supprime un salon (refuse si système). Supprime aussi tous ses channels et messages.
- \`create_channel\` : crée un channel dans un salon.
- \`rename_channel\` : renomme / re-décrit / change l'icône d'un channel.
- \`move_channel\` : déplace un channel d'un salon à un autre.
- \`delete_channel\` : supprime un channel (et tous ses messages).
- \`update_form\` : met à jour le récap visible côté UI (champ \`note\` libre, ex : "Salon Réception ajouté avec 3 channels").

## Comment tu agis
- Tu **commences toujours par un \`list_groups\`** si tu n'as pas encore vu l'arborescence dans cette conversation.
- Avant toute suppression, tu confirmes l'intention en 1 phrase courte.
- Pour des batchs de création (ex: "crée 3 channels"), tu chaînes plusieurs tools dans le même tour (1 appel par opération).
- Après chaque action réussie, tu écris **1 phrase ultra courte** ("Salon Réception créé." / "Channel #planning déplacé.").
- À la fin d'un batch, tu peux appeler \`update_form\` avec un \`note\` qui résume ce qui a été fait.
- Tu ne fais **rien d'autre** que CRUD sur salons/channels. Tu n'envoies pas de messages, tu ne modifies pas les permissions.

${styleRules}
${formContextStr}

Rappel : tes appels de tools écrivent **directement en base**. Confirme toujours avant une suppression de salon ou de channel non vide.`
  }

  // ============================================
  // WORKFLOW : GÉRER LES TÂCHES (CRUD live templates + instances)
  // ============================================
  if (workflowMode === 'gerer_taches') {
    return `Tu es **Back Wikot**, agent ultra-spécialisé dans la **gestion des tâches** du **${hotelName}**.

## Ta mission UNIQUE pour cette session
Créer / modifier des tâches dans l'application Wikot. Deux types de tâches :
1. **Tâche récurrente** (\`task_kind=template\`) : se régénère automatiquement (daily / weekly avec jours / monthly avec jour du mois).
2. **Tâche ponctuelle** (\`task_kind=instance\`) : une seule fois, sur une date précise.

## Outils disponibles
- \`list_tasks\` : liste les tâches existantes (templates + instances du jour).
- \`get_task\` : détail d'une tâche (template ou instance) + ses assignés.
- \`list_employees\` : liste les utilisateurs de l'hôtel (pour les assignations).
- \`load_task_for_edit\` : charge une tâche existante dans le formulaire (mode update).
- \`start_new_task\` : initialise un formulaire vierge pour une nouvelle tâche.
- \`update_form\` : met à jour le formulaire visible. Champs : \`task_kind\` ('template'|'instance'), \`mode\` ('create'|'update'), \`task_id\` (en update), \`title\`, \`description\`, \`category\`, \`priority\` ('normal'|'high'|'urgent'), \`recurrence_type\` ('daily'|'weekly'|'monthly'), \`recurrence_days\` (bitmask 1-127 si weekly), \`monthly_day\` (1-31 ou -1 si monthly), \`suggested_time\` ('HH:MM'), \`duration_min\` (1-1439), \`active_from\` (YYYY-MM-DD), \`active_to\` (YYYY-MM-DD), \`task_date\` (YYYY-MM-DD pour instance), \`assignee_ids\` (tableau d'ints — **UNIQUEMENT si task_kind='instance'**).

## Comment tu agis
- L'utilisateur enregistre lui-même via le bouton "Enregistrer" : tes \`update_form\` ne touchent **pas** la base, ils remplissent le formulaire.
- Tu commences par 1 question si l'utilisateur est vague : récurrente ou ponctuelle ? quand ? qui ?
- Tu remplis tous les champs cohérents en 1 ou 2 \`update_form\` consécutifs.
- Pour les jours de la semaine (\`recurrence_days\`), c'est un bitmask : Lun=1, Mar=2, Mer=4, Jeu=8, Ven=16, Sam=32, Dim=64. "Tous les jours" = 127. "Lun-Ven" = 31. "Week-end" = 96.
- **RÈGLE CRITIQUE — Attribution** : une tâche **récurrente (template)** définit uniquement QUOI / QUAND / OÙ. **Tu ne peux PAS attribuer une personne à un template.** Chaque jour génère une instance "bébé" qui est attribuée au cas par cas. Si l'utilisateur dit "crée une tâche récurrente assignée à Pierre", crée le template SANS \`assignee_ids\`, et explique que l'attribution se fait jour par jour dans la vue jour/semaine.
- Pour les tâches **ponctuelles (instance)** uniquement : tu peux assigner par nom ("assigne à Pierre"), appelle d'abord \`list_employees\`, trouve l'id, puis push \`assignee_ids: [id]\` via \`update_form\`.
- Pour modifier une tâche existante, appelle \`load_task_for_edit\` qui charge le formulaire, puis applique les changements via \`update_form\`.

${styleRules}
${formContextStr}

Rappel : tes \`update_form\` remplissent le formulaire. L'utilisateur clique "Enregistrer" pour persister. Sois ultra-précis sur les ids et bitmasks.`
  }

  // ============================================
  // FALLBACK : pas de workflow_mode (entrée Back Wikot sans workflow choisi)
  // → Demander à l'utilisateur de choisir un des boutons d'entonnoir
  // ============================================
  return `Tu es **Back Wikot**, agent de rédaction et d'édition pour le **${hotelName}**.

Tu fais EXACTEMENT ces choses, et rien d'autre :
1. Créer une procédure
2. Modifier une procédure
3. Créer une information
4. Modifier une information
5. Conseiller sur la gestion des conversations
6. Conseiller sur la recherche dans les conversations
7. Conseiller sur la création/gestion des tâches

Si l'utilisateur t'écrit sans avoir choisi un workflow, demande-lui poliment de cliquer sur l'un des boutons d'entonnoir affichés à l'écran. Reste très bref.

${styleRules}`
}

// Helper : tools disponibles selon le mode et les permissions
// mode='standard' → Wikot lecture (search/get/list/add_reference uniquement)
// mode='max'      → Back Wikot (lecture + update_form uniquement, scope par workflowMode)
// workflowMode = 'gerer_procedures' | 'gerer_infos' | 'gerer_conversations' | 'gerer_taches' | null
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
    // Tools de recherche étendus disponibles en mode standard : conversations + tâches
    tools.push({
      type: 'function',
      function: {
        name: 'list_groups',
        description: 'Liste les salons et channels du chat pour résoudre les noms en IDs avant search_messages. Retourne {groups: [{id, name, channels: [{id, name}]}]}.',
        parameters: { type: 'object', properties: {} }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'list_employees',
        description: 'Liste les utilisateurs de l\'hôtel pour résoudre prénom/nom en user_id avant search_messages ou search_tasks.',
        parameters: { type: 'object', properties: {} }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'search_messages',
        description: 'Recherche dans l\'historique des messages du chat de l\'hôtel. Utile pour répondre à "qui a dit X", "quel est le dernier message qui m\'est destiné", "qui était responsable de Y". Retourne {results: [{id, channel_id, channel_name, group_name, author_id, author_name, created_at, content}]}.',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Mot-clé recherché dans le contenu' },
            channel_id: { type: 'integer' },
            group_id: { type: 'integer' },
            author_id: { type: 'integer' },
            mentions_user_id: { type: 'integer', description: 'Restreindre aux messages qui mentionnent ce user_id (utilisé pour "messages qui me sont destinés")' },
            after: { type: 'string', description: 'YYYY-MM-DD' },
            before: { type: 'string', description: 'YYYY-MM-DD' },
            limit: { type: 'integer', description: '1-50, défaut 10' }
          }
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'search_tasks',
        description: 'Recherche dans les tâches (templates récurrents + instances ponctuelles). Utile pour répondre à "quelle est ma prochaine tâche", "qui doit faire X", "quelles tâches sont en retard". Retourne {results: [{kind, id, title, description, task_date, suggested_time, priority, status, assignees}]}. kind = "template" ou "instance".',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Mot-clé sur titre/description' },
            assignee_id: { type: 'integer', description: 'Restreindre aux tâches attribuées à ce user_id (utiliser pour "mes tâches")' },
            status: { type: 'string', enum: ['pending', 'done', 'all'], description: 'Filtre par statut (instances). défaut: all' },
            after: { type: 'string', description: 'YYYY-MM-DD (instances : task_date >= after)' },
            before: { type: 'string', description: 'YYYY-MM-DD (instances : task_date <= before)' },
            limit: { type: 'integer', description: '1-30, défaut 10' }
          }
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'select_answer',
        description: `Sélectionne UN OU PLUSIEURS blocs de réponse à afficher à l'utilisateur. UTILISE-LE OBLIGATOIREMENT à la fin de chaque question, jamais de texte libre.

Tu passes un tableau "blocks" : 1 bloc si une seule ressource répond, plusieurs blocs si la question demande plusieurs éléments (ex : "quelles sont mes tâches pour aujourd'hui" → plusieurs blocs task).

Types de blocs disponibles :
- {type:"procedure", id} : procédure entière
- {type:"procedure_step", procedure_id, step_number} : UNE étape précise (ou sa sous-procédure liée)
- {type:"info_item", id} : UNE information
- {type:"info_category", id} : TOUT un thème d'infos
- {type:"chat_message", id} : UN message du chat (utile pour "qui a dit X", "dernier message qui m'est destiné")
- {type:"task", task_kind, id} : UNE tâche (task_kind = "template" pour récurrentes ou "instance" pour ponctuelles)
- {type:"none"} : utilisé SEUL, quand aucune ressource ne correspond ou question hors-sujet.

RÈGLE DE GRANULARITÉ : choisis toujours le type le plus précis qui répond. Tableau "blocks" : 1 à 5 blocs max. Si tu mets "none", c'est le seul bloc autorisé.`,
        parameters: {
          type: 'object',
          properties: {
            blocks: {
              type: 'array',
              description: 'Tableau de 1 à 5 blocs. Si type=none, mettre 1 seul bloc.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['procedure', 'procedure_step', 'info_item', 'info_category', 'chat_message', 'task', 'none'] },
                  id: { type: 'integer', description: 'ID de la ressource (procedure/info_item/info_category/chat_message/task)' },
                  procedure_id: { type: 'integer', description: '[procedure_step] ID de la procédure parente' },
                  step_number: { type: 'integer', description: '[procedure_step] numéro de l\'étape' },
                  task_kind: { type: 'string', enum: ['template', 'instance'], description: '[task] template ou instance' }
                },
                required: ['type']
              }
            }
          },
          required: ['blocks']
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
  const isProcedureWorkflow = workflowMode === 'gerer_procedures'
  const isInfoWorkflow = workflowMode === 'gerer_infos'

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

  // ============================================
  // WORKFLOW : GÉRER LES CONVERSATIONS (CRUD live salons + channels)
  // ============================================
  if (workflowMode === 'gerer_conversations') {
    tools.push({
      type: 'function',
      function: {
        name: 'list_groups',
        description: 'Liste tous les salons (groupes) et leurs channels de l\'hôtel. À appeler en début de conversation pour voir l\'arborescence. Retourne {groups: [{id, name, icon, color, is_system, channels: [{id, name, description, icon}]}]}.',
        parameters: { type: 'object', properties: {} }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'create_group',
        description: 'Crée un nouveau salon (groupe).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nom du salon (1-60 chars)' },
            icon: { type: 'string', description: 'Icône Font Awesome (ex: fa-folder, fa-utensils)' },
            color: { type: 'string', description: 'Couleur hex (ex: #3B82F6)' }
          },
          required: ['name']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'rename_group',
        description: 'Renomme un salon existant et/ou change son icône/couleur.',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'integer' },
            name: { type: 'string' },
            icon: { type: 'string' },
            color: { type: 'string' }
          },
          required: ['group_id', 'name']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'delete_group',
        description: 'Supprime un salon et tous ses channels + messages. Refusé si le salon est système.',
        parameters: {
          type: 'object',
          properties: { group_id: { type: 'integer' } },
          required: ['group_id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'create_channel',
        description: 'Crée un channel dans un salon donné.',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'integer' },
            name: { type: 'string', description: 'Nom du channel (1-80 chars, sans #)' },
            description: { type: 'string' },
            icon: { type: 'string', description: 'Icône Font Awesome (défaut fa-hashtag)' }
          },
          required: ['group_id', 'name']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'rename_channel',
        description: 'Renomme un channel et/ou modifie sa description ou son icône.',
        parameters: {
          type: 'object',
          properties: {
            channel_id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: 'string' },
            icon: { type: 'string' }
          },
          required: ['channel_id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'move_channel',
        description: 'Déplace un channel d\'un salon à un autre.',
        parameters: {
          type: 'object',
          properties: {
            channel_id: { type: 'integer' },
            new_group_id: { type: 'integer' }
          },
          required: ['channel_id', 'new_group_id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'delete_channel',
        description: 'Supprime un channel et tous ses messages.',
        parameters: {
          type: 'object',
          properties: { channel_id: { type: 'integer' } },
          required: ['channel_id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'update_form',
        description: 'Met à jour le récap visible côté UI. Champ note libre pour résumer ce qui a été fait dans la session.',
        parameters: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'Texte court de récap visible dans le formulaire' }
          }
        }
      }
    })
  }

  // ============================================
  // WORKFLOW : GÉRER LES TÂCHES (form-driven create/update)
  // ============================================
  if (workflowMode === 'gerer_taches') {
    tools.push({
      type: 'function',
      function: {
        name: 'list_tasks',
        description: 'Liste les tâches existantes : templates récurrents + instances ponctuelles du jour. Retourne {templates: [{id, title, recurrence_type, recurrence_days, monthly_day, priority, is_active}], instances: [{id, title, task_date, suggested_time, priority, status}]}.',
        parameters: { type: 'object', properties: {} }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'get_task',
        description: 'Récupère le détail complet d\'une tâche par son id et son type (template ou instance).',
        parameters: {
          type: 'object',
          properties: {
            task_kind: { type: 'string', enum: ['template', 'instance'] },
            task_id: { type: 'integer' }
          },
          required: ['task_kind', 'task_id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'list_employees',
        description: 'Liste les employés assignables (admin + employees) de l\'hôtel. Retourne [{id, name, role, job_role}].',
        parameters: { type: 'object', properties: {} }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'start_new_task',
        description: 'Initialise un formulaire vierge pour une nouvelle tâche. Précise le type.',
        parameters: {
          type: 'object',
          properties: {
            task_kind: { type: 'string', enum: ['template', 'instance'], description: 'template = récurrente, instance = ponctuelle' }
          },
          required: ['task_kind']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'load_task_for_edit',
        description: 'Charge une tâche existante dans le formulaire en mode "update". Le formulaire est pré-rempli avec les données actuelles.',
        parameters: {
          type: 'object',
          properties: {
            task_kind: { type: 'string', enum: ['template', 'instance'] },
            task_id: { type: 'integer' }
          },
          required: ['task_kind', 'task_id']
        }
      }
    })
    tools.push({
      type: 'function',
      function: {
        name: 'update_form',
        description: 'Met à jour le formulaire de tâche visible. Tous les champs sont optionnels et n\'écrasent que ce qui est passé. recurrence_days est un bitmask : Lun=1 Mar=2 Mer=4 Jeu=8 Ven=16 Sam=32 Dim=64 (tous=127, lun-ven=31, weekend=96).',
        parameters: {
          type: 'object',
          properties: {
            task_kind: { type: 'string', enum: ['template', 'instance'] },
            mode: { type: 'string', enum: ['create', 'update'] },
            task_id: { type: 'integer', description: 'Requis en mode update' },
            title: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
            recurrence_type: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Templates uniquement' },
            recurrence_days: { type: 'integer', description: 'Bitmask 0-127 si weekly' },
            monthly_day: { type: 'integer', description: '1-31 ou -1 (dernier jour) si monthly' },
            suggested_time: { type: 'string', description: 'Format HH:MM' },
            duration_min: { type: 'integer', description: '1-1439' },
            active_from: { type: 'string', description: 'YYYY-MM-DD (templates)' },
            active_to: { type: 'string', description: 'YYYY-MM-DD (templates)' },
            task_date: { type: 'string', description: 'YYYY-MM-DD (instance ponctuelle)' },
            assignee_ids: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Liste des user_ids assignés. UNIQUEMENT pour task_kind=instance (ponctuelle ou bébé d\'un récurrent). Les templates n\'ont JAMAIS d\'attribution — chaque instance est attribuée jour par jour. Utilise list_employees pour résoudre les noms.'
            }
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
  // Filtre optionnel par workflow_mode (gerer_procedures / gerer_infos / gerer_conversations / gerer_taches)
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
  // Workflow mode (Back Wikot uniquement) : 4 workflows unifiés "Gérer X"
  const allowedWorkflows = [
    'gerer_procedures', 'gerer_infos', 'gerer_conversations', 'gerer_taches'
  ]
  // Backward-compat : remap des anciens noms (refonte 7→4)
  const LEGACY_WORKFLOW_REMAP: Record<string, string> = {
    create_procedure: 'gerer_procedures',
    update_procedure: 'gerer_procedures',
    create_info: 'gerer_infos',
    update_info: 'gerer_infos',
    chercher_conversations: 'gerer_conversations'
  }
  const rawWorkflow = body.workflow_mode
  const remappedWorkflow = (rawWorkflow && LEGACY_WORKFLOW_REMAP[rawWorkflow]) || rawWorkflow
  const workflowMode = (mode === 'max' && allowedWorkflows.includes(remappedWorkflow)) ? remappedWorkflow : null
  // Normalisation : le frontend peut envoyer 'info' ou 'info_item' → on stocke 'info_item' pour cohérence
  let rawTargetKind = body.target_kind
  if (rawTargetKind === 'info') rawTargetKind = 'info_item'
  const targetKind = (workflowMode && (rawTargetKind === 'procedure' || rawTargetKind === 'info_item')) ? rawTargetKind : null
  const targetId = (workflowMode && body.target_id) ? parseInt(body.target_id) : null

  // Titre par défaut explicite selon le workflow
  let defaultTitle = mode === 'max' ? 'Nouvelle session Back Wikot' : 'Nouvelle conversation'
  if (workflowMode === 'gerer_procedures') defaultTitle = 'Gérer les procédures'
  else if (workflowMode === 'gerer_infos') defaultTitle = 'Gérer les informations'
  else if (workflowMode === 'gerer_conversations') defaultTitle = 'Gérer les conversations'
  else if (workflowMode === 'gerer_taches') defaultTitle = 'Gérer les tâches'

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
  // Sélection finale du mode standard (Wikot = sélecteur de cartes) — TABLEAU DE BLOCS
  type SelectedBlock = {
    type: 'procedure' | 'procedure_step' | 'info_item' | 'info_category' | 'chat_message' | 'task' | 'none'
    id?: number
    procedure_id?: number
    step_number?: number
    task_kind?: 'template' | 'instance'
  }
  let selectedBlocks: SelectedBlock[] = []
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
      // === MODE STANDARD : select_answer === outil de finalisation (multi-blocs)
      else if (fnName === 'select_answer') {
        const toInt = (v: any): number | undefined => {
          if (typeof v === 'number') return v
          if (v == null) return undefined
          const n = parseInt(String(v))
          return Number.isFinite(n) ? n : undefined
        }
        const rawBlocks: any[] = Array.isArray(fnArgs.blocks)
          ? fnArgs.blocks
          // Tolérance : si l'IA renvoie l'ancien format à plat, on l'enveloppe
          : (fnArgs.type ? [{ type: fnArgs.type, id: fnArgs.id, procedure_id: fnArgs.procedure_id, step_number: fnArgs.step_number, task_kind: fnArgs.task_kind }] : [])
        const out: SelectedBlock[] = []
        for (const b of rawBlocks.slice(0, 5)) {
          const t = b?.type
          const aId = toInt(b?.id)
          const pId = toInt(b?.procedure_id)
          const sNum = toInt(b?.step_number)
          const tk = b?.task_kind === 'template' ? 'template' : (b?.task_kind === 'instance' ? 'instance' : undefined)
          if (t === 'procedure' && aId) out.push({ type: 'procedure', id: aId })
          else if (t === 'procedure_step' && pId && sNum) out.push({ type: 'procedure_step', procedure_id: pId, step_number: sNum })
          else if (t === 'info_item' && aId) out.push({ type: 'info_item', id: aId })
          else if (t === 'info_category' && aId) out.push({ type: 'info_category', id: aId })
          else if (t === 'chat_message' && aId) out.push({ type: 'chat_message', id: aId })
          else if (t === 'task' && aId && tk) out.push({ type: 'task', id: aId, task_kind: tk })
          else if (t === 'none') { out.length = 0; out.push({ type: 'none' }); break }
        }
        selectedBlocks = out.length > 0 ? out : [{ type: 'none' }]
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: true, count: selectedBlocks.length }) })
        stopAfterThisIter = true
      }
      // === MODE MAX (Back Wikot) : update_form === l'IA écrit dans le formulaire UI
      else if (fnName === 'update_form') {
        // Filtrer les champs autorisés selon le workflow (sécurité serveur)
        let allowed: string[] = []
        if (workflowMode === 'gerer_procedures') {
          allowed = ['title', 'trigger_event', 'description', 'category_id', 'steps']
        } else if (workflowMode === 'gerer_infos') {
          allowed = ['title', 'content', 'category_id']
        } else if (workflowMode === 'gerer_conversations') {
          allowed = ['note']
        } else if (workflowMode === 'gerer_taches') {
          allowed = [
            'task_kind', 'mode', 'task_id',
            'title', 'description', 'category', 'priority',
            'recurrence_type', 'recurrence_days', 'monthly_day',
            'suggested_time', 'duration_min',
            'active_from', 'active_to', 'task_date',
            'assignee_ids'
          ]
        }
        const cleanPatch: any = {}
        for (const k of allowed) {
          if (fnArgs[k] !== undefined) cleanPatch[k] = fnArgs[k]
        }
        // Garde-fou : un template n'a JAMAIS d'attribution (archi instance-level only)
        if (workflowMode === 'gerer_taches' && cleanPatch.task_kind === 'template' && 'assignee_ids' in cleanPatch) {
          delete cleanPatch.assignee_ids
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
      // === READ TOOLS PARTAGÉS (multi-workflows Phase 4) ===
      else if (['list_groups', 'list_employees', 'search_messages', 'search_tasks', 'list_tasks', 'get_task'].includes(fnName)) {
        let toolResult: any = { ok: false }
        try {
          if (fnName === 'list_groups') {
            const groups = await c.env.DB.prepare('SELECT id, name, icon, color, is_system FROM chat_groups WHERE hotel_id = ? ORDER BY sort_order, id').bind(user.hotel_id).all()
            const channels = await c.env.DB.prepare('SELECT id, group_id, name, description, icon FROM chat_channels WHERE hotel_id = ? ORDER BY sort_order, id').bind(user.hotel_id).all()
            const chByGroup: Record<number, any[]> = {}
            for (const ch of (channels.results as any[])) {
              if (!chByGroup[ch.group_id]) chByGroup[ch.group_id] = []
              chByGroup[ch.group_id].push({ id: ch.id, name: ch.name, description: ch.description, icon: ch.icon })
            }
            toolResult = {
              groups: (groups.results as any[]).map(g => ({
                id: g.id, name: g.name, icon: g.icon, color: g.color, is_system: !!g.is_system,
                channels: chByGroup[g.id] || []
              }))
            }
          } else if (fnName === 'list_employees') {
            const r = await c.env.DB.prepare(`SELECT id, name, role, job_role FROM users WHERE hotel_id = ? AND role IN ('admin','employee') ORDER BY name`).bind(user.hotel_id).all()
            toolResult = { employees: r.results }
          } else if (fnName === 'search_messages') {
            const conds: string[] = ['m.hotel_id = ?']
            const params: any[] = [user.hotel_id]
            if (fnArgs.q && String(fnArgs.q).trim()) {
              conds.push('m.content LIKE ?')
              params.push('%' + String(fnArgs.q).trim() + '%')
            }
            if (fnArgs.channel_id) {
              conds.push('m.channel_id = ?')
              params.push(parseInt(String(fnArgs.channel_id)))
            }
            if (fnArgs.group_id) {
              conds.push('ch.group_id = ?')
              params.push(parseInt(String(fnArgs.group_id)))
            }
            if (fnArgs.author_id) {
              conds.push('m.user_id = ?')
              params.push(parseInt(String(fnArgs.author_id)))
            }
            if (fnArgs.mentions_user_id) {
              const mid = parseInt(String(fnArgs.mentions_user_id))
              if (Number.isFinite(mid)) {
                // Pas de colonne mentions_json : on détecte les mentions par pattern textuel @<prénom>
                // On récupère le prénom/nom de l'utilisateur ciblé puis on filtre via LIKE.
                const target = await c.env.DB.prepare('SELECT name FROM users WHERE id = ? AND hotel_id = ?').bind(mid, user.hotel_id).first<any>()
                const fullName = (target?.name || '').trim()
                if (fullName) {
                  const firstName = fullName.split(/\s+/)[0]
                  conds.push('(m.content LIKE ? OR m.content LIKE ?)')
                  params.push(`%@${firstName}%`, `%@${fullName}%`)
                } else {
                  // Cible introuvable : on force un résultat vide pour éviter de leak
                  conds.push('1 = 0')
                }
              }
            }
            if (fnArgs.after && /^\d{4}-\d{2}-\d{2}$/.test(String(fnArgs.after))) {
              conds.push('date(m.created_at) >= ?')
              params.push(String(fnArgs.after))
            }
            if (fnArgs.before && /^\d{4}-\d{2}-\d{2}$/.test(String(fnArgs.before))) {
              conds.push('date(m.created_at) <= ?')
              params.push(String(fnArgs.before))
            }
            const limit = Math.max(1, Math.min(50, parseInt(String(fnArgs.limit || 20))))
            const rows = await c.env.DB.prepare(`
              SELECT m.id, m.channel_id, m.user_id, m.content, m.created_at,
                     ch.name as channel_name, ch.group_id, g.name as group_name,
                     u.name as author_name
              FROM chat_messages m
              JOIN chat_channels ch ON ch.id = m.channel_id
              JOIN chat_groups g ON g.id = ch.group_id
              LEFT JOIN users u ON u.id = m.user_id
              WHERE ${conds.join(' AND ')}
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT ?
            `).bind(...params, limit).all()
            toolResult = { results: rows.results }
          } else if (fnName === 'search_tasks') {
            // Recherche unifiée templates + instances avec filtres assignee/status/dates
            const q = fnArgs.q && String(fnArgs.q).trim() ? '%' + String(fnArgs.q).trim() + '%' : null
            const assigneeId = fnArgs.assignee_id ? parseInt(String(fnArgs.assignee_id)) : null
            const statusFilter = ['pending', 'done'].includes(String(fnArgs.status)) ? String(fnArgs.status) : null
            const after = /^\d{4}-\d{2}-\d{2}$/.test(String(fnArgs.after || '')) ? String(fnArgs.after) : null
            const before = /^\d{4}-\d{2}-\d{2}$/.test(String(fnArgs.before || '')) ? String(fnArgs.before) : null
            const limit = Math.max(1, Math.min(30, parseInt(String(fnArgs.limit || 10))))

            const results: any[] = []

            // --- TEMPLATES (récurrents) : pas d'attribution, pas de status, pas de date ---
            // On les inclut seulement si pas de filtre assignee/status/date (sinon ils sont hors-scope)
            if (!assigneeId && !statusFilter && !after && !before) {
              const tplConds: string[] = ['hotel_id = ?', 'is_active = 1']
              const tplParams: any[] = [user.hotel_id]
              if (q) { tplConds.push('(title LIKE ? OR description LIKE ?)'); tplParams.push(q, q) }
              const tpls = await c.env.DB.prepare(`
                SELECT id, title, description, suggested_time, priority, category, recurrence_type
                FROM task_templates WHERE ${tplConds.join(' AND ')}
                ORDER BY title LIMIT ?
              `).bind(...tplParams, limit).all()
              for (const t of (tpls.results as any[])) {
                results.push({
                  kind: 'template', id: t.id, title: t.title, description: t.description,
                  suggested_time: t.suggested_time, priority: t.priority, category: t.category,
                  recurrence_type: t.recurrence_type, status: null, task_date: null, assignees: []
                })
              }
            }

            // --- INSTANCES (ponctuelles + babies de récurrents) ---
            const instConds: string[] = ['ti.hotel_id = ?']
            const instParams: any[] = [user.hotel_id]
            if (q) { instConds.push('(ti.title LIKE ? OR ti.description LIKE ?)'); instParams.push(q, q) }
            if (statusFilter) { instConds.push('ti.status = ?'); instParams.push(statusFilter) }
            if (after) { instConds.push('ti.task_date >= ?'); instParams.push(after) }
            if (before) { instConds.push('ti.task_date <= ?'); instParams.push(before) }
            if (assigneeId) {
              instConds.push('EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_instance_id = ti.id AND ta.user_id = ?)')
              instParams.push(assigneeId)
            }
            const instances = await c.env.DB.prepare(`
              SELECT ti.id, ti.title, ti.description, ti.task_date, ti.suggested_time,
                     ti.priority, ti.status, ti.category, ti.template_id
              FROM task_instances ti
              WHERE ${instConds.join(' AND ')}
              ORDER BY ti.task_date ASC, ti.suggested_time ASC, ti.id ASC
              LIMIT ?
            `).bind(...instParams, limit).all()
            const instanceRows = instances.results as any[]
            // Récupérer assignations de toutes les instances en une seule requête
            const instIds = instanceRows.map(r => r.id)
            const assigneesByInstance: Record<number, any[]> = {}
            if (instIds.length > 0) {
              const placeholders = instIds.map(() => '?').join(',')
              const ar = await c.env.DB.prepare(`
                SELECT ta.task_instance_id, ta.user_id, u.name
                FROM task_assignments ta
                JOIN users u ON u.id = ta.user_id
                WHERE ta.task_instance_id IN (${placeholders})
              `).bind(...instIds).all()
              for (const a of (ar.results as any[])) {
                if (!assigneesByInstance[a.task_instance_id]) assigneesByInstance[a.task_instance_id] = []
                assigneesByInstance[a.task_instance_id].push({ user_id: a.user_id, name: a.name })
              }
            }
            for (const r of instanceRows) {
              results.push({
                kind: 'instance', id: r.id, title: r.title, description: r.description,
                task_date: r.task_date, suggested_time: r.suggested_time, priority: r.priority,
                status: r.status, category: r.category, template_id: r.template_id,
                assignees: assigneesByInstance[r.id] || []
              })
            }

            toolResult = { results }
          } else if (fnName === 'list_tasks') {
            const tpl = await c.env.DB.prepare(`SELECT id, title, recurrence_type, recurrence_days, monthly_day, priority, suggested_time, duration_min, is_active, category FROM task_templates WHERE hotel_id = ? ORDER BY is_active DESC, title`).bind(user.hotel_id).all()
            const today = new Date().toISOString().slice(0, 10)
            const inst = await c.env.DB.prepare(`SELECT id, template_id, task_date, title, suggested_time, priority, status, category FROM task_instances WHERE hotel_id = ? AND task_date >= ? ORDER BY task_date, suggested_time LIMIT 50`).bind(user.hotel_id, today).all()
            toolResult = { templates: tpl.results, instances: inst.results }
          } else if (fnName === 'get_task') {
            const kind = fnArgs.task_kind === 'instance' ? 'instance' : 'template'
            const id = parseInt(String(fnArgs.task_id))
            if (!id) {
              toolResult = { error: 'task_id requis' }
            } else if (kind === 'template') {
              const t = await c.env.DB.prepare('SELECT * FROM task_templates WHERE id = ? AND hotel_id = ?').bind(id, user.hotel_id).first<any>()
              if (!t) toolResult = { error: 'Template introuvable' }
              else {
                // Note archi : les templates n'ont PAS d'attribution. Chaque instance est attribuée individuellement.
                toolResult = { task_kind: 'template', task: t, assignees: [], note: 'Les templates n\'ont pas d\'attribution. Attribution gérée au niveau de chaque instance (jour par jour).' }
              }
            } else {
              const t = await c.env.DB.prepare('SELECT * FROM task_instances WHERE id = ? AND hotel_id = ?').bind(id, user.hotel_id).first<any>()
              if (!t) toolResult = { error: 'Instance introuvable' }
              else {
                const a = await c.env.DB.prepare(`SELECT ta.user_id, u.name FROM task_assignments ta JOIN users u ON u.id = ta.user_id WHERE ta.task_instance_id = ?`).bind(id).all()
                toolResult = { task_kind: 'instance', task: t, assignees: a.results }
              }
            }
          }
        } catch (e: any) {
          toolResult = { error: e?.message || 'Erreur serveur' }
        }
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
      }

      // === START_NEW_TASK / LOAD_TASK_FOR_EDIT : pousse un patch de formulaire (gerer_taches) ===
      else if (workflowMode === 'gerer_taches' && (fnName === 'start_new_task' || fnName === 'load_task_for_edit')) {
        let toolResult: any = { ok: false }
        try {
          if (fnName === 'start_new_task') {
            const kind = fnArgs.task_kind === 'instance' ? 'instance' : 'template'
            formPatches.push({
              task_kind: kind,
              mode: 'create',
              task_id: null,
              title: '',
              description: '',
              category: null,
              priority: 'normal',
              recurrence_type: kind === 'template' ? 'weekly' : null,
              recurrence_days: kind === 'template' ? 127 : null,
              monthly_day: null,
              suggested_time: null,
              duration_min: null,
              active_from: null,
              active_to: null,
              task_date: kind === 'instance' ? new Date().toISOString().slice(0, 10) : null,
              assignee_ids: []
            })
            toolResult = { ok: true, task_kind: kind, mode: 'create' }
          } else {
            const kind = fnArgs.task_kind === 'instance' ? 'instance' : 'template'
            const id = parseInt(String(fnArgs.task_id))
            if (!id) {
              toolResult = { ok: false, error: 'task_id requis' }
            } else if (kind === 'template') {
              const t = await c.env.DB.prepare('SELECT * FROM task_templates WHERE id = ? AND hotel_id = ?').bind(id, user.hotel_id).first<any>()
              if (!t) toolResult = { ok: false, error: 'Template introuvable' }
              else {
                // Templates : aucune attribution (archi instance-level only)
                formPatches.push({
                  task_kind: 'template', mode: 'update', task_id: id,
                  title: t.title, description: t.description, category: t.category,
                  priority: t.priority, recurrence_type: t.recurrence_type, recurrence_days: t.recurrence_days,
                  monthly_day: t.monthly_day, suggested_time: t.suggested_time, duration_min: t.duration_min,
                  active_from: t.active_from, active_to: t.active_to, task_date: null,
                  assignee_ids: []
                })
                toolResult = { ok: true, task_kind: 'template', mode: 'update', task_id: id }
              }
            } else {
              const t = await c.env.DB.prepare('SELECT * FROM task_instances WHERE id = ? AND hotel_id = ?').bind(id, user.hotel_id).first<any>()
              if (!t) toolResult = { ok: false, error: 'Instance introuvable' }
              else {
                const a = await c.env.DB.prepare(`SELECT user_id FROM task_assignments WHERE task_instance_id = ?`).bind(id).all()
                formPatches.push({
                  task_kind: 'instance', mode: 'update', task_id: id,
                  title: t.title, description: t.description, category: t.category,
                  priority: t.priority, recurrence_type: null, recurrence_days: null, monthly_day: null,
                  suggested_time: t.suggested_time, duration_min: t.duration_min,
                  active_from: null, active_to: null, task_date: t.task_date,
                  assignee_ids: (a.results as any[]).map(r => r.user_id)
                })
                toolResult = { ok: true, task_kind: 'instance', mode: 'update', task_id: id }
              }
            }
          }
        } catch (e: any) {
          toolResult = { ok: false, error: e?.message || 'Erreur serveur' }
        }
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
      }

      // === WORKFLOW GÉRER LES CONVERSATIONS : CRUD live salons + channels ===
      else if (workflowMode === 'gerer_conversations' && ['create_group', 'rename_group', 'delete_group', 'create_channel', 'rename_channel', 'move_channel', 'delete_channel'].includes(fnName)) {
        const canManage = user.role === 'admin' || user.role === 'super_admin' || (user as any).can_edit_procedures || (user as any).can_edit_info
        if (!canManage || !user.hotel_id) {
          oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'Permission refusée pour gérer les salons.' }) })
        } else {
          let toolResult: any = { ok: false }
          try {
            if (fnName === 'create_group') {
              const name = String(fnArgs.name || '').trim()
              if (!name || name.length > 60) {
                toolResult = { ok: false, error: 'Nom requis (1-60 chars).' }
              } else {
                const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM chat_groups WHERE hotel_id = ?').bind(user.hotel_id).first<any>()
                const r = await c.env.DB.prepare('INSERT INTO chat_groups (hotel_id, name, icon, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, 0)').bind(user.hotel_id, name, fnArgs.icon || 'fa-folder', fnArgs.color || '#3B82F6', (maxOrder?.m || 0) + 1).run()
                toolResult = { ok: true, group_id: r.meta.last_row_id, name }
              }
            } else if (fnName === 'rename_group') {
              const id = parseInt(String(fnArgs.group_id))
              const name = String(fnArgs.name || '').trim()
              const g = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(id).first<any>()
              if (!g || g.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Salon introuvable.' }
              else if (!name) toolResult = { ok: false, error: 'Nom requis.' }
              else {
                await c.env.DB.prepare('UPDATE chat_groups SET name = ?, icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?').bind(name, fnArgs.icon || null, fnArgs.color || null, id).run()
                toolResult = { ok: true, group_id: id, name }
              }
            } else if (fnName === 'delete_group') {
              const id = parseInt(String(fnArgs.group_id))
              const g = await c.env.DB.prepare('SELECT hotel_id, is_system, name FROM chat_groups WHERE id = ?').bind(id).first<any>()
              if (!g || g.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Salon introuvable.' }
              else if (g.is_system) toolResult = { ok: false, error: 'Impossible de supprimer un salon système.' }
              else {
                const channels = await c.env.DB.prepare('SELECT id FROM chat_channels WHERE group_id = ?').bind(id).all()
                const chIds = (channels.results as any[]).map(r => r.id)
                const ops: D1PreparedStatement[] = []
                if (chIds.length > 0) {
                  const ph = chIds.map(() => '?').join(',')
                  ops.push(c.env.DB.prepare(`DELETE FROM chat_messages WHERE channel_id IN (${ph})`).bind(...chIds))
                  ops.push(c.env.DB.prepare(`DELETE FROM chat_reads WHERE channel_id IN (${ph})`).bind(...chIds))
                }
                ops.push(c.env.DB.prepare('DELETE FROM chat_channels WHERE group_id = ?').bind(id))
                ops.push(c.env.DB.prepare('DELETE FROM chat_groups WHERE id = ?').bind(id))
                await c.env.DB.batch(ops)
                toolResult = { ok: true, deleted_group_id: id, name: g.name, deleted_channels: chIds.length }
              }
            } else if (fnName === 'create_channel') {
              const groupId = parseInt(String(fnArgs.group_id))
              const name = String(fnArgs.name || '').trim()
              const g = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(groupId).first<any>()
              if (!g || g.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Salon invalide.' }
              else if (!name || name.length > 80) toolResult = { ok: false, error: 'Nom requis (1-80 chars).' }
              else {
                const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM chat_channels WHERE group_id = ?').bind(groupId).first<any>()
                const r = await c.env.DB.prepare('INSERT INTO chat_channels (hotel_id, group_id, name, description, icon, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(user.hotel_id, groupId, name, fnArgs.description || null, fnArgs.icon || 'fa-hashtag', (maxOrder?.m || 0) + 1, user.id).run()
                toolResult = { ok: true, channel_id: r.meta.last_row_id, group_id: groupId, name }
              }
            } else if (fnName === 'rename_channel') {
              const id = parseInt(String(fnArgs.channel_id))
              const ch = await c.env.DB.prepare('SELECT hotel_id, name, description, icon FROM chat_channels WHERE id = ?').bind(id).first<any>()
              if (!ch || ch.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Channel introuvable.' }
              else {
                const newName = fnArgs.name !== undefined ? String(fnArgs.name).trim() : ch.name
                if (!newName) toolResult = { ok: false, error: 'Nom requis.' }
                else {
                  await c.env.DB.prepare('UPDATE chat_channels SET name = ?, description = ?, icon = COALESCE(?, icon), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(newName, fnArgs.description !== undefined ? fnArgs.description : ch.description, fnArgs.icon || null, id).run()
                  toolResult = { ok: true, channel_id: id, name: newName }
                }
              }
            } else if (fnName === 'move_channel') {
              const id = parseInt(String(fnArgs.channel_id))
              const newGroupId = parseInt(String(fnArgs.new_group_id))
              const ch = await c.env.DB.prepare('SELECT hotel_id FROM chat_channels WHERE id = ?').bind(id).first<any>()
              const g = await c.env.DB.prepare('SELECT hotel_id FROM chat_groups WHERE id = ?').bind(newGroupId).first<any>()
              if (!ch || ch.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Channel introuvable.' }
              else if (!g || g.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Salon cible invalide.' }
              else {
                await c.env.DB.prepare('UPDATE chat_channels SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(newGroupId, id).run()
                toolResult = { ok: true, channel_id: id, new_group_id: newGroupId }
              }
            } else if (fnName === 'delete_channel') {
              const id = parseInt(String(fnArgs.channel_id))
              const ch = await c.env.DB.prepare('SELECT hotel_id, name FROM chat_channels WHERE id = ?').bind(id).first<any>()
              if (!ch || ch.hotel_id !== user.hotel_id) toolResult = { ok: false, error: 'Channel introuvable.' }
              else {
                await c.env.DB.batch([
                  c.env.DB.prepare('DELETE FROM chat_messages WHERE channel_id = ?').bind(id),
                  c.env.DB.prepare('DELETE FROM chat_reads WHERE channel_id = ?').bind(id),
                  c.env.DB.prepare('DELETE FROM chat_channels WHERE id = ?').bind(id)
                ])
                toolResult = { ok: true, deleted_channel_id: id, name: ch.name }
              }
            }
          } catch (e: any) {
            toolResult = { ok: false, error: e?.message || 'Erreur serveur.' }
          }
          oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
        }
      }


      else {
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'Tool non reconnu' }) })
      }
    }

    // Mode standard : dès que select_answer est appelé, on arrête la boucle
    if (stopAfterThisIter) break
  }

  // ============================================
  // MODE STANDARD : on construit le TABLEAU answer_cards à partir de selectedBlocks
  // (Wikot peut renvoyer 1 à 5 blocs : procédure, étape, info, catégorie, message, tâche, none)
  // ============================================
  const answerCards: any[] = []
  if (mode === 'standard') {
    // Filet de sécurité : si le modèle n'a pas appelé select_answer
    if (selectedBlocks.length === 0) {
      if (seenProcedureIds.size > 0) {
        selectedBlocks = [{ type: 'procedure', id: Array.from(seenProcedureIds)[0] }]
      } else if (seenInfoItemIds.size > 0) {
        selectedBlocks = [{ type: 'info_item', id: Array.from(seenInfoItemIds)[0] }]
      } else {
        selectedBlocks = [{ type: 'none' }]
      }
    }

    for (const block of selectedBlocks) {
      let card: any = { kind: 'not_found' }

      if (block.type === 'procedure' && block.id) {
        const p = await c.env.DB.prepare(`
          SELECT p.id, p.title, p.description, p.trigger_event, p.category_id,
                 c.name as category_name, c.color as category_color, c.icon as category_icon
          FROM procedures p
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.id = ? AND p.hotel_id = ?
        `).bind(block.id, user.hotel_id).first() as any
        if (p) {
          const stepsRes = await c.env.DB.prepare(`
            SELECT s.id, s.step_number, s.title, s.content, s.linked_procedure_id, lp.title as linked_title
            FROM steps s
            LEFT JOIN procedures lp ON lp.id = s.linked_procedure_id
            WHERE s.procedure_id = ? ORDER BY s.step_number
          `).bind(p.id).all()
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
              FROM steps WHERE procedure_id IN (${placeholders})
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
          card = {
            kind: 'procedure',
            id: p.id, title: p.title, description: p.description, trigger_event: p.trigger_event,
            category_name: p.category_name, category_color: p.category_color, category_icon: p.category_icon,
            step_count: steps.length, steps
          }
        }
      } else if (block.type === 'procedure_step' && block.procedure_id && block.step_number) {
        const p = await c.env.DB.prepare(`
          SELECT p.id, p.title, p.trigger_event,
                 c.name as category_name, c.color as category_color, c.icon as category_icon
          FROM procedures p
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.id = ? AND p.hotel_id = ?
        `).bind(block.procedure_id, user.hotel_id).first() as any
        const stepRow = await c.env.DB.prepare(`
          SELECT s.id, s.step_number, s.title, s.content, s.linked_procedure_id, lp.title as linked_title
          FROM steps s
          LEFT JOIN procedures lp ON lp.id = s.linked_procedure_id
          WHERE s.procedure_id = ? AND s.step_number = ?
        `).bind(block.procedure_id, block.step_number).first() as any
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
          card = {
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
        }
      } else if (block.type === 'info_item' && block.id) {
        const i = await c.env.DB.prepare(`
          SELECT i.id, i.title, i.content, i.category_id,
                 c.name as category_name, c.color as category_color, c.icon as category_icon
          FROM hotel_info_items i
          LEFT JOIN hotel_info_categories c ON i.category_id = c.id
          WHERE i.id = ? AND i.hotel_id = ?
        `).bind(block.id, user.hotel_id).first() as any
        if (i) {
          card = {
            kind: 'info_item',
            id: i.id, title: i.title, content: i.content, category_id: i.category_id,
            category_name: i.category_name, category_color: i.category_color, category_icon: i.category_icon
          }
        }
      } else if (block.type === 'info_category' && block.id) {
        const cat = await c.env.DB.prepare(`
          SELECT id, name, color, icon FROM hotel_info_categories
          WHERE id = ? AND hotel_id = ?
        `).bind(block.id, user.hotel_id).first() as any
        if (cat) {
          const itemsRes = await c.env.DB.prepare(`
            SELECT id, title, content FROM hotel_info_items
            WHERE category_id = ? AND hotel_id = ? ORDER BY title
          `).bind(cat.id, user.hotel_id).all()
          const items = (itemsRes.results as any[]).map(it => ({
            id: it.id, title: it.title, content: it.content
          }))
          card = {
            kind: 'info_category',
            id: cat.id, name: cat.name, color: cat.color, icon: cat.icon,
            item_count: items.length, items
          }
        }
      } else if (block.type === 'chat_message' && block.id) {
        // Carte d'UN message de chat : on cite tel quel (l'IA ne reformule pas)
        const m = await c.env.DB.prepare(`
          SELECT m.id, m.content, m.created_at, m.channel_id, m.user_id,
                 u.name as author_name,
                 ch.name as channel_name, ch.icon as channel_icon, ch.group_id,
                 g.name as group_name, g.icon as group_icon, g.color as group_color
          FROM chat_messages m
          JOIN chat_channels ch ON ch.id = m.channel_id
          JOIN chat_groups g ON g.id = ch.group_id
          LEFT JOIN users u ON u.id = m.user_id
          WHERE m.id = ? AND m.hotel_id = ?
        `).bind(block.id, user.hotel_id).first() as any
        if (m) {
          card = {
            kind: 'chat_message',
            id: m.id, content: m.content, created_at: m.created_at,
            channel_id: m.channel_id, channel_name: m.channel_name, channel_icon: m.channel_icon,
            group_id: m.group_id, group_name: m.group_name, group_icon: m.group_icon, group_color: m.group_color,
            author_id: m.user_id, author_name: m.author_name
          }
        }
      } else if (block.type === 'task' && block.id && block.task_kind) {
        if (block.task_kind === 'template') {
          const t = await c.env.DB.prepare(`
            SELECT id, title, description, suggested_time, priority, category,
                   recurrence_type, recurrence_days, monthly_day, duration_min, is_active
            FROM task_templates WHERE id = ? AND hotel_id = ?
          `).bind(block.id, user.hotel_id).first() as any
          if (t) {
            card = {
              kind: 'task', task_kind: 'template',
              id: t.id, title: t.title, description: t.description,
              suggested_time: t.suggested_time, priority: t.priority, category: t.category,
              recurrence_type: t.recurrence_type, recurrence_days: t.recurrence_days,
              monthly_day: t.monthly_day, duration_min: t.duration_min, is_active: !!t.is_active,
              assignees: []
            }
          }
        } else {
          const t = await c.env.DB.prepare(`
            SELECT id, title, description, task_date, suggested_time, priority, status, category,
                   duration_min, template_id
            FROM task_instances WHERE id = ? AND hotel_id = ?
          `).bind(block.id, user.hotel_id).first() as any
          if (t) {
            const ar = await c.env.DB.prepare(`
              SELECT ta.user_id, u.name
              FROM task_assignments ta JOIN users u ON u.id = ta.user_id
              WHERE ta.task_instance_id = ?
            `).bind(t.id).all()
            card = {
              kind: 'task', task_kind: 'instance',
              id: t.id, title: t.title, description: t.description,
              task_date: t.task_date, suggested_time: t.suggested_time, priority: t.priority,
              status: t.status, category: t.category, duration_min: t.duration_min,
              template_id: t.template_id,
              assignees: (ar.results as any[]).map(a => ({ user_id: a.user_id, name: a.name }))
            }
          }
        }
      } else if (block.type === 'none') {
        card = { kind: 'none' }
      }

      answerCards.push(card)
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
  // Pour mode standard : on stocke les answer_cards (array) dans references_json
  // On garde answer_card (singulier = premier élément) pour rétro-compat des anciens messages
  // Pour mode max : on stocke les références sourcing classiques
  const referencesJson = mode === 'standard'
    ? (answerCards.length > 0 ? JSON.stringify({ answer_cards: answerCards, answer_card: answerCards[0] }) : null)
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
      answer_cards: answerCards,
      answer_card: answerCards[0] || null
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
const HOTEL_SETTINGS_FIELDS: Record<string, 'text' | 'int' | 'time' | 'color'> = {
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

    if (kind === 'int') {
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
  // Le modèle (mère) définit QUOI / QUAND / OÙ.
  // Chaque jour génère une INSTANCE (bébé) qui naît TOUJOURS LIBRE (non attribuée).
  // L'attribution se fait UNIQUEMENT au niveau instance, jour par jour.
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

  // INSERT instances en batch — TOUTES non assignées par construction
  const insStmts = toCreate.map(t => db.prepare(
    `INSERT OR IGNORE INTO task_instances
       (hotel_id, template_id, task_date, title, description, suggested_time, category, priority, duration_min, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(hotelId, t.id, dateStr, t.title, t.description, t.suggested_time, t.category, t.priority || 'normal', t.duration_min || null, null))
  await db.batch(insStmts)
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
// Les modèles définissent QUOI/QUAND/OÙ uniquement. L'attribution est instance-level.
app.get('/api/tasks/templates', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const r = await c.env.DB.prepare(
    `SELECT id, title, description, recurrence_type, recurrence_days, monthly_day,
            active_from, active_to, suggested_time, category, priority, duration_min,
            is_active, created_at
     FROM task_templates WHERE hotel_id = ? ORDER BY is_active DESC, title`
  ).bind(user.hotel_id).all()
  return c.json({ templates: r.results || [] })
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

// POST /api/tasks/templates — créer un modèle récurrent (QUOI / QUAND / OÙ)
// Pas d'attribution ici : chaque jour génère une instance libre, à attribuer manuellement.
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
  return c.json({ id: r.meta.last_row_id, success: true })
})

// PUT /api/tasks/templates/:id — modifier un modèle (QUOI / QUAND / OÙ uniquement)
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

  // Liste du staff pour permettre l'attribution rapide depuis la vue semaine
  const staff = await c.env.DB.prepare(
    `SELECT id, name, role FROM users WHERE hotel_id = ? AND role IN ('admin','employee') ORDER BY name`
  ).bind(user.hotel_id).all()

  return c.json({
    start: dates[0], end: endStr, dates,
    instances: instances.results, assignments,
    staff: staff.results,
    me: { id: user.id, can_create_tasks: canCreateTasks(user) ? 1 : 0, can_assign_tasks: canAssignTasks(user) ? 1 : 0 }
  })
})

// POST /api/tasks/copy-week — copie les assignations d'une semaine source vers une semaine cible
// Body: { from: 'YYYY-MM-DD' (lundi semaine source), to: 'YYYY-MM-DD' (lundi semaine cible) }
// Stratégie : pour chaque jour de la semaine source, on cherche les instances qui ont
// le MÊME template_id que celles de la semaine cible (au même jour de la semaine),
// et on copie les assignés (sans écraser les éventuelles assignations déjà faites).
// Pour les tâches ponctuelles (template_id NULL), on copie celles qui ont le même titre.
app.post('/api/tasks/copy-week', authMiddleware, async (c) => {
  const user = c.get('user')
  if (!canAssignTasks(user)) return c.json({ error: 'Permission requise' }, 403)
  if (!user.hotel_id) return c.json({ error: 'Hôtel non défini' }, 400)
  const body = await c.req.json() as any
  const fromStr = String(body.from || '').trim()
  const toStr = String(body.to || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    return c.json({ error: 'Dates invalides (format YYYY-MM-DD requis)' }, 400)
  }

  // Calcule les 7 dates de chaque semaine
  const fromDates: string[] = []
  const toDates: string[] = []
  const fromStart = new Date(fromStr + 'T12:00:00Z')
  const toStart = new Date(toStr + 'T12:00:00Z')
  for (let i = 0; i < 7; i++) {
    fromDates.push(new Date(fromStart.getTime() + i * 86400000).toISOString().slice(0, 10))
    toDates.push(new Date(toStart.getTime() + i * 86400000).toISOString().slice(0, 10))
  }

  // S'assure que la semaine cible a bien matérialisé ses instances
  for (const d of toDates) {
    await materializeTasksForDate(c.env.DB, user.hotel_id, d)
  }

  // Charge les instances source + leurs assignations
  const fromInstances = await c.env.DB.prepare(
    `SELECT id, template_id, task_date, title FROM task_instances
     WHERE hotel_id = ? AND task_date >= ? AND task_date <= ?`
  ).bind(user.hotel_id, fromDates[0], fromDates[6]).all()

  const toInstances = await c.env.DB.prepare(
    `SELECT id, template_id, task_date, title FROM task_instances
     WHERE hotel_id = ? AND task_date >= ? AND task_date <= ?`
  ).bind(user.hotel_id, toDates[0], toDates[6]).all()

  const fromIds = (fromInstances.results || []).map((i: any) => i.id)
  if (fromIds.length === 0) return c.json({ copied: 0, message: 'Aucune tâche à copier' })

  const ph = fromIds.map(() => '?').join(',')
  const fromAssigns = await c.env.DB.prepare(
    `SELECT task_instance_id, user_id FROM task_assignments WHERE task_instance_id IN (${ph})`
  ).bind(...fromIds).all()
  const assignsByInst = new Map<number, number[]>()
  for (const r of (fromAssigns.results || []) as any[]) {
    if (!assignsByInst.has(r.task_instance_id)) assignsByInst.set(r.task_instance_id, [])
    assignsByInst.get(r.task_instance_id)!.push(r.user_id)
  }

  // Match source→cible par (jour de la semaine, template_id ou titre)
  const ops: D1PreparedStatement[] = []
  let copied = 0
  for (let i = 0; i < 7; i++) {
    const srcDate = fromDates[i]
    const dstDate = toDates[i]
    const srcOfDay = (fromInstances.results || []).filter((x: any) => x.task_date === srcDate)
    const dstOfDay = (toInstances.results || []).filter((x: any) => x.task_date === dstDate)
    for (const src of srcOfDay as any[]) {
      const userIds = assignsByInst.get(src.id) || []
      if (userIds.length === 0) continue
      // Match : même template_id si récurrente, sinon même titre exact
      const dst = (dstOfDay as any[]).find(d =>
        src.template_id !== null && d.template_id === src.template_id
        || src.template_id === null && d.template_id === null && d.title === src.title
      )
      if (!dst) continue
      for (const uid of userIds) {
        ops.push(c.env.DB.prepare(
          `INSERT OR IGNORE INTO task_assignments (task_instance_id, user_id, status, assigned_by)
           VALUES (?, ?, 'pending', ?)`
        ).bind(dst.id, uid, user.id))
        copied++
      }
    }
  }

  if (ops.length > 0) await c.env.DB.batch(ops)
  return c.json({ copied, success: true })
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
  <script src="/static/modules/08-tasks.js"></script>
  <script src="/static/modules/07-chat-modals.js"></script>
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
