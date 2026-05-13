// ============================================
// VIEW: TABLEAU VELEDA — Vrai whiteboard d'equipe
// ============================================
//
// Concept : un VRAI tableau Veleda numerique, affiche EN GRAND par defaut.
// - 2 boutons flottants (FAB) :
//     * Haut-droite : "Ecrire sur le tableau" -> ouvre une modal formulaire
//       (texte + couleur d'importance + date/heure de disparition)
//     * Bas-droite  : "Legende" -> ouvre une modal qui liste tous les users
//       avec leur emote-icone, et permet de changer son propre emoji
// - Les utilisateurs avec can_use_veleda peuvent : creer / modifier le contenu /
//   deplacer / redimensionner / supprimer / changer la couleur de N'IMPORTE
//   QUELLE note du tableau.
// - Les autres voient le tableau en LECTURE SEULE.
// - Importance d'une note : 3 couleurs whitelistees serveur
//     green = pas important
//     black = importance intermediaire (defaut)
//     red   = importance capitale
// - Chaque note affiche l'emote-icone de son auteur (signature visuelle).
// - Polling 60s avec skip si l'utilisateur interagit.

// Limites (alignees avec le backend)
const VELEDA_MAX_CONTENT_LEN = 2000;

// Couleurs autorisees (whitelist front, doit matcher VELEDA_ALLOWED_COLORS serveur)
const VELEDA_COLORS = ['green', 'black', 'red'];
const VELEDA_COLOR_LABELS = {
  green: 'Pas critique',
  black: 'Importance moyenne',
  red:   'Capital'
};
const VELEDA_COLOR_HEX = {
  green: '#15803D',
  black: '#1A1A1A',
  red:   '#B91C1C'
};

// Banque de 50 emote-icones (doit matcher VELEDA_EMOJI_BANK serveur)
const VELEDA_EMOJI_BANK = [
  '⭐','🌟','✨','💫','⚡',
  '🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪',
  '🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜',
  '◆','◇','▲','△','▼','▽','■','□','●','○',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎',
  '🐱','🐶','🦊','🐻','🐼','🐯','🦁'
];

// Angles de rotation (stables par id)
const VELEDA_ROTATIONS = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3];

// Dimensions par defaut d'une nouvelle note (px)
const VELEDA_DEFAULT_WIDTH = 240;
const VELEDA_DEFAULT_HEIGHT = 120;

// Bornes (alignees avec backend)
const VELEDA_MIN_SIZE = 80;
const VELEDA_MAX_SIZE = 2000;

// ============================================
// HELPERS
// ============================================
function veledaEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function veledaUrgency(expiresAtIso) {
  const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
  if (remainingMs < 24 * 3600 * 1000) return 'red';
  if (remainingMs < 7 * 24 * 3600 * 1000) return 'amber';
  return 'green';
}

function veledaExpiresLabel(expiresAtIso) {
  const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
  if (remainingMs <= 0) return 'expiree';
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 60) return `disparait dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `disparait dans ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `disparait dans ${days}j`;
  const months = Math.floor(days / 30);
  return `disparait dans ${months} mois`;
}

function veledaRotationFor(noteId) {
  const idx = Math.abs(Number(noteId) || 0) % VELEDA_ROTATIONS.length;
  return VELEDA_ROTATIONS[idx];
}

// Conversion d'une date locale en valeur pour <input type="datetime-local">
function veledaToDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Detection de permission cote front (l'autorite reelle est cote serveur).
function veledaUserCanEdit() {
  try {
    if (typeof state === 'undefined' || !state) return false;
    if (state.veledaMe && state.veledaMe.can_use_veleda !== undefined && state.veledaMe.can_use_veleda !== null) {
      return Number(state.veledaMe.can_use_veleda) === 1;
    }
    if (typeof userCanUseVeleda === 'function') {
      try { return !!userCanUseVeleda(); } catch (_) { }
    }
    if (!state.user) return false;
    return state.user.role === 'admin'
        || state.user.role === 'super_admin'
        || Number(state.user.can_use_veleda) === 1;
  } catch (_) {
    return false;
  }
}

// Couleur fiable d'une note (defaut = black si valeur inconnue)
function veledaNoteColor(note) {
  if (note && typeof note.color === 'string' && VELEDA_COLORS.indexOf(note.color) !== -1) {
    return note.color;
  }
  return 'black';
}

// Recherche d'un emplacement libre (algo AABB)
function veledaFindFreeSpot(notes, boardWidth, boardHeight, w, h) {
  const padding = 12;
  for (let y = padding; y < boardHeight - h - padding; y += 40) {
    for (let x = padding; x < boardWidth - w - padding; x += 40) {
      let collision = false;
      for (const n of notes) {
        const nx = n.pos_x ?? 0;
        const ny = n.pos_y ?? 0;
        const nw = n.width ?? VELEDA_DEFAULT_WIDTH;
        const nh = n.height ?? VELEDA_DEFAULT_HEIGHT;
        if (x < nx + nw + padding && x + w + padding > nx && y < ny + nh + padding && y + h + padding > ny) {
          collision = true;
          break;
        }
      }
      if (!collision) return { x, y };
    }
  }
  return { x: 20 + Math.random() * 40, y: boardHeight - h - 40 };
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
    state.veledaMe = data.me || {
      id: state.user?.id,
      role: state.user?.role,
      can_use_veleda: state.user?.can_use_veleda,
      emoji: state.user?.emoji
    };
  } catch (e) {
    state.veledaError = e.message || 'Erreur inconnue';
    state.veledaNotes = state.veledaNotes || [];
  } finally {
    state.veledaLoading = false;
  }
}

