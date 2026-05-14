// ============================================
// VIEW: TABLEAU VELEDA — Vrai whiteboard d'equipe (V3)
// ============================================
//
// V3 : tableau VRAIMENT plein page, notes minimalistes au plus pres du texte.
// - Pas de titre / pas de pill / pas de wrapper : le tableau prend toute la page
// - 1 seul FAB : "Ecrire" en haut a droite (le FAB Legende a ete retire)
// - Une note par defaut : juste le texte, taille auto au contenu, rien d'autre
// - 3 etats d'une note :
//     * normal  : juste le texte (police + couleur)
//     * inspect : texte + petit overlay en bas avec "disparait dans X" + auteur (+ emoji)
//     * edit    : textarea + sélecteurs couleur/police + actions
// - Bascule :
//     * 1er double-clic  -> inspect
//     * 2e double-clic (sur une note deja en inspect) -> edit
//     * clic en dehors / Echap -> retour normal
//     * pour les non-editeurs : double-clic donne directement inspect (pas d'edit)
// - 10 polices manuscrites Google Fonts a choisir a la creation (et en edition).

// Limites alignees avec le backend
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

// 10 polices autorisees (doit matcher VELEDA_ALLOWED_FONTS serveur)
const VELEDA_FONTS = [
  'Permanent Marker',
  'Kalam',
  'Caveat',
  'Architects Daughter',
  'Shadows Into Light',
  'Indie Flower',
  'Patrick Hand',
  'Gloria Hallelujah',
  'Reenie Beanie',
  'Just Another Hand'
];
const VELEDA_DEFAULT_FONT = 'Kalam';

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
// Rotations minimales pour garder un cote manuscrit sans agrandir la hitbox.
// Plus la rotation est forte, plus le bounding box (zone cliquable) deborde
// verticalement, ce qui creait des conflits de selection entre notes proches.
const VELEDA_ROTATIONS = [0];

// Bornes pour le resize (le user peut quand meme agrandir s'il veut)
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

// Police fiable d'une note (defaut = Kalam si valeur inconnue)
function veledaNoteFont(note) {
  if (note && typeof note.font === 'string' && VELEDA_FONTS.indexOf(note.font) !== -1) {
    return note.font;
  }
  return VELEDA_DEFAULT_FONT;
}

// Recherche d'un emplacement libre (algo AABB tres simple)
function veledaFindFreeSpot(notes, boardWidth, boardHeight) {
  const padding = 12;
  const tryW = 200;
  const tryH = 60;
  for (let y = padding; y < boardHeight - tryH - padding; y += 40) {
    for (let x = padding; x < boardWidth - tryW - padding; x += 40) {
      let collision = false;
      for (const n of notes) {
        const nx = n.pos_x ?? 0;
        const ny = n.pos_y ?? 0;
        const nw = n.width ?? tryW;
        const nh = n.height ?? tryH;
        if (x < nx + nw + padding && x + tryW + padding > nx && y < ny + nh + padding && y + tryH + padding > ny) {
          collision = true;
          break;
        }
      }
      if (!collision) return { x, y };
    }
  }
  return { x: 20 + Math.random() * 40, y: 20 + Math.random() * 40 };
}

