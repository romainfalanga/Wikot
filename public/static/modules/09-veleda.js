// ============================================
// VIEW: TABLEAU VÉLÉDA — Notes éphémères partagées
// ============================================
//
// Concept : "whiteboard" numérique de l'équipe. Tout le staff de l'hôtel
// peut noter des infos temporaires (ex: "Ch. 204 → check-out 14h",
// "Livreur attendu mardi") avec une date d'expiration au-delà de laquelle
// la note est automatiquement supprimée.
//
// État dans state :
//   state.veledaNotes        : array des notes actives
//   state.veledaLoading      : bool
//   state.veledaError        : string|null
//   state.veledaMe           : { id, role } — pour gérer les droits de suppression
//   state.veledaPollingId    : interval id (polling 60s pour voir les ajouts collègues)
//
// Sécurité front : on injecte tout via textContent dans le rendu des
// cartes (pas d'innerHTML brut sur le contenu user) pour neutraliser XSS.

// Durées prédéfinies pour le sélecteur rapide
const VELEDA_QUICK_DURATIONS = [
  { label: '6 heures',  hours: 6 },
  { label: '24 heures', hours: 24 },
  { label: '3 jours',   hours: 72 },
  { label: '7 jours',   hours: 168 },
  { label: '14 jours',  hours: 336 },
  { label: '1 mois',    hours: 720 },
];

// Limites (alignées avec le backend)
const VELEDA_MAX_TITLE_LEN = 100;
const VELEDA_MAX_CONTENT_LEN = 2000;

// ============================================
// HELPERS
// ============================================

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

// Texte humanisé "expire dans 3h", "expire dans 2j", etc.
function veledaExpiresLabel(expiresAtIso) {
  const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
  if (remainingMs <= 0) return 'expirée';
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 60) return `expire dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `expire dans ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `expire dans ${days} j`;
  const months = Math.floor(days / 30);
  return `expire dans ${months} mois`;
}

// Couleur d'accent par niveau d'urgence
const VELEDA_URGENCY_COLORS = {
  green: { border: '#10B981', bg: 'rgba(16,185,129,0.06)',  badge: '#0F766E', badgeBg: 'rgba(16,185,129,0.15)' },
  amber: { border: '#D97706', bg: 'rgba(217,119,6,0.06)',   badge: '#B45309', badgeBg: 'rgba(217,119,6,0.15)'  },
  red:   { border: '#DC2626', bg: 'rgba(220,38,38,0.06)',   badge: '#B91C1C', badgeBg: 'rgba(220,38,38,0.15)'  },
};

