// ============================================
// VIEW: TABLEAU VELEDA — Vrai whiteboard d'equipe
// ============================================
//
// Concept : un VRAI tableau Veleda numerique.
// - L'utilisateur ayant la permission can_use_veleda peut TOUT faire sur le
//   tableau : creer, modifier le contenu, deplacer, redimensionner, supprimer
//   N'IMPORTE QUELLE note (pas seulement les siennes).
// - Les autres utilisateurs voient le tableau en LECTURE SEULE.
// - La duree de vie d'une note se choisit obligatoirement via un selecteur
//   date + heure (datetime-local).
// - A son expiration, la note disparait automatiquement (lazy cleanup serveur).
//
// Etat dans state :
//   state.veledaNotes        : array des notes actives (avec pos_x, pos_y, width, height)
//   state.veledaLoading      : bool
//   state.veledaError        : string|null
//   state.veledaMe           : { id, role, can_use_veleda }
//   state.veledaPollingId    : interval id (polling 60s)
//   state.veledaDraftContent : brouillon en cours de saisie
//   state.veledaDraftExpiresLocal : date+heure choisie pour la nouvelle note (YYYY-MM-DDTHH:mm)
//   state.veledaDragging     : { id, startX, startY, origX, origY } pendant un drag
//   state.veledaResizing     : { id, startX, startY, origW, origH } pendant un resize
//   state.veledaEditingId    : id de la note en cours d'edition inline (null sinon)

// Limites (alignees avec le backend)
const VELEDA_MAX_CONTENT_LEN = 2000;

// Couleurs de feutre (stables par id)
const VELEDA_INK_COLORS = ['black', 'blue', 'red', 'green'];

// Angles de rotation (stables par id)
const VELEDA_ROTATIONS = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3];

// Dimensions par defaut d'une nouvelle note (px)
const VELEDA_DEFAULT_WIDTH = 240;
const VELEDA_DEFAULT_HEIGHT = 110;

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

