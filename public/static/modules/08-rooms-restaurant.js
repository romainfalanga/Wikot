// ============================================
// WIKOT MODULE — 08-rooms-restaurant
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

// ============================================
// HISTORY / NAVIGATION (bouton "Retour" navigateur)
// ============================================
// Problème résolu : avant, cliquer "Retour" sur le navigateur quittait directement
// le site, parce qu'aucune entrée d'historique n'était poussée lors des changements
// de vue côté SPA. Maintenant, chaque changement de vue principal (et ouverture
// d'un détail procédure) pousse une entrée dans window.history, et popstate
// restaure l'état correspondant.
//
// Convention pour state object stocké dans history :
//   { view: 'dashboard' | 'procedures' | 'info' | 'wikot' | 'wikot-max' | 'conversations'
//        | 'changelog' | 'templates' | 'users' | 'hotels' | 'procedure-detail' ...,
//     procedureId: number | null }
//
// On ignore volontairement les sous-états très éphémères (modales, accordéons,
// scroll, etc.) pour ne pas saturer l'historique.

let _historyPopping = false; // garde anti-boucle

function pushHistory(view, params) {
  if (_historyPopping) return; // pas de pushState pendant un popstate
  const entry = { view, ...(params || {}) };
  try {
    history.pushState(entry, '', '#' + view);
  } catch {}
}

function replaceHistory(view, params) {
  const entry = { view, ...(params || {}) };
  try {
    history.replaceState(entry, '', '#' + view);
  } catch {}
}

async function restoreFromHistory(entry) {
  if (!entry || !entry.view) return;
  _historyPopping = true;
  try {
    // Cas spécial : retour vers une vue détail procédure → recharger la procédure
    if (entry.view === 'procedure-detail' && entry.procedureId) {
      const data = await api(`/procedures/${entry.procedureId}?include_subprocedures=1`);
      if (data) {
        state.selectedProcedure = data;
        state.currentView = 'procedure-detail';
      } else {
        // Procédure introuvable (supprimée) → retour à la liste
        state.currentView = 'procedures';
      }
    } else {
      // Vues simples : on reproduit ce que fait navigate() mais sans pushHistory
      if (state.currentView === 'conversations' && entry.view !== 'conversations') {
        stopChatPolling();
        state.selectedChannelId = null;
        state.chatMessages = [];
      }
      state.currentView = entry.view;
      state.selectedProcedure = null;

      if (entry.view === 'conversations') {
        const fresh = state.chatGroups && state.chatGroups.length > 0
          && state.chatLastLoadedAt && (Date.now() - state.chatLastLoadedAt) < 30000;
        if (!fresh) {
          await loadChatData();
        }
      }
    }
    render();
  } finally {
    _historyPopping = false;
  }
}

window.addEventListener('popstate', (e) => {
  // Si state est vide (par exemple ancrage initial sans replaceState), on tente
  // de retomber sur la vue racine (dashboard / procedures selon rôle).
  const fallback = state.user
    ? { view: state.user.role === 'employee' ? 'procedures' : 'dashboard' }
    : { view: 'dashboard' };
  restoreFromHistory(e.state || fallback);
});

// ============================================
// VIEW: ROOMS — gestion des chambres (admin/permission can_edit_clients)
// ============================================
async function loadRooms() {
  const data = await api('/rooms');
  if (data) state.rooms = data.rooms || [];
}