// Échappement HTML basique (pour les attributs et le rendu de texte user)
function veledaEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Format date FR lisible
function veledaFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Conversion d'une date locale en valeur pour <input type="datetime-local">
function veledaToDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// Démarrage du polling 60s quand on est sur la page Véléda
function startVeledaPolling() {
  if (state.veledaPollingId) return;
  state.veledaPollingId = setInterval(async () => {
    if (state.currentView !== 'veleda') {
      stopVeledaPolling();
      return;
    }
    // Refresh silencieux : on ne re-render que si le contenu a changé
    const prevJson = JSON.stringify(state.veledaNotes || []);
    await loadVeledaNotes();
    const nextJson = JSON.stringify(state.veledaNotes || []);
    if (prevJson !== nextJson) {
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
  // Premier chargement : on déclenche le fetch puis on rerender
  if (state.veledaNotes === undefined) {
    state.veledaNotes = [];
    loadVeledaNotes().then(() => {
      startVeledaPolling();
      renderApp();
    });
    return renderVeledaSkeleton();
  }

  const notes = state.veledaNotes || [];
  const me = state.veledaMe || { id: state.user?.id, role: state.user?.role };

  // Comptes par niveau pour le résumé en haut
  const counts = { red: 0, amber: 0, green: 0 };
  notes.forEach(n => { counts[veledaUrgency(n.expires_at)]++; });

  // Démarrage du polling si pas déjà fait
  startVeledaPolling();

  return `
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 class="font-display text-3xl font-semibold tracking-tight" style="color: var(--c-navy);">
            <i class="fas fa-clipboard mr-2" style="color: var(--c-gold);"></i>Tableau Véléda
          </h2>
          <p class="text-sm mt-1" style="color: rgba(15,27,40,0.6);">
            Notes éphémères partagées par toute l'équipe. Chaque note disparaît automatiquement à sa date d'expiration.
          </p>
        </div>
        <button onclick="openVeledaCreateModal()"
          class="btn-premium font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 text-sm shrink-0"
          style="background: var(--c-navy); color: white;">
          <i class="fas fa-plus"></i> Nouvelle note
        </button>
      </div>

      <!-- Résumé urgence (si au moins une note) -->
      ${notes.length > 0 ? `
        <div class="flex flex-wrap gap-2 mb-5 text-xs">
          ${counts.red > 0 ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold" style="background:${VELEDA_URGENCY_COLORS.red.badgeBg}; color:${VELEDA_URGENCY_COLORS.red.badge};">
            <span style="width:6px;height:6px;border-radius:50%;background:${VELEDA_URGENCY_COLORS.red.badge};"></span>
            ${counts.red} urgente${counts.red > 1 ? 's' : ''} (< 24h)
          </span>` : ''}
          ${counts.amber > 0 ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold" style="background:${VELEDA_URGENCY_COLORS.amber.badgeBg}; color:${VELEDA_URGENCY_COLORS.amber.badge};">
            <span style="width:6px;height:6px;border-radius:50%;background:${VELEDA_URGENCY_COLORS.amber.badge};"></span>
            ${counts.amber} cette semaine
          </span>` : ''}
          ${counts.green > 0 ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold" style="background:${VELEDA_URGENCY_COLORS.green.badgeBg}; color:${VELEDA_URGENCY_COLORS.green.badge};">
            <span style="width:6px;height:6px;border-radius:50%;background:${VELEDA_URGENCY_COLORS.green.badge};"></span>
            ${counts.green} à long terme
          </span>` : ''}
        </div>
      ` : ''}

      <!-- Erreur éventuelle -->
      ${state.veledaError ? `
        <div class="mb-4 p-3 rounded-lg flex items-center gap-2 text-sm" style="background:rgba(220,38,38,0.08); color:#B91C1C; border:1px solid rgba(220,38,38,0.2);">
          <i class="fas fa-circle-exclamation"></i>
          <span>${veledaEscape(state.veledaError)}</span>
        </div>
      ` : ''}

      <!-- Liste des notes -->
      ${notes.length === 0 ? renderVeledaEmptyState() : `
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          ${notes.map(n => renderVeledaCard(n, me)).join('')}
        </div>
      `}
    </div>
  `;
}

// Squelette de chargement initial
function renderVeledaSkeleton() {
  return `
    <div class="max-w-7xl mx-auto">
      <div class="mb-6">
        <h2 class="font-display text-3xl font-semibold tracking-tight" style="color: var(--c-navy);">
          <i class="fas fa-clipboard mr-2" style="color: var(--c-gold);"></i>Tableau Véléda
        </h2>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        ${[1,2,3].map(() => `
          <div class="rounded-xl p-5" style="background:white; border:1px solid var(--c-line); animation:pulse 1.5s ease-in-out infinite;">
            <div style="height:14px; width:60%; background:#E5E7EB; border-radius:4px; margin-bottom:12px;"></div>
            <div style="height:10px; width:100%; background:#F3F4F6; border-radius:4px; margin-bottom:6px;"></div>
            <div style="height:10px; width:85%; background:#F3F4F6; border-radius:4px;"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// État vide
function renderVeledaEmptyState() {
  return `
    <div class="rounded-2xl p-12 text-center" style="background:white; border:2px dashed var(--c-line);">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
        style="background: rgba(201,169,97,0.12); color: var(--c-gold);">
        <i class="fas fa-clipboard text-2xl"></i>
      </div>
      <h3 class="font-display text-lg font-semibold mb-2" style="color: var(--c-navy);">Aucune note pour l'instant</h3>
      <p class="text-sm mb-5" style="color: rgba(15,27,40,0.55); max-width:420px; margin-left:auto; margin-right:auto;">
        Notez ici des informations éphémères importantes : numéro de chambre d'un client, livraison attendue, intervention prévue, etc.
        Chaque note expire automatiquement à la date que vous choisissez.
      </p>
      <button onclick="openVeledaCreateModal()"
        class="btn-premium font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm"
        style="background: var(--c-navy); color: white;">
        <i class="fas fa-plus"></i> Créer la première note
      </button>
    </div>
  `;
}

// Carte individuelle (post-it)
function renderVeledaCard(note, me) {
  const urgency = veledaUrgency(note.expires_at);
  const colors = VELEDA_URGENCY_COLORS[urgency];
  const canDelete = (note.created_by === me.id) || me.role === 'admin' || me.role === 'super_admin';
  const canEdit = canDelete; // mêmes règles
  const expiresLabel = veledaExpiresLabel(note.expires_at);
  const expiresDate = veledaFormatDate(note.expires_at);

  return `
    <article class="rounded-xl p-4 flex flex-col gap-3"
      style="background:${colors.bg}; border:1px solid ${colors.border}; border-left:4px solid ${colors.border};">

      <!-- En-tête : titre + badge urgence -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          ${note.title ? `
            <h3 class="font-display font-semibold text-base leading-tight break-words" style="color: var(--c-navy);">
              ${veledaEscape(note.title)}
            </h3>
          ` : ''}
        </div>
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0"
          style="background:${colors.badgeBg}; color:${colors.badge};" title="Expire le ${veledaEscape(expiresDate)}">
          <i class="fas fa-clock"></i> ${veledaEscape(expiresLabel)}
        </span>
      </div>

      <!-- Contenu de la note -->
      <p class="text-sm whitespace-pre-wrap break-words" style="color: var(--c-navy); line-height:1.5;">
        ${veledaEscape(note.content)}
      </p>

      <!-- Pied : auteur + actions -->
      <div class="flex items-center justify-between gap-2 pt-2" style="border-top:1px solid rgba(15,27,40,0.06);">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
            style="background: var(--c-cream-deep); color: var(--c-navy);">
            ${veledaEscape((note.created_by_name || '?').charAt(0).toUpperCase())}
          </div>
          <span class="text-[11px] truncate" style="color: rgba(15,27,40,0.55);">
            ${veledaEscape(note.created_by_name || 'Inconnu')}
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${canEdit ? `
            <button onclick="openVeledaEditModal(${note.id})"
              class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-xs"
              style="background: rgba(15,27,40,0.04); color: rgba(15,27,40,0.55);"
              onmouseover="this.style.background='rgba(15,27,40,0.08)'; this.style.color='var(--c-navy)'"
              onmouseout="this.style.background='rgba(15,27,40,0.04)'; this.style.color='rgba(15,27,40,0.55)'"
              title="Modifier">
              <i class="fas fa-pen"></i>
            </button>
          ` : ''}
          ${canDelete ? `
            <button onclick="deleteVeledaNote(${note.id})"
              class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-xs"
              style="background: rgba(220,38,38,0.06); color: #B91C1C;"
              onmouseover="this.style.background='rgba(220,38,38,0.12)'"
              onmouseout="this.style.background='rgba(220,38,38,0.06)'"
              title="Supprimer">
              <i class="fas fa-trash"></i>
            </button>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

// ============================================
// MODALES
// ============================================

// Ouverture du modal de création
function openVeledaCreateModal() {
  // Par défaut : expire dans 24h
  const defaultExpire = new Date(Date.now() + 24 * 3600 * 1000);
  showVeledaModal({
    mode: 'create',
    title: '',
    content: '',
    expiresAtLocal: veledaToDatetimeLocal(defaultExpire),
    selectedQuickHours: 24
  });
}

// Ouverture du modal d'édition (préchargé avec la note)
function openVeledaEditModal(noteId) {
  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;
  const d = new Date(note.expires_at);
  showVeledaModal({
    mode: 'edit',
    noteId,
    title: note.title || '',
    content: note.content || '',
    expiresAtLocal: veledaToDatetimeLocal(d),
    selectedQuickHours: null
  });
}

// Affichage de la modale (création ou édition)
function showVeledaModal(opts) {
  const container = document.getElementById('modal-container');
  if (!container) return;

  const isEdit = opts.mode === 'edit';

  container.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(10,22,40,0.55); backdrop-filter: blur(4px);"
      onclick="if(event.target===this) closeVeledaModal()">
      <div class="bg-white rounded-2xl shadow-premium-lg w-full max-w-lg overflow-hidden"
        style="border: 1px solid var(--c-line);">

        <!-- Header -->
        <div class="px-6 py-5 flex items-center justify-between" style="border-bottom: 1px solid var(--c-line);">
          <div>
            <h3 class="font-display text-lg font-semibold" style="color: var(--c-navy);">
              <i class="fas fa-clipboard mr-2" style="color: var(--c-gold);"></i>
              ${isEdit ? 'Modifier la note' : 'Nouvelle note'}
            </h3>
            <p class="text-xs mt-0.5" style="color: rgba(15,27,40,0.55);">
              Conseil : utilisez les numéros de chambre plutôt que les noms des clients.
            </p>
          </div>
          <button onclick="closeVeledaModal()" class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style="color: rgba(15,27,40,0.5);"
            onmouseover="this.style.background='rgba(15,27,40,0.05)'"
            onmouseout="this.style.background='transparent'">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Body -->
        <div class="px-6 py-5 space-y-4">
          <!-- Titre -->
          <div>
            <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">
              Titre <span class="text-[10px] font-normal opacity-60 normal-case">(facultatif, ex: "Ch. 204")</span>
            </label>
            <input id="veleda-title" type="text" maxlength="${VELEDA_MAX_TITLE_LEN}"
              placeholder="Court intitulé"
              class="input-premium w-full px-3 py-2 rounded-lg outline-none text-sm"
              value="${veledaEscape(opts.title)}">
          </div>

          <!-- Contenu -->
          <div>
            <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">
              Information <span style="color:#DC2626;">*</span>
            </label>
            <textarea id="veleda-content" maxlength="${VELEDA_MAX_CONTENT_LEN}" rows="4"
              placeholder="Ex: Check-out 14h, demande oreiller en plus, livraison prévue mardi…"
              class="input-premium w-full px-3 py-2 rounded-lg outline-none text-sm resize-none"
            >${veledaEscape(opts.content)}</textarea>
            <p class="text-[10px] mt-1" style="color: rgba(15,27,40,0.4);">
              <span id="veleda-content-count">${(opts.content || '').length}</span> / ${VELEDA_MAX_CONTENT_LEN}
            </p>
          </div>

          <!-- Durée rapide -->
          <div>
            <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">
              Durée de validité
            </label>
            <div class="flex flex-wrap gap-1.5 mb-2">
              ${VELEDA_QUICK_DURATIONS.map(d => `
                <button type="button" onclick="selectVeledaQuickDuration(${d.hours})"
                  data-veleda-quick="${d.hours}"
                  class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                  style="background: ${opts.selectedQuickHours === d.hours ? 'var(--c-navy)' : 'var(--c-cream-deep)'}; color: ${opts.selectedQuickHours === d.hours ? 'white' : 'var(--c-navy)'};">
                  ${d.label}
                </button>
              `).join('')}
            </div>
            <label class="block text-[10px] mb-1" style="color: rgba(15,27,40,0.5);">Ou date/heure précise :</label>
            <input id="veleda-expires" type="datetime-local"
              class="input-premium w-full px-3 py-2 rounded-lg outline-none text-sm"
              value="${veledaEscape(opts.expiresAtLocal)}"
              oninput="document.querySelectorAll('[data-veleda-quick]').forEach(b => { b.style.background='var(--c-cream-deep)'; b.style.color='var(--c-navy)'; });">
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 flex items-center justify-end gap-2" style="background: var(--c-cream-deep); border-top: 1px solid var(--c-line);">
          <button onclick="closeVeledaModal()"
            class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style="color: rgba(15,27,40,0.6);"
            onmouseover="this.style.background='rgba(15,27,40,0.05)'"
            onmouseout="this.style.background='transparent'">
            Annuler
          </button>
          <button onclick="${isEdit ? `submitVeledaEdit(${opts.noteId})` : 'submitVeledaCreate()'}"
            id="veleda-submit-btn"
            class="btn-premium font-semibold px-5 py-2 rounded-lg text-sm flex items-center gap-2"
            style="background: var(--c-navy); color: white;">
            <i class="fas ${isEdit ? 'fa-save' : 'fa-plus'}"></i>
            ${isEdit ? 'Enregistrer' : 'Créer la note'}
          </button>
        </div>
      </div>
    </div>
  `;

  // Compteur live de caractères
  const ta = document.getElementById('veleda-content');
  const counter = document.getElementById('veleda-content-count');
  if (ta && counter) {
    ta.addEventListener('input', () => { counter.textContent = ta.value.length; });
  }

  // Focus auto sur le titre (ou le contenu en édition)
  setTimeout(() => {
    const focusTarget = isEdit ? document.getElementById('veleda-content') : document.getElementById('veleda-title');
    if (focusTarget) focusTarget.focus();
  }, 50);
}

function closeVeledaModal() {
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';
}

// Sélection d'une durée rapide → met à jour le champ datetime + highlight le bouton
function selectVeledaQuickDuration(hours) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  const input = document.getElementById('veleda-expires');
  if (input) input.value = veledaToDatetimeLocal(d);

  // Reset des autres boutons
  document.querySelectorAll('[data-veleda-quick]').forEach(b => {
    if (Number(b.dataset.veledaQuick) === hours) {
      b.style.background = 'var(--c-navy)';
      b.style.color = 'white';
    } else {
      b.style.background = 'var(--c-cream-deep)';
      b.style.color = 'var(--c-navy)';
    }
  });
}

// ============================================
// ACTIONS — CREATE / EDIT / DELETE
// ============================================

async function submitVeledaCreate() {
  const title = (document.getElementById('veleda-title')?.value || '').trim();
  const content = (document.getElementById('veleda-content')?.value || '').trim();
  const expiresLocal = (document.getElementById('veleda-expires')?.value || '').trim();
  const btn = document.getElementById('veleda-submit-btn');

  // Validations front (la vraie validation est côté serveur)
  if (!content) { alert('Le contenu de la note est requis.'); return; }
  if (!expiresLocal) { alert('Veuillez choisir une date d\'expiration.'); return; }
  const expiresIso = new Date(expiresLocal).toISOString();
  if (new Date(expiresIso).getTime() <= Date.now()) {
    alert('La date d\'expiration doit être dans le futur.');
    return;
  }

  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création…'; }

  try {
    const res = await fetch('/api/veleda-notes', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, expires_at: expiresIso })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de création');

    closeVeledaModal();
    await loadVeledaNotes();
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<i class="fas fa-plus"></i> Créer la note'; }
  }
}

async function submitVeledaEdit(noteId) {
  const title = (document.getElementById('veleda-title')?.value || '').trim();
  const content = (document.getElementById('veleda-content')?.value || '').trim();
  const expiresLocal = (document.getElementById('veleda-expires')?.value || '').trim();
  const btn = document.getElementById('veleda-submit-btn');

  if (!content) { alert('Le contenu de la note est requis.'); return; }
  if (!expiresLocal) { alert('Veuillez choisir une date d\'expiration.'); return; }
  const expiresIso = new Date(expiresLocal).toISOString();
  if (new Date(expiresIso).getTime() <= Date.now()) {
    alert('La date d\'expiration doit être dans le futur.');
    return;
  }

  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…'; }

  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, expires_at: expiresIso })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de modification');

    closeVeledaModal();
    await loadVeledaNotes();
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<i class="fas fa-save"></i> Enregistrer'; }
  }
}

async function deleteVeledaNote(noteId) {
  if (!confirm('Supprimer cette note définitivement ?')) return;
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur de suppression');

    // Suppression locale immédiate (UX)
    state.veledaNotes = (state.veledaNotes || []).filter(n => n.id !== noteId);
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// EXPORT GLOBAL (les modules sont chargés en <script defer> sans bundler)
// ============================================
window.renderVeledaView = renderVeledaView;
window.loadVeledaNotes = loadVeledaNotes;
window.openVeledaCreateModal = openVeledaCreateModal;
window.openVeledaEditModal = openVeledaEditModal;
window.closeVeledaModal = closeVeledaModal;
window.selectVeledaQuickDuration = selectVeledaQuickDuration;
window.submitVeledaCreate = submitVeledaCreate;
window.submitVeledaEdit = submitVeledaEdit;
window.deleteVeledaNote = deleteVeledaNote;
window.stopVeledaPolling = stopVeledaPolling;