function veledaInkFor(noteId) {
  const idx = Math.abs(Number(noteId) || 0) % VELEDA_INK_COLORS.length;
  return VELEDA_INK_COLORS[idx];
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

// Detection de permission cote front (l'autorite reelle est cote serveur)
function veledaUserCanEdit() {
  // L'API renvoie can_use_veleda dans state.veledaMe (source de verite serveur).
  // Fallback sur le state.user pour les cas avant chargement.
  if (state.veledaMe && state.veledaMe.can_use_veleda !== undefined) {
    return Number(state.veledaMe.can_use_veleda) === 1;
  }
  if (typeof userCanUseVeleda === 'function') return userCanUseVeleda();
  if (!state.user) return false;
  return state.user.role === 'admin' || state.user.role === 'super_admin' || Number(state.user.can_use_veleda) === 1;
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
    state.veledaMe = data.me || { id: state.user?.id, role: state.user?.role, can_use_veleda: state.user?.can_use_veleda };
  } catch (e) {
    state.veledaError = e.message || 'Erreur inconnue';
    state.veledaNotes = state.veledaNotes || [];
  } finally {
    state.veledaLoading = false;
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
    if (isTyping || isEditing || isInteracting) return;

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
  if (state.veledaNotes === undefined) {
    state.veledaNotes = [];
    state.veledaDraftContent = state.veledaDraftContent || '';
    // Default datetime : 24h dans le futur
    if (!state.veledaDraftExpiresLocal) {
      state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
    }
    state.veledaEditingId = null;
    loadVeledaNotes().then(() => {
      startVeledaPolling();
      renderApp();
    });
    return renderVeledaShell([]);
  }

  if (state.veledaDraftContent === undefined) state.veledaDraftContent = '';
  if (!state.veledaDraftExpiresLocal) {
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  }
  if (state.veledaEditingId === undefined) state.veledaEditingId = null;

  startVeledaPolling();
  return renderVeledaShell(state.veledaNotes || []);
}

function renderVeledaShell(notes) {
  const me = state.veledaMe || { id: state.user?.id, role: state.user?.role, can_use_veleda: state.user?.can_use_veleda };
  const canEdit = veledaUserCanEdit();

  return `
    <div class="max-w-7xl mx-auto">

      <h2 class="veleda-page-title">
        <i class="fas fa-clipboard mr-2" style="color: var(--c-gold, #C9A961);"></i>Tableau Veleda
      </h2>
      <p class="veleda-page-subtitle">
        ${canEdit
          ? 'Ce qu\'il faut avoir en tete maintenant. Place les notes ou tu veux, redimensionne-les, modifie-les. Elles s\'effacent toutes seules a la date choisie.'
          : 'Ce qu\'il faut avoir en tete maintenant. Vous consultez le tableau en lecture seule. Demandez a l\'admin la permission d\'ecrire dessus.'
        }
      </p>

      ${state.veledaError ? `
        <div class="mb-4 p-3 rounded-lg flex items-center gap-2 text-sm" style="background:rgba(220,38,38,0.08); color:#B91C1C; border:1px solid rgba(220,38,38,0.2);">
          <i class="fas fa-circle-exclamation"></i>
          <span>${veledaEscape(state.veledaError)}</span>
        </div>
      ` : ''}

      <!-- ZONE DE SAISIE (visible uniquement pour ceux qui ont la permission) -->
      ${canEdit ? renderVeledaWriteZone() : `
        <div class="veleda-readonly-banner">
          <i class="fas fa-eye"></i>
          <span>Lecture seule — vous n'avez pas la permission d'ecrire sur ce tableau.</span>
        </div>
      `}

      <!-- LE TABLEAU -->
      <div class="veleda-board" id="veleda-board">
        <span class="veleda-rivet tl"></span>
        <span class="veleda-rivet tr"></span>
        <span class="veleda-rivet bl"></span>
        <span class="veleda-rivet br"></span>

        ${notes.length === 0 ? `
          <div class="veleda-empty">
            ${canEdit
              ? 'Le tableau est vide. Ecris une premiere info la-haut'
              : 'Le tableau est vide pour l\'instant.'
            }
            ${canEdit ? '<i class="fas fa-arrow-up" style="opacity:0.4; margin-left:8px;"></i>' : ''}
          </div>
        ` : `
          <div class="veleda-notes-layer">
            ${notes.map(n => renderVeledaNote(n, me, canEdit)).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

// Zone de saisie : textarea + datetime-local obligatoire + bouton submit
function renderVeledaWriteZone() {
  const draft = state.veledaDraftContent || '';
  const expiresLocal = state.veledaDraftExpiresLocal || veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  // Min = maintenant (pour empecher selection passe via le picker)
  const minLocal = veledaToDatetimeLocal(new Date(Date.now() + 60 * 1000));

  return `
    <div class="veleda-write-zone-standalone">
      <textarea id="veleda-write-input"
        class="veleda-write-input"
        maxlength="${VELEDA_MAX_CONTENT_LEN}"
        rows="2"
        placeholder="Ecris une info ici... (ex: ch.204 check-out 14h, livraison mardi, plombier 9h)"
        oninput="veledaOnInputChange(this.value)"
        onkeydown="veledaOnKeyDown(event)"
      >${veledaEscape(draft)}</textarea>

      <div class="veleda-write-row">
        <div class="veleda-date-block">
          <label class="veleda-date-label">
            <i class="fas fa-calendar-day" style="margin-right:4px;"></i>
            disparait le :
          </label>
          <input id="veleda-expires-input"
            type="datetime-local"
            class="veleda-custom-date-input"
            min="${minLocal}"
            value="${expiresLocal}"
            onchange="veledaSetExpires(this.value)">
        </div>
        <button class="veleda-write-submit" id="veleda-submit-btn" onclick="submitVeledaCreate()">
          <i class="fas fa-marker"></i> Ecrire sur le tableau
        </button>
      </div>
    </div>
  `;
}

// Une note posee sur le tableau
function renderVeledaNote(note, me, canEdit) {
  const urgency = veledaUrgency(note.expires_at);
  const ink = veledaInkFor(note.id);
  const rotation = veledaRotationFor(note.id);
  const expiresLabel = veledaExpiresLabel(note.expires_at);
  const authorName = (note.created_by_name || '?').split(' ')[0];
  const isEditing = state.veledaEditingId === note.id;

  const x = note.pos_x ?? 20;
  const y = note.pos_y ?? 20;
  const w = note.width ?? VELEDA_DEFAULT_WIDTH;
  const h = note.height ?? VELEDA_DEFAULT_HEIGHT;

  // En mode edition : on affiche un textarea inline (rotation supprimee)
  if (isEditing) {
    return `
      <div class="veleda-note veleda-ink-${ink} veleda-note-editing"
        style="left:${x}px; top:${y}px; width:${w}px; min-height:${h}px; transform: rotate(0deg); z-index: 50;"
        data-note-id="${note.id}">
        <textarea class="veleda-inline-edit-input"
          maxlength="${VELEDA_MAX_CONTENT_LEN}"
          onkeydown="veledaOnInlineEditKey(event, ${note.id})"
        >${veledaEscape(note.content)}</textarea>
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
    <div class="veleda-note veleda-ink-${ink} ${canEdit ? 'veleda-note-draggable' : ''}"
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
        height: VELEDA_DEFAULT_HEIGHT
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur d\'ecriture');

    // Reset du brouillon (on remet la date par defaut a +24h)
    state.veledaDraftContent = '';
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));

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
// EDITION INLINE DU CONTENU
// ============================================
function veledaStartEdit(noteId) {
  if (!veledaUserCanEdit()) return;
  state.veledaEditingId = noteId;
  renderApp();
  // Focus sur le textarea apres rerender
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
  // Echap = annuler, Cmd/Ctrl+Entree = enregistrer
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
  // Si rien n'a change, on ferme simplement
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
    // Met a jour le state local
    if (note) note.content = newContent;
    state.veledaEditingId = null;
    renderApp();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// DRAG & DROP
// ============================================
function veledaStartDrag(event, noteId) {
  // Pas de drag si on clique sur un controle interne
  if (event.target.closest('.veleda-resize-handle') ||
      event.target.closest('.veleda-eraser') ||
      event.target.closest('.veleda-edit-btn') ||
      event.target.closest('.veleda-inline-edit-input') ||
      event.target.closest('.veleda-inline-edit-actions')) return;
  if (event.button !== 0) return;
  if (!veledaUserCanEdit()) return;
  // Pas de drag si en mode edition
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
window.veledaOnInputChange = veledaOnInputChange;
window.veledaOnKeyDown = veledaOnKeyDown;
window.veledaSetExpires = veledaSetExpires;
window.submitVeledaCreate = submitVeledaCreate;
window.deleteVeledaNote = deleteVeledaNote;
window.veledaStartDrag = veledaStartDrag;
window.veledaStartResize = veledaStartResize;
window.veledaStartEdit = veledaStartEdit;
window.veledaCancelEdit = veledaCancelEdit;
window.veledaSaveEdit = veledaSaveEdit;
window.veledaOnInlineEditKey = veledaOnInlineEditKey;
window.stopVeledaPolling = stopVeledaPolling;
