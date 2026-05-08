// Génère des hashes PBKDF2-SHA256 600k (algo v2) pour les comptes legacy plaintext.
// Utilise Web Crypto (dispo dans Node 18+) — strictement la même implémentation que le Worker.
import { webcrypto } from 'node:crypto'
const crypto = webcrypto

const PBKDF2_ITER = 100_000
const PBKDF2_ALGO = 'pbkdf2-sha256-100k'

function bytesToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function derivePbkdf2(password, salt, iterations) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return new Uint8Array(bits)
}

async function hashPassword(password) {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITER)
  return { hash: bytesToHex(hash), salt: bytesToHex(salt), algo: PBKDF2_ALGO }
}

// Comptes à migrer (id, email, password en clair stocké actuellement)
const accounts = [
  { id: 1, email: 'romain@wikot.app',  password: 'demo123' },
  { id: 3, email: 'Laura@gmail.com',   password: '123' },
  { id: 4, email: 'Doriane@gmail.com', password: '123' },
  { id: 5, email: 'Pauline@gmail.com', password: '123' },
  { id: 6, email: 'Florence@gmail.com', password: '123' },
]

console.log('-- Migration legacy plaintext → PBKDF2-SHA256 600k')
console.log('-- Généré le', new Date().toISOString())
console.log('')
for (const acc of accounts) {
  const { hash, salt, algo } = await hashPassword(acc.password)
  console.log(`-- ${acc.email} (id=${acc.id})`)
  console.log(
    `UPDATE users SET password_hash_v2 = '${hash}', password_salt = '${salt}', ` +
    `password_algo = '${algo}', password_hash = '' WHERE id = ${acc.id};`
  )
  console.log('')
}
