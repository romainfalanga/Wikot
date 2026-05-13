// ============================================
// VIEW: TABLEAU VELEDA — Vrai whiteboard d'equipe
// ============================================
//
// Concept : un VRAI tableau Veleda numerique. L'utilisateur ecrit une info
// brute (pas de titre, pas de champ separe) avec une duree de vie.
// La note apparait sur le tableau en police manuscrite, legerement inclinee,
// avec une couleur de feutre aleatoire (noir/bleu/rouge/vert). A son
// expiration, elle disparait automatiquement (lazy cleanup serveur).
//
// Etat dans state :
//   state.veledaNotes        : array des notes actives
//   state.veledaLoading      : bool
//   state.veledaError        : string|null
//   state.veledaMe           : { id, role }
//   state.veledaPollingId    : interval id (polling 60s pour voir les ajouts des collegues)
//   state.veledaDraftContent : brouillon en cours de saisie (preserve entre rerenders)
//   state.veledaDraftHours   : duree choisie pour la nouvelle note (defaut 24h)

// Durees rapides proposees (en heures)
const VELEDA_QUICK_DURATIONS = [
  { label: '6h',     hours: 6 },
  { label: '24h',    hours: 24 },
  { label: '3 jours', hours: 72 },
  { label: '7 jours', hours: 168 },
  { label: '14 jours', hours: 336 },
  { label: '1 mois', hours: 720 },
];

// Limites (alignees avec le backend)
const VELEDA_MAX_CONTENT_LEN = 2000;

// Couleurs de feutre disponibles (assignees pseudo-aleatoirement et stable par id)
const VELEDA_INK_COLORS = ['black', 'blue', 'red', 'green'];

// Angles de rotation possibles (en degres) pour les notes — leger random
const VELEDA_ROTATIONS = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3];

// ============================================
// HELPERS
// ============================================

// Echappement HTML basique (pour le rendu de texte user)
function veledaEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Niveau d'urgence selon le temps restant avant expiration
//  - 'red'   : expire dans moins de 24h
//  - 'amber' : expire entre 24h et 7j
//  - 'green' : expire dans plus de 7j
function veledaUrgency(expiresAtIso) {
  const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
  if (remainingMs < 24 * 3600 * 1000) return 'red';
  if (remainingMs < 7 * 24 * 3600 * 1000) return 'amber';
  return 'green';
}

// Texte humanise "expire dans 3h", "expire dans 2j", etc.
function veledaExpiresLabel(expiresAtIso) {
  const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
  if (remainingMs <= 0) return 'expiree';
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 60) return `expire dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `expire dans ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `expire dans ${days}j`;
  const months = Math.floor(days / 30);
  return `expire dans ${months} mois`;
}

// Assigne une couleur de feutre stable par id (deterministe : meme id => meme couleur)
function veledaInkFor(noteId) {
  const idx = Math.abs(Number(noteId) || 0) % VELEDA_INK_COLORS.length;
  return VELEDA_INK_COLORS[idx];
}

// Assigne une rotation stable par id
function veledaRotationFor(noteId) {
  const idx = Math.abs(Number(noteId) || 0) % VELEDA_ROTATIONS.length;
  return VELEDA_ROTATIONS[idx];
}

// ============================================
// CHARGEMENT DES NOTES
// ============================================
async function loadVeledaNotes() {
  state.veledaLoading = true;
  state.veledaError = null;
  try {
    const res = await fetch('/api/veleda-notes', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur de chargement');
    }
    const data = await res.json();
    state.veledaNotes = Array.isArray(data.notes) ? data.notes : [];
    state.veledaMe = data.me || { id: state.user?.id, role: state.user?.role };
  } catch (e) {
    state.veledaError = e.message || 'Erreur inconnue';
    state.veledaNotes = state.veledaNotes || [];
  } finally {
    state.veledaLoading = false;
  }
}

// Polling 60s pour voir les ajouts des collegues
function startVeledaPolling() {
  if (state.veledaPollingId) return;
  state.veledaPollingId = setInterval(async () => {
    if (state.currentView !== 'veleda') {
      stopVeledaPolling();
      return;
    }
    // Si l'utilisateur est en train de taper, on ne re-render PAS (preserve son brouillon)
    const inputEl = document.getElementById('veleda-write-input');
    const isTyping = inputEl && document.activeElement === inputEl;
    const prevJson = JSON.stringify(state.veledaNotes || []);
    await loadVeledaNotes();
    const nextJson = JSON.stringify(state.veledaNotes || []);
    if (prevJson !== nextJson && !isTyping) {
      renderApp();
    }
  }, 60000);
}