async function loadVeledaLegend() {
  try {
    const res = await fetch('/api/veleda-legend', {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur de chargement de la legende');
    }
    const data = await res.json();
    state.veledaLegend = Array.isArray(data.users) ? data.users : [];
    // On reflete le serveur sur state.user.emoji aussi (au cas ou)
    if (state.user && data.me && data.me.emoji !== undefined) {
      state.user.emoji = data.me.emoji;
      if (state.veledaMe) state.veledaMe.emoji = data.me.emoji;
    }
  } catch (e) {
    state.veledaLegendError = e.message || 'Erreur inconnue';
  }
}

function startVeledaPolling() {
  if (state.veledaPollingId) return;
  state.veledaPollingId = setInterval(async () => {
    if (state.currentView !== 'veleda') {
      stopVeledaPolling();
      return;
    }
    // Skip si l'utilisateur est en train de taper / dragger / resizer / editer
    const inputEl = document.getElementById('veleda-write-input');
    const isTyping = inputEl && document.activeElement === inputEl;
    const editingEl = document.querySelector('.veleda-note-editing textarea');
    const isEditing = editingEl && document.activeElement === editingEl;
    const isInteracting = !!state.veledaDragging || !!state.veledaResizing;
    // Skip si une modale est ouverte
    const modalOpen = state.veledaWriteModalOpen || state.veledaLegendModalOpen;
    if (isTyping || isEditing || isInteracting || modalOpen) return;

    const prevJson = JSON.stringify(state.veledaNotes || []);
    await loadVeledaNotes();
    const nextJson = JSON.stringify(state.veledaNotes || []);
    if (prevJson !== nextJson) renderApp();
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
  // Init state Veleda si premier rendu
  if (state.veledaNotes === undefined) {
    state.veledaNotes = [];
    state.veledaDraftContent = state.veledaDraftContent || '';
    state.veledaDraftColor = state.veledaDraftColor || 'black';
    if (!state.veledaDraftExpiresLocal) {
      state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
    }
    state.veledaEditingId = null;
    state.veledaWriteModalOpen = false;
    state.veledaLegendModalOpen = false;
    loadVeledaNotes().then(() => {
      startVeledaPolling();
      renderApp();
    });
    return renderVeledaShell([]);
  }

  if (state.veledaDraftContent === undefined) state.veledaDraftContent = '';
  if (!state.veledaDraftColor) state.veledaDraftColor = 'black';
  if (!state.veledaDraftExpiresLocal) {
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  }
  if (state.veledaEditingId === undefined) state.veledaEditingId = null;
  if (state.veledaWriteModalOpen === undefined) state.veledaWriteModalOpen = false;
  if (state.veledaLegendModalOpen === undefined) state.veledaLegendModalOpen = false;

  startVeledaPolling();
  return renderVeledaShell(state.veledaNotes || []);
}

function renderVeledaShell(notes) {
  const me = state.veledaMe || {
    id: state.user?.id, role: state.user?.role,
    can_use_veleda: state.user?.can_use_veleda, emoji: state.user?.emoji
  };
  const canEdit = veledaUserCanEdit();

  // Modales (rendues en overlay si ouvertes)
  const writeModalHtml = state.veledaWriteModalOpen ? renderVeledaWriteModal() : '';
  const legendModalHtml = state.veledaLegendModalOpen ? renderVeledaLegendModal() : '';

  return `
    <div class="veleda-page">
      <div class="veleda-page-header">
        <h2 class="veleda-page-title">
          <i class="fas fa-clipboard mr-2" style="color: var(--c-gold, #C9A961);"></i>Tableau Veleda
        </h2>
        ${!canEdit ? `
          <span class="veleda-readonly-pill">
            <i class="fas fa-eye"></i> Lecture seule
          </span>
        ` : ''}
      </div>

      ${state.veledaError ? `
        <div class="mb-3 p-3 rounded-lg flex items-center gap-2 text-sm" style="background:rgba(220,38,38,0.08); color:#B91C1C; border:1px solid rgba(220,38,38,0.2);">
          <i class="fas fa-circle-exclamation"></i>
          <span>${veledaEscape(state.veledaError)}</span>
        </div>
      ` : ''}

      <!-- LE TABLEAU EN GRAND -->
      <div class="veleda-board veleda-board-large" id="veleda-board">
        <span class="veleda-rivet tl"></span>
        <span class="veleda-rivet tr"></span>
        <span class="veleda-rivet bl"></span>
        <span class="veleda-rivet br"></span>

        ${notes.length === 0 ? `
          <div class="veleda-empty">
            ${canEdit
              ? 'Le tableau est vide. Appuie sur "Ecrire" en haut a droite pour ajouter une info.'
              : 'Le tableau est vide pour l\\'instant.'
            }
          </div>
        ` : `
          <div class="veleda-notes-layer">
            ${notes.map(n => renderVeledaNote(n, me, canEdit)).join('')}
          </div>
        `}

        <!-- FAB Ecrire (haut-droite) — visible uniquement si permission -->
        ${canEdit ? `
          <button class="veleda-fab veleda-fab-write"
            onclick="openVeledaWriteModal()"
            title="Ecrire sur le tableau">
            <i class="fas fa-marker"></i>
            <span>Ecrire</span>
          </button>
        ` : ''}

        <!-- FAB Legende (bas-droite) — toujours visible -->
        <button class="veleda-fab veleda-fab-legend"
          onclick="openVeledaLegendModal()"
          title="Voir la legende (qui est qui)">
          <i class="fas fa-users"></i>
          <span>Legende</span>
        </button>
      </div>

      ${writeModalHtml}
      ${legendModalHtml}
    </div>
  `;
}

// ============================================
// MODALE "ECRIRE SUR LE TABLEAU"
// ============================================
function renderVeledaWriteModal() {
  const draft = state.veledaDraftContent || '';
  const expiresLocal = state.veledaDraftExpiresLocal || veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  const minLocal = veledaToDatetimeLocal(new Date(Date.now() + 60 * 1000));
  const selectedColor = state.veledaDraftColor || 'black';

  const colorButtons = VELEDA_COLORS.map(c => `
    <button type="button"
      class="veleda-color-pick veleda-color-${c} ${selectedColor === c ? 'active' : ''}"
      onclick="veledaSetDraftColor('${c}')"
      title="${veledaEscape(VELEDA_COLOR_LABELS[c])}">
      <span class="veleda-color-dot" style="background:${VELEDA_COLOR_HEX[c]};"></span>
      <span class="veleda-color-label">${veledaEscape(VELEDA_COLOR_LABELS[c])}</span>
      ${selectedColor === c ? '<i class="fas fa-check"></i>' : ''}
    </button>
  `).join('');

  return `
    <div class="veleda-modal-overlay" onclick="closeVeledaWriteModalIfBackdrop(event)">
      <div class="veleda-modal" onclick="event.stopPropagation()">
        <div class="veleda-modal-header">
          <h3>
            <i class="fas fa-marker" style="color:#C9A961;"></i>
            Ecrire sur le tableau
          </h3>
          <button class="veleda-modal-close" onclick="closeVeledaWriteModal()">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="veleda-modal-body">
          <label class="veleda-field-label">Information a partager</label>
          <textarea id="veleda-write-input"
            class="veleda-write-input-modal veleda-ink-${selectedColor}"
            maxlength="${VELEDA_MAX_CONTENT_LEN}"
            rows="3"
            placeholder="Ex: ch.204 check-out 14h, livraison mardi, plombier 9h..."
            oninput="veledaOnInputChange(this.value)"
            onkeydown="veledaOnKeyDown(event)"
          >${veledaEscape(draft)}</textarea>

          <label class="veleda-field-label">
            Importance
            <span class="veleda-field-hint">— change la couleur du feutre</span>
          </label>
          <div class="veleda-color-row">
            ${colorButtons}
          </div>

          <label class="veleda-field-label">
            <i class="fas fa-calendar-day" style="margin-right:4px;"></i>
            Date et heure de disparition
          </label>
          <input id="veleda-expires-input"
            type="datetime-local"
            class="veleda-custom-date-input"
            min="${minLocal}"
            value="${expiresLocal}"
            onchange="veledaSetExpires(this.value)">
        </div>

        <div class="veleda-modal-footer">
          <button class="veleda-modal-btn veleda-modal-cancel" onclick="closeVeledaWriteModal()">
            Annuler
          </button>
          <button class="veleda-modal-btn veleda-modal-submit" id="veleda-submit-btn" onclick="submitVeledaCreate()">
            <i class="fas fa-marker"></i> Ecrire
          </button>
        </div>
      </div>
    </div>
  `;
}

function openVeledaWriteModal() {
  if (!veledaUserCanEdit()) return;
  state.veledaWriteModalOpen = true;
  // Reset les valeurs par defaut si vide
  if (!state.veledaDraftColor) state.veledaDraftColor = 'black';
  if (!state.veledaDraftExpiresLocal) {
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  }
  renderApp();
  setTimeout(() => {
    const inp = document.getElementById('veleda-write-input');
    if (inp) inp.focus();
  }, 50);
}

function closeVeledaWriteModal() {
  state.veledaWriteModalOpen = false;
  renderApp();
}

function closeVeledaWriteModalIfBackdrop(event) {
  if (event.target.classList && event.target.classList.contains('veleda-modal-overlay')) {
    closeVeledaWriteModal();
  }
}

function veledaSetDraftColor(color) {
  if (VELEDA_COLORS.indexOf(color) === -1) return;
  state.veledaDraftColor = color;
  renderApp();
  setTimeout(() => {
    const inp = document.getElementById('veleda-write-input');
    if (inp) inp.focus();
  }, 30);
}

// ============================================
// MODALE "LEGENDE" (qui est qui + change son emoji)
// ============================================
function renderVeledaLegendModal() {
  const myEmoji = (state.veledaMe && state.veledaMe.emoji) || (state.user && state.user.emoji) || null;
  const legend = state.veledaLegend || null;

  // Liste des users de l'hotel
  const usersHtml = legend === null ? `
    <div class="veleda-legend-loading">
      <i class="fas fa-spinner fa-spin"></i> Chargement de la legende...
    </div>
  ` : (legend.length === 0 ? `
    <div class="veleda-legend-empty">Aucun utilisateur dans cet hotel.</div>
  ` : `
    <div class="veleda-legend-list">
      ${legend.map(u => `
        <div class="veleda-legend-item">
          <span class="veleda-legend-emoji">${u.emoji ? veledaEscape(u.emoji) : '<i class=\\'fas fa-user-circle\\' style=\\'opacity:0.3;\\'></i>'}</span>
          <span class="veleda-legend-name">${veledaEscape(u.name || 'Sans nom')}</span>
          ${u.role === 'admin' ? '<span class="veleda-legend-badge">admin</span>' : ''}
          ${u.id === state.user?.id ? '<span class="veleda-legend-you">moi</span>' : ''}
        </div>
      `).join('')}
    </div>
  `);

  // Banque d'emojis a choisir
  const emojiPicker = VELEDA_EMOJI_BANK.map(em => `
    <button type="button"
      class="veleda-emoji-pick ${myEmoji === em ? 'active' : ''}"
      onclick="veledaPickMyEmoji('${em.replace(/'/g, "\\'")}')"
      title="Choisir cet icone">
      ${em}
    </button>
  `).join('');

  return `
    <div class="veleda-modal-overlay" onclick="closeVeledaLegendModalIfBackdrop(event)">
      <div class="veleda-modal veleda-modal-wide" onclick="event.stopPropagation()">
        <div class="veleda-modal-header">
          <h3>
            <i class="fas fa-users" style="color:#C9A961;"></i>
            Legende du tableau
          </h3>
          <button class="veleda-modal-close" onclick="closeVeledaLegendModal()">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="veleda-modal-body">
          <div class="veleda-legend-section">
            <h4 class="veleda-legend-title">Qui est qui</h4>
            <p class="veleda-legend-subtitle">Chaque icone identifie son auteur sur le tableau.</p>
            ${usersHtml}
          </div>

          <div class="veleda-legend-section veleda-legend-picker-section">
            <h4 class="veleda-legend-title">
              Mon icone
              <span class="veleda-legend-current">${myEmoji ? veledaEscape(myEmoji) : '<span style="opacity:0.4;">(non choisi)</span>'}</span>
            </h4>
            <p class="veleda-legend-subtitle">Choisis ton icone parmi les ${VELEDA_EMOJI_BANK.length} disponibles. Clique a nouveau pour la retirer.</p>
            <div class="veleda-emoji-picker">
              ${emojiPicker}
            </div>
            ${myEmoji ? `
              <button class="veleda-emoji-clear" onclick="veledaClearMyEmoji()">
                <i class="fas fa-times"></i> Retirer mon icone
              </button>
            ` : ''}
          </div>
        </div>

        <div class="veleda-modal-footer">
          <button class="veleda-modal-btn veleda-modal-cancel" onclick="closeVeledaLegendModal()">
            Fermer
          </button>
        </div>
      </div>
    </div>
  `;
}

function openVeledaLegendModal() {
  state.veledaLegendModalOpen = true;
  state.veledaLegend = null; // force rechargement
  state.veledaLegendError = null;
  renderApp();
  loadVeledaLegend().then(() => renderApp());
}

function closeVeledaLegendModal() {
  state.veledaLegendModalOpen = false;
  renderApp();
}

function closeVeledaLegendModalIfBackdrop(event) {
  if (event.target.classList && event.target.classList.contains('veleda-modal-overlay')) {
    closeVeledaLegendModal();
  }
}

async function veledaPickMyEmoji(emoji) {
  try {
    const res = await fetch('/api/me/emoji', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Impossible de changer l\'icone');
    // Maj locale
    if (state.user) state.user.emoji = emoji;
    if (state.veledaMe) state.veledaMe.emoji = emoji;
    // Maj de la legende locale aussi
    if (Array.isArray(state.veledaLegend)) {
      const me = state.veledaLegend.find(u => u.id === state.user?.id);
      if (me) me.emoji = emoji;
    }
    // Recharge les notes pour mettre a jour author_emoji sur ses propres notes
    await loadVeledaNotes();
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

async function veledaClearMyEmoji() {
  try {
    const res = await fetch('/api/me/emoji', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: null })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur');
    if (state.user) state.user.emoji = null;
    if (state.veledaMe) state.veledaMe.emoji = null;
    if (Array.isArray(state.veledaLegend)) {
      const me = state.veledaLegend.find(u => u.id === state.user?.id);
      if (me) me.emoji = null;
    }
    await loadVeledaNotes();
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// RENDU D'UNE NOTE
// ============================================
function renderVeledaNote(note, me, canEdit) {
  const urgency = veledaUrgency(note.expires_at);
  const color = veledaNoteColor(note);
  const rotation = veledaRotationFor(note.id);
  const expiresLabel = veledaExpiresLabel(note.expires_at);
  const authorName = (note.created_by_name || '?').split(' ')[0];
  const authorEmoji = note.author_emoji || null;
  const isEditing = state.veledaEditingId === note.id;

  const x = note.pos_x ?? 20;
  const y = note.pos_y ?? 20;
  const w = note.width ?? VELEDA_DEFAULT_WIDTH;
  const h = note.height ?? VELEDA_DEFAULT_HEIGHT;

  // En mode edition : on affiche un textarea inline (rotation supprimee)
  if (isEditing) {
    const colorButtons = VELEDA_COLORS.map(c => `
      <button type="button"
        class="veleda-color-pick-mini veleda-color-${c} ${color === c ? 'active' : ''}"
        onclick="veledaChangeNoteColor(${note.id}, '${c}')"
        title="${veledaEscape(VELEDA_COLOR_LABELS[c])}">
        <span class="veleda-color-dot" style="background:${VELEDA_COLOR_HEX[c]};"></span>
      </button>
    `).join('');

    return `
      <div class="veleda-note veleda-ink-${color} veleda-note-editing"
        style="left:${x}px; top:${y}px; width:${w}px; min-height:${h}px; transform: rotate(0deg); z-index: 50;"
        data-note-id="${note.id}">
        <textarea class="veleda-inline-edit-input"
          maxlength="${VELEDA_MAX_CONTENT_LEN}"
          onkeydown="veledaOnInlineEditKey(event, ${note.id})"
        >${veledaEscape(note.content)}</textarea>
        <div class="veleda-inline-color-row">
          ${colorButtons}
        </div>
        <div class="veleda-inline-edit-actions">
          <button class="veleda-inline-btn veleda-inline-cancel" onclick="veledaCancelEdit()">
            <i class="fas fa-times"></i> Annuler
          </button>
          <button class="veleda-inline-btn veleda-inline-save" onclick="veledaSaveEdit(${note.id})">
            <i class="fas fa-check"></i> Enregistrer
          </button>
        </div>
      </div>
    `;
  }

  // Mode normal : avec drag/resize/erase si canEdit
  const dragHandler = canEdit ? `onmousedown="veledaStartDrag(event, ${note.id})"` : '';
  const dblClickHandler = canEdit ? `ondblclick="veledaStartEdit(${note.id})"` : '';

  return `
    <div class="veleda-note veleda-ink-${color} ${canEdit ? 'veleda-note-draggable' : ''}"
      style="left:${x}px; top:${y}px; width:${w}px; min-height:${h}px; transform: rotate(${rotation}deg);"
      data-note-id="${note.id}"
      ${dragHandler}
      ${dblClickHandler}>
      ${canEdit ? `
        <button class="veleda-eraser"
          onmousedown="event.stopPropagation();"
          onclick="deleteVeledaNote(${note.id})"
          title="Effacer cette note">
          <i class="fas fa-eraser"></i>
        </button>
        <button class="veleda-edit-btn"
          onmousedown="event.stopPropagation();"
          onclick="veledaStartEdit(${note.id})"
          title="Modifier le contenu">
          <i class="fas fa-pen"></i>
        </button>
      ` : ''}
      ${authorEmoji ? `
        <span class="veleda-note-author-emoji" title="${veledaEscape(authorName)}">
          ${veledaEscape(authorEmoji)}
        </span>
      ` : ''}
      <div class="veleda-note-content">${veledaEscape(note.content)}</div>
      <div class="veleda-meta">
        <span class="veleda-urgency-dot ${urgency}"></span>
        <span>${veledaEscape(expiresLabel)}</span>
        <span style="opacity:0.6;">— ${veledaEscape(authorName)}</span>
      </div>
      ${canEdit ? `
        <div class="veleda-resize-handle"
          onmousedown="veledaStartResize(event, ${note.id})"
          title="Redimensionner">
          <i class="fas fa-grip-lines" style="transform: rotate(-45deg);"></i>
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================
// INTERACTIONS — saisie & creation
// ============================================
function veledaOnInputChange(value) {
  state.veledaDraftContent = value;
}

function veledaOnKeyDown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    submitVeledaCreate();
  }
}

function veledaSetExpires(localStr) {
  state.veledaDraftExpiresLocal = localStr;
}

async function submitVeledaCreate() {
  const content = (state.veledaDraftContent || '').trim();
  const expiresLocal = state.veledaDraftExpiresLocal;
  const color = state.veledaDraftColor || 'black';
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
  if (!expiresLocal) {
    alert('Choisis une date et une heure de disparition.');
    return;
  }
  if (VELEDA_COLORS.indexOf(color) === -1) {
    alert('Couleur invalide.');
    return;
  }
  const expiresDate = new Date(expiresLocal);
  if (isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now()) {
    alert('La date de disparition doit etre dans le futur.');
    return;
  }
  const expiresIso = expiresDate.toISOString();

  // Position initiale (emplacement libre)
  const board = document.getElementById('veleda-board');
  const boardRect = board ? board.getBoundingClientRect() : { width: 1000, height: 600 };
  const boardW = boardRect.width - 80;
  const boardH = boardRect.height - 80;
  const spot = veledaFindFreeSpot(state.veledaNotes || [], boardW, boardH, VELEDA_DEFAULT_WIDTH, VELEDA_DEFAULT_HEIGHT);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ecriture...';
  }

  try {
    const res = await fetch('/api/veleda-notes', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '',
        content,
        expires_at: expiresIso,
        pos_x: Math.round(spot.x),
        pos_y: Math.round(spot.y),
        width: VELEDA_DEFAULT_WIDTH,
        height: VELEDA_DEFAULT_HEIGHT,
        color
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur d\'ecriture');

    // Reset du brouillon (date par defaut a +24h, couleur black)
    state.veledaDraftContent = '';
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
    state.veledaDraftColor = 'black';
    state.veledaWriteModalOpen = false;

    await loadVeledaNotes();
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-marker"></i> Ecrire';
    }
  }
}

async function deleteVeledaNote(noteId) {
  if (!confirm('Effacer cette note du tableau ?')) return;
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur de suppression');
    state.veledaNotes = (state.veledaNotes || []).filter(n => n.id !== noteId);
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// EDITION INLINE DU CONTENU + COULEUR
// ============================================
function veledaStartEdit(noteId) {
  if (!veledaUserCanEdit()) return;
  state.veledaEditingId = noteId;
  renderApp();
  setTimeout(() => {
    const ta = document.querySelector('.veleda-note-editing textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 50);
}

function veledaCancelEdit() {
  state.veledaEditingId = null;
  renderApp();
}

function veledaOnInlineEditKey(event, noteId) {
  if (event.key === 'Escape') {
    event.preventDefault();
    veledaCancelEdit();
  } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    veledaSaveEdit(noteId);
  }
}

async function veledaSaveEdit(noteId) {
  const ta = document.querySelector('.veleda-note-editing textarea');
  if (!ta) return;
  const newContent = ta.value.trim();
  if (!newContent) {
    alert('Le contenu ne peut pas etre vide.');
    return;
  }
  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (note && newContent === note.content) {
    veledaCancelEdit();
    return;
  }
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur de modification');
    if (note) note.content = newContent;
    state.veledaEditingId = null;
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// Changement de couleur d'une note pendant l'edition inline
async function veledaChangeNoteColor(noteId, color) {
  if (!veledaUserCanEdit()) return;
  if (VELEDA_COLORS.indexOf(color) === -1) return;
  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;
  if (note.color === color) return;
  // MAJ optimiste
  const prevColor = note.color;
  note.color = color;
  renderApp();
  setTimeout(() => {
    const ta = document.querySelector('.veleda-note-editing textarea');
    if (ta) ta.focus();
  }, 30);
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ color })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur de changement de couleur');
    }
  } catch (e) {
    // Rollback
    note.color = prevColor;
    renderApp();
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// DRAG & DROP
// ============================================
function veledaStartDrag(event, noteId) {
  if (event.target.closest('.veleda-resize-handle') ||
      event.target.closest('.veleda-eraser') ||
      event.target.closest('.veleda-edit-btn') ||
      event.target.closest('.veleda-inline-edit-input') ||
      event.target.closest('.veleda-inline-edit-actions') ||
      event.target.closest('.veleda-note-author-emoji')) return;
  if (event.button !== 0) return;
  if (!veledaUserCanEdit()) return;
  if (state.veledaEditingId === noteId) return;

  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;

  event.preventDefault();
  state.veledaDragging = {
    id: noteId,
    startX: event.clientX,
    startY: event.clientY,
    origX: note.pos_x ?? 20,
    origY: note.pos_y ?? 20
  };

  document.addEventListener('mousemove', veledaOnDragMove);
  document.addEventListener('mouseup', veledaOnDragEnd);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';

  const el = document.querySelector(`.veleda-note[data-note-id="${noteId}"]`);
  if (el) {
    el.dataset.origRotation = el.style.transform;
    el.style.transform = 'rotate(0deg) scale(1.03)';
    el.style.zIndex = '100';
    el.style.transition = 'none';
    el.style.boxShadow = '0 12px 30px rgba(0,0,0,0.25)';
  }
}

function veledaOnDragMove(event) {
  if (!state.veledaDragging) return;
  const dx = event.clientX - state.veledaDragging.startX;
  const dy = event.clientY - state.veledaDragging.startY;
  const newX = state.veledaDragging.origX + dx;
  const newY = state.veledaDragging.origY + dy;

  const el = document.querySelector(`.veleda-note[data-note-id="${state.veledaDragging.id}"]`);
  if (el) {
    el.style.left = newX + 'px';
    el.style.top = newY + 'px';
  }
}

async function veledaOnDragEnd(event) {
  if (!state.veledaDragging) return;
  const { id, startX, startY, origX, origY } = state.veledaDragging;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  let newX = Math.round(origX + dx);
  let newY = Math.round(origY + dy);

  const board = document.getElementById('veleda-board');
  if (board) {
    const boardRect = board.getBoundingClientRect();
    const noteEl = document.querySelector(`.veleda-note[data-note-id="${id}"]`);
    const noteRect = noteEl ? noteEl.getBoundingClientRect() : { width: 240, height: 110 };
    newX = Math.max(-50, Math.min(newX, boardRect.width - noteRect.width + 50));
    newY = Math.max(-20, Math.min(newY, boardRect.height - noteRect.height + 20));
  }

  const el = document.querySelector(`.veleda-note[data-note-id="${id}"]`);
  if (el) {
    el.style.left = newX + 'px';
    el.style.top = newY + 'px';
    el.style.transform = el.dataset.origRotation || '';
    el.style.zIndex = '';
    el.style.transition = '';
    el.style.boxShadow = '';
  }

  document.removeEventListener('mousemove', veledaOnDragMove);
  document.removeEventListener('mouseup', veledaOnDragEnd);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  const note = (state.veledaNotes || []).find(n => n.id === id);
  if (note) {
    note.pos_x = newX;
    note.pos_y = newY;
  }
  state.veledaDragging = null;

  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    await persistVeledaLayout(id, { pos_x: newX, pos_y: newY });
  }
}

// ============================================
// RESIZE
// ============================================
function veledaStartResize(event, noteId) {
  if (event.button !== 0) return;
  if (!veledaUserCanEdit()) return;
  event.preventDefault();
  event.stopPropagation();

  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;

  state.veledaResizing = {
    id: noteId,
    startX: event.clientX,
    startY: event.clientY,
    origW: note.width ?? VELEDA_DEFAULT_WIDTH,
    origH: note.height ?? VELEDA_DEFAULT_HEIGHT
  };

  document.addEventListener('mousemove', veledaOnResizeMove);
  document.addEventListener('mouseup', veledaOnResizeEnd);
  document.body.style.cursor = 'nwse-resize';
  document.body.style.userSelect = 'none';

  const el = document.querySelector(`.veleda-note[data-note-id="${noteId}"]`);
  if (el) {
    el.dataset.origRotation = el.style.transform;
    el.style.transform = 'rotate(0deg)';
    el.style.transition = 'none';
    el.style.zIndex = '100';
  }
}

function veledaOnResizeMove(event) {
  if (!state.veledaResizing) return;
  const dx = event.clientX - state.veledaResizing.startX;
  const dy = event.clientY - state.veledaResizing.startY;
  let newW = state.veledaResizing.origW + dx;
  let newH = state.veledaResizing.origH + dy;
  newW = Math.max(VELEDA_MIN_SIZE, Math.min(newW, VELEDA_MAX_SIZE));
  newH = Math.max(VELEDA_MIN_SIZE, Math.min(newH, VELEDA_MAX_SIZE));

  const el = document.querySelector(`.veleda-note[data-note-id="${state.veledaResizing.id}"]`);
  if (el) {
    el.style.width = newW + 'px';
    el.style.minHeight = newH + 'px';
  }
}

async function veledaOnResizeEnd(event) {
  if (!state.veledaResizing) return;
  const { id, startX, startY, origW, origH } = state.veledaResizing;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  let newW = Math.round(origW + dx);
  let newH = Math.round(origH + dy);
  newW = Math.max(VELEDA_MIN_SIZE, Math.min(newW, VELEDA_MAX_SIZE));
  newH = Math.max(VELEDA_MIN_SIZE, Math.min(newH, VELEDA_MAX_SIZE));

  const el = document.querySelector(`.veleda-note[data-note-id="${id}"]`);
  if (el) {
    el.style.width = newW + 'px';
    el.style.minHeight = newH + 'px';
    el.style.transform = el.dataset.origRotation || '';
    el.style.transition = '';
    el.style.zIndex = '';
  }

  document.removeEventListener('mousemove', veledaOnResizeMove);
  document.removeEventListener('mouseup', veledaOnResizeEnd);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  const note = (state.veledaNotes || []).find(n => n.id === id);
  if (note) {
    note.width = newW;
    note.height = newH;
  }
  state.veledaResizing = null;

  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    await persistVeledaLayout(id, { width: newW, height: newH });
  }
}

// Persistance silencieuse du layout
async function persistVeledaLayout(noteId, payload) {
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Veleda: persistance layout echouee', err);
    }
  } catch (e) {
    console.warn('Veleda: erreur persistance layout', e);
  }
}

// ============================================
// EXPORT GLOBAL
// ============================================
window.renderVeledaView = renderVeledaView;
window.loadVeledaNotes = loadVeledaNotes;
window.loadVeledaLegend = loadVeledaLegend;
window.veledaOnInputChange = veledaOnInputChange;
window.veledaOnKeyDown = veledaOnKeyDown;
window.veledaSetExpires = veledaSetExpires;
window.veledaSetDraftColor = veledaSetDraftColor;
window.submitVeledaCreate = submitVeledaCreate;
window.deleteVeledaNote = deleteVeledaNote;
window.veledaStartDrag = veledaStartDrag;
window.veledaStartResize = veledaStartResize;
window.veledaStartEdit = veledaStartEdit;
window.veledaCancelEdit = veledaCancelEdit;
window.veledaSaveEdit = veledaSaveEdit;
window.veledaOnInlineEditKey = veledaOnInlineEditKey;
window.veledaChangeNoteColor = veledaChangeNoteColor;
window.stopVeledaPolling = stopVeledaPolling;
window.openVeledaWriteModal = openVeledaWriteModal;
window.closeVeledaWriteModal = closeVeledaWriteModal;
window.closeVeledaWriteModalIfBackdrop = closeVeledaWriteModalIfBackdrop;
window.openVeledaLegendModal = openVeledaLegendModal;
window.closeVeledaLegendModal = closeVeledaLegendModal;
window.closeVeledaLegendModalIfBackdrop = closeVeledaLegendModalIfBackdrop;
window.veledaPickMyEmoji = veledaPickMyEmoji;
window.veledaClearMyEmoji = veledaClearMyEmoji;