// ============================================
// CHARGEMENT
// ============================================
async function loadVeledaNotes() {
  state.veledaLoading = true;
  state.veledaError = null;
  try {
    const parentId = state.veledaCurrentBoardId;
    const url = parentId
      ? '/api/veleda-notes?parent=' + encodeURIComponent(parentId)
      : '/api/veleda-notes';
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Si le sous-tableau n'existe plus (a ete supprime), on retombe sur la racine
      if (res.status === 404 && parentId) {
        state.veledaCurrentBoardId = null;
        state.veledaBreadcrumb = [];
        return await loadVeledaNotes();
      }
      throw new Error(err.error || 'Erreur de chargement');
    }
    const data = await res.json();
    state.veledaNotes = Array.isArray(data.notes) ? data.notes : [];
    state.veledaBreadcrumb = Array.isArray(data.breadcrumb) ? data.breadcrumb : [];
    state.veledaCurrentBoardId = data.current_board_id ?? null;
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

// Navigation : ouvrir un sous-tableau (clic sur une note de type is_board)
async function veledaOpenBoard(noteId) {
  if (!noteId) return;
  state.veledaCurrentBoardId = Number(noteId);
  state.veledaInspectingId = null;
  state.veledaEditingId = null;
  state.veledaWriteModalOpen = false;
  state.veledaNotes = [];
  render();
  await loadVeledaNotes();
  render();
}

// Navigation : revenir a la racine ou a un ancetre via breadcrumb
async function veledaNavigateTo(targetBoardId) {
  state.veledaCurrentBoardId = targetBoardId ? Number(targetBoardId) : null;
  state.veledaInspectingId = null;
  state.veledaEditingId = null;
  state.veledaWriteModalOpen = false;
  state.veledaNotes = [];
  render();
  await loadVeledaNotes();
  render();
}

function startVeledaPolling() {
  if (state.veledaPollingId) return;
  state.veledaPollingId = setInterval(async () => {
    if (state.currentView !== 'veleda') {
      stopVeledaPolling();
      return;
    }
    const inputEl = document.getElementById('veleda-write-input');
    const isTyping = inputEl && document.activeElement === inputEl;
    const editingEl = document.querySelector('.vnote--edit textarea');
    const isEditing = editingEl && document.activeElement === editingEl;
    const isInteracting = !!state.veledaDragging || !!state.veledaResizing;
    const modalOpen = state.veledaWriteModalOpen;
    if (isTyping || isEditing || isInteracting || modalOpen) return;

    const prevJson = JSON.stringify(state.veledaNotes || []);
    await loadVeledaNotes();
    const nextJson = JSON.stringify(state.veledaNotes || []);
    if (prevJson !== nextJson) render();
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
    state.veledaDraftColor = state.veledaDraftColor || 'black';
    state.veledaDraftFont = state.veledaDraftFont || VELEDA_DEFAULT_FONT;
    state.veledaDraftIsBoard = state.veledaDraftIsBoard || false;
    if (!state.veledaDraftExpiresLocal) {
      state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
    }
    state.veledaEditingId = null;
    state.veledaInspectingId = null;
    state.veledaWriteModalOpen = false;
    state.veledaCurrentBoardId = state.veledaCurrentBoardId ?? null;
    state.veledaBreadcrumb = state.veledaBreadcrumb || [];
    loadVeledaNotes().then(() => {
      startVeledaPolling();
      render();
    });
    return renderVeledaShell([]);
  }

  if (state.veledaDraftContent === undefined) state.veledaDraftContent = '';
  if (!state.veledaDraftColor) state.veledaDraftColor = 'black';
  if (!state.veledaDraftFont) state.veledaDraftFont = VELEDA_DEFAULT_FONT;
  if (state.veledaDraftIsBoard === undefined) state.veledaDraftIsBoard = false;
  if (!state.veledaDraftExpiresLocal) {
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  }
  if (state.veledaEditingId === undefined) state.veledaEditingId = null;
  if (state.veledaInspectingId === undefined) state.veledaInspectingId = null;
  if (state.veledaWriteModalOpen === undefined) state.veledaWriteModalOpen = false;
  if (state.veledaCurrentBoardId === undefined) state.veledaCurrentBoardId = null;
  if (state.veledaBreadcrumb === undefined) state.veledaBreadcrumb = [];

  startVeledaPolling();
  return renderVeledaShell(state.veledaNotes || []);
}

function renderVeledaShell(notes) {
  const me = state.veledaMe || {
    id: state.user?.id, role: state.user?.role,
    can_use_veleda: state.user?.can_use_veleda, emoji: state.user?.emoji
  };
  const canEdit = veledaUserCanEdit();
  const writeModalHtml = state.veledaWriteModalOpen ? renderVeledaWriteModal() : '';

  // === Breadcrumb / titre du tableau courant en haut a gauche ===
  // - Racine : "Tableau VELEDA"
  // - Sous-tableau : "Tableau VELEDA > <texte de la note-tableau parente> > ..."
  // Chaque ancetre est cliquable pour remonter.
  const breadcrumb = state.veledaBreadcrumb || [];
  const onRoot = !state.veledaCurrentBoardId;
  let breadcrumbHtml = '';
  if (onRoot) {
    breadcrumbHtml = `
      <div class="veleda-breadcrumb">
        <span class="veleda-breadcrumb-current">
          <i class="fas fa-chalkboard"></i>
          Tableau VELEDA
        </span>
      </div>
    `;
  } else {
    // racine cliquable, puis chaque niveau intermediaire cliquable,
    // puis le dernier (= tableau courant) en evidence
    const parts = [];
    parts.push(`
      <button type="button" class="veleda-breadcrumb-link"
        onclick="event.stopPropagation(); veledaNavigateTo(null)">
        <i class="fas fa-chalkboard"></i> Tableau VELEDA
      </button>
    `);
    for (let i = 0; i < breadcrumb.length; i++) {
      const item = breadcrumb[i];
      const isLast = i === breadcrumb.length - 1;
      parts.push(`<span class="veleda-breadcrumb-sep"><i class="fas fa-angle-right"></i></span>`);
      if (isLast) {
        parts.push(`
          <span class="veleda-breadcrumb-current" title="${veledaEscape(item.content)}">
            ${veledaEscape(item.content)}
          </span>
        `);
      } else {
        parts.push(`
          <button type="button" class="veleda-breadcrumb-link"
            onclick="event.stopPropagation(); veledaNavigateTo(${item.id})"
            title="${veledaEscape(item.content)}">
            ${veledaEscape(item.content)}
          </button>
        `);
      }
    }
    breadcrumbHtml = `<div class="veleda-breadcrumb">${parts.join('')}</div>`;
  }

  return `
    <div class="veleda-fullpage">
      <div class="veleda-board veleda-board-fullpage" id="veleda-board" onclick="veledaBoardClick(event)">
        <span class="veleda-rivet tl"></span>
        <span class="veleda-rivet tr"></span>
        <span class="veleda-rivet bl"></span>
        <span class="veleda-rivet br"></span>

        ${breadcrumbHtml}

        ${state.veledaError ? `
          <div class="veleda-error-overlay">
            <i class="fas fa-circle-exclamation"></i>
            <span>${veledaEscape(state.veledaError)}</span>
          </div>
        ` : ''}

        ${notes.length === 0 ? `
          <div class="veleda-empty">
            ${canEdit
              ? (onRoot
                  ? 'Le tableau est vide. Appuie sur "Ecrire" en haut a droite.'
                  : 'Ce sous-tableau est vide. Appuie sur "Ecrire" pour ajouter une note ici.')
              : 'Le tableau est vide pour l\'instant.'
            }
          </div>
        ` : `
          <div class="veleda-notes-layer">
            ${notes.map(n => renderVeledaNote(n, me, canEdit)).join('')}
          </div>
        `}

        ${canEdit ? `
          <button class="veleda-fab veleda-fab-write"
            onclick="event.stopPropagation(); openVeledaWriteModal();"
            title="Ecrire sur le tableau">
            <i class="fas fa-marker"></i>
            <span>Ecrire</span>
          </button>
        ` : `
          <div class="veleda-readonly-pill-fab" title="Lecture seule">
            <i class="fas fa-eye"></i>
            <span>Lecture seule</span>
          </div>
        `}
      </div>

      ${writeModalHtml}
    </div>
  `;
}

// ============================================
// RENDU D'UNE NOTE — V12 : REFONTE TOTALE
// ============================================
// Probleme historique : les classes .veleda-note avaient ete redefinies
// 6 fois dans style.css au fil des versions (V1, V2, V3, V5, V8, V9, V10),
// avec des padding/min-height/box-shadow/background contradictoires.
// Meme avec une cascade override, le DOM rendu finissait par avoir un
// bloc plus grand que le texte.
//
// SOLUTION V12 : on utilise un NOUVEAU prefixe de classes "vnote-*" qui
// n'existe NULLE PART ailleurs dans le CSS. Aucun ancien selecteur ne
// peut matcher. Cascade vierge -> les seules regles qui s'appliquent
// sont celles du bloc V12 en fin de feuille de style.
//
// On garde 3 etats :
//   - vnote (normal) : juste le texte, hitbox = texte exact
//   - vnote vnote--inspect : texte + barrette d'actions sous le texte
//   - vnote vnote--edit : textarea + toolbar + boutons annuler/enregistrer
//
// Aucun width/height inline n'est jamais injecte : la note s'auto-dimensionne
// strictement a son contenu, quelles que soient les donnees en base.
// ============================================
function renderVeledaNote(note, me, canEdit) {
  const color = veledaNoteColor(note);
  const font = veledaNoteFont(note);
  const isEditing = state.veledaEditingId === note.id;
  const isInspecting = state.veledaInspectingId === note.id && !isEditing;
  const isBoardNote = note.is_board === 1 || note.is_board === true;

  // Position (uniquement left/top, JAMAIS de width/height inline)
  const x = note.pos_x ?? 20;
  const y = note.pos_y ?? 20;
  const posStyle = `left:${x}px; top:${y}px; font-family: '${font}', cursive;`;

  // =========================================
  // MODE EDIT
  // =========================================
  if (isEditing) {
    const colorBtns = VELEDA_COLORS.map(c => `
      <button type="button"
        class="vnote-edit-color vnote-edit-color--${c} ${color === c ? 'is-active' : ''}"
        onclick="event.stopPropagation(); veledaChangeNoteColor(${note.id}, '${c}')"
        title="${veledaEscape(VELEDA_COLOR_LABELS[c])}">
        <span style="background:${VELEDA_COLOR_HEX[c]};"></span>
      </button>
    `).join('');

    const fontOpts = VELEDA_FONTS.map(f => `
      <option value="${veledaEscape(f)}" ${font === f ? 'selected' : ''}
        style="font-family: '${f}', cursive;">${veledaEscape(f)}</option>
    `).join('');

    return `
      <div class="vnote vnote--edit vnote--ink-${color}"
        style="${posStyle}"
        data-note-id="${note.id}"
        onclick="event.stopPropagation();">
        <textarea class="vnote-edit-input"
          maxlength="${VELEDA_MAX_CONTENT_LEN}"
          style="font-family: '${font}', cursive;"
          onkeydown="veledaOnInlineEditKey(event, ${note.id})"
        >${veledaEscape(note.content)}</textarea>
        <div class="vnote-edit-toolbar">
          <div class="vnote-edit-colors">${colorBtns}</div>
          <select class="vnote-edit-fontselect"
            onchange="veledaChangeNoteFont(${note.id}, this.value)"
            onclick="event.stopPropagation();"
            style="font-family: '${font}', cursive;">
            ${fontOpts}
          </select>
        </div>
        <div class="vnote-edit-actions">
          <button class="vnote-edit-btn vnote-edit-cancel"
            onclick="event.stopPropagation(); veledaCancelEdit()">
            <i class="fas fa-times"></i> Annuler
          </button>
          <button class="vnote-edit-btn vnote-edit-save"
            onclick="event.stopPropagation(); veledaSaveEdit(${note.id})">
            <i class="fas fa-check"></i> Enregistrer
          </button>
        </div>
      </div>
    `;
  }

  // =========================================
  // MODE NORMAL / INSPECT
  // =========================================
  const dragHandler = canEdit ? `onmousedown="veledaStartDrag(event, ${note.id})"` : '';
  const dblClickHandler = `ondblclick="veledaOnNoteDblClick(event, ${note.id})"`;

  // Click sur le contenu :
  //   - note normale : juste stopPropagation
  //   - note-tableau : navigation vers le sous-tableau (anti-collision drag)
  const contentClickHandler = isBoardNote
    ? `onclick="event.stopPropagation(); veledaTryOpenBoard(event, ${note.id})"`
    : `onclick="event.stopPropagation();"`;

  // Barrette d'actions : TOUJOURS dans le DOM, revelee au HOVER via CSS.
  // Posee dans un wrapper SEPARE pour qu'elle ne deforme jamais
  // la hitbox du texte. La note reste un simple span de texte.
  const inspectBar = `
    <div class="vnote-bar" onclick="event.stopPropagation();">
      <div class="vnote-bar-info">
        <span class="vnote-bar-dot vnote-bar-dot--${veledaUrgency(note.expires_at)}"></span>
        <span class="vnote-bar-expires">${veledaEscape(veledaExpiresLabel(note.expires_at))}</span>
        <span class="vnote-bar-author">${veledaEscape((note.created_by_name || '?').split(' ')[0])}</span>
      </div>
      ${canEdit ? `
        <div class="vnote-bar-actions">
          ${isBoardNote ? `
            <button class="vnote-bar-btn vnote-bar-btn--open"
              onclick="event.stopPropagation(); veledaOpenBoard(${note.id})"
              title="Ouvrir le sous-tableau">
              <i class="fas fa-arrow-right-to-bracket"></i>
              <span>Ouvrir</span>
            </button>
          ` : ''}
          <button class="vnote-bar-btn vnote-bar-btn--edit"
            onclick="event.stopPropagation(); veledaStartEdit(${note.id})"
            title="Modifier">
            <i class="fas fa-pen"></i>
          </button>
          <button class="vnote-bar-btn vnote-bar-btn--delete"
            onclick="event.stopPropagation(); deleteVeledaNote(${note.id})"
            title="${isBoardNote ? 'Effacer (supprime aussi tout son contenu)' : 'Effacer'}">
            <i class="fas fa-eraser"></i>
          </button>
        </div>
      ` : ''}
    </div>
  `;

  // STRUCTURE V12 :
  // - .vnote-wrap : wrapper positionne en absolu (porte left/top + font-family)
  //                 contient le texte + la barrette inspect.
  // - .vnote-text : le texte lui-meme, display: inline-block, width: max-content
  //                 -> sa hitbox colle EXACTEMENT au texte. C'est lui qui porte
  //                 les handlers drag/dblclick/click.
  // - .vnote-bar : la barrette d'actions, positionnee SOUS le texte mais HORS
  //                de la hitbox de la note. Aucun risque de selection croisee.
  return `
    <div class="vnote-wrap ${isInspecting ? 'vnote-wrap--inspect' : ''} ${isBoardNote ? 'vnote-wrap--board' : ''}"
      style="${posStyle}"
      data-note-id="${note.id}"
      data-is-board="${isBoardNote ? '1' : '0'}">
      <span class="vnote-text vnote--ink-${color} ${canEdit ? 'vnote-text--draggable' : ''} ${isBoardNote ? 'vnote-text--board' : ''}"
        ${dragHandler}
        ${dblClickHandler}
        ${contentClickHandler}>${veledaEscape(note.content)}</span>
      ${inspectBar}
    </div>
  `;
}

// Helper : sur une note-tableau, on n'ouvre le sous-tableau que si l'utilisateur
// a vraiment fait un clic et pas un drag. On s'appuie sur le flag de drag.
function veledaTryOpenBoard(event, noteId) {
  if (state.veledaDragging || state.veledaResizing) return;
  // Si on est en mode edit / inspect sur cette note, ne pas naviguer
  if (state.veledaEditingId === noteId) return;
  veledaOpenBoard(noteId);
}

// ============================================
// MODALE "ECRIRE SUR LE TABLEAU"
// ============================================
function renderVeledaWriteModal() {
  const draft = state.veledaDraftContent || '';
  const expiresLocal = state.veledaDraftExpiresLocal || veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  const minLocal = veledaToDatetimeLocal(new Date(Date.now() + 60 * 1000));
  const selectedColor = state.veledaDraftColor || 'black';
  const selectedFont = state.veledaDraftFont || VELEDA_DEFAULT_FONT;
  const isBoardChecked = !!state.veledaDraftIsBoard;

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

  // Apercu pour chaque police : ecrit le nom dans la police elle-meme
  const fontButtons = VELEDA_FONTS.map(f => `
    <button type="button"
      class="veleda-font-pick ${selectedFont === f ? 'active' : ''}"
      onclick="veledaSetDraftFont('${f}')"
      title="${veledaEscape(f)}"
      style="font-family: '${f}', cursive;">
      ${veledaEscape(f)}
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
            style="font-family: '${selectedFont}', cursive;"
            oninput="veledaOnInputChange(this.value)"
            onkeydown="veledaOnKeyDown(event)"
          >${veledaEscape(draft)}</textarea>

          <label class="veleda-field-label">
            Importance
            <span class="veleda-field-hint">— couleur du feutre</span>
          </label>
          <div class="veleda-color-row">${colorButtons}</div>

          <label class="veleda-field-label">
            Police d'ecriture
            <span class="veleda-field-hint">— 10 styles manuscrits</span>
          </label>
          <div class="veleda-font-grid">${fontButtons}</div>

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

          <label class="veleda-isboard-row ${isBoardChecked ? 'is-checked' : ''}">
            <input type="checkbox"
              class="veleda-isboard-checkbox"
              ${isBoardChecked ? 'checked' : ''}
              onchange="veledaSetDraftIsBoard(this.checked)">
            <span class="veleda-isboard-content">
              <span class="veleda-isboard-title">
                <i class="fas fa-chalkboard"></i>
                Faire de cette note un sous-tableau
              </span>
              <span class="veleda-isboard-hint">
                La note sera soulignee en bleu et cliquable. Elle ouvrira son propre tableau VELEDA pour organiser les idees liees.
              </span>
            </span>
          </label>
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
  if (!state.veledaDraftColor) state.veledaDraftColor = 'black';
  if (!state.veledaDraftFont) state.veledaDraftFont = VELEDA_DEFAULT_FONT;
  if (!state.veledaDraftExpiresLocal) {
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
  }
  render();
  setTimeout(() => {
    const inp = document.getElementById('veleda-write-input');
    if (inp) inp.focus();
  }, 50);
}

function closeVeledaWriteModal() {
  state.veledaWriteModalOpen = false;
  render();
}

function closeVeledaWriteModalIfBackdrop(event) {
  if (event.target.classList && event.target.classList.contains('veleda-modal-overlay')) {
    closeVeledaWriteModal();
  }
}

function veledaSetDraftColor(color) {
  if (VELEDA_COLORS.indexOf(color) === -1) return;
  state.veledaDraftColor = color;
  render();
  setTimeout(() => {
    const inp = document.getElementById('veleda-write-input');
    if (inp) inp.focus();
  }, 30);
}

function veledaSetDraftFont(font) {
  if (VELEDA_FONTS.indexOf(font) === -1) return;
  state.veledaDraftFont = font;
  render();
  setTimeout(() => {
    const inp = document.getElementById('veleda-write-input');
    if (inp) inp.focus();
  }, 30);
}

function veledaSetDraftIsBoard(checked) {
  state.veledaDraftIsBoard = !!checked;
  render();
  setTimeout(() => {
    const inp = document.getElementById('veleda-write-input');
    if (inp) inp.focus();
  }, 30);
}

// ============================================
// CLIC SUR LE TABLEAU (en dehors d'une note) -> ferme inspect
// ============================================
function veledaBoardClick(event) {
  // Si on a clique sur une note ou son contenu, le stopPropagation a deja eu lieu.
  // Donc ici on est en "dehors d'une note" -> on ferme inspect/edit s'il y en a.
  if (state.veledaInspectingId !== null || state.veledaEditingId !== null) {
    state.veledaInspectingId = null;
    if (state.veledaEditingId !== null) state.veledaEditingId = null;
    render();
  }
}

// Double-clic sur une note : passe directement en mode EDIT
// (l'inspect/infos se fait desormais au HOVER, plus besoin de double-clic pour ca)
function veledaOnNoteDblClick(event, noteId) {
  event.stopPropagation();
  if (!veledaUserCanEdit()) return;
  state.veledaInspectingId = null;
  state.veledaEditingId = noteId;
  render();
  setTimeout(() => {
    const ta = document.querySelector('.vnote--edit textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 50);
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
  const font = state.veledaDraftFont || VELEDA_DEFAULT_FONT;
  const isBoard = !!state.veledaDraftIsBoard;
  const parentNoteId = state.veledaCurrentBoardId || null;
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
  if (VELEDA_FONTS.indexOf(font) === -1) {
    alert('Police invalide.');
    return;
  }
  const expiresDate = new Date(expiresLocal);
  if (isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now()) {
    alert('La date de disparition doit etre dans le futur.');
    return;
  }
  const expiresIso = expiresDate.toISOString();

  // Position initiale : un emplacement libre dans le coin haut-gauche
  const board = document.getElementById('veleda-board');
  const boardRect = board ? board.getBoundingClientRect() : { width: 1000, height: 600 };
  const boardW = boardRect.width - 80;
  const boardH = boardRect.height - 80;
  const spot = veledaFindFreeSpot(state.veledaNotes || [], boardW, boardH);

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
        // Pas de width/height : laisse la note s'adapter au texte
        color,
        font,
        is_board: isBoard,
        parent_note_id: parentNoteId
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur d\'ecriture');

    // Reset du brouillon
    state.veledaDraftContent = '';
    state.veledaDraftExpiresLocal = veledaToDatetimeLocal(new Date(Date.now() + 24 * 3600 * 1000));
    state.veledaDraftColor = 'black';
    state.veledaDraftFont = VELEDA_DEFAULT_FONT;
    state.veledaDraftIsBoard = false;
    state.veledaWriteModalOpen = false;

    await loadVeledaNotes();
    render();
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
    if (state.veledaInspectingId === noteId) state.veledaInspectingId = null;
    if (state.veledaEditingId === noteId) state.veledaEditingId = null;
    render();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// EDITION INLINE DU CONTENU + COULEUR + POLICE
// ============================================
function veledaStartEdit(noteId) {
  if (!veledaUserCanEdit()) return;
  state.veledaEditingId = noteId;
  state.veledaInspectingId = null;
  render();
  setTimeout(() => {
    const ta = document.querySelector('.vnote--edit textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 50);
}

function veledaCancelEdit() {
  state.veledaEditingId = null;
  render();
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
  const ta = document.querySelector('.vnote--edit textarea');
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
    render();
  } catch (e) {
    alert(e.message || 'Erreur inconnue');
  }
}

async function veledaChangeNoteColor(noteId, color) {
  if (!veledaUserCanEdit()) return;
  if (VELEDA_COLORS.indexOf(color) === -1) return;
  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;
  if (note.color === color) return;
  const prevColor = note.color;
  note.color = color;
  render();
  setTimeout(() => {
    const ta = document.querySelector('.vnote--edit textarea');
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
      throw new Error(data.error || 'Erreur');
    }
  } catch (e) {
    note.color = prevColor;
    render();
    alert(e.message || 'Erreur inconnue');
  }
}

async function veledaChangeNoteFont(noteId, font) {
  if (!veledaUserCanEdit()) return;
  if (VELEDA_FONTS.indexOf(font) === -1) return;
  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;
  if (note.font === font) return;
  const prevFont = note.font;
  note.font = font;
  render();
  setTimeout(() => {
    const ta = document.querySelector('.vnote--edit textarea');
    if (ta) ta.focus();
  }, 30);
  try {
    const res = await fetch('/api/veleda-notes/' + noteId, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ font })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur');
    }
  } catch (e) {
    note.font = prevFont;
    render();
    alert(e.message || 'Erreur inconnue');
  }
}

// ============================================
// DRAG & DROP
// ============================================
function veledaStartDrag(event, noteId) {
  if (event.target.closest('.vnote-bar') ||
      event.target.closest('.vnote-edit-input') ||
      event.target.closest('.vnote-edit-actions') ||
      event.target.closest('.vnote-edit-toolbar') ||
      event.target.closest('.vnote-edit-colors') ||
      event.target.closest('.vnote-edit-fontselect')) return;
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

  const el = document.querySelector(`.vnote-wrap[data-note-id="${noteId}"]`);
  if (el) {
    el.style.zIndex = '100';
    el.style.transition = 'none';
  }
}

function veledaOnDragMove(event) {
  if (!state.veledaDragging) return;
  const dx = event.clientX - state.veledaDragging.startX;
  const dy = event.clientY - state.veledaDragging.startY;
  const newX = state.veledaDragging.origX + dx;
  const newY = state.veledaDragging.origY + dy;

  const el = document.querySelector(`.vnote-wrap[data-note-id="${state.veledaDragging.id}"]`);
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
    const noteEl = document.querySelector(`.vnote-wrap[data-note-id="${id}"]`);
    const noteRect = noteEl ? noteEl.getBoundingClientRect() : { width: 200, height: 60 };
    newX = Math.max(-50, Math.min(newX, boardRect.width - noteRect.width + 50));
    newY = Math.max(-20, Math.min(newY, boardRect.height - noteRect.height + 20));
  }

  const el = document.querySelector(`.vnote-wrap[data-note-id="${id}"]`);
  if (el) {
    el.style.left = newX + 'px';
    el.style.top = newY + 'px';
    el.style.zIndex = '';
    el.style.transition = '';
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
// RESIZE (uniquement en mode inspect / si user editeur)
// ============================================
function veledaStartResize(event, noteId) {
  if (event.button !== 0) return;
  if (!veledaUserCanEdit()) return;
  event.preventDefault();
  event.stopPropagation();

  const note = (state.veledaNotes || []).find(n => n.id === noteId);
  if (!note) return;

  // Si pas de taille definie, on prend la taille actuellement rendue
  const el = document.querySelector(`.vnote-wrap[data-note-id="${noteId}"]`);
  const rect = el ? el.getBoundingClientRect() : { width: 200, height: 60 };

  state.veledaResizing = {
    id: noteId,
    startX: event.clientX,
    startY: event.clientY,
    origW: note.width ?? Math.round(rect.width),
    origH: note.height ?? Math.round(rect.height)
  };

  document.addEventListener('mousemove', veledaOnResizeMove);
  document.addEventListener('mouseup', veledaOnResizeEnd);
  document.body.style.cursor = 'nwse-resize';
  document.body.style.userSelect = 'none';

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

  const el = document.querySelector(`.vnote-wrap[data-note-id="${state.veledaResizing.id}"]`);
  if (el) {
    el.style.width = newW + 'px';
    el.style.height = newH + 'px';
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

  const el = document.querySelector(`.vnote-wrap[data-note-id="${id}"]`);
  if (el) {
    el.style.width = newW + 'px';
    el.style.height = newH + 'px';
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
window.veledaSetDraftColor = veledaSetDraftColor;
window.veledaSetDraftFont = veledaSetDraftFont;
window.veledaSetDraftIsBoard = veledaSetDraftIsBoard;
window.submitVeledaCreate = submitVeledaCreate;
window.deleteVeledaNote = deleteVeledaNote;
window.veledaStartDrag = veledaStartDrag;
window.veledaStartResize = veledaStartResize;
window.veledaStartEdit = veledaStartEdit;
window.veledaCancelEdit = veledaCancelEdit;
window.veledaSaveEdit = veledaSaveEdit;
window.veledaOnInlineEditKey = veledaOnInlineEditKey;
window.veledaChangeNoteColor = veledaChangeNoteColor;
window.veledaChangeNoteFont = veledaChangeNoteFont;
window.stopVeledaPolling = stopVeledaPolling;
window.openVeledaWriteModal = openVeledaWriteModal;
window.closeVeledaWriteModal = closeVeledaWriteModal;
window.closeVeledaWriteModalIfBackdrop = closeVeledaWriteModalIfBackdrop;
window.veledaBoardClick = veledaBoardClick;
window.veledaOnNoteDblClick = veledaOnNoteDblClick;
window.veledaOpenBoard = veledaOpenBoard;
window.veledaTryOpenBoard = veledaTryOpenBoard;
window.veledaNavigateTo = veledaNavigateTo;