function stopVeledaPolling() {
  if (state.veledaPollingId) {
    clearInterval(state.veledaPollingId);
    state.veledaPollingId = null;
  }
}

// ============================================
// RENDU PRINCIPAL
// ============================================
function renderVeledaView() {
  // Premier chargement : on declenche le fetch puis on rerender
  if (state.veledaNotes === undefined) {
    state.veledaNotes = [];
    state.veledaDraftContent = state.veledaDraftContent || '';
    state.veledaDraftHours = state.veledaDraftHours || 24;
    loadVeledaNotes().then(() => {
      startVeledaPolling();
      renderApp();
    });
    return renderVeledaShell([]);
  }

  // Init des brouillons s'ils n'existent pas
  if (state.veledaDraftContent === undefined) state.veledaDraftContent = '';
  if (state.veledaDraftHours === undefined) state.veledaDraftHours = 24;

  // Polling lance si pas deja fait
  startVeledaPolling();

  return renderVeledaShell(state.veledaNotes || []);
}

// Coque complete : titre + zone de saisie + tableau avec les notes
function renderVeledaShell(notes) {
  const me = state.veledaMe || { id: state.user?.id, role: state.user?.role };

  return `
    <div class="max-w-7xl mx-auto">

      <!-- Titre de la page (au-dessus du tableau) -->
      <h2 class="veleda-page-title">
        <i class="fas fa-clipboard mr-2" style="color: var(--c-gold, #C9A961);"></i>Tableau Veleda
      </h2>
      <p class="veleda-page-subtitle">
        Ce qu'il faut avoir en tete maintenant. Chaque note s'efface toute seule a la date que tu choisis.
      </p>

      <!-- Erreur eventuelle -->
      ${state.veledaError ? `
        <div class="mb-4 p-3 rounded-lg flex items-center gap-2 text-sm" style="background:rgba(220,38,38,0.08); color:#B91C1C; border:1px solid rgba(220,38,38,0.2);">
          <i class="fas fa-circle-exclamation"></i>
          <span>${veledaEscape(state.veledaError)}</span>
        </div>
      ` : ''}

      <!-- LE TABLEAU -->
      <div class="veleda-board">
        <!-- Rivets aux 4 coins (effet metallique) -->
        <span class="veleda-rivet tl"></span>
        <span class="veleda-rivet tr"></span>
        <span class="veleda-rivet bl"></span>
        <span class="veleda-rivet br"></span>

        <!-- Zone de saisie : un seul champ texte + duree -->
        ${renderVeledaWriteZone()}

        <!-- Les notes sur le tableau -->
        ${notes.length === 0 ? `
          <div class="veleda-empty">
            Le tableau est vide. Ecris une premiere info la-haut <i class="fas fa-arrow-up" style="opacity:0.4;"></i>
          </div>
        ` : `
          <div class="veleda-notes-grid">
            ${notes.map(n => renderVeledaNote(n, me)).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

// Zone de saisie : un champ texte brut + boutons de duree + bouton ajouter
function renderVeledaWriteZone() {
  const draft = state.veledaDraftContent || '';
  const selectedHours = state.veledaDraftHours || 24;

  return `
    <div class="veleda-write-zone">
      <textarea id="veleda-write-input"
        class="veleda-write-input"
        maxlength="${VELEDA_MAX_CONTENT_LEN}"
        rows="2"
        placeholder="Ecris une info ici... (ex: ch.204 check-out 14h, livraison mardi, intervention plombier...)"
        oninput="veledaOnInputChange(this.value)"
        onkeydown="veledaOnKeyDown(event)"
      >${veledaEscape(draft)}</textarea>

      <div class="veleda-write-actions">
        <div class="veleda-duration-buttons">
          <span class="veleda-write-hint" style="margin-right:4px;">disparait dans :</span>
          ${VELEDA_QUICK_DURATIONS.map(d => `
            <button type="button"
              class="veleda-duration-btn ${selectedHours === d.hours ? 'active' : ''}"
              onclick="veledaSelectDuration(${d.hours})">
              ${d.label}
            </button>
          `).join('')}
        </div>
        <button class="veleda-write-submit" id="veleda-submit-btn" onclick="submitVeledaCreate()">
          <i class="fas fa-marker"></i> Ecrire sur le tableau
        </button>
      </div>
    </div>
  `;
}

// Une note posee sur le tableau (police feutre + rotation aleatoire stable)
function renderVeledaNote(note, me) {
  const urgency = veledaUrgency(note.expires_at);
  const ink = veledaInkFor(note.id);
  const rotation = veledaRotationFor(note.id);
  const canDelete = (note.created_by === me.id) || me.role === 'admin' || me.role === 'super_admin';
  const expiresLabel = veledaExpiresLabel(note.expires_at);
  const authorName = (note.created_by_name || '?').split(' ')[0]; // prenom seulement

  return `
    <div class="veleda-note veleda-ink-${ink}"
      style="transform: rotate(${rotation}deg);"
      data-note-id="${note.id}">
      ${canDelete ? `
        <button class="veleda-eraser"
          onclick="deleteVeledaNote(${note.id})"
          title="Effacer cette note">
          <i class="fas fa-eraser"></i>
        </button>
      ` : ''}
      ${veledaEscape(note.content)}
      <div class="veleda-meta">
        <span class="veleda-urgency-dot ${urgency}"></span>
        <span>${veledaEscape(expiresLabel)}</span>
        <span style="opacity:0.6;">— ${veledaEscape(authorName)}</span>
      </div>
    </div>
  `;
}

// ============================================
// INTERACTIONS — saisie / duree / submit / delete
// ============================================

// Mise a jour du brouillon en cours (sans rerender pour ne pas perdre le focus)
function veledaOnInputChange(value) {
  state.veledaDraftContent = value;
}

// Cmd/Ctrl + Entree = envoyer
function veledaOnKeyDown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    submitVeledaCreate();
  }
}

