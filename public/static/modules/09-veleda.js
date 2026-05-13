// ============================================
// VIEW: TABLEAU VELEDA — Vrai whiteboard d'equipe
// ============================================
//
// Concept : un VRAI tableau Veleda numerique.
// - L'utilisateur ecrit une info brute (pas de titre).
// - Choix de la duree de vie : boutons rapides OU date precise.
// - Une fois sur le tableau, la note peut etre DEPLACEE (drag) et REDIMENSIONNEE
//   (poignee en bas a droite) par son auteur (ou un admin).
// - A son expiration, la note disparait automatiquement (lazy cleanup serveur).
//
// Etat dans state :
//   state.veledaNotes        : array des notes actives (avec pos_x, pos_y, width, height)
//   state.veledaLoading      : bool
//   state.veledaError        : string|null
//   state.veledaMe           : { id, role }
//   state.veledaPollingId    : interval id (polling 60s)
//   state.veledaDraftContent : brouillon en cours de saisie
//   state.veledaDraftHours   : duree choisie (heures) — null si custom
//   state.veledaDraftCustomDate : date custom (ISO local) — null sinon
//   state.veledaShowDatePicker : bool pour afficher le datetime-local
//   state.veledaDragging     : { id, startX, startY, origX, origY } pendant un drag
//   state.veledaResizing     : { id, startX, startY, origW, origH } pendant un resize

// Durees rapides proposees (en heures)
const VELEDA_QUICK_DURATIONS = [
  { label: '6h',      hours: 6 },
  { label: '24h',     hours: 24 },
  { label: '3 jours', hours: 72 },
  { label: '7 jours', hours: 168 },
  { label: '14 jours', hours: 336 },
  { label: '1 mois',  hours: 720 },
];

// Limites (alignees avec le backend)
const VELEDA_MAX_CONTENT_LEN = 2000;

// Couleurs de feutre disponibles (stables par id)
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
  if (minutes < 60) return `expire dans ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `expire dans ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `expire dans ${days}j`;
  const months = Math.floor(days / 30);
  return `expire dans ${months} mois`;
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

// Recherche d'un emplacement libre (algo simple : on parcourt une grille virtuelle)
// pour positionner automatiquement une nouvelle note sans chevauchement.
function veledaFindFreeSpot(notes, boardWidth, boardHeight, w, h) {
  const padding = 12;
  // On essaie en bandes horizontales (top a top), de gauche a droite
  for (let y = padding; y < boardHeight - h - padding; y += 40) {
    for (let x = padding; x < boardWidth - w - padding; x += 40) {
      let collision = false;
      for (const n of notes) {
        const nx = n.pos_x ?? 0;
        const ny = n.pos_y ?? 0;
        const nw = n.width ?? VELEDA_DEFAULT_WIDTH;
        const nh = n.height ?? VELEDA_DEFAULT_HEIGHT;
        // Test AABB
        if (x < nx + nw + padding && x + w + padding > nx && y < ny + nh + padding && y + h + padding > ny) {
          collision = true;
          break;
        }
      }
      if (!collision) return { x, y };
    }
  }
  // Fallback : en bas a gauche avec un decalage aleatoire
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
    state.veledaMe = data.me || { id: state.user?.id, role: state.user?.role };
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
    // Si l'utilisateur est en train de taper / dragger / resizer, on skip
    const inputEl = document.getElementById('veleda-write-input');
    const isTyping = inputEl && document.activeElement === inputEl;
    const isInteracting = !!state.veledaDragging || !!state.veledaResizing;
    if (isTyping || isInteracting) return;

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
    state.veledaDraftHours = state.veledaDraftHours || 24;
    state.veledaDraftCustomDate = state.veledaDraftCustomDate || null;
    state.veledaShowDatePicker = false;
    loadVeledaNotes().then(() => {
      startVeledaPolling();
      renderApp();
    });
    return renderVeledaShell([]);
  }

  if (state.veledaDraftContent === undefined) state.veledaDraftContent = '';
  if (state.veledaDraftHours === undefined) state.veledaDraftHours = 24;
  if (state.veledaDraftCustomDate === undefined) state.veledaDraftCustomDate = null;
  if (state.veledaShowDatePicker === undefined) state.veledaShowDatePicker = false;

  startVeledaPolling();
  return renderVeledaShell(state.veledaNotes || []);
}