function renderRoomsView() {
  // Lazy load : on déclenche le chargement si pas encore fait
  if (!state._roomsLoaded) {
    state._roomsLoaded = true;
    loadRooms().then(() => render());
    return `<div class="text-center py-12 text-gray-500"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>Chargement des chambres...</p></div>`;
  }
  if (!userCanEditClients() && state.user.role !== 'admin') {
    return `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">Vous n'avez pas la permission de gérer les chambres.</div>`;
  }
  const canEdit = userCanEditClients();
  return `
  <div class="fade-in">
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
      <div>
        <p class="section-eyebrow mb-2">Hébergement</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Chambres</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">${state.rooms.length} chambre(s) · ${state.rooms.filter(r => r.is_active).length} active(s)</p>
      </div>
      ${canEdit ? `
        <div class="flex flex-wrap gap-2">
          ${state.rooms.length === 0 ? `<button onclick="seedLecquesRooms()" class="px-4 py-2 rounded-lg text-sm font-semibold transition-all" style="background: var(--c-gold); color: var(--c-navy);" title="Crée les 56 chambres du Grand Hôtel des Lecques"><i class="fas fa-magic mr-2"></i>Seed Lecques (56)</button>` : ''}
          <button onclick="showBulkRoomsModal()" class="px-4 py-2 rounded-lg text-sm font-semibold transition-all" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);"><i class="fas fa-file-import mr-2"></i>Import en masse</button>
          <button onclick="showRoomModal()" class="btn-premium px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;"><i class="fas fa-plus text-xs"></i>Nouvelle chambre</button>
        </div>
      ` : ''}
    </div>
    <div class="card-premium overflow-hidden">
      <div class="table-scroll-wrapper">
        <table class="min-w-full text-sm">
          <thead class="text-xs uppercase tracking-wider" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.55);">
            <tr>
              <th class="px-4 py-3 text-left">Numéro</th>
              <th class="px-4 py-3 text-left">Étage</th>
              <th class="px-4 py-3 text-left">Capacité</th>
              <th class="px-4 py-3 text-left">Client actuel</th>
              <th class="px-4 py-3 text-left">Statut</th>
              ${canEdit ? '<th class="px-4 py-3 text-right">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${state.rooms.length === 0 ? `<tr><td colspan="${canEdit ? 6 : 5}" class="px-4 py-12 text-center" style="color: rgba(15,27,40,0.4);">Aucune chambre. Créez la première !</td></tr>` : state.rooms.map(r => `
              <tr style="border-top: 1px solid var(--c-line);" onmouseover="this.style.background='var(--c-cream-deep)'" onmouseout="this.style.background='transparent'">
                <td class="px-4 py-3 font-display font-bold" style="color: var(--c-navy);">${escapeHtml(r.room_number)}</td>
                <td class="px-4 py-3" style="color: rgba(15,27,40,0.6);">${escapeHtml(r.floor || '—')}</td>
                <td class="px-4 py-3" style="color: rgba(15,27,40,0.6);">${r.capacity || 2} pers.</td>
                <td class="px-4 py-3">
                  ${r.current_guest ? `<span class="font-medium" style="color: var(--c-navy);">${escapeHtml(r.current_guest)}</span>` : '<span class="italic" style="color: rgba(15,27,40,0.35);">Libre</span>'}
                  ${r.checkout_date ? `<div class="text-[11px]" style="color: rgba(15,27,40,0.5);">Départ: ${r.checkout_date}</div>` : ''}
                </td>
                <td class="px-4 py-3">
                  ${r.is_active ? '<span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style="background: rgba(201,169,97,0.15); color: var(--c-gold-deep);">Active</span>' : '<span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">Désactivée</span>'}
                </td>
                ${canEdit ? `<td class="px-4 py-3 text-right">
                  <button onclick="showRoomModal(${r.id})" class="mr-3 transition-colors" style="color: var(--c-navy);" title="Modifier"><i class="fas fa-pen"></i></button>
                  <button onclick="deleteRoom(${r.id}, '${escapeHtml(r.room_number).replace(/'/g, "\\'")}')" class="transition-colors" style="color: #C84C3F;" title="Supprimer"><i class="fas fa-trash"></i></button>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function showRoomModal(roomId = null) {
  const room = roomId ? state.rooms.find(r => r.id === roomId) : null;
  const isEdit = !!room;
  const html = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onclick="if(event.target===this) closeModal()">
    <div class="modal-panel bg-white w-full sm:max-w-md">
      <div class="modal-header bg-brand-400 text-white px-5 py-3 flex items-center justify-between">
        <h3 class="font-semibold"><i class="fas fa-door-closed mr-2"></i>${isEdit ? 'Modifier' : 'Créer'} une chambre</h3>
        <button onclick="closeModal()" class="text-white/80 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body p-5 space-y-4">
        <div>
          <label class="block text-sm font-medium text-navy-700 mb-1">Numéro de chambre *</label>
          <input id="room_number" type="text" required value="${room ? escapeHtml(room.room_number) : ''}" placeholder="Ex: 101" class="w-full px-3 py-2 border border-gray-200 rounded-lg form-input-mobile">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-700 mb-1">Étage</label>
          <input id="room_floor" type="text" value="${room ? escapeHtml(room.floor || '') : ''}" placeholder="Ex: 1er, RDC" class="w-full px-3 py-2 border border-gray-200 rounded-lg form-input-mobile">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-700 mb-1">Capacité (pers.)</label>
          <input id="room_capacity" type="number" min="1" max="10" value="${room ? (room.capacity || 2) : 2}" class="w-full px-3 py-2 border border-gray-200 rounded-lg form-input-mobile">
        </div>
        ${isEdit ? `<div class="flex items-center gap-2"><input id="room_active" type="checkbox" ${room.is_active ? 'checked' : ''}><label for="room_active" class="text-sm text-navy-700">Chambre active</label></div>` : ''}
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
          <button onclick="saveRoom(${roomId || 'null'})" class="px-4 py-2 text-sm btn-premium-navy text-white rounded-lg font-semibold">${isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('modal-container').innerHTML = html;
}

async function saveRoom(roomId) {
  const room_number = document.getElementById('room_number').value.trim();
  const floor = document.getElementById('room_floor').value.trim();
  const capacity = parseInt(document.getElementById('room_capacity').value) || 2;
  if (!room_number) { showToast('Numéro de chambre requis', 'error'); return; }
  const body = { room_number, floor, capacity };
  if (roomId) {
    const activeEl = document.getElementById('room_active');
    if (activeEl) body.is_active = activeEl.checked ? 1 : 0;
    const data = await api(`/rooms/${roomId}`, { method: 'PUT', body: JSON.stringify(body) });
    if (data) { showToast('Chambre modifiée', 'success'); closeModal(); await loadRooms(); render(); }
  } else {
    const data = await api('/rooms', { method: 'POST', body: JSON.stringify(body) });
    if (data) { showToast('Chambre créée', 'success'); closeModal(); await loadRooms(); render(); }
  }
}

async function deleteRoom(roomId, label) {
  if (!confirm(`Supprimer la chambre ${label} ? Le compte client associé sera également supprimé.`)) return;
  const data = await api(`/rooms/${roomId}`, { method: 'DELETE' });
  if (data) { showToast('Chambre supprimée', 'success'); await loadRooms(); render(); }
}

// ============================================
// IMPORT EN MASSE — coller une liste de chambres (1 par ligne)
// Format accepté par ligne :
//   "101"           → numéro seul, étage = '', capacité = 2
//   "101,1"         → numéro + étage
//   "101,1,2"       → numéro + étage + capacité
//   "101 ; 1 ; 2"   → séparateur ; aussi accepté (FR)
// ============================================
function showBulkRoomsModal() {
  const html = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-2" onclick="if(event.target===this) closeModal()">
    <div class="modal-panel bg-white w-full sm:max-w-lg max-h-[95vh] flex flex-col">
      <div class="modal-header bg-blue-500 text-white px-5 py-3 flex items-center justify-between">
        <h3 class="font-semibold"><i class="fas fa-file-import mr-2"></i>Import en masse de chambres</h3>
        <button onclick="closeModal()" class="text-white/80 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body p-5 space-y-4 overflow-y-auto">
        <div class="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
          <p class="font-semibold mb-1"><i class="fas fa-info-circle mr-1"></i>Format accepté (1 chambre par ligne)</p>
          <ul class="list-disc pl-5 space-y-0.5">
            <li><code>101</code> — numéro seul (étage vide, 2 personnes)</li>
            <li><code>101,1</code> — numéro + étage</li>
            <li><code>101,1,2</code> — numéro + étage + capacité</li>
          </ul>
          <p class="mt-1.5">Les chambres déjà existantes sont automatiquement ignorées.</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-700 mb-1">Liste des chambres</label>
          <textarea id="bulk_rooms_text" rows="12" placeholder="01,1&#10;02,1&#10;03,1&#10;..." class="w-full px-3 py-2 border border-gray-200 rounded-lg form-input-mobile font-mono text-sm"></textarea>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
          <button onclick="bulkCreateRooms()" class="px-5 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold"><i class="fas fa-check mr-1"></i>Créer les chambres</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('modal-container').innerHTML = html;
}

// Parse une ligne au format "num[,étage[,capacité]]" (séparateurs , ; ou tab)
function parseRoomLine(line) {
  const parts = line.split(/[,;\t]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return {
    room_number: parts[0],
    floor: parts[1] || null,
    capacity: parts[2] ? parseInt(parts[2]) || 2 : 2
  };
}

async function bulkCreateRooms() {
  const text = document.getElementById('bulk_rooms_text').value;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) { showToast('Liste vide', 'error'); return; }
  const rooms = lines.map(parseRoomLine).filter(Boolean);
  if (rooms.length === 0) { showToast('Aucune chambre valide', 'error'); return; }
  const data = await api('/rooms/bulk', { method: 'POST', body: JSON.stringify({ rooms }) });
  if (data) {
    let msg = `${data.created} créée(s)`;
    if (data.skipped) msg += ` · ${data.skipped} ignorée(s) (déjà existantes)`;
    if (data.errors && data.errors.length) msg += ` · ${data.errors.length} erreur(s)`;
    showToast(msg, data.created > 0 ? 'success' : 'warning');
    closeModal();
    await loadRooms();
    render();
  }
}

// Seed initial dédié au Grand Hôtel des Lecques :
//   Étage 1 : 01-09 (9 chambres)
//   Étage 2 : 101-109 (9 chambres)
//   Étage 3 : 201-219 (19 chambres)
//   Étage 4 : 301-319 (19 chambres)
//   Total : 56
async function seedLecquesRooms() {
  if (!confirm('Créer automatiquement les 56 chambres du Grand Hôtel des Lecques ?\n\n• Étage 1 : 01 à 09 (9 chambres)\n• Étage 2 : 101 à 109 (9 chambres)\n• Étage 3 : 201 à 219 (19 chambres)\n• Étage 4 : 301 à 319 (19 chambres)')) return;
  const rooms = [];
  let order = 0;
  // Étage 1 : 01-09 (numéros formatés sur 2 chiffres)
  for (let i = 1; i <= 9; i++) {
    rooms.push({ room_number: String(i).padStart(2, '0'), floor: '1', capacity: 2, sort_order: order++ });
  }
  // Étage 2 : 101-109
  for (let i = 101; i <= 109; i++) {
    rooms.push({ room_number: String(i), floor: '2', capacity: 2, sort_order: order++ });
  }
  // Étage 3 : 201-219
  for (let i = 201; i <= 219; i++) {
    rooms.push({ room_number: String(i), floor: '3', capacity: 2, sort_order: order++ });
  }
  // Étage 4 : 301-319
  for (let i = 301; i <= 319; i++) {
    rooms.push({ room_number: String(i), floor: '4', capacity: 2, sort_order: order++ });
  }
  const data = await api('/rooms/bulk', { method: 'POST', body: JSON.stringify({ rooms }) });
  if (data) {
    showToast(`${data.created} chambre(s) créée(s) · ${data.skipped} ignorée(s)`, 'success');
    await loadRooms();
    render();
  }
}

// ============================================
// VIEW: OCCUPANCY — Code Wikot (saisie 12h00 + import IA doc clients)
// ============================================
async function loadOccupancy() {
  const data = await api('/occupancy/today');
  if (data) {
    state.occupancyToday = data;
    state.occupancyEntries = {};
    for (const room of (data.rooms || [])) {
      state.occupancyEntries[room.room_id] = {
        guest_name: room.guest_name || '',
        checkout_date: room.checkout_date || ''
      };
    }
  }
}

function renderOccupancyView() {
  if (!state._occupancyLoaded) {
    state._occupancyLoaded = true;
    loadOccupancy().then(() => render());
    return `<div class="text-center py-12 text-gray-500"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>Chargement...</p></div>`;
  }
  if (!userCanEditClients()) {
    return `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">Permission requise.</div>`;
  }
  const data = state.occupancyToday;
  if (!data) return `<div class="text-gray-500">Chargement...</div>`;
  const today = data.today;
  const hotel = data.hotel || {};
  const rooms = data.rooms || [];
  const occupied = rooms.filter(r => r.is_active === 1).length;

  // Date de checkout par défaut : J+1
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  return `
  <div class="fade-in">
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <p class="section-eyebrow mb-2">Saisie quotidienne</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Code Wikot</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.55);">${occupied}/${rooms.length} chambre(s) occupée(s) · à valider à 12h00</p>
        <p class="text-xs mt-1" style="color: rgba(15,27,40,0.45);">Date : <span class="font-mono">${today}</span> · Code hôtel : <button onclick="showHotelCodeEditModal()" class="font-mono font-bold underline-offset-2 hover:underline transition-colors" style="color: var(--c-gold-deep); cursor: pointer;" title="Modifier le code hôtel">${hotel.client_login_code || '— (à définir)'}</button></p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button onclick="navigateTo('rooms')" class="px-4 py-2 rounded-lg text-sm font-semibold transition-all" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);" title="Gérer les chambres"><i class="fas fa-door-closed mr-2"></i>Chambres</button>
        <button onclick="showOccupancyImportModal()" class="px-4 py-2 rounded-lg text-sm font-semibold transition-all" style="background: linear-gradient(135deg, var(--c-gold) 0%, var(--c-gold-deep) 100%); color: #fff; border: 1px solid var(--c-gold-deep);"><i class="fas fa-wand-magic-sparkles mr-2"></i>Importer un document</button>
        <button onclick="showHotelCodeEditModal()" class="px-4 py-2 rounded-lg text-sm font-semibold transition-all" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);"><i class="fas fa-key mr-2"></i>Modifier le code hôtel</button>
        <button onclick="saveOccupancyDay()" class="btn-premium px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;"><i class="fas fa-save text-xs"></i>Enregistrer la journée</button>
      </div>
    </div>

    <div class="card-premium p-4 mb-6" style="background: var(--c-cream-deep); border-left: 3px solid var(--c-gold);">
      <div class="flex gap-3">
        <i class="fas fa-info-circle mt-0.5" style="color: var(--c-gold-deep);"></i>
        <p class="text-sm" style="color: rgba(15,27,40,0.75);">
          <strong style="color: var(--c-navy);">Comment ça marche :</strong> Pour chaque chambre, saisissez le nom du client + date de départ. Le nom devient automatiquement son mot de passe pour se connecter à Wikot depuis sa chambre. Une chambre laissée vide est considérée comme libre.
        </p>
      </div>
    </div>

    ${rooms.length === 0 ? `
      <div class="card-premium p-12 text-center" style="color: rgba(15,27,40,0.5);">
        <i class="fas fa-door-closed text-3xl mb-3" style="color: rgba(15,27,40,0.2);"></i>
        <p class="mb-4">Aucune chambre configurée.</p>
        <button onclick="navigateTo('rooms')" class="px-5 py-2 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: #fff;"><i class="fas fa-arrow-right mr-2"></i>Aller à la page Chambres</button>
      </div>
    ` : `
    <!-- Mobile : grille de cartes (inchangée) -->
    <div class="card-premium overflow-hidden md:hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3">
        ${rooms.map(r => {
          const entry = state.occupancyEntries[r.room_id] || { guest_name: '', checkout_date: '' };
          const isOccupied = r.is_active === 1;
          return `
          <div class="rounded-lg p-3 transition-all" style="background: ${isOccupied ? 'rgba(201,169,97,0.06)' : '#fff'}; border: 1px solid ${isOccupied ? 'rgba(201,169,97,0.30)' : 'var(--c-line)'};">
            <div class="flex items-center justify-between mb-3">
              <span class="font-display font-bold text-lg" style="color: var(--c-navy);">Ch. ${escapeHtml(r.room_number)}</span>
              ${isOccupied ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider" style="background: var(--c-gold); color: var(--c-navy);">Occupée</span>' : '<span class="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">Libre</span>'}
            </div>
            <div class="space-y-2">
              <div>
                <label class="block text-[10px] font-medium uppercase tracking-wider mb-1" style="color: rgba(15,27,40,0.5);">Nom du client (= mot de passe)</label>
                <input type="text" value="${escapeHtml(entry.guest_name)}" oninput="state.occupancyEntries[${r.room_id}].guest_name = this.value"
                  placeholder="Ex: Dupont"
                  class="w-full px-2.5 py-1.5 input-premium rounded text-sm form-input-mobile">
              </div>
              <div>
                <label class="block text-[10px] font-medium uppercase tracking-wider mb-1" style="color: rgba(15,27,40,0.5);">Date de départ</label>
                <input type="date" value="${entry.checkout_date || tomorrowStr}" oninput="state.occupancyEntries[${r.room_id}].checkout_date = this.value"
                  class="w-full px-2.5 py-1.5 input-premium rounded text-sm form-input-mobile">
              </div>
              ${isOccupied ? `<button onclick="clearRoomOccupancy(${r.room_id})" class="w-full text-xs py-1.5 rounded transition-all" style="color: #C84C3F; background: rgba(226,125,110,0.08);"><i class="fas fa-eraser mr-1"></i>Marquer libre</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Desktop / tablette : table en rangées (chambre, statut, nom, date départ, action) -->
    <div class="card-premium overflow-hidden hidden md:block">
      <div class="grid items-center gap-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style="grid-template-columns: 90px 90px 1fr 180px 110px; color: rgba(15,27,40,0.5); background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
        <div>Chambre</div>
        <div>Statut</div>
        <div>Nom du client (= mot de passe)</div>
        <div>Date de départ</div>
        <div></div>
      </div>
      ${rooms.map(r => {
        const entry = state.occupancyEntries[r.room_id] || { guest_name: '', checkout_date: '' };
        const isOccupied = r.is_active === 1;
        return `
        <div class="grid items-center gap-3 px-4 py-2 transition-colors hover:bg-[rgba(201,169,97,0.04)]" style="grid-template-columns: 90px 90px 1fr 180px 110px; background: ${isOccupied ? 'rgba(201,169,97,0.04)' : '#fff'}; border-bottom: 1px solid var(--c-line);">
          <div class="font-display font-bold text-base" style="color: var(--c-navy);">${escapeHtml(r.room_number)}</div>
          <div>
            ${isOccupied
              ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider" style="background: var(--c-gold); color: var(--c-navy);">Occupée</span>'
              : '<span class="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">Libre</span>'}
          </div>
          <input type="text" value="${escapeHtml(entry.guest_name)}" oninput="state.occupancyEntries[${r.room_id}].guest_name = this.value"
            placeholder="Ex: Dupont"
            class="w-full px-2.5 py-1.5 input-premium rounded text-sm">
          <input type="date" value="${entry.checkout_date || tomorrowStr}" oninput="state.occupancyEntries[${r.room_id}].checkout_date = this.value"
            class="w-full px-2.5 py-1.5 input-premium rounded text-sm">
          <div class="flex justify-end">
            ${isOccupied
              ? `<button onclick="clearRoomOccupancy(${r.room_id})" class="text-xs px-2.5 py-1 rounded transition-all" style="color: #C84C3F; background: rgba(226,125,110,0.08);" title="Marquer libre"><i class="fas fa-eraser mr-1"></i>Libérer</button>`
              : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    `}
  </div>`;
}

async function saveOccupancyDay() {
  const entries = [];
  for (const [room_id, e] of Object.entries(state.occupancyEntries)) {
    const name = (e.guest_name || '').trim();
    if (name) {
      entries.push({ room_id: parseInt(room_id), guest_name: name, checkout_date: e.checkout_date || null, action: 'set' });
    } else {
      entries.push({ room_id: parseInt(room_id), action: 'clear' });
    }
  }
  const data = await api('/occupancy/day', { method: 'POST', body: JSON.stringify({ entries }) });
  if (data) {
    showToast('Journée enregistrée — mots de passe clients à jour', 'success');
    state._occupancyLoaded = false;
    await loadOccupancy();
    render();
  }
}

async function clearRoomOccupancy(roomId) {
  if (!confirm('Marquer cette chambre comme libre ? Le compte client sera désactivé et toutes les sessions actives fermées.')) return;
  const data = await api(`/occupancy/room/${roomId}`, { method: 'POST', body: JSON.stringify({ action: 'clear' }) });
  if (data) {
    showToast('Chambre libérée', 'success');
    state._occupancyLoaded = false;
    await loadOccupancy();
    render();
  }
}

// (Anciennement : printOccupancyCards — fonction supprimée car le bouton « Imprimer les fiches »
// a été retiré. Les fiches papier ne sont plus utilisées : les clients reçoivent leur code via
// le code Wikot affiché côté admin et leur nom suffit comme mot de passe du jour.)

// ============================================
// MODAL : Modifier le code hôtel
// ============================================
async function showHotelCodeEditModal() {
  if (!userCanEditClients()) {
    showToast('Permission requise pour modifier le code hôtel', 'warning');
    return;
  }
  const data = state.occupancyToday || await api('/occupancy/today');
  if (!data) return;
  const currentCode = (data.hotel && data.hotel.client_login_code) || '';
  showModal('Code hôtel', `
    <p class="text-xs mb-4" style="color: rgba(15,27,40,0.55);">Le code que les clients saisissent pour se connecter à Wikot.</p>
    <form onsubmit="event.preventDefault(); updateHotelCode(document.getElementById('new_hotel_code').value)">
      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Nouveau code</label>
      <input id="new_hotel_code" type="text" required minlength="3" maxlength="32" autofocus
        value="${escapeHtml(currentCode)}"
        placeholder="Ex : GRDPARIS"
        class="w-full px-3 py-2.5 input-premium rounded-lg text-sm font-mono uppercase tracking-wide" />
      <p class="text-xs mt-2" style="color: rgba(15,27,40,0.55);">3 à 32 caractères (lettres, chiffres, tirets, underscores). Converti automatiquement en majuscules.</p>
      <div class="flex gap-2 mt-5">
        <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
        <button type="submit" class="flex-1 btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-check mr-1.5"></i>Enregistrer</button>
      </div>
    </form>
  `);
}

async function updateHotelCode(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (code.length < 3) { showToast('Le code doit faire au moins 3 caractères', 'error'); return; }
  const res = await api('/occupancy/hotel-code', { method: 'PUT', body: JSON.stringify({ code }) });
  if (res) {
    showToast('Code hôtel mis à jour', 'success');
    closeModal();
    state._occupancyLoaded = false;
    await loadOccupancy();
    render();
  }
}

// ============================================
// MODAL : Importer un document clients (Code Wikot — Gemini Vision)
// ============================================
function showOccupancyImportModal() {
  if (!userCanEditClients()) {
    showToast('Permission requise pour importer un document', 'warning');
    return;
  }
  state.aiImportPreview = null;
  state.aiImportLoading = false;
  state.aiImportError = null;
  showModal('Importer un document clients', renderAiImportModalContent('occupancy'));
}

// ============================================
// MODAL : Importer un document réservations (Restaurant — Gemini Vision)
// ============================================
function showRestaurantImportModal() {
  if (!userCanEditRestaurant()) {
    showToast('Permission requise pour importer un document', 'warning');
    return;
  }
  state.aiImportPreview = null;
  state.aiImportLoading = false;
  state.aiImportError = null;
  showModal('Importer un document réservations', renderAiImportModalContent('restaurant'));
}

// ============================================
// CONTENU MODAL IMPORT IA — partagé entre Code Wikot et Restaurant
// ============================================
function renderAiImportModalContent(kind) {
  // kind = 'occupancy' | 'restaurant'
  const titles = {
    occupancy: { eyebrow: 'Pré-remplissage IA', title: 'Importer un document clients', subtitle: 'PDF, image ou capture d\'écran de la liste des clients du jour' },
    restaurant: { eyebrow: 'Pré-remplissage IA', title: 'Importer un document réservations', subtitle: 'PDF, image ou capture d\'écran des réservations resto / petit-déj' }
  };
  const t = titles[kind];
  const preview = state.aiImportPreview;
  const loading = state.aiImportLoading;
  const error = state.aiImportError;

  return `
    <div class="p-6 max-w-2xl">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center" style="background: linear-gradient(135deg, var(--c-gold) 0%, var(--c-gold-deep) 100%);">
          <i class="fas fa-wand-magic-sparkles text-white"></i>
        </div>
        <div>
          <p class="section-eyebrow">${t.eyebrow}</p>
          <h3 class="font-display text-lg font-semibold" style="color: var(--c-navy);">${t.title}</h3>
          <p class="text-xs" style="color: rgba(15,27,40,0.55);">${t.subtitle}</p>
        </div>
      </div>

      ${!preview && !loading ? `
        <div class="card-premium p-4 mb-4" style="background: rgba(201,169,97,0.08); border-left: 3px solid var(--c-gold);">
          <p class="text-xs leading-relaxed" style="color: var(--c-navy);"><i class="fas fa-circle-info mr-1.5" style="color: var(--c-gold-deep);"></i><strong>Important :</strong> Wikot va analyser votre document pour <strong>pré-remplir</strong> les informations. C'est uniquement une étape de pré-remplissage : vérifiez ensuite manuellement chaque nom, chambre et date avant de valider — Wikot peut faire des erreurs (orthographe, dates, etc.).</p>
        </div>

        <label class="block">
          <input type="file" id="ai_import_file" accept="image/*,application/pdf" class="hidden" onchange="handleAiImportFileSelected('${kind}', event)" />
          <div class="cursor-pointer rounded-xl p-8 text-center transition-all hover:bg-cream" style="border: 2px dashed var(--c-line-strong); background: var(--c-ivory);" onclick="document.getElementById('ai_import_file').click()">
            <i class="fas fa-cloud-arrow-up text-4xl mb-3" style="color: var(--c-gold);"></i>
            <p class="font-display font-semibold mb-1" style="color: var(--c-navy);">Choisir un document</p>
            <p class="text-xs" style="color: rgba(15,27,40,0.55);">PDF, JPG, PNG · max 10 Mo</p>
          </div>
        </label>

        <div class="flex gap-2 mt-5">
          <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
        </div>
      ` : ''}

      ${loading ? `
        <div class="text-center py-10">
          <i class="fas fa-circle-notch fa-spin text-4xl mb-4" style="color: var(--c-gold);"></i>
          <p class="font-display font-semibold" style="color: var(--c-navy);">Wikot analyse votre document...</p>
          <p class="text-xs mt-2" style="color: rgba(15,27,40,0.55);">Extraction des chambres, noms et dates en cours</p>
        </div>
      ` : ''}

      ${error ? `
        <div class="card-premium p-4 mb-4" style="background: rgba(200,76,63,0.08); border-left: 3px solid #C84C3F;">
          <p class="text-sm" style="color: #8B2E22;"><i class="fas fa-triangle-exclamation mr-1.5"></i><strong>Erreur :</strong> ${escapeHtml(error)}</p>
        </div>
        <div class="flex gap-2">
          <button type="button" onclick="state.aiImportError=null; render();" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: #fff;">Réessayer</button>
          <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Fermer</button>
        </div>
      ` : ''}

      ${preview && !loading && !error ? renderAiImportPreview(kind, preview) : ''}
    </div>
  `;
}

function renderAiImportPreview(kind, preview) {
  const rows = preview.rows || [];
  return `
    <div class="card-premium p-3 mb-4" style="background: rgba(200,76,63,0.06); border-left: 3px solid #C84C3F;">
      <p class="text-xs leading-relaxed" style="color: var(--c-navy);"><i class="fas fa-eye mr-1.5" style="color: #C84C3F;"></i><strong>Vérification manuelle obligatoire.</strong> ${rows.length} ligne(s) extraite(s). Contrôlez chaque nom (orthographe), chaque numéro de chambre et chaque date. Wikot peut se tromper.</p>
    </div>

    <div class="card-premium overflow-hidden mb-4" style="max-height: 380px; overflow-y: auto;">
      <table class="w-full text-sm">
        <thead style="background: var(--c-cream-deep); position: sticky; top: 0;">
          <tr style="border-bottom: 1px solid var(--c-line);">
            ${kind === 'occupancy' ? `
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Ch.</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Nom du client</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Départ</th>
            ` : `
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Date</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Repas</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Heure</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Nom</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Pers.</th>
              <th class="px-3 py-2 text-left font-semibold text-xs" style="color: var(--c-navy);">Ch.</th>
            `}
            <th class="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr style="border-bottom: 1px solid var(--c-line);">
              ${kind === 'occupancy' ? `
                <td class="px-3 py-2"><input type="text" value="${escapeHtml(r.room_number || '')}" oninput="state.aiImportPreview.rows[${i}].room_number=this.value" class="w-16 px-2 py-1 input-premium rounded text-xs font-mono" /></td>
                <td class="px-3 py-2"><input type="text" value="${escapeHtml(r.guest_name || '')}" oninput="state.aiImportPreview.rows[${i}].guest_name=this.value" class="w-full px-2 py-1 input-premium rounded text-xs" /></td>
                <td class="px-3 py-2"><input type="date" value="${escapeHtml(r.checkout_date || '')}" oninput="state.aiImportPreview.rows[${i}].checkout_date=this.value" class="px-2 py-1 input-premium rounded text-xs" /></td>
              ` : `
                <td class="px-3 py-2"><input type="date" value="${escapeHtml(r.date || '')}" oninput="state.aiImportPreview.rows[${i}].date=this.value" class="px-2 py-1 input-premium rounded text-xs" /></td>
                <td class="px-3 py-2"><select onchange="state.aiImportPreview.rows[${i}].meal_type=this.value" class="px-2 py-1 input-premium rounded text-xs">
                  <option value="breakfast" ${r.meal_type==='breakfast'?'selected':''}>Petit-déj</option>
                  <option value="lunch" ${r.meal_type==='lunch'?'selected':''}>Déjeuner</option>
                  <option value="dinner" ${r.meal_type==='dinner'?'selected':''}>Dîner</option>
                </select></td>
                <td class="px-3 py-2"><input type="time" value="${escapeHtml(r.time || '')}" oninput="state.aiImportPreview.rows[${i}].time=this.value" class="px-2 py-1 input-premium rounded text-xs font-mono" /></td>
                <td class="px-3 py-2"><input type="text" value="${escapeHtml(r.guest_name || '')}" oninput="state.aiImportPreview.rows[${i}].guest_name=this.value" class="w-full px-2 py-1 input-premium rounded text-xs" /></td>
                <td class="px-3 py-2"><input type="number" min="1" value="${r.guests_count || 1}" oninput="state.aiImportPreview.rows[${i}].guests_count=parseInt(this.value)||1" class="w-14 px-2 py-1 input-premium rounded text-xs" /></td>
                <td class="px-3 py-2"><input type="text" value="${escapeHtml(r.room_number || '')}" oninput="state.aiImportPreview.rows[${i}].room_number=this.value" class="w-16 px-2 py-1 input-premium rounded text-xs font-mono" /></td>
              `}
              <td class="px-2 py-2 text-right"><button onclick="state.aiImportPreview.rows.splice(${i},1); render();" class="text-xs" style="color: #C84C3F;" title="Supprimer cette ligne"><i class="fas fa-trash"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="flex gap-2">
      <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
      <button type="button" onclick="state.aiImportPreview=null; render();" class="px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line-strong);"><i class="fas fa-rotate-right mr-1.5"></i>Recommencer</button>
      <button type="button" onclick="confirmAiImport('${kind}')" class="flex-1 btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-check mr-1.5"></i>Valider et appliquer (${rows.length})</button>
    </div>
  `;
}

async function handleAiImportFileSelected(kind, event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('Fichier trop lourd (max 10 Mo)', 'error'); return; }
  state.aiImportLoading = true;
  state.aiImportError = null;
  render();
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    const url = (window.API_BASE || '/api') + (kind === 'occupancy' ? '/ai-import/occupancy' : '/ai-import/restaurant');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.token },
      body: fd
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Échec de l\'analyse');
    state.aiImportPreview = { rows: data.rows || [], import_id: data.import_id };
    state.aiImportLoading = false;
  } catch (e) {
    state.aiImportError = e.message || 'Erreur inconnue';
    state.aiImportLoading = false;
  }
  render();
}

async function confirmAiImport(kind) {
  const preview = state.aiImportPreview;
  if (!preview) return;
  const rows = (preview.rows || []).filter(r => kind === 'occupancy' ? (r.room_number && r.guest_name) : (r.date && r.guest_name));
  if (rows.length === 0) { showToast('Aucune ligne valide à appliquer', 'warning'); return; }
  const url = kind === 'occupancy' ? '/ai-import/occupancy/apply' : '/ai-import/restaurant/apply';
  const res = await api(url, { method: 'POST', body: JSON.stringify({ import_id: preview.import_id, rows }) });
  if (res) {
    showToast(`${res.applied || rows.length} ligne(s) appliquée(s)`, 'success');
    closeModal();
    if (kind === 'occupancy') {
      state._occupancyLoaded = false;
      await loadOccupancy();
    } else {
      state._restaurantLoaded = false;
      await loadRestaurantData();
    }
    render();
  }
}

// ============================================
// VIEW: TASKS — "À faire" (vue jour avec navigation J-1/J/J+1, tâches mises en valeur pour soi)
// ============================================

// Helpers récurrence (bitmask 7 bits : lun=bit0..dim=bit6)
const TASK_DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const TASK_DAY_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function recurrenceToString(bits) {
  bits = bits | 0;
  if (bits === 127) return 'Tous les jours';
  if (bits === 31) return 'Lun-Ven';
  if (bits === 96) return 'Sam-Dim';
  const days = [];
  for (let i = 0; i < 7; i++) if ((bits >> i) & 1) days.push(TASK_DAY_FULL[i].slice(0, 3));
  return days.length === 0 ? 'Jamais' : days.join(', ');
}

function todayIsoStr() { return new Date().toISOString().slice(0, 10); }
function shiftDate(isoStr, days) {
  const d = new Date(isoStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatDateLong(isoStr) {
  return new Date(isoStr + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function loadTasksForDate(dateStr) {
  state.tasksLoading = true;
  const data = await api(`/tasks?date=${dateStr}`);
  state.tasksLoading = false;
  if (data) {
    state.tasksData = data;
    state.tasksDate = dateStr;
  }
}

function renderTasksView() {
  if (!state.tasksDate) state.tasksDate = todayIsoStr();
  const dateStr = state.tasksDate;

  if (!state.tasksData || state.tasksData.date !== dateStr) {
    if (!state.tasksLoading) {
      loadTasksForDate(dateStr).then(render);
    }
    return `<div class="text-center py-12" style="color: rgba(15,27,40,0.55);"><i class="fas fa-spinner fa-spin text-2xl mb-2" style="color: var(--c-gold);"></i><p>Chargement des tâches...</p></div>`;
  }

  const data = state.tasksData;
  const me = data.me || {};
  const myId = state.user.id;
  const canCreate = !!me.can_create_tasks || userCanCreateTasks();
  const canAssign = !!me.can_assign_tasks || userCanAssignTasks();
  const instances = data.instances || [];
  const assignmentsByInstance = {};
  for (const a of (data.assignments || [])) {
    (assignmentsByInstance[a.task_instance_id] = assignmentsByInstance[a.task_instance_id] || []).push(a);
  }

  // Sépare : mes tâches en cours, mes tâches faites, tâches des autres
  const myPending = [];
  const myDone = [];
  const others = [];
  const unassigned = [];
  for (const inst of instances) {
    const list = assignmentsByInstance[inst.id] || [];
    const mine = list.find(a => a.user_id === myId);
    if (mine) {
      if (mine.status === 'done') myDone.push({ inst, list, mine });
      else myPending.push({ inst, list, mine });
    } else if (list.length === 0) {
      unassigned.push({ inst, list });
    } else {
      others.push({ inst, list });
    }
  }

  const today = todayIsoStr();
  const isToday = dateStr === today;
  const isPast = dateStr < today;

  return `
  <div class="fade-in">
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <p class="section-eyebrow mb-2">Tâches du jour</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">À faire</h2>
        <p class="text-sm mt-1.5 capitalize" style="color: rgba(15,27,40,0.55);">${formatDateLong(dateStr)}${isToday ? ' · aujourd\'hui' : isPast ? ' · passé' : ''}</p>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--c-line);">
          <button onclick="navigateTaskDate(-1)" class="px-3 py-2 text-sm" style="background: #fff; color: var(--c-navy); border-right: 1px solid var(--c-line);" title="Jour précédent"><i class="fas fa-chevron-left"></i></button>
          <input type="date" value="${dateStr}" onchange="state.tasksDate=this.value; loadTasksForDate(this.value).then(render);" class="px-3 py-2 text-sm font-mono" style="background: #fff; color: var(--c-navy); border: none;" />
          <button onclick="navigateTaskDate(1)" class="px-3 py-2 text-sm" style="background: #fff; color: var(--c-navy); border-left: 1px solid var(--c-line);" title="Jour suivant"><i class="fas fa-chevron-right"></i></button>
        </div>
        ${!isToday ? `<button onclick="state.tasksDate='${today}'; loadTasksForDate('${today}').then(render);" class="px-3 py-2 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);"><i class="fas fa-calendar-day mr-1"></i>Aujourd'hui</button>` : ''}
        ${canCreate ? `<button onclick="showTaskInstanceForm(null, '${dateStr}')" class="px-3 py-2 rounded-lg text-sm font-semibold btn-premium-navy text-white"><i class="fas fa-plus mr-1"></i>Nouvelle tâche</button>` : ''}
        ${canCreate ? `<button onclick="showTaskTemplatesModal()" class="px-3 py-2 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);" title="Tâches récurrentes"><i class="fas fa-rotate mr-1"></i>Modèles récurrents</button>` : ''}
      </div>
    </div>

    ${(!canCreate && !canAssign) ? `
      <div class="card-premium p-3 mb-4" style="background: rgba(201,169,97,0.08); border-left: 3px solid var(--c-gold);">
        <p class="text-xs" style="color: var(--c-navy);"><i class="fas fa-circle-info mr-1.5" style="color: var(--c-gold-deep);"></i>Vous voyez toutes les tâches de l'équipe. <strong>Les vôtres sont mises en valeur.</strong> Validez les vôtres en cliquant sur la case.</p>
      </div>
    ` : ''}

    ${instances.length === 0 ? `
      <div class="card-premium p-10 text-center">
        <i class="fas fa-list-check text-4xl mb-3" style="color: var(--c-line-strong);"></i>
        <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucune tâche pour ce jour</p>
        <p class="text-sm mt-1" style="color: rgba(15,27,40,0.55);">${canCreate ? 'Créez une tâche ponctuelle ou un modèle récurrent.' : 'Aucune tâche n\'a encore été planifiée.'}</p>
      </div>
    ` : `
      ${myPending.length > 0 ? renderTaskSection('Mes tâches', myPending, { highlight: true, data, canCreate, canAssign }) : ''}
      ${myDone.length > 0 ? renderTaskSection('Mes tâches terminées', myDone, { highlight: true, faded: true, data, canCreate, canAssign }) : ''}
      ${unassigned.length > 0 ? renderTaskSection('Tâches non attribuées', unassigned, { data, canCreate, canAssign, free: true }) : ''}
      ${others.length > 0 ? renderTaskSection("Tâches de l'équipe", others, { data, canCreate, canAssign }) : ''}
    `}
  </div>`;
}

function renderTaskSection(title, entries, opts) {
  const myId = state.user.id;
  return `
    <div class="mb-6">
      <h3 class="font-display text-sm font-semibold uppercase tracking-wider mb-3" style="color: ${opts.highlight ? 'var(--c-gold-deep)' : 'rgba(15,27,40,0.5)'};">${title} <span class="text-xs ml-1" style="color: rgba(15,27,40,0.4);">(${entries.length})</span></h3>
      <div class="grid grid-cols-1 gap-2">
        ${entries.map(e => renderTaskCard(e.inst, e.list, opts, myId)).join('')}
      </div>
    </div>`;
}

function renderTaskCard(inst, assignments, opts, myId) {
  const mine = assignments.find(a => a.user_id === myId);
  const isMine = !!mine;
  const isDone = mine && mine.status === 'done';
  const allDone = inst.status === 'done';
  const canEdit = opts.canCreate;
  const canAssign = opts.canAssign;

  const assigneeNames = assignments.length === 0
    ? '<span class="text-xs italic" style="color: rgba(15,27,40,0.4);">Personne</span>'
    : assignments.map(a => `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${a.user_id === myId ? 'font-semibold' : ''}" style="${a.user_id === myId ? 'background: var(--c-gold); color: #fff;' : 'background: var(--c-cream-deep); color: var(--c-navy);'}">${a.status === 'done' ? '<i class="fas fa-check text-[9px]"></i>' : ''}${escapeHtml(a.user_name || '?')}</span>`).join(' ');

  const cardStyle = isMine
    ? `background: linear-gradient(180deg, rgba(201,169,97,0.10) 0%, #fff 60%); border: 1px solid var(--c-gold); box-shadow: 0 1px 0 rgba(201,169,97,0.20);`
    : opts.faded ? `background: var(--c-cream-deep); opacity: 0.75;`
    : `background: #fff; border: 1px solid var(--c-line);`;

  return `
    <div class="card-premium p-3.5 transition-all" style="${cardStyle}">
      <div class="flex items-start gap-3">
        ${isMine ? `
          <button onclick="${isDone ? `uncompleteTask(${inst.id})` : `completeTask(${inst.id})`}" class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all" style="${isDone ? 'background: var(--c-gold); color: #fff;' : 'background: #fff; color: var(--c-navy); border: 2px solid var(--c-gold);'}" title="${isDone ? 'Annuler la validation' : 'Valider'}">
            ${isDone ? '<i class="fas fa-check text-xs"></i>' : ''}
          </button>
        ` : opts.free ? `
          <button onclick="completeTask(${inst.id})" class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all" style="background: #fff; color: var(--c-navy); border: 2px dashed var(--c-line-strong);" title="Prendre cette tâche libre">
            <i class="fas fa-hand text-[10px]" style="color: var(--c-gold-deep);"></i>
          </button>
        ` : `
          <div class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style="background: var(--c-cream-deep); color: ${allDone ? 'var(--c-gold-deep)' : 'rgba(15,27,40,0.3)'};">
            ${allDone ? '<i class="fas fa-check text-xs"></i>' : '<i class="fas fa-clock text-[10px]"></i>'}
          </div>
        `}

        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-display font-semibold text-sm leading-tight ${isDone ? 'line-through opacity-60' : ''}" style="color: var(--c-navy);">${escapeHtml(inst.title)}</p>
              ${inst.description ? `<p class="text-xs mt-1" style="color: rgba(15,27,40,0.6);">${escapeHtml(inst.description)}</p>` : ''}
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]" style="color: rgba(15,27,40,0.55);">
                ${inst.suggested_time ? `<span><i class="fas fa-clock mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(inst.suggested_time)}</span>` : ''}
                ${inst.category ? `<span><i class="fas fa-tag mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(inst.category)}</span>` : ''}
                ${inst.template_id ? `<span class="italic"><i class="fas fa-rotate mr-1"></i>récurrente</span>` : ''}
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-1">${assigneeNames}</div>
            </div>
            ${(canEdit || canAssign) ? `
              <div class="flex gap-1 shrink-0">
                ${canAssign ? `<button onclick="showTaskAssignModal(${inst.id})" class="w-7 h-7 rounded flex items-center justify-center" style="background: var(--c-cream-deep); color: var(--c-navy);" title="Attribuer"><i class="fas fa-user-tag text-[11px]"></i></button>` : ''}
                ${canEdit ? `<button onclick="showTaskInstanceForm(${inst.id}, '${state.tasksDate}')" class="w-7 h-7 rounded flex items-center justify-center" style="background: var(--c-cream-deep); color: var(--c-navy);" title="Modifier"><i class="fas fa-pen text-[11px]"></i></button>` : ''}
                ${canEdit ? `<button onclick="deleteTaskInstance(${inst.id})" class="w-7 h-7 rounded flex items-center justify-center" style="background: rgba(200,76,63,0.10); color: #C84C3F;" title="Supprimer"><i class="fas fa-trash text-[11px]"></i></button>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function navigateTaskDate(deltaDays) {
  const next = shiftDate(state.tasksDate || todayIsoStr(), deltaDays);
  state.tasksDate = next;
  loadTasksForDate(next).then(render);
}

async function completeTask(instanceId) {
  const res = await api(`/tasks/instances/${instanceId}/complete`, { method: 'POST', body: JSON.stringify({}) });
  if (res) {
    showToast('Tâche validée', 'success');
    await loadTasksForDate(state.tasksDate);
    render();
  }
}

async function uncompleteTask(instanceId) {
  const res = await api(`/tasks/instances/${instanceId}/uncomplete`, { method: 'POST', body: JSON.stringify({}) });
  if (res) {
    await loadTasksForDate(state.tasksDate);
    render();
  }
}

async function deleteTaskInstance(instanceId) {
  if (!confirm('Supprimer définitivement cette tâche ?')) return;
  const res = await api(`/tasks/instances/${instanceId}`, { method: 'DELETE' });
  if (res) {
    showToast('Tâche supprimée', 'success');
    await loadTasksForDate(state.tasksDate);
    render();
  }
}

function showTaskInstanceForm(instanceId, dateStr) {
  // Si instanceId fourni → on édite, sinon on crée
  const inst = instanceId ? (state.tasksData.instances.find(i => i.id === instanceId) || {}) : {};
  const isEdit = !!instanceId;
  showModal(isEdit ? 'Modifier la tâche' : 'Nouvelle tâche', `
    <form onsubmit="event.preventDefault(); submitTaskInstanceForm(${instanceId || 'null'})">
      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Titre <span style="color: #C84C3F;">*</span></label>
      <input id="ti_title" type="text" required maxlength="200" value="${escapeHtml(inst.title || '')}" autofocus class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3" placeholder="Ex : Vérifier la machine à café" />

      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Description (optionnel)</label>
      <textarea id="ti_description" rows="2" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3" placeholder="Détails...">${escapeHtml(inst.description || '')}</textarea>

      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Date</label>
          <input id="ti_date" type="date" required value="${escapeHtml(inst.task_date || dateStr)}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" />
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Heure suggérée</label>
          <input id="ti_time" type="time" value="${escapeHtml(inst.suggested_time || '')}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" />
        </div>
      </div>

      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Catégorie (optionnel)</label>
      <select id="ti_category" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-4">
        <option value="">— Aucune —</option>
        ${['reception','menage','restaurant','maintenance','autre'].map(c => `<option value="${c}" ${(inst.category||'')===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
      </select>

      <div class="flex gap-2">
        <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
        <button type="submit" class="flex-1 btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-check mr-1.5"></i>${isEdit ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>
  `);
}

async function submitTaskInstanceForm(instanceId) {
  const body = {
    title: document.getElementById('ti_title').value.trim(),
    description: document.getElementById('ti_description').value.trim() || null,
    task_date: document.getElementById('ti_date').value,
    suggested_time: document.getElementById('ti_time').value || null,
    category: document.getElementById('ti_category').value || null
  };
  if (!body.title) { showToast('Titre requis', 'error'); return; }
  const url = instanceId ? `/tasks/instances/${instanceId}` : '/tasks/instances';
  const method = instanceId ? 'PUT' : 'POST';
  const res = await api(url, { method, body: JSON.stringify(body) });
  if (res) {
    showToast(instanceId ? 'Tâche modifiée' : 'Tâche créée', 'success');
    closeModal();
    state.tasksDate = body.task_date;
    await loadTasksForDate(body.task_date);
    render();
  }
}

function showTaskAssignModal(instanceId) {
  const data = state.tasksData;
  const inst = data.instances.find(i => i.id === instanceId);
  if (!inst) return;
  const staff = data.staff || [];
  const currentlyAssigned = new Set((data.assignments || []).filter(a => a.task_instance_id === instanceId).map(a => a.user_id));
  showModal(`Attribuer : ${inst.title}`, `
    <p class="text-xs mb-4" style="color: rgba(15,27,40,0.55);">Cochez les personnes à qui attribuer cette tâche. Décocher retire l'attribution.</p>
    <div class="space-y-2 mb-5 max-h-72 overflow-y-auto">
      ${staff.map(u => `
        <label class="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all" style="background: ${currentlyAssigned.has(u.id) ? 'rgba(201,169,97,0.10)' : '#fff'}; border: 1px solid var(--c-line);">
          <input type="checkbox" ${currentlyAssigned.has(u.id) ? 'checked' : ''} data-user-id="${u.id}" class="w-4 h-4 rounded" style="accent-color: var(--c-gold-deep);" />
          <span class="font-display text-sm" style="color: var(--c-navy);">${escapeHtml(u.name)}</span>
          <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.6);">${u.role === 'admin' ? 'Admin' : 'Employé'}</span>
        </label>
      `).join('')}
    </div>
    <div class="flex gap-2">
      <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
      <button type="button" onclick="submitTaskAssign(${instanceId})" class="flex-1 btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-check mr-1.5"></i>Enregistrer</button>
    </div>
  `);
}

async function submitTaskAssign(instanceId) {
  const checks = document.querySelectorAll('#modal-container input[type="checkbox"][data-user-id]');
  const userIds = [];
  checks.forEach(c => { if (c.checked) userIds.push(parseInt(c.dataset.userId)); });
  const res = await api(`/tasks/instances/${instanceId}/assign`, { method: 'POST', body: JSON.stringify({ user_ids: userIds }) });
  if (res) {
    showToast('Attribution mise à jour', 'success');
    closeModal();
    await loadTasksForDate(state.tasksDate);
    render();
  }
}

async function showTaskTemplatesModal() {
  const r = await api('/tasks/templates');
  if (!r) return;
  const templates = r.templates || [];
  showModal('Tâches récurrentes', `
    <p class="text-xs mb-4" style="color: rgba(15,27,40,0.55);">Les modèles génèrent automatiquement une tâche pour chaque date qui correspond à la récurrence. Modifier un modèle n'affecte pas les tâches déjà créées.</p>
    <div class="mb-4">
      <button onclick="showTaskTemplateForm(null)" class="w-full btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-plus mr-1.5"></i>Nouveau modèle récurrent</button>
    </div>
    ${templates.length === 0 ? `
      <div class="text-center py-6" style="color: rgba(15,27,40,0.5);">
        <i class="fas fa-rotate text-3xl mb-2" style="color: var(--c-line-strong);"></i>
        <p class="text-sm">Aucun modèle récurrent.</p>
      </div>
    ` : `
      <div class="space-y-2 max-h-80 overflow-y-auto">
        ${templates.map(t => `
          <div class="card-premium p-3 ${t.is_active ? '' : 'opacity-60'}" style="background: #fff; border: 1px solid var(--c-line);">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <p class="font-display font-semibold text-sm" style="color: var(--c-navy);">${escapeHtml(t.title)}</p>
                ${t.description ? `<p class="text-xs mt-0.5" style="color: rgba(15,27,40,0.6);">${escapeHtml(t.description)}</p>` : ''}
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]" style="color: rgba(15,27,40,0.55);">
                  <span><i class="fas fa-rotate mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(recurrenceToString(t.recurrence_days))}</span>
                  ${t.suggested_time ? `<span><i class="fas fa-clock mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(t.suggested_time)}</span>` : ''}
                  ${t.category ? `<span><i class="fas fa-tag mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(t.category)}</span>` : ''}
                  ${!t.is_active ? '<span class="italic" style="color: #C84C3F;">désactivé</span>' : ''}
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <button onclick="showTaskTemplateForm(${t.id})" class="w-7 h-7 rounded flex items-center justify-center" style="background: var(--c-cream-deep); color: var(--c-navy);" title="Modifier"><i class="fas fa-pen text-[11px]"></i></button>
                <button onclick="deleteTaskTemplate(${t.id})" class="w-7 h-7 rounded flex items-center justify-center" style="background: rgba(200,76,63,0.10); color: #C84C3F;" title="Supprimer"><i class="fas fa-trash text-[11px]"></i></button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <div class="mt-4">
      <button type="button" onclick="closeModal()" class="w-full px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Fermer</button>
    </div>
  `);
}

async function showTaskTemplateForm(templateId) {
  let tpl = { recurrence_days: 127, is_active: 1 };
  if (templateId) {
    const r = await api('/tasks/templates');
    if (r) {
      const found = (r.templates || []).find(t => t.id === templateId);
      if (found) tpl = found;
    }
  }
  showModal(templateId ? 'Modifier le modèle' : 'Nouveau modèle récurrent', `
    <form onsubmit="event.preventDefault(); submitTaskTemplateForm(${templateId || 'null'})">
      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Titre <span style="color: #C84C3F;">*</span></label>
      <input id="tt_title" type="text" required maxlength="200" value="${escapeHtml(tpl.title || '')}" autofocus class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3" />

      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Description</label>
      <textarea id="tt_description" rows="2" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3">${escapeHtml(tpl.description || '')}</textarea>

      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Jours de répétition</label>
      <div class="flex gap-1 mb-3" id="tt_days">
        ${TASK_DAY_LABELS.map((label, i) => {
          const checked = ((tpl.recurrence_days || 0) >> i) & 1;
          return `<button type="button" data-day="${i}" onclick="toggleTaskTemplateDay(${i})" class="w-9 h-9 rounded-lg text-xs font-semibold transition-all" style="background: ${checked ? 'var(--c-gold)' : 'var(--c-cream-deep)'}; color: ${checked ? '#fff' : 'var(--c-navy)'}; border: 1px solid ${checked ? 'var(--c-gold-deep)' : 'var(--c-line)'};">${label}</button>`;
        }).join('')}
      </div>
      <input type="hidden" id="tt_recurrence" value="${tpl.recurrence_days || 127}" />
      <div class="flex flex-wrap gap-1.5 mb-3">
        <button type="button" onclick="setTaskTemplateRecurrence(127)" class="text-[11px] px-2 py-1 rounded" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Tous les jours</button>
        <button type="button" onclick="setTaskTemplateRecurrence(31)" class="text-[11px] px-2 py-1 rounded" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Lun-Ven</button>
        <button type="button" onclick="setTaskTemplateRecurrence(96)" class="text-[11px] px-2 py-1 rounded" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Sam-Dim</button>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Heure suggérée</label>
          <input id="tt_time" type="time" value="${escapeHtml(tpl.suggested_time || '')}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" />
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Catégorie</label>
          <select id="tt_category" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm">
            <option value="">— Aucune —</option>
            ${['reception','menage','restaurant','maintenance','autre'].map(c => `<option value="${c}" ${(tpl.category||'')===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Actif depuis (optionnel)</label>
          <input id="tt_from" type="date" value="${escapeHtml(tpl.active_from || '')}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" />
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Actif jusqu'au (optionnel)</label>
          <input id="tt_to" type="date" value="${escapeHtml(tpl.active_to || '')}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" />
        </div>
      </div>

      ${templateId ? `
        <label class="flex items-center gap-2 mb-4 cursor-pointer">
          <input id="tt_active" type="checkbox" ${tpl.is_active ? 'checked' : ''} class="w-4 h-4 rounded" style="accent-color: var(--c-gold-deep);" />
          <span class="text-sm" style="color: var(--c-navy);">Modèle actif (génère les tâches)</span>
        </label>
      ` : ''}

      <div class="flex gap-2">
        <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
        <button type="submit" class="flex-1 btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-check mr-1.5"></i>${templateId ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>
  `);
}

function toggleTaskTemplateDay(dayIdx) {
  const input = document.getElementById('tt_recurrence');
  let bits = parseInt(input.value) || 0;
  bits ^= (1 << dayIdx);
  input.value = bits;
  // re-render des boutons
  const btns = document.querySelectorAll('#tt_days button');
  btns.forEach((b, i) => {
    const checked = (bits >> i) & 1;
    b.style.background = checked ? 'var(--c-gold)' : 'var(--c-cream-deep)';
    b.style.color = checked ? '#fff' : 'var(--c-navy)';
    b.style.borderColor = checked ? 'var(--c-gold-deep)' : 'var(--c-line)';
  });
}

function setTaskTemplateRecurrence(bits) {
  document.getElementById('tt_recurrence').value = bits;
  const btns = document.querySelectorAll('#tt_days button');
  btns.forEach((b, i) => {
    const checked = (bits >> i) & 1;
    b.style.background = checked ? 'var(--c-gold)' : 'var(--c-cream-deep)';
    b.style.color = checked ? '#fff' : 'var(--c-navy)';
    b.style.borderColor = checked ? 'var(--c-gold-deep)' : 'var(--c-line)';
  });
}

async function submitTaskTemplateForm(templateId) {
  const body = {
    title: document.getElementById('tt_title').value.trim(),
    description: document.getElementById('tt_description').value.trim() || null,
    recurrence_days: parseInt(document.getElementById('tt_recurrence').value) || 127,
    suggested_time: document.getElementById('tt_time').value || null,
    category: document.getElementById('tt_category').value || null,
    active_from: document.getElementById('tt_from').value || null,
    active_to: document.getElementById('tt_to').value || null
  };
  if (!body.title) { showToast('Titre requis', 'error'); return; }
  if (templateId) {
    const activeEl = document.getElementById('tt_active');
    if (activeEl) body.is_active = activeEl.checked ? 1 : 0;
  }
  const url = templateId ? `/tasks/templates/${templateId}` : '/tasks/templates';
  const method = templateId ? 'PUT' : 'POST';
  const res = await api(url, { method, body: JSON.stringify(body) });
  if (res) {
    showToast(templateId ? 'Modèle modifié' : 'Modèle créé', 'success');
    closeModal();
    await loadTasksForDate(state.tasksDate);
    render();
    setTimeout(() => showTaskTemplatesModal(), 100);
  }
}

async function deleteTaskTemplate(templateId) {
  if (!confirm('Supprimer ce modèle récurrent ? Les tâches déjà générées resteront en place.')) return;
  const res = await api(`/tasks/templates/${templateId}`, { method: 'DELETE' });
  if (res) {
    showToast('Modèle supprimé', 'success');
    closeModal();
    setTimeout(() => showTaskTemplatesModal(), 100);
  }
}

// ============================================
// VIEW: RESTAURANT — planning + dashboard réservations
// ============================================
async function loadRestaurantData() {
  const today = new Date().toISOString().slice(0, 10);
  const fortnight = new Date(); fortnight.setDate(fortnight.getDate() + 13);
  const to = fortnight.toISOString().slice(0, 10);
  state.restaurantDashboardFrom = state.restaurantDashboardFrom || today;
  state.restaurantDashboardTo = state.restaurantDashboardTo || to;
  const [sched, exc, dash, resa, tpls] = await Promise.all([
    api('/restaurant/schedule'),
    api('/restaurant/exceptions'),
    api(`/restaurant/dashboard?from=${state.restaurantDashboardFrom}&to=${state.restaurantDashboardTo}`),
    api(`/restaurant/reservations?from=${state.restaurantDashboardFrom}&to=${state.restaurantDashboardTo}`),
    api('/restaurant/templates')
  ]);
  if (sched) state.restaurantSchedule = sched.schedule || [];
  if (exc) state.restaurantExceptions = exc.exceptions || [];
  if (dash) state.restaurantDashboard = dash;
  if (resa) state.restaurantReservations = resa.reservations || [];
  if (tpls) state.restaurantTemplates = tpls.templates || [];
}

function renderRestaurantView() {
  // FIX bug "chargement infini" : on déclenche le load une seule fois mais on
  // ne marque le flag qu'au succès → en cas d'erreur, l'utilisateur peut retry.
  // De plus, on rend immédiatement la coquille avec un état "loading" pour que
  // la première frame apparaisse même avant la résolution de la promesse.
  if (!state._restaurantLoaded && !state._restaurantLoading) {
    state._restaurantLoading = true;
    loadRestaurantData()
      .then(() => { state._restaurantLoaded = true; })
      .catch(() => { state._restaurantLoaded = false; })
      .finally(() => { state._restaurantLoading = false; render(); });
    return `<div class="text-center py-12" style="color: rgba(15,27,40,0.55);"><i class="fas fa-spinner fa-spin text-2xl mb-2" style="color: var(--c-gold);"></i><p>Chargement du restaurant...</p></div>`;
  }
  if (state._restaurantLoading) {
    return `<div class="text-center py-12" style="color: rgba(15,27,40,0.55);"><i class="fas fa-spinner fa-spin text-2xl mb-2" style="color: var(--c-gold);"></i><p>Chargement du restaurant...</p></div>`;
  }
  if (!state._restaurantLoaded) {
    return `<div class="text-center py-12">
      <i class="fas fa-triangle-exclamation text-3xl mb-3" style="color: #C84C3F;"></i>
      <p style="color: var(--c-navy);">Erreur de chargement du restaurant.</p>
      <button onclick="state._restaurantLoaded=false; state._restaurantLoading=false; render();" class="mt-4 px-4 py-2 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: #fff;"><i class="fas fa-rotate-right mr-1.5"></i>Réessayer</button>
    </div>`;
  }
  const tab = state.restaurantTab || 'dashboard';
  const tabBtn = (key, icon, label) => `
    <button onclick="state.restaurantTab='${key}'; render()" class="px-4 py-3 text-sm font-medium transition-colors" style="${tab === key ? 'color: var(--c-navy); border-bottom: 2px solid var(--c-gold); background: rgba(201,169,97,0.06);' : 'color: rgba(15,27,40,0.55); border-bottom: 2px solid transparent;'}">
      <i class="fas ${icon} mr-1.5 text-xs"></i>${label}
    </button>`;
  return `
  <div class="fade-in">
    <div class="mb-6">
      <p class="section-eyebrow mb-2">Service en salle</p>
      <h2 class="section-title-premium text-2xl sm:text-3xl">Restaurant</h2>
      <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">Planning hebdomadaire, exceptions et tableau de bord des réservations</p>
    </div>
    <div class="card-premium overflow-hidden">
      <div class="flex flex-wrap" style="border-bottom: 1px solid var(--c-line);">
        ${tabBtn('dashboard', 'fa-chart-column', 'Tableau de bord')}
        ${tabBtn('reservations', 'fa-list', 'Réservations')}
        ${tabBtn('schedule', 'fa-calendar-week', 'Planning')}
        ${tabBtn('templates', 'fa-clone', 'Modèles')}
        ${tabBtn('exceptions', 'fa-calendar-xmark', 'Exceptions')}
      </div>
      <div class="p-5">
        ${tab === 'dashboard' ? renderRestaurantDashboard()
          : tab === 'reservations' ? renderRestaurantReservations()
          : tab === 'schedule' ? renderRestaurantSchedule()
          : tab === 'templates' ? renderRestaurantTemplates()
          : renderRestaurantExceptions()}
      </div>
    </div>
  </div>`;
}

function renderRestaurantDashboard() {
  const d = state.restaurantDashboard;
  if (!d) return '<div class="text-gray-500">Chargement...</div>';
  const stats = d.stats || [];
  const cap = d.capacityMap || {};
  // Construire la liste de jours
  const days = [];
  const start = new Date(d.from + 'T00:00:00Z');
  const end = new Date(d.to + 'T00:00:00Z');
  for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
    days.push(dt.toISOString().slice(0, 10));
  }
  const meals = ['breakfast', 'lunch', 'dinner'];
  const mealLabels = { breakfast: '☕ Petit-déj', lunch: '🍽️ Déjeuner', dinner: '🍷 Dîner' };
  const mealColors = { breakfast: 'bg-amber-400', lunch: 'bg-orange-400', dinner: 'bg-rose-400' };
  // Index stats
  const statsMap = {};
  for (const s of stats) statsMap[`${s.reservation_date}|${s.meal_type}`] = s;
  // Totaux
  const totalGuests = stats.reduce((acc, s) => acc + parseInt(s.total_guests || 0), 0);
  const totalBookings = stats.reduce((acc, s) => acc + parseInt(s.bookings || 0), 0);

  return `
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
    <div class="card-premium p-4" style="border-left: 3px solid var(--c-gold);">
      <div class="section-eyebrow">Période</div>
      <div class="font-display text-sm font-semibold mt-1" style="color: var(--c-navy);">${d.from} → ${d.to}</div>
    </div>
    <div class="card-premium p-4" style="border-left: 3px solid var(--c-navy);">
      <div class="section-eyebrow">Réservations</div>
      <div class="font-display text-2xl font-bold mt-1" style="color: var(--c-navy);">${totalBookings}</div>
    </div>
    <div class="card-premium p-4" style="border-left: 3px solid var(--c-gold-deep);">
      <div class="section-eyebrow">Couverts totaux</div>
      <div class="font-display text-2xl font-bold mt-1" style="color: var(--c-navy);">${totalGuests}</div>
    </div>
  </div>
  <div class="space-y-3">
    ${days.map(day => {
      const dayName = new Date(day + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      return `
      <div class="border border-gray-200 rounded-lg p-3">
        <div class="font-semibold text-navy-800 text-sm mb-2">${dayName}</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          ${meals.map(m => {
            const k = `${day}|${m}`;
            const s = statsMap[k];
            const guests = s ? parseInt(s.total_guests) : 0;
            const capacity = cap[k] || 0;
            const ratio = capacity > 0 ? Math.min(100, (guests / capacity) * 100) : 0;
            const isClosed = capacity === 0;
            return `
            <div class="rounded p-2.5 ${isClosed ? 'opacity-50' : ''}" style="background: var(--c-cream-deep);">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium" style="color: var(--c-navy);">${mealLabels[m]}</span>
                <span style="color: rgba(15,27,40,0.6);">${guests}/${capacity || '—'}</span>
              </div>
              ${isClosed ? '<div class="text-[10px] italic mt-1" style="color: rgba(15,27,40,0.4);">Fermé</div>' : `
              <div class="w-full rounded-full h-1.5 mt-1.5" style="background: rgba(15,27,40,0.10);">
                <div class="h-1.5 rounded-full transition-all" style="width: ${ratio}%; background: var(--c-gold);"></div>
              </div>
              <div class="text-[10px] mt-0.5" style="color: rgba(15,27,40,0.5);">${Math.round(ratio)}% rempli</div>
              `}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderRestaurantReservations() {
  const reservations = state.restaurantReservations || [];
  const mealLabels = { breakfast: 'Petit-déj', lunch: 'Déjeuner', dinner: 'Dîner' };
  const canEdit = userCanEditRestaurant();
  return `
  <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
    <p class="text-sm" style="color: rgba(15,27,40,0.55);">${reservations.length} réservation(s) du ${state.restaurantDashboardFrom} au ${state.restaurantDashboardTo}</p>
    ${canEdit ? `
      <div class="flex flex-wrap gap-2">
        <button onclick="showRestaurantImportModal()" class="px-3 py-1.5 rounded text-sm font-semibold" style="background: linear-gradient(135deg, var(--c-gold) 0%, var(--c-gold-deep) 100%); color: #fff;"><i class="fas fa-wand-magic-sparkles mr-1"></i>Importer</button>
        <button onclick="showStaffReservationModal()" class="btn-premium-navy text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-plus mr-1"></i>Ajouter</button>
      </div>
    ` : ''}
  </div>
  <div class="table-scroll-wrapper">
    <table class="min-w-full text-sm">
      <thead class="bg-gray-50 text-xs uppercase text-gray-500">
        <tr>
          <th class="px-3 py-2 text-left">Date</th>
          <th class="px-3 py-2 text-left">Repas</th>
          <th class="px-3 py-2 text-left">Heure</th>
          <th class="px-3 py-2 text-left">Pers.</th>
          <th class="px-3 py-2 text-left">Chambre</th>
          <th class="px-3 py-2 text-left">Nom</th>
          <th class="px-3 py-2 text-left">Notes</th>
          ${canEdit ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        ${reservations.length === 0 ? `<tr><td colspan="${canEdit ? 8 : 7}" class="px-3 py-8 text-center text-gray-400">Aucune réservation</td></tr>` : reservations.map(r => `
          <tr class="hover:bg-gray-50">
            <td class="px-3 py-2 font-medium">${r.reservation_date}</td>
            <td class="px-3 py-2">${mealLabels[r.meal_type] || r.meal_type}</td>
            <td class="px-3 py-2 font-mono text-xs">${r.time_slot || '—'}</td>
            <td class="px-3 py-2 text-center">${r.guest_count}</td>
            <td class="px-3 py-2">${r.room_number ? `Ch. ${escapeHtml(r.room_number)}` : '<span class="text-gray-400">—</span>'}</td>
            <td class="px-3 py-2">${escapeHtml(r.guest_name || r.client_guest_name || '—')}</td>
            <td class="px-3 py-2 text-gray-500 text-xs">${escapeHtml((r.notes || '').slice(0, 40))}</td>
            ${canEdit ? `<td class="px-3 py-2 text-right"><button onclick="cancelStaffReservation(${r.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-times"></i></button></td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderRestaurantSchedule() {
  const sched = state.restaurantSchedule || [];
  const days = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const mealLabels = { breakfast: '☕ Petit-déj', lunch: '🍽️ Déjeuner', dinner: '🍷 Dîner' };
  const meals = ['breakfast', 'lunch', 'dinner'];
  const map = {};
  for (const s of sched) map[`${s.weekday}|${s.meal_type}`] = s;
  const canEdit = userCanEditRestaurant();
  return `
  <p class="text-sm text-gray-500 mb-3">Planning hebdomadaire — ouverture, horaires et capacités par défaut.</p>
  <div class="space-y-3">
    ${days.map((dayName, weekday) => `
      <div class="border border-gray-200 rounded-lg p-3">
        <div class="font-semibold text-navy-800 text-sm mb-2">${dayName}</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          ${meals.map(m => {
            const s = map[`${weekday}|${m}`];
            if (!s) return `<div class="bg-gray-50 rounded p-2 text-xs text-gray-400">${mealLabels[m]} — non configuré</div>`;
            return `
            <div class="bg-gray-50 rounded p-3">
              <div class="flex items-center justify-between text-xs font-medium mb-2">
                <span>${mealLabels[m]}</span>
                <label class="flex items-center gap-1 text-[10px]">
                  <input type="checkbox" ${s.is_open ? 'checked' : ''} ${canEdit ? '' : 'disabled'} onchange="updateScheduleField(${s.id}, 'is_open', this.checked ? 1 : 0)">
                  Ouvert
                </label>
              </div>
              <div class="grid grid-cols-3 gap-1 text-xs">
                <input type="time" value="${s.open_time || ''}" ${canEdit ? '' : 'disabled'} onchange="updateScheduleField(${s.id}, 'open_time', this.value)" class="px-1 py-1 border rounded text-[11px]" placeholder="Début">
                <input type="time" value="${s.close_time || ''}" ${canEdit ? '' : 'disabled'} onchange="updateScheduleField(${s.id}, 'close_time', this.value)" class="px-1 py-1 border rounded text-[11px]" placeholder="Fin">
                <input type="number" min="0" value="${s.capacity || 0}" ${canEdit ? '' : 'disabled'} onchange="updateScheduleField(${s.id}, 'capacity', parseInt(this.value)||0)" class="px-1 py-1 border rounded text-[11px]" placeholder="Cap.">
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('')}
  </div>`;
}

async function updateScheduleField(id, field, value) {
  const body = {}; body[field] = value;
  const data = await api(`/restaurant/schedule/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (data) {
    showToast('Planning mis à jour', 'success');
    // Met à jour l'état local sans recharger toute la vue
    const s = state.restaurantSchedule.find(x => x.id === id);
    if (s) s[field] = value;
  }
}

// ============================================
// RESTAURANT — Modèles de semaine (CRUD)
// ============================================
function renderRestaurantTemplates() {
  const tpls = state.restaurantTemplates || [];
  const canEdit = userCanEditRestaurant();
  return `
  <div class="flex justify-between items-center mb-3">
    <p class="text-sm text-gray-500">Modèles de semaine — appliquez en 1 clic des horaires &amp; capacités complètes sur les 7 jours.</p>
    ${canEdit ? `<button onclick="newRestaurantTemplate()" class="btn-premium-navy text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-plus mr-1"></i>Nouveau modèle</button>` : ''}
  </div>
  ${tpls.length === 0 ? '<div class="text-center py-8 text-gray-400">Aucun modèle. Créez-en un ou utilisez les modèles par défaut.</div>' : ''}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    ${tpls.map(t => {
      const summary = summarizeTemplate(t.days || []);
      return `
      <div class="border-2 ${t.is_default ? 'border-brand-300 bg-brand-50/30' : 'border-gray-200'} rounded-lg p-4">
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-navy-800 truncate">${escapeHtml(t.name)}</h4>
              ${t.is_default ? '<span class="text-[10px] px-1.5 py-0.5 bg-brand-400 text-white rounded">Défaut</span>' : ''}
            </div>
            ${t.description ? `<p class="text-xs text-gray-500 mt-0.5">${escapeHtml(t.description)}</p>` : ''}
          </div>
        </div>
        <div class="text-xs text-gray-600 space-y-0.5 mb-3 bg-gray-50 rounded p-2 font-mono">
          <div>☕ ${summary.breakfast}</div>
          <div>🍽️ ${summary.lunch}</div>
          <div>🍷 ${summary.dinner}</div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${canEdit ? `
            <button onclick="applyRestaurantTemplate(${t.id}, '${escapeHtml(t.name)}')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-semibold"><i class="fas fa-bolt mr-1"></i>Appliquer</button>
            <button onclick="editRestaurantTemplate(${t.id})" class="bg-white border border-gray-300 hover:bg-gray-50 text-navy-700 px-3 py-1.5 rounded text-xs"><i class="fas fa-pen mr-1"></i>Modifier</button>
            ${!t.is_default ? `<button onclick="deleteRestaurantTemplate(${t.id}, '${escapeHtml(t.name)}')" class="text-red-500 hover:text-red-700 px-2 py-1.5 rounded text-xs"><i class="fas fa-trash"></i></button>` : ''}
          ` : '<span class="text-xs text-gray-400 italic">Lecture seule</span>'}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// Résumé compact d'un template (heures dominantes par repas)
function summarizeTemplate(days) {
  const out = { breakfast: '—', lunch: '—', dinner: '—' };
  const counts = { breakfast: {}, lunch: {}, dinner: {} };
  for (const d of days) {
    for (const m of (d.meals || [])) {
      if (!m.is_open) continue;
      const k = `${m.open_time || '?'}–${m.close_time || '?'} (${m.capacity || 0} pl.)`;
      counts[m.meal_type] = counts[m.meal_type] || {};
      counts[m.meal_type][k] = (counts[m.meal_type][k] || 0) + 1;
    }
  }
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const entries = Object.entries(counts[meal] || {});
    if (entries.length === 0) { out[meal] = 'Fermé toute la semaine'; continue; }
    entries.sort((a, b) => b[1] - a[1]);
    out[meal] = `${entries[0][0]} · ${entries[0][1]}j/7`;
  }
  return out;
}

async function applyRestaurantTemplate(id, name) {
  if (!confirm(`Appliquer le modèle "${name}" ?\n\nLes 7 jours du planning seront remplacés par les horaires & capacités du modèle.`)) return;
  const result = await api(`/restaurant/templates/${id}/apply`, { method: 'POST' });
  if (result) {
    showToast(`Modèle appliqué (${result.updated} mis à jour, ${result.inserted} créés)`, 'success');
    // Recharger uniquement le planning, pas toute la page
    const sched = await api('/restaurant/schedule');
    if (sched) state.restaurantSchedule = sched.schedule || [];
    state.restaurantTab = 'schedule';
    render();
  }
}

async function deleteRestaurantTemplate(id, name) {
  if (!confirm(`Supprimer définitivement le modèle "${name}" ?`)) return;
  const result = await api(`/restaurant/templates/${id}`, { method: 'DELETE' });
  if (result) {
    showToast('Modèle supprimé', 'success');
    state.restaurantTemplates = state.restaurantTemplates.filter(t => t.id !== id);
    render();
  }
}

function newRestaurantTemplate() {
  // Cloner le planning actuel comme base
  const days = [0,1,2,3,4,5,6].map(weekday => ({
    weekday,
    meals: ['breakfast', 'lunch', 'dinner'].map(meal_type => {
      const s = (state.restaurantSchedule || []).find(x => x.weekday === weekday && x.meal_type === meal_type);
      return s ? {
        meal_type,
        is_open: s.is_open ? 1 : 0,
        open_time: s.open_time,
        close_time: s.close_time,
        capacity: s.capacity || 0
      } : { meal_type, is_open: 0, open_time: null, close_time: null, capacity: 0 };
    })
  }));
  state.editingTemplate = { id: null, name: '', description: '', days };
  showRestaurantTemplateModal();
}

function editRestaurantTemplate(id) {
  const t = (state.restaurantTemplates || []).find(x => x.id === id);
  if (!t) return;
  // Deep clone pour ne pas muter l'état avant validation
  state.editingTemplate = JSON.parse(JSON.stringify({ id: t.id, name: t.name, description: t.description || '', days: t.days || [] }));
  showRestaurantTemplateModal();
}

function showRestaurantTemplateModal() {
  const t = state.editingTemplate;
  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const mealLabels = { breakfast: '☕ Petit-déj', lunch: '🍽️ Déjeuner', dinner: '🍷 Dîner' };
  const html = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-2" onclick="if(event.target===this) closeModal()">
    <div class="modal-panel bg-white w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto">
      <div class="modal-header bg-brand-400 text-white px-5 py-3 sticky top-0 z-10">
        <h3 class="font-semibold">${t.id ? 'Modifier' : 'Nouveau'} modèle de semaine</h3>
      </div>
      <div class="modal-body p-5 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-navy-700 mb-1">Nom *</label>
            <input id="tpl_name" type="text" value="${escapeHtml(t.name || '')}" placeholder="Ex: Semaine été" class="w-full px-3 py-2 border rounded form-input-mobile text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-navy-700 mb-1">Description</label>
            <input id="tpl_desc" type="text" value="${escapeHtml(t.description || '')}" placeholder="Optionnel" class="w-full px-3 py-2 border rounded form-input-mobile text-sm">
          </div>
        </div>
        <div class="space-y-2">
          ${dayNames.map((dn, weekday) => {
            const day = t.days.find(d => d.weekday === weekday) || { weekday, meals: [] };
            return `
            <div class="border border-gray-200 rounded-lg p-3">
              <div class="font-semibold text-navy-800 text-sm mb-2">${dn}</div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                ${['breakfast','lunch','dinner'].map(mt => {
                  const m = day.meals.find(x => x.meal_type === mt) || { meal_type: mt, is_open: 0 };
                  return `
                  <div class="bg-gray-50 rounded p-2 text-xs">
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="font-medium">${mealLabels[mt]}</span>
                      <label class="flex items-center gap-1 text-[10px]">
                        <input type="checkbox" ${m.is_open ? 'checked' : ''} onchange="updateTplField(${weekday}, '${mt}', 'is_open', this.checked ? 1 : 0)">
                        Ouvert
                      </label>
                    </div>
                    <div class="grid grid-cols-3 gap-1">
                      <input type="time" value="${m.open_time || ''}" onchange="updateTplField(${weekday}, '${mt}', 'open_time', this.value || null)" class="px-1 py-1 border rounded text-[11px]">
                      <input type="time" value="${m.close_time || ''}" onchange="updateTplField(${weekday}, '${mt}', 'close_time', this.value || null)" class="px-1 py-1 border rounded text-[11px]">
                      <input type="number" min="0" value="${m.capacity || 0}" onchange="updateTplField(${weekday}, '${mt}', 'capacity', parseInt(this.value)||0)" class="px-1 py-1 border rounded text-[11px]">
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>
        <div class="flex justify-end gap-2 pt-2 sticky bottom-0 bg-white">
          <button onclick="closeModal()" class="px-4 py-2 text-sm text-gray-600 rounded hover:bg-gray-100">Annuler</button>
          <button onclick="saveRestaurantTemplate()" class="px-4 py-2 text-sm btn-premium-navy text-white rounded font-semibold"><i class="fas fa-save mr-1"></i>Enregistrer</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('modal-container').innerHTML = html;
}

function updateTplField(weekday, meal_type, field, value) {
  const t = state.editingTemplate;
  if (!t) return;
  let day = t.days.find(d => d.weekday === weekday);
  if (!day) { day = { weekday, meals: [] }; t.days.push(day); }
  let meal = day.meals.find(m => m.meal_type === meal_type);
  if (!meal) { meal = { meal_type, is_open: 0 }; day.meals.push(meal); }
  meal[field] = value;
}

async function saveRestaurantTemplate() {
  const t = state.editingTemplate;
  if (!t) return;
  const name = document.getElementById('tpl_name').value.trim();
  const description = document.getElementById('tpl_desc').value.trim();
  if (!name) { showToast('Nom requis', 'error'); return; }
  // S'assurer qu'on a bien 7 jours, chacun avec 3 repas
  const completeDays = [0,1,2,3,4,5,6].map(weekday => {
    const day = t.days.find(d => d.weekday === weekday) || { weekday, meals: [] };
    const meals = ['breakfast','lunch','dinner'].map(mt => {
      const m = day.meals.find(x => x.meal_type === mt);
      return m || { meal_type: mt, is_open: 0, open_time: null, close_time: null, capacity: 0 };
    });
    return { weekday, meals };
  });
  const body = JSON.stringify({ name, description, days: completeDays });
  const result = t.id
    ? await api(`/restaurant/templates/${t.id}`, { method: 'PUT', body })
    : await api('/restaurant/templates', { method: 'POST', body });
  if (result) {
    showToast(t.id ? 'Modèle mis à jour' : 'Modèle créé', 'success');
    closeModal();
    // Recharger uniquement les templates
    const tpls = await api('/restaurant/templates');
    if (tpls) state.restaurantTemplates = tpls.templates || [];
    state.editingTemplate = null;
    render();
  }
}

function renderRestaurantExceptions() {
  const exc = state.restaurantExceptions || [];
  const mealLabels = { breakfast: 'Petit-déj', lunch: 'Déjeuner', dinner: 'Dîner' };
  const canEdit = userCanEditRestaurant();
  return `
  <div class="flex justify-between items-center mb-3">
    <p class="text-sm text-gray-500">Exceptions ponctuelles (jours fériés, événements privés…)</p>
    ${canEdit ? `<button onclick="showExceptionModal()" class="btn-premium-navy text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-plus mr-1"></i>Ajouter</button>` : ''}
  </div>
  <div class="space-y-2">
    ${exc.length === 0 ? '<div class="text-center py-8 text-gray-400">Aucune exception programmée.</div>' : exc.map(e => `
      <div class="border border-gray-200 rounded-lg p-3 flex items-center justify-between">
        <div class="flex-1">
          <div class="font-semibold text-navy-800 text-sm">${e.exception_date} — ${mealLabels[e.meal_type]}</div>
          <div class="text-xs text-gray-500">${e.is_open ? `Ouvert ${e.open_time || ''}–${e.close_time || ''} · capacité ${e.capacity || '—'}` : 'Fermé'}${e.notes ? ' · ' + escapeHtml(e.notes) : ''}</div>
        </div>
        ${canEdit ? `<button onclick="deleteException(${e.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    `).join('')}
  </div>`;
}

function showExceptionModal() {
  const today = new Date().toISOString().slice(0, 10);
  const html = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onclick="if(event.target===this) closeModal()">
    <div class="modal-panel bg-white w-full sm:max-w-md">
      <div class="modal-header bg-brand-400 text-white px-5 py-3"><h3 class="font-semibold">Nouvelle exception</h3></div>
      <div class="modal-body p-5 space-y-3">
        <div><label class="block text-sm mb-1">Date</label><input id="exc_date" type="date" min="${today}" value="${today}" class="w-full px-3 py-2 border rounded form-input-mobile"></div>
        <div><label class="block text-sm mb-1">Repas</label><select id="exc_meal" class="w-full px-3 py-2 border rounded form-input-mobile"><option value="breakfast">Petit-déj</option><option value="lunch">Déjeuner</option><option value="dinner">Dîner</option></select></div>
        <div class="flex items-center gap-2"><input id="exc_open" type="checkbox"><label for="exc_open" class="text-sm">Ouvert (sinon = service annulé)</label></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="block text-xs mb-1">Début</label><input id="exc_start" type="time" class="w-full px-2 py-1 border rounded text-sm"></div>
          <div><label class="block text-xs mb-1">Fin</label><input id="exc_end" type="time" class="w-full px-2 py-1 border rounded text-sm"></div>
        </div>
        <div><label class="block text-xs mb-1">Capacité</label><input id="exc_cap" type="number" min="0" class="w-full px-2 py-1 border rounded text-sm" placeholder="Ex: 20"></div>
        <div><label class="block text-xs mb-1">Notes</label><input id="exc_notes" type="text" class="w-full px-2 py-1 border rounded text-sm" placeholder="Ex: Mariage privé"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeModal()" class="px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100">Annuler</button>
          <button onclick="saveException()" class="px-3 py-1.5 text-sm btn-premium-navy text-white rounded">Enregistrer</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('modal-container').innerHTML = html;
}

async function saveException() {
  const body = {
    exception_date: document.getElementById('exc_date').value,
    meal_type: document.getElementById('exc_meal').value,
    is_open: document.getElementById('exc_open').checked,
    open_time: document.getElementById('exc_start').value || null,
    close_time: document.getElementById('exc_end').value || null,
    capacity: parseInt(document.getElementById('exc_cap').value) || null,
    notes: document.getElementById('exc_notes').value || null
  };
  const data = await api('/restaurant/exceptions', { method: 'POST', body: JSON.stringify(body) });
  if (data) { showToast('Exception ajoutée', 'success'); closeModal(); state._restaurantLoaded = false; await loadRestaurantData(); render(); }
}

async function deleteException(id) {
  if (!confirm('Supprimer cette exception ?')) return;
  const data = await api(`/restaurant/exceptions/${id}`, { method: 'DELETE' });
  if (data) { showToast('Exception supprimée', 'success'); state._restaurantLoaded = false; await loadRestaurantData(); render(); }
}

function showStaffReservationModal() {
  const today = new Date().toISOString().slice(0, 10);
  const html = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onclick="if(event.target===this) closeModal()">
    <div class="modal-panel bg-white w-full sm:max-w-md">
      <div class="modal-header bg-brand-400 text-white px-5 py-3"><h3 class="font-semibold">Nouvelle réservation</h3></div>
      <div class="modal-body p-5 space-y-3">
        <div><label class="block text-sm mb-1">Date</label><input id="resa_date" type="date" min="${today}" value="${today}" class="w-full px-3 py-2 border rounded form-input-mobile"></div>
        <div><label class="block text-sm mb-1">Repas</label><select id="resa_meal" class="w-full px-3 py-2 border rounded form-input-mobile"><option value="breakfast">Petit-déj</option><option value="lunch">Déjeuner</option><option value="dinner">Dîner</option></select></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="block text-xs mb-1">Heure souhaitée</label><input id="resa_time" type="time" class="w-full px-2 py-1 border rounded text-sm"></div>
          <div><label class="block text-xs mb-1">Personnes</label><input id="resa_count" type="number" min="1" max="20" value="2" class="w-full px-2 py-1 border rounded text-sm"></div>
        </div>
        <div><label class="block text-xs mb-1">Nom du client</label><input id="resa_name" type="text" class="w-full px-3 py-2 border rounded text-sm" placeholder="Ex: M. Dupont"></div>
        <div><label class="block text-xs mb-1">Notes</label><input id="resa_notes" type="text" class="w-full px-3 py-2 border rounded text-sm" placeholder="Allergies, demandes spéciales…"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeModal()" class="px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-100">Annuler</button>
          <button onclick="saveStaffReservation()" class="px-3 py-1.5 text-sm btn-premium-navy text-white rounded">Enregistrer</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('modal-container').innerHTML = html;
}

async function saveStaffReservation() {
  const body = {
    reservation_date: document.getElementById('resa_date').value,
    meal_type: document.getElementById('resa_meal').value,
    time_slot: document.getElementById('resa_time').value || null,
    guest_count: parseInt(document.getElementById('resa_count').value) || 1,
    guest_name: document.getElementById('resa_name').value || null,
    notes: document.getElementById('resa_notes').value || null
  };
  const data = await api('/restaurant/reservations', { method: 'POST', body: JSON.stringify(body) });
  if (data) { showToast('Réservation enregistrée', 'success'); closeModal(); state._restaurantLoaded = false; await loadRestaurantData(); render(); }
}

async function cancelStaffReservation(id) {
  if (!confirm('Annuler cette réservation ?')) return;
  const data = await api(`/restaurant/reservations/${id}`, { method: 'DELETE' });
  if (data) { showToast('Réservation annulée', 'success'); state._restaurantLoaded = false; await loadRestaurantData(); render(); }
}