// Selection d'une duree rapide : on met a jour le state + on toggle les boutons SANS rerender (preserve focus)
function veledaSelectDuration(hours) {
  state.veledaDraftHours = hours;
  // Toggle visuel direct des boutons (pas de rerender pour preserver le focus du textarea)
  document.querySelectorAll('.veleda-duration-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const btns = document.querySelectorAll('.veleda-duration-btn');
  btns.forEach(btn => {
    if (btn.textContent.trim() === VELEDA_QUICK_DURATIONS.find(d => d.hours === hours)?.label) {
      btn.classList.add('active');
    }
  });
}

// Creation d'une note
async function submitVeledaCreate() {
  const content = (state.veledaDraftContent || '').trim();
  const hours = state.veledaDraftHours || 24;
  const btn = document.getElementById('veleda-submit-btn');

  if (!content) {
    const inputEl = document.getElementById('veleda-write-input');
    if (inputEl) {
      inputEl.focus();
      inputEl.style.borderBottomColor = '#DC2626';
      setTimeout(() => { inputEl.style.borderBottomColor = ''; }, 1500);
    }
    return;
  }

  const expiresIso = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ecriture...';
  }

  try {
    const res = await fetch('/api/veleda-notes', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      // On envoie un title vide (le backend l'accepte) : seul content compte ici
      body: JSON.stringify({ title: '', content, expires_at: expiresIso })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur d\'ecriture');

    // Reset du brouillon
    state.veledaDraftContent = '';
    state.veledaDraftHours = 24;

    // Recharge et rerender
    await loadVeledaNotes();
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-marker"></i> Ecrire sur le tableau';
    }
  }
}

// Suppression d'une note (effaceur)
async function deleteVeledaNote(noteId) {
  if (!confirm('Effacer cette note du tableau ?')) return;
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur de suppression');

    // Suppression locale immediate (UX)
    state.veledaNotes = (state.veledaNotes || []).filter(n => n.id !== noteId);
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// EXPORT GLOBAL (les modules sont charges en <script defer> sans bundler)
// ============================================
window.renderVeledaView = renderVeledaView;
window.loadVeledaNotes = loadVeledaNotes;
window.veledaOnInputChange = veledaOnInputChange;
window.veledaOnKeyDown = veledaOnKeyDown;
window.veledaSelectDuration = veledaSelectDuration;
window.submitVeledaCreate = submitVeledaCreate;
window.deleteVeledaNote = deleteVeledaNote;
window.stopVeledaPolling = stopVeledaPolling;