function renderVeledaShell(notes) {
  const me = state.veledaMe || { id: state.user?.id, role: state.user?.role };

  return `
    <div class="max-w-7xl mx-auto">

      <h2 class="veleda-page-title">
        <i class="fas fa-clipboard mr-2" style="color: var(--c-gold, #C9A961);"></i>Tableau Veleda
      </h2>
      <p class="veleda-page-subtitle">
        Ce qu'il faut avoir en tete maintenant. Place les notes ou tu veux, redimensionne-les. Elles s'effacent toutes seules a la date choisie.
      </p>

      ${state.veledaError ? `
        <div class="mb-4 p-3 rounded-lg flex items-center gap-2 text-sm" style="background:rgba(220,38,38,0.08); color:#B91C1C; border:1px solid rgba(220,38,38,0.2);">
          <i class="fas fa-circle-exclamation"></i>
          <span>${veledaEscape(state.veledaError)}</span>
        </div>
      ` : ''}

      <!-- ZONE DE SAISIE (au-dessus du tableau pour ne pas etre genee par les notes positionnees) -->
      ${renderVeledaWriteZone()}

      <!-- LE TABLEAU (positionnement absolu des notes) -->
      <div class="veleda-board" id="veleda-board">
        <span class="veleda-rivet tl"></span>
        <span class="veleda-rivet tr"></span>
        <span class="veleda-rivet bl"></span>
        <span class="veleda-rivet br"></span>

        ${notes.length === 0 ? `
          <div class="veleda-empty">
            Le tableau est vide. Ecris une premiere info la-haut <i class="fas fa-arrow-up" style="opacity:0.4;"></i>
          </div>
        ` : `
          <div class="veleda-notes-layer">
            ${notes.map(n => renderVeledaNote(n, me)).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

// Zone de saisie : champ texte + duree rapide + bouton date precise
function renderVeledaWriteZone() {
  const draft = state.veledaDraftContent || '';
  const selectedHours = state.veledaDraftHours;
  const customDate = state.veledaDraftCustomDate;
  const showDatePicker = state.veledaShowDatePicker;

  // Default datetime-local : 24h dans le futur si pas defini
  const defaultDate = customDate || veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));

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

      <div class="veleda-write-actions">
        <div class="veleda-duration-buttons">
          <span class="veleda-write-hint" style="margin-right:4px;">disparait dans :</span>
          ${VELEDA_QUICK_DURATIONS.map(d => `
            <button type="button"
              class="veleda-duration-btn ${selectedHours === d.hours && !customDate ? 'active' : ''}"
              onclick="veledaSelectDuration(${d.hours})">
              ${d.label}
            </button>
          `).join('')}
          <button type="button"
            class="veleda-duration-btn ${customDate ? 'active' : ''}"
            onclick="veledaToggleDatePicker()"
            title="Choisir une date precise">
            <i class="fas fa-calendar-day"></i> ${customDate ? veledaFormatCustomDate(customDate) : 'date precise'}
          </button>
        </div>
        <button class="veleda-write-submit" id="veleda-submit-btn" onclick="submitVeledaCreate()">
          <i class="fas fa-marker"></i> Ecrire sur le tableau
        </button>
      </div>

      ${showDatePicker ? `
        <div class="veleda-datepicker-row">
          <label class="veleda-write-hint">Disparait le :</label>
          <input id="veleda-custom-date" type="datetime-local"
            class="veleda-custom-date-input"
            value="${defaultDate}"
            onchange="veledaSetCustomDate(this.value)">
          ${customDate ? `<button type="button" class="veleda-clear-date" onclick="veledaClearCustomDate()" title="Annuler la date precise"><i class="fas fa-times"></i></button>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

// Affichage compact d'une date custom dans le bouton (ex: "mar. 14 a 14h30")
function veledaFormatCustomDate(localStr) {
  try {
    const d = new Date(localStr);
    if (isNaN(d.getTime())) return 'date precise';
    return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return 'date precise';
  }
}

// Une note posee sur le tableau (positionnement absolu + drag + resize)
function renderVeledaNote(note, me) {
  const urgency = veledaUrgency(note.expires_at);
  const ink = veledaInkFor(note.id);
  const rotation = veledaRotationFor(note.id);
  const canEdit = (note.created_by === me.id) || me.role === 'admin' || me.role === 'super_admin';
  const expiresLabel = veledaExpiresLabel(note.expires_at);
  const authorName = (note.created_by_name || '?').split(' ')[0];

  // Position et taille (avec fallback si non defini)
  const x = note.pos_x ?? 20;
  const y = note.pos_y ?? 20;
  const w = note.width ?? VELEDA_DEFAULT_WIDTH;
  const h = note.height ?? VELEDA_DEFAULT_HEIGHT;

  // Sur les notes draggables, on attache un onmousedown sur le corps (pas sur l'effaceur ni la poignee)
  const dragHandler = canEdit ? `onmousedown="veledaStartDrag(event, ${note.id})"` : '';

  return `
    <div class="veleda-note veleda-ink-${ink} ${canEdit ? 'veleda-note-draggable' : ''}"
      style="left:${x}px; top:${y}px; width:${w}px; min-height:${h}px; transform: rotate(${rotation}deg);"
      data-note-id="${note.id}"
      ${dragHandler}>
      ${canEdit ? `
        <button class="veleda-eraser"
          onmousedown="event.stopPropagation();"
          onclick="deleteVeledaNote(${note.id})"
          title="Effacer cette note">
          <i class="fas fa-eraser"></i>
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
// INTERACTIONS — saisie / duree / date custom / submit
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

// Selection d'une duree rapide : annule la date custom, met a jour le state, toggle visuel sans rerender
function veledaSelectDuration(hours) {
  state.veledaDraftHours = hours;
  state.veledaDraftCustomDate = null;
  // Toggle visuel sans rerender (preserve focus du textarea)
  document.querySelectorAll('.veleda-duration-btn').forEach(btn => btn.classList.remove('active'));
  const lbl = VELEDA_QUICK_DURATIONS.find(d => d.hours === hours)?.label;
  document.querySelectorAll('.veleda-duration-btn').forEach(btn => {
    if (btn.textContent.trim() === lbl) btn.classList.add('active');
  });
  // Si le datepicker est ouvert, on le ferme
  if (state.veledaShowDatePicker) {
    state.veledaShowDatePicker = false;
    renderApp();
  }
}

// Ouvre/ferme le date picker
function veledaToggleDatePicker() {
  state.veledaShowDatePicker = !state.veledaShowDatePicker;
  renderApp();
  // Focus auto sur le champ date
  setTimeout(() => {
    const el = document.getElementById('veleda-custom-date');
    if (el) el.focus();
  }, 50);
}

// Set une date precise (depuis le datetime-local)
function veledaSetCustomDate(localStr) {
  if (!localStr) {
    state.veledaDraftCustomDate = null;
    renderApp();
    return;
  }
  const d = new Date(localStr);
  if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
    alert('La date doit etre dans le futur.');
    return;
  }
  state.veledaDraftCustomDate = localStr;
  state.veledaDraftHours = null;
  renderApp();
}

// Annule la date precise
function veledaClearCustomDate() {
  state.veledaDraftCustomDate = null;
  state.veledaDraftHours = 24;
  renderApp();
}

// Creation d'une note
async function submitVeledaCreate() {
  const content = (state.veledaDraftContent || '').trim();
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

  // Calcul de la date d'expiration : custom ou via hours
  let expiresIso;
  if (state.veledaDraftCustomDate) {
    const d = new Date(state.veledaDraftCustomDate);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      alert('La date d\'expiration doit etre dans le futur.');
      return;
    }
    expiresIso = d.toISOString();
  } else {
    const hours = state.veledaDraftHours || 24;
    expiresIso = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  // Calcul de la position initiale (emplacement libre sur le tableau)
  const board = document.getElementById('veleda-board');
  const boardRect = board ? board.getBoundingClientRect() : { width: 1000, height: 600 };
  const boardW = boardRect.width - 80; // marge interne du board
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

    // Reset du brouillon
    state.veledaDraftContent = '';
    state.veledaDraftHours = 24;
    state.veledaDraftCustomDate = null;
    state.veledaShowDatePicker = false;

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
// DRAG & DROP — deplacement des notes sur le tableau
// ============================================
function veledaStartDrag(event, noteId) {
  // On ne demarre pas le drag si on clique sur la poignee de resize ou l'effaceur
  if (event.target.closest('.veleda-resize-handle') || event.target.closest('.veleda-eraser')) return;
  // Ignore les clics droits / autres
  if (event.button !== 0) return;

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
  // Cursor global pendant le drag
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';

  // On enleve la rotation pendant le drag pour un mouvement plus net
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

  // Bornage : on garde la note dans le tableau (avec une marge negative tolerable)
  const board = document.getElementById('veleda-board');
  if (board) {
    const boardRect = board.getBoundingClientRect();
    const noteEl = document.querySelector(`.veleda-note[data-note-id="${id}"]`);
    const noteRect = noteEl ? noteEl.getBoundingClientRect() : { width: 240, height: 110 };
    newX = Math.max(-50, Math.min(newX, boardRect.width - noteRect.width + 50));
    newY = Math.max(-20, Math.min(newY, boardRect.height - noteRect.height + 20));
  }

  // Restaure le style original (rotation + ombre + transition)
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

  // Met a jour le state local + persiste cote serveur
  const note = (state.veledaNotes || []).find(n => n.id === id);
  if (note) {
    note.pos_x = newX;
    note.pos_y = newY;
  }
  state.veledaDragging = null;

  // Persistance silencieuse (PUT) — pas de rerender pour ne pas casser le visuel
  // On ne persiste que si la position a vraiment change (eviter PUT inutile sur simple clic)
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    await persistVeledaLayout(id, { pos_x: newX, pos_y: newY });
  }
}

// ============================================
// RESIZE — redimensionnement via poignee bas-droit
// ============================================
function veledaStartResize(event, noteId) {
  if (event.button !== 0) return;
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

// Persistance silencieuse du layout (position et/ou taille)
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
window.veledaSelectDuration = veledaSelectDuration;
window.veledaToggleDatePicker = veledaToggleDatePicker;
window.veledaSetCustomDate = veledaSetCustomDate;
window.veledaClearCustomDate = veledaClearCustomDate;
window.submitVeledaCreate = submitVeledaCreate;
window.deleteVeledaNote = deleteVeledaNote;
window.veledaStartDrag = veledaStartDrag;
window.veledaStartResize = veledaStartResize;
window.stopVeledaPolling = stopVeledaPolling;
