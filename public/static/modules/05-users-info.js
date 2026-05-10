// ============================================
// WIKOT MODULE — 05-users-info
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

// ============================================
// USERS VIEW
// ============================================
function renderUsersView() {
  const isSuperAdmin = state.user.role === 'super_admin';
  const isAdmin = state.user.role === 'admin';

  // Filtre hôtel (super_admin uniquement) — stocké dans state
  const filterHotelId = state.usersFilterHotel || '';
  const filteredUsers = isSuperAdmin && filterHotelId
    ? state.users.filter(u => String(u.hotel_id) === String(filterHotelId))
    : state.users;

  // Super admin : filtre pour ne montrer que les admins des hôtels par défaut (mais peut voir tous)
  const roleLabels = { super_admin: 'Super Admin', admin: 'Admin', employee: 'Employé' };
  const roleColors = { super_admin: 'bg-purple-100 text-purple-700', admin: 'bg-blue-100 text-blue-700', employee: 'bg-green-100 text-green-700' };

  // Pills premium pour le rôle (au lieu des couleurs criardes)
  const rolePill = (role) => {
    const cfg = {
      super_admin: 'background: rgba(10,22,40,0.08); color: var(--c-navy);',
      admin:       'background: rgba(201,169,97,0.14); color: var(--c-gold-deep);',
      employee:    'background: var(--c-cream-deep); color: rgba(15,27,40,0.65);'
    };
    return `<span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full" style="${cfg[role] || cfg.employee}">${roleLabels[role]}</span>`;
  };

  return `
  <div class="fade-in">
    <!-- Header premium -->
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
      <div>
        <p class="section-eyebrow mb-2">Équipe</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Utilisateurs</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">${filteredUsers.length} compte${filteredUsers.length > 1 ? 's' : ''}${filterHotelId ? ' — filtré' : ''}</p>
      </div>
      <button onclick="showUserForm()" class="btn-premium self-start sm:self-auto px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;">
        <i class="fas fa-user-plus text-xs"></i>Ajouter
      </button>
    </div>

    ${isSuperAdmin ? `
    <div class="card-premium p-4 mb-5 flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 shrink-0">
        <i class="fas fa-filter text-sm" style="color: var(--c-gold);"></i>
        <span class="text-xs uppercase tracking-wider font-semibold" style="color: var(--c-navy);">Filtrer par hôtel</span>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="state.usersFilterHotel=''; render()"
          class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all" style="${!filterHotelId ? 'background: var(--c-navy); color: #fff;' : 'background: var(--c-cream-deep); color: var(--c-navy);'}">
          Tous
        </button>
        ${state.hotels.map(h => {
          const isActive = filterHotelId === String(h.id);
          return `
          <button onclick="state.usersFilterHotel='${h.id}'; render()"
            class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all" style="${isActive ? 'background: var(--c-gold); color: var(--c-navy);' : 'background: rgba(201,169,97,0.10); color: var(--c-gold-deep); border: 1px solid rgba(201,169,97,0.20);'}">
            <i class="fas fa-hotel mr-1"></i>${escapeHtml(h.name)}
          </button>
        `;}).join('')}
      </div>
    </div>` : ''}

    <!-- Desktop table premium (md+) -->
    <div class="hidden md:block card-premium overflow-hidden">
     <div class="table-scroll-wrapper">
      <table class="w-full min-w-[640px]">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider" style="background: var(--c-cream-deep); color: var(--c-gold-deep);">
            <th class="text-left py-3 px-5 font-semibold">Utilisateur</th>
            ${isSuperAdmin ? '<th class="text-left py-3 px-5 font-semibold">Hôtel</th>' : ''}
            <th class="text-left py-3 px-5 font-semibold">Rôle</th>
            <th class="text-left py-3 px-5 font-semibold">Dernière connexion</th>
            <th class="text-left py-3 px-5 font-semibold">Statut</th>
            ${isAdmin ? '<th class="text-left py-3 px-5 font-semibold">Permissions employé</th>' : ''}
            <th class="text-left py-3 px-5 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filteredUsers.length === 0 ? `
            <tr><td colspan="6" class="py-10 text-center text-sm" style="color: rgba(15,27,40,0.45);">Aucun utilisateur</td></tr>
          ` : filteredUsers.map(u => {
            const isEmployee = u.role === 'employee';
            const isSelf = u.id === state.user.id;
            return `
            <tr style="border-top: 1px solid var(--c-line);" onmouseover="this.style.background='var(--c-cream)';" onmouseout="this.style.background='transparent';">
              <td class="py-3.5 px-5">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold" style="background: var(--c-navy); color: var(--c-gold);">${escapeHtml(u.name.charAt(0))}</div>
                  <div>
                    <p class="text-sm font-display font-semibold" style="color: var(--c-navy);">${escapeHtml(u.name)}${isSelf ? ' <span class="text-[10px] px-1.5 py-0.5 rounded ml-1" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">vous</span>' : ''}</p>
                    <p class="text-xs" style="color: rgba(15,27,40,0.5);">${escapeHtml(u.email)}</p>
                  </div>
                </div>
              </td>
              ${isSuperAdmin ? `<td class="py-3.5 px-5 text-sm" style="color: rgba(15,27,40,0.65);">${u.hotel_name ? escapeHtml(u.hotel_name) : '<span style="color: rgba(15,27,40,0.3);" class="italic">—</span>'}</td>` : ''}
              <td class="py-3.5 px-5">
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${rolePill(u.role)}
                  ${u.job_role ? `<span class="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1" style="background: rgba(201,169,97,0.12); color: var(--c-gold-deep); border: 1px solid rgba(201,169,97,0.25);"><i class="fas ${jobRoleIcon(u.job_role)} text-[9px]"></i>${jobRoleLabel(u.job_role) || u.job_role}</span>` : ''}
                </div>
              </td>
              <td class="py-3.5 px-5 text-xs" style="color: rgba(15,27,40,0.5);">${u.last_login ? formatDate(u.last_login) : 'Jamais'}</td>
              <td class="py-3.5 px-5">
                <span class="w-2 h-2 rounded-full inline-block" style="background: ${u.is_active ? '#5C8A6E' : '#C84C3F'};"></span>
                <span class="text-xs ml-1.5" style="color: rgba(15,27,40,0.55);">${u.is_active ? 'Actif' : 'Inactif'}</span>
              </td>
              ${isAdmin ? `
              <td class="py-3.5 px-5">
                ${isEmployee ? permissionCheckboxes(u) : `<span class="text-xs italic" style="color: rgba(15,27,40,0.35);">${u.role === 'admin' ? 'Droits admin (complets)' : '—'}</span>`}
              </td>` : ''}
              <td class="py-3.5 px-5">
                <div class="flex items-center gap-1">
                  <button onclick="showUserForm(${u.id})"
                    class="w-8 h-8 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='rgba(201,169,97,0.12)'; this.style.color='var(--c-gold-deep)';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';"
                    title="Modifier ${u.name.replace(/'/g, "\\'")}">
                    <i class="fas fa-pen text-xs"></i>
                  </button>
                  ${isSelf ? '' : `
                  <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
                    class="w-8 h-8 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='rgba(226,125,110,0.12)'; this.style.color='#C84C3F';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';"
                    title="Supprimer ${u.name.replace(/'/g, "\\'")}">
                    <i class="fas fa-trash text-xs"></i>
                  </button>`}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
     </div>
    </div>

    <!-- Mobile cards premium (< md) -->
    <div class="md:hidden space-y-3">
      ${filteredUsers.length === 0 ? `
        <div class="card-premium empty-state-premium">
          <div class="empty-icon"><i class="fas fa-users"></i></div>
          <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucun utilisateur</p>
        </div>
      ` : filteredUsers.map(u => {
        const isEmployee = u.role === 'employee';
        const isSelf = u.id === state.user.id;
        return `
        <div class="card-premium p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style="background: var(--c-navy); color: var(--c-gold);">${escapeHtml(u.name.charAt(0))}</div>
              <div class="min-w-0">
                <p class="text-sm font-display font-semibold truncate" style="color: var(--c-navy);">${escapeHtml(u.name)}${isSelf ? ' <span class="text-[10px] px-1 py-0.5 rounded" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">vous</span>' : ''}</p>
                <p class="text-xs truncate" style="color: rgba(15,27,40,0.5);">${escapeHtml(u.email)}</p>
                ${isSuperAdmin && u.hotel_name ? `<p class="text-xs mt-0.5" style="color: var(--c-gold-deep);"><i class="fas fa-hotel mr-1"></i>${escapeHtml(u.hotel_name)}</p>` : ''}
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button onclick="showUserForm(${u.id})"
                class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: rgba(201,169,97,0.12); color: var(--c-gold-deep);">
                <i class="fas fa-pen text-xs"></i>
              </button>
              ${isSelf ? '' : `
              <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
                class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: rgba(226,125,110,0.10); color: #C84C3F;">
                <i class="fas fa-trash text-xs"></i>
              </button>`}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-3 pt-3" style="border-top: 1px solid var(--c-line);">
            ${rolePill(u.role)}
            ${u.job_role ? `<span class="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1" style="background: rgba(201,169,97,0.12); color: var(--c-gold-deep); border: 1px solid rgba(201,169,97,0.25);"><i class="fas ${jobRoleIcon(u.job_role)} text-[9px]"></i>${jobRoleLabel(u.job_role) || u.job_role}</span>` : ''}
            <span class="flex items-center gap-1.5 text-xs" style="color: rgba(15,27,40,0.55);">
              <span class="w-1.5 h-1.5 rounded-full" style="background: ${u.is_active ? '#5C8A6E' : '#C84C3F'};"></span>
              ${u.is_active ? 'Actif' : 'Inactif'}
            </span>
            <span class="text-[10px]" style="color: rgba(15,27,40,0.45);"><i class="fas fa-clock mr-0.5" style="color: var(--c-gold);"></i>${u.last_login ? formatDate(u.last_login) : 'Jamais connecté'}</span>
          </div>
          ${isAdmin && isEmployee ? `
          <div class="mt-3 pt-3" style="border-top: 1px solid var(--c-line);">
            <p class="text-[10px] uppercase tracking-wider font-semibold mb-2" style="color: var(--c-gold-deep);">Permissions</p>
            ${permissionCheckboxes(u, true)}
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>

    ${isAdmin ? `
    <div class="mt-5 card-premium p-5 flex items-start gap-3" style="background: linear-gradient(180deg, #fff 0%, var(--c-cream) 100%); border-left: 3px solid var(--c-gold);">
      <i class="fas fa-circle-info text-base mt-0.5" style="color: var(--c-gold);"></i>
      <div class="text-xs space-y-1.5" style="color: rgba(15,27,40,0.7);">
        <p class="section-eyebrow">Permissions des employés</p>
        <p>Vous pouvez activer / désactiver indépendamment plusieurs <strong style="color: var(--c-navy);">droits</strong> pour chaque employé :</p>
        <ul class="list-disc pl-5 space-y-0.5">
          <li><strong style="color: var(--c-navy);">Procédures</strong> — créer, modifier et supprimer les procédures.</li>
          <li><strong style="color: var(--c-navy);">Informations</strong> — créer et modifier les informations de l'hôtel.</li>
          <li><strong style="color: var(--c-navy);">Salons / chat</strong> — créer, modifier et organiser les conversations.</li>
          <li><strong style="color: var(--c-navy);">Créer des tâches</strong> — créer et modifier les tâches récurrentes ou ponctuelles.</li>
          <li><strong style="color: var(--c-navy);">Attribuer des tâches</strong> — assigner des tâches aux autres employés.</li>
        </ul>
        <p class="mt-1">Les <strong style="color: var(--c-navy);">admins</strong> ont toujours accès complet à tout, sans cases à cocher.</p>
      </div>
    </div>` : ''}
  </div>`;
}

async function deleteUser(id, name) {
  if (!confirm(`Supprimer le compte de "${name}" ? Cette action est irréversible.`)) return;
  const result = await api(`/users/${id}`, { method: 'DELETE' });
  if (result) {
    await loadData();
    render();
    showToast(`Compte de ${name} supprimé`, 'success');
  }
}

// ============================================
// HOTEL INFO — Page Informations
// ============================================
async function loadHotelInfo() {
  const data = await api('/hotel-info');
  if (data) {
    state.hotelInfoCategories = data.categories || [];
    state.hotelInfoItems = data.items || [];
    state.hotelInfoLoaded = true;
  }
}

function renderHotelInfoView() {
  // Charger en arrière-plan si pas encore fait
  if (!state.hotelInfoLoaded) {
    loadHotelInfo().then(() => render());
    return `
    <div class="fade-in flex items-center justify-center py-20">
      <div class="text-center">
        <i class="fas fa-circle-notch fa-spin text-2xl mb-3" style="color: var(--c-gold);"></i>
        <p class="text-sm" style="color: rgba(15,27,40,0.5);">Chargement des informations…</p>
      </div>
    </div>`;
  }

  const canEditInfo = canEditHotelInfo();
  const cats = state.hotelInfoCategories || [];
  const items = state.hotelInfoItems || [];
  const q = (state.hotelInfoSearchQuery || '').trim().toLowerCase();

  // Filtre items selon recherche
  const filteredItems = q
    ? items.filter(it => (it.title || '').toLowerCase().includes(q) || (it.content || '').toLowerCase().includes(q))
    : items;

  return `
  <div class="fade-in">
    <!-- Header premium -->
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div class="min-w-0">
        <p class="section-eyebrow mb-2">L'hôtel en détail</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Informations</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">Tout ce qu'il faut savoir sur l'hôtel, à portée de main.</p>
      </div>
      ${canEditInfo ? `
        <div class="flex flex-wrap gap-2 shrink-0">
          <button onclick="showHotelInfoCategoryModal()" class="px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line-strong);" onmouseover="this.style.borderColor='var(--c-gold)'" onmouseout="this.style.borderColor='var(--c-line-strong)'">
            <i class="fas fa-folder-plus"></i><span class="hidden sm:inline">Catégorie</span>
          </button>
          <button onclick="showHotelInfoItemModal()" class="btn-premium px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;">
            <i class="fas fa-plus text-xs"></i><span>Nouvelle info</span>
          </button>
        </div>
      ` : ''}
    </div>

    <!-- Barre de recherche premium sticky -->
    <div class="sticky top-0 z-10 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-3 mb-5" style="background: var(--c-cream); border-bottom: 1px solid var(--c-line);">
      <div class="relative max-w-2xl">
        <i class="fas fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-sm" style="color: var(--c-gold);"></i>
        <input id="hotel-info-search" type="text" value="${escapeHtml(state.hotelInfoSearchQuery || '')}"
          oninput="state.hotelInfoSearchQuery = this.value; renderHotelInfoBody()"
          placeholder="Rechercher une info (parking, petit-déjeuner, jacuzzi…)"
          class="input-premium form-input-mobile w-full pl-10 pr-10 py-3 rounded-xl outline-none">
        ${q ? `<button onclick="state.hotelInfoSearchQuery=''; document.getElementById('hotel-info-search').value=''; renderHotelInfoBody()" class="absolute right-3 top-1/2 -translate-y-1/2" style="color: rgba(15,27,40,0.4);"><i class="fas fa-xmark"></i></button>` : ''}
      </div>
    </div>

    <!-- Corps -->
    <div id="hotel-info-body">
      ${renderHotelInfoBodyHTML(cats, filteredItems, q, canEditInfo)}
    </div>
  </div>`;
}

// Helper centralisé : qui peut éditer les infos hôtel ?
// Admin, super_admin ET employés avec can_edit_info = 1 (permission granulaire)
function canEditHotelInfo() {
  return userCanEditInfo();
}

function renderHotelInfoBody() {
  // Refresh seulement le corps sans tout re-rendre (recherche live)
  const body = document.getElementById('hotel-info-body');
  if (!body) { render(); return; }
  const cats = state.hotelInfoCategories || [];
  const items = state.hotelInfoItems || [];
  const q = (state.hotelInfoSearchQuery || '').trim().toLowerCase();
  const filteredItems = q
    ? items.filter(it => (it.title || '').toLowerCase().includes(q) || (it.content || '').toLowerCase().includes(q))
    : items;
  body.innerHTML = renderHotelInfoBodyHTML(cats, filteredItems, q, canEditHotelInfo());
}

function renderHotelInfoBodyHTML(cats, filteredItems, q, canEditInfo) {
  if (filteredItems.length === 0 && q) {
    return `
    <div class="card-premium empty-state-premium">
      <div class="empty-icon"><i class="fas fa-magnifying-glass"></i></div>
      <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucun résultat pour « ${escapeHtml(q)} »</p>
      <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Essayez avec un autre terme.</p>
    </div>`;
  }

  if (cats.length === 0 && filteredItems.length === 0) {
    return `
    <div class="card-premium empty-state-premium">
      <div class="empty-icon"><i class="fas fa-circle-info"></i></div>
      <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucune information renseignée</p>
      ${canEditInfo ? `<p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Cliquez sur « Nouvelle info » pour commencer.</p>` : ''}
    </div>`;
  }

  // Mode recherche : liste à plat avec catégorie en badge
  if (q) {
    return `
    <div class="space-y-3">
      ${filteredItems.map(it => {
        const cat = cats.find(c => c.id === it.category_id);
        return renderHotelInfoItemCard(it, cat, canEditInfo, true);
      }).join('')}
    </div>`;
  }

  // Mode normal : groupé par catégorie en accordéon
  const itemsByCat = {};
  filteredItems.forEach(it => {
    const cid = it.category_id || 0;
    if (!itemsByCat[cid]) itemsByCat[cid] = [];
    itemsByCat[cid].push(it);
  });

  const orphanItems = itemsByCat[0] || [];

  return `
  <div class="space-y-4">
    ${cats.map(cat => {
      const catItems = itemsByCat[cat.id] || [];
      const isOpen = state.hotelInfoActiveCategory === cat.id;
      return `
      <div id="info-cat-${cat.id}" class="card-premium">
        <!-- Header de la catégorie premium -->
        <div class="flex items-stretch" style="background: linear-gradient(180deg, #fff 0%, var(--c-cream) 100%); border-bottom: ${isOpen ? '1px solid var(--c-line)' : 'none'};">
          <button type="button" onclick="toggleHotelInfoCategory(${cat.id})"
            class="flex-1 min-w-0 flex items-center gap-3 px-5 py-4 transition-colors text-left">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background: rgba(201,169,97,0.12);">
              <i class="fas ${cat.icon || 'fa-circle-info'}" style="color: var(--c-gold-deep);"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-display font-semibold text-sm sm:text-base truncate" style="color: var(--c-navy);">${escapeHtml(cat.name)}</h3>
              <p class="text-[11px] uppercase tracking-wider mt-0.5" style="color: rgba(15,27,40,0.45);">${catItems.length} info${catItems.length > 1 ? 's' : ''}</p>
            </div>
          </button>
          <div class="flex items-center gap-1 pr-3 sm:pr-4 shrink-0">
            ${canEditInfo ? `
              <button type="button" onclick="showHotelInfoCategoryModal(${cat.id})" title="Renommer la catégorie"
                class="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='var(--c-cream-deep)'; this.style.color='var(--c-navy)';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';">
                <i class="fas fa-pen text-sm"></i>
              </button>
              <button type="button" onclick="deleteHotelInfoCategory(${cat.id})" title="Supprimer"
                class="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='rgba(226,125,110,0.12)'; this.style.color='#C84C3F';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';">
                <i class="fas fa-trash text-sm"></i>
              </button>
              <div class="w-px h-6 mx-1" style="background: var(--c-line-strong);"></div>
            ` : ''}
            <button type="button" onclick="toggleHotelInfoCategory(${cat.id})" title="Ouvrir / fermer"
              class="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style="color: var(--c-gold-deep);" onmouseover="this.style.background='rgba(201,169,97,0.12)'" onmouseout="this.style.background='transparent'">
              <i id="info-cat-chevron-${cat.id}" class="fas fa-chevron-${isOpen ? 'up' : 'down'} text-sm transition-transform"></i>
            </button>
          </div>
        </div>
        <div id="info-cat-content-${cat.id}" class="${isOpen ? '' : 'hidden'} p-3 sm:p-4 space-y-2" style="background: var(--c-cream);">
          ${catItems.length === 0 ? `
            <p class="text-sm italic px-2 py-3" style="color: rgba(15,27,40,0.4);">Aucune info dans cette catégorie.</p>
          ` : catItems.map(it => renderHotelInfoItemCard(it, cat, canEditInfo, false)).join('')}
          ${canEditInfo ? `
            <button onclick="showHotelInfoItemModal(null, ${cat.id})" class="w-full mt-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all" style="border: 1.5px dashed var(--c-line-strong); color: rgba(15,27,40,0.5); background: transparent;" onmouseover="this.style.borderColor='var(--c-gold)'; this.style.color='var(--c-gold-deep)'; this.style.background='rgba(201,169,97,0.05)';" onmouseout="this.style.borderColor='var(--c-line-strong)'; this.style.color='rgba(15,27,40,0.5)'; this.style.background='transparent';">
              <i class="fas fa-plus mr-1"></i>Ajouter une info dans « ${escapeHtml(cat.name)} »
            </button>
          ` : ''}
        </div>
      </div>`;
    }).join('')}

    ${orphanItems.length > 0 ? `
      <div class="card-premium">
        <div class="px-5 py-3" style="border-bottom: 1px solid var(--c-line); background: var(--c-cream-deep);">
          <h3 class="text-sm font-display font-semibold" style="color: var(--c-navy);"><i class="fas fa-folder-open mr-2" style="color: var(--c-gold);"></i>Sans catégorie</h3>
        </div>
        <div class="p-3 sm:p-4 space-y-2" style="background: var(--c-cream);">
          ${orphanItems.map(it => renderHotelInfoItemCard(it, null, canEditInfo, false)).join('')}
        </div>
      </div>
    ` : ''}
  </div>`;
}

function renderHotelInfoItemCard(item, category, canEditInfo, showCategoryBadge) {
  return `
  <div id="info-item-${item.id}" class="rounded-lg transition-all" style="background: #fff; border: 1px solid var(--c-line);" onmouseover="this.style.borderColor='rgba(201,169,97,0.35)'" onmouseout="this.style.borderColor='var(--c-line)'">
    <div class="px-4 py-3.5 flex items-start gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap mb-1.5">
          <h4 class="font-display font-semibold text-sm sm:text-base" style="color: var(--c-navy);">${escapeHtml(item.title)}</h4>
          ${showCategoryBadge && category ? `
            <span class="pill-gold">
              <i class="fas ${category.icon || 'fa-circle-info'}"></i>${escapeHtml(category.name)}
            </span>
          ` : ''}
        </div>
        ${item.content ? `<div class="text-sm whitespace-pre-wrap break-words leading-relaxed" style="color: rgba(15,27,40,0.72);">${formatHotelInfoContent(item.content)}</div>` : ''}
      </div>
      ${canEditInfo ? `
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="showHotelInfoItemModal(${item.id})" title="Modifier"
            class="w-8 h-8 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='var(--c-cream-deep)'; this.style.color='var(--c-navy)';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';">
            <i class="fas fa-pen text-xs"></i>
          </button>
          <button onclick="deleteHotelInfoItem(${item.id})" title="Supprimer"
            class="w-8 h-8 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='rgba(226,125,110,0.12)'; this.style.color='#C84C3F';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      ` : ''}
    </div>
  </div>`;
}

// Mise en forme légère du contenu : transforme **gras**, ⚠️/💡/📧 en couleurs, garde retours ligne
function formatHotelInfoContent(text) {
  let html = escapeHtml(text);
  // **gras**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-navy-800">$1</strong>');
  // Lignes commençant par • ou - → puces stylées
  html = html.replace(/^(\s*[•\-]\s+)(.+)$/gm, '<span class="block pl-4 relative"><span class="absolute left-0 text-brand-400">•</span>$2</span>');
  return html;
}

// Toggle par DOM-only pour éviter le scroll jump (pas de re-render)
function toggleHotelInfoCategory(catId) {
  const content = document.getElementById(`info-cat-content-${catId}`);
  const chevron = document.getElementById(`info-cat-chevron-${catId}`);
  if (!content || !chevron) {
    // Fallback (recherche active, etc.)
    state.hotelInfoActiveCategory = state.hotelInfoActiveCategory === catId ? null : catId;
    renderHotelInfoBody();
    return;
  }
  const willOpen = content.classList.contains('hidden');
  content.classList.toggle('hidden');
  chevron.classList.toggle('fa-chevron-down', !willOpen);
  chevron.classList.toggle('fa-chevron-up', willOpen);
  state.hotelInfoActiveCategory = willOpen ? catId : null;
}

// Catalogue d'icônes Font Awesome pour les catégories d'informations hôtelières.
// Inclut toutes les icônes déjà utilisées en prod (fa-bed, fa-concierge-bell, fa-shirt,
// fa-utensils, fa-water-ladder, fa-tv, fa-star, fa-circle-info) + une cinquantaine
// d'options couvrant restauration, hébergement, services, loisirs, accessibilité, etc.
const HOTEL_INFO_ICONS = [
  // Hébergement & confort
  'fa-bed', 'fa-bath', 'fa-shower', 'fa-shirt', 'fa-temperature-half', 'fa-fan',
  'fa-broom', 'fa-soap', 'fa-toilet-paper',
  // Services hôteliers
  'fa-concierge-bell', 'fa-bell', 'fa-key', 'fa-suitcase-rolling', 'fa-suitcase',
  'fa-bell-concierge', 'fa-receipt', 'fa-credit-card',
  // Restauration
  'fa-utensils', 'fa-mug-saucer', 'fa-wine-glass', 'fa-martini-glass', 'fa-bread-slice',
  'fa-cookie', 'fa-bottle-water',
  // Loisirs & bien-être
  'fa-water-ladder', 'fa-spa', 'fa-dumbbell', 'fa-hot-tub-person', 'fa-umbrella-beach',
  'fa-person-swimming', 'fa-golf-ball-tee', 'fa-bicycle',
  // Multimédia & connectivité
  'fa-tv', 'fa-wifi', 'fa-volume-high', 'fa-music', 'fa-headphones',
  // Localisation & extérieur
  'fa-location-dot', 'fa-map-location-dot', 'fa-mountain', 'fa-tree', 'fa-leaf',
  'fa-sun', 'fa-cloud-sun',
  // Transport & parking
  'fa-car', 'fa-square-parking', 'fa-plane', 'fa-train', 'fa-taxi',
  // Spécial / général
  'fa-star', 'fa-heart', 'fa-circle-info', 'fa-shield-halved', 'fa-paw',
  'fa-baby', 'fa-wheelchair',
];

// Modaux édition catégorie
function showHotelInfoCategoryModal(catId = null) {
  const cat = catId ? (state.hotelInfoCategories || []).find(c => c.id === catId) : null;
  const isEdit = !!cat;
  // Icône par défaut : celle existante en édition, sinon fa-circle-info
  const initialIcon = (cat && cat.icon) ? cat.icon : 'fa-circle-info';
  // Garantir que l'icône courante est dans la liste (sinon on l'ajoute en tête)
  const iconList = HOTEL_INFO_ICONS.includes(initialIcon)
    ? HOTEL_INFO_ICONS
    : [initialIcon, ...HOTEL_INFO_ICONS];

  showModal(isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie', `
    <form onsubmit="event.preventDefault(); submitHotelInfoCategory(${catId || 'null'})">
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Nom de la catégorie *</label>
        <input id="info-cat-name" type="text" required maxlength="60" value="${cat ? escapeHtml(cat.name) : ''}"
          placeholder="Ex: Restauration, Loisirs..."
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Icône</label>
        <input type="hidden" id="info-cat-icon" value="${initialIcon}">
        <div id="info-cat-icon-grid" class="grid grid-cols-7 sm:grid-cols-9 gap-1.5 p-2 rounded-lg max-h-64 overflow-y-auto" style="background: var(--c-cream-deep); border: 1px solid var(--c-line);">
          ${iconList.map(ic => `
            <button type="button" onclick="selectHotelInfoIcon('${ic}')" data-icon="${ic}"
              class="info-cat-icon-btn flex items-center justify-center rounded-md transition-all ${ic === initialIcon ? 'ring-2' : ''}"
              style="aspect-ratio: 1; background: ${ic === initialIcon ? 'var(--c-navy)' : '#fff'}; color: ${ic === initialIcon ? '#fff' : 'var(--c-navy)'}; border: 1px solid var(--c-line); --tw-ring-color: var(--c-gold);"
              title="${ic}">
              <i class="fas ${ic} text-base"></i>
            </button>
          `).join('')}
        </div>
        <p class="text-xs text-navy-400 mt-1.5">Sélectionnez l'icône qui représente le mieux la catégorie.</p>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 rounded-lg text-sm font-medium transition-all" style="background: var(--c-cream-deep); color: var(--c-navy);">Annuler</button>
        <button type="submit" class="btn-premium px-4 py-3 sm:py-2 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: #fff;">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>
  `);
}

// Sélection d'icône — DOM-only pour éviter de re-render le modal
function selectHotelInfoIcon(icon) {
  const hidden = document.getElementById('info-cat-icon');
  if (hidden) hidden.value = icon;
  const grid = document.getElementById('info-cat-icon-grid');
  if (!grid) return;
  grid.querySelectorAll('.info-cat-icon-btn').forEach(btn => {
    const isSelected = btn.dataset.icon === icon;
    btn.classList.toggle('ring-2', isSelected);
    btn.style.background = isSelected ? 'var(--c-navy)' : '#fff';
    btn.style.color = isSelected ? '#fff' : 'var(--c-navy)';
  });
}

async function submitHotelInfoCategory(catId) {
  const name = document.getElementById('info-cat-name').value.trim();
  const icon = (document.getElementById('info-cat-icon') || {}).value || 'fa-circle-info';
  if (!name) return;

  const path = catId ? `/hotel-info/categories/${catId}` : '/hotel-info/categories';
  const method = catId ? 'PUT' : 'POST';
  // Couleur conservée existante en édition, sinon palette neutre par défaut.
  // L'icône est désormais le seul identifiant visuel choisi par l'utilisateur.
  const cat = catId ? (state.hotelInfoCategories || []).find(c => c.id === catId) : null;
  const color = cat ? cat.color || '#3B82F6' : '#3B82F6';
  const data = await api(path, { method, body: JSON.stringify({ name, icon, color }) });
  if (data) {
    closeModal();
    showToast(catId ? 'Catégorie modifiée' : 'Catégorie créée', 'success');
    await loadHotelInfo();
    render();
  }
}

async function deleteHotelInfoCategory(catId) {
  const cat = (state.hotelInfoCategories || []).find(c => c.id === catId);
  if (!cat) return;
  if (!confirm(`Supprimer la catégorie « ${cat.name} » ? Les infos qu'elle contient ne seront pas supprimées mais deviendront sans catégorie.`)) return;
  const data = await api(`/hotel-info/categories/${catId}`, { method: 'DELETE' });
  if (data) {
    showToast('Catégorie supprimée', 'success');
    await loadHotelInfo();
    render();
  }
}

// Modaux édition item
function showHotelInfoItemModal(itemId = null, presetCategoryId = null) {
  const item = itemId ? (state.hotelInfoItems || []).find(i => i.id === itemId) : null;
  const isEdit = !!item;
  const cats = state.hotelInfoCategories || [];
  const currentCatId = item ? item.category_id : presetCategoryId;

  showModal(isEdit ? 'Modifier l\'info' : 'Nouvelle info', `
    <form onsubmit="event.preventDefault(); submitHotelInfoItem(${itemId || 'null'})">
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Titre *</label>
        <input id="info-item-title" type="text" required maxlength="120" value="${item ? escapeHtml(item.title) : ''}"
          placeholder="Ex: Parking, Petit-déjeuner..."
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Catégorie</label>
        <select id="info-item-cat" class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg outline-none focus:ring-2 focus:ring-brand-400 bg-white">
          <option value="">Sans catégorie</option>
          ${cats.map(c => `<option value="${c.id}" ${c.id === currentCatId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Contenu</label>
        <textarea id="info-item-content" rows="8" oninput="autoResizeTextarea(this)" placeholder="Toutes les infos utiles : horaires, tarifs, conditions, etc.&#10;&#10;Astuces : utilisez **gras** pour mettre en valeur, • pour des puces."
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg outline-none focus:ring-2 focus:ring-brand-400">${item ? escapeHtml(item.content || '') : ''}</textarea>
        <p class="text-xs text-navy-400 mt-1">Vous pouvez utiliser **gras** et des puces (• ou -)</p>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2 sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 -mb-4 sm:-mb-5 pb-4 sm:pb-5" style="background: #fff; border-top: 1px solid var(--c-line);">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 rounded-lg text-sm font-medium transition-all" style="background: var(--c-cream-deep); color: var(--c-navy);">Annuler</button>
        <button type="submit" class="btn-premium px-4 py-3 sm:py-2 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: #fff;">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>
  `);
}

async function submitHotelInfoItem(itemId) {
  const title = document.getElementById('info-item-title').value.trim();
  const cat = document.getElementById('info-item-cat').value;
  const content = document.getElementById('info-item-content').value;
  if (!title) return;

  const body = {
    title,
    category_id: cat ? parseInt(cat) : null,
    content
  };
  const path = itemId ? `/hotel-info/items/${itemId}` : '/hotel-info/items';
  const method = itemId ? 'PUT' : 'POST';
  const data = await api(path, { method, body: JSON.stringify(body) });
  if (data) {
    closeModal();
    showToast(itemId ? 'Info modifiée' : 'Info créée', 'success');
    await loadHotelInfo();
    render();
  }
}

async function deleteHotelInfoItem(itemId) {
  const item = (state.hotelInfoItems || []).find(i => i.id === itemId);
  if (!item) return;
  if (!confirm(`Supprimer l'info « ${item.title} » ?`)) return;
  const data = await api(`/hotel-info/items/${itemId}`, { method: 'DELETE' });
  if (data) {
    showToast('Info supprimée', 'success');
    await loadHotelInfo();
    render();
  }
}

// ============================================
// HOTELS VIEW (Super Admin)
// ============================================
function renderHotelsView() {
  return `
  <div class="fade-in">
    <!-- Header premium -->
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
      <div>
        <p class="section-eyebrow mb-2">Établissements</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Hôtels</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">${state.hotels.length} hôtel${state.hotels.length > 1 ? 's' : ''} dans le portefeuille</p>
      </div>
      <button onclick="showHotelForm()" class="btn-premium self-start sm:self-auto px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;">
        <i class="fas fa-plus text-xs"></i>Nouvel hôtel
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      ${state.hotels.length === 0 ? `
        <div class="md:col-span-2 xl:col-span-3 card-premium empty-state-premium">
          <div class="empty-icon"><i class="fas fa-hotel"></i></div>
          <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucun hôtel enregistré</p>
          <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Cliquez sur « Nouvel hôtel » pour commencer.</p>
        </div>
      ` : state.hotels.map(h => `
        <div class="card-premium p-5">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy);">
              <i class="fas fa-hotel text-lg" style="color: var(--c-gold);"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-display font-semibold text-lg truncate" style="color: var(--c-navy);">${escapeHtml(h.name)}</h3>
              ${h.address ? `<p class="text-sm mt-1" style="color: rgba(15,27,40,0.6);"><i class="fas fa-map-marker-alt mr-1" style="color: var(--c-gold);"></i>${escapeHtml(h.address)}</p>` : `<p class="text-sm italic mt-1" style="color: rgba(15,27,40,0.35);">Adresse non renseignée</p>`}
              <p class="text-[11px] uppercase tracking-wider mt-2.5" style="color: rgba(15,27,40,0.4);"><i class="fas fa-calendar mr-1" style="color: var(--c-gold);"></i>Créé le ${formatDate(h.created_at)}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-4 pt-4" style="border-top: 1px solid var(--c-line);">
            <button onclick="showHotelEditForm(${h.id}, '${h.name.replace(/'/g, "\\'")}', '${(h.address || '').replace(/'/g, "\\'")}')"
              class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-all" style="background: var(--c-cream-deep); color: var(--c-navy);" onmouseover="this.style.background='var(--c-gold)'" onmouseout="this.style.background='var(--c-cream-deep)'">
              <i class="fas fa-pen"></i>Modifier
            </button>
            <button onclick="showHotelUsers(${h.id})"
              class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-all" style="background: rgba(201,169,97,0.10); color: var(--c-gold-deep); border: 1px solid rgba(201,169,97,0.20);" onmouseover="this.style.background='rgba(201,169,97,0.20)'" onmouseout="this.style.background='rgba(201,169,97,0.10)'">
              <i class="fas fa-users"></i>Admins
            </button>
            <button onclick="deleteHotel(${h.id}, '${h.name.replace(/'/g, "\\'")}')"
              class="w-9 h-9 flex items-center justify-center rounded-lg transition-all" style="background: rgba(226,125,110,0.10); color: #C84C3F;" onmouseover="this.style.background='rgba(226,125,110,0.20)'" onmouseout="this.style.background='rgba(226,125,110,0.10)'"
              title="Supprimer cet hôtel">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

async function deleteHotel(id, name) {
  if (!confirm(`Supprimer l'hôtel "${name}" ?\n\n⚠️ Cette action supprimera TOUTES les données associées (utilisateurs, procédures, catégories, suggestions, historique). Elle est irréversible.`)) return;
  const result = await api(`/hotels/${id}`, { method: 'DELETE' });
  if (result) {
    await loadData();
    render();
    showToast(`Hôtel "${name}" supprimé`, 'success');
  }
}

function showHotelEditForm(id, name, address) {
  const content = `
  <form onsubmit="event.preventDefault(); updateHotel(${id})">
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nom de l'hôtel *</label>
        <input id="hotel-edit-name" type="text" required value="${name}"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Adresse</label>
        <input id="hotel-edit-address" type="text" value="${address}" placeholder="Adresse complète"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="flex justify-end gap-3 pt-4" style="border-top: 1px solid var(--c-line);">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm transition-colors" style="color: rgba(15,27,40,0.55);">Annuler</button>
        <button type="submit" class="btn-premium px-6 py-2 rounded-lg text-sm font-semibold transition-colors" style="background: var(--c-navy); color: #fff;">
          <i class="fas fa-save mr-1.5"></i>Enregistrer
        </button>
      </div>
    </div>
  </form>`;
  showModal(`Modifier — ${name}`, content);
}

async function updateHotel(id) {
  const data = {
    name: document.getElementById('hotel-edit-name').value.trim(),
    address: document.getElementById('hotel-edit-address').value.trim()
  };
  const result = await api(`/hotels/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Hôtel mis à jour', 'success');
  }
}

function showHotelUsers(hotelId) {
  // Filtre les users de cet hôtel et navigue vers la vue users
  state.usersFilterHotel = String(hotelId);
  navigate('users');
}

// ============================================
// TEMPLATES VIEW (Super Admin)
// ============================================
function renderTemplatesView() {
  return `
  <div class="fade-in">
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
      <div>
        <p class="section-eyebrow mb-2">Bibliothèque</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Templates</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.55);">Modèles de procédures réutilisables pour vos hôtels</p>
      </div>
      <button onclick="showTemplateForm()" class="btn-premium px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 self-start sm:self-auto" style="background: var(--c-navy); color: #fff;">
        <i class="fas fa-plus text-xs"></i>Nouveau template
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${state.templates.length === 0 ? `
        <div class="md:col-span-2 lg:col-span-3 card-premium empty-state-premium">
          <div class="empty-icon"><i class="fas fa-copy"></i></div>
          <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucun template</p>
          <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Créez un modèle pour gagner du temps sur les procédures récurrentes.</p>
        </div>
      ` : state.templates.map(t => {
        const steps = JSON.parse(t.steps_json || '[]');
        return `
        <div class="card-premium p-5">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy);">
              <i class="fas fa-copy" style="color: var(--c-gold);"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-display font-semibold" style="color: var(--c-navy);">${escapeHtml(t.name)}</h4>
              ${t.category_name ? `<span class="pill-gold mt-1.5">${escapeHtml(t.category_name)}</span>` : ''}
            </div>
          </div>
          ${t.description ? `<p class="text-sm mb-3 whitespace-pre-wrap" style="color: rgba(15,27,40,0.65);">${escapeHtml(t.description)}</p>` : (t.trigger_event ? `<p class="text-sm mb-3 whitespace-pre-wrap" style="color: rgba(15,27,40,0.65);">${escapeHtml(t.trigger_event)}</p>` : '')}
          <div class="flex items-center justify-between pt-3" style="border-top: 1px solid var(--c-line);">
            <span class="text-[11px] uppercase tracking-wider" style="color: rgba(15,27,40,0.45);"><i class="fas fa-list mr-1" style="color: var(--c-gold);"></i>${steps.length} étapes</span>
            <button onclick="deleteTemplate(${t.id})" class="text-xs transition-colors" style="color: #C84C3F;">
              <i class="fas fa-trash mr-1"></i>Supprimer
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

async function deleteTemplate(id) {
  if (!confirm('Supprimer ce template ?')) return;
  await api(`/templates/${id}`, { method: 'DELETE' });
  await loadData();
  render();
  showToast('Template supprimé', 'success');
}

// ============================================
// CONVERSATIONS — Vue principale
// ============================================

// Suggestions de salons par groupe (cliquables à la création)
const CHANNEL_SUGGESTIONS = {
  'Espaces communs': [
    { name: 'réception', icon: 'fa-bell-concierge' },
    { name: 'restaurant', icon: 'fa-utensils' },
    { name: 'bar', icon: 'fa-martini-glass' },
    { name: 'piscine', icon: 'fa-water-ladder' },
    { name: 'parking', icon: 'fa-square-parking' },
    { name: 'spa', icon: 'fa-spa' },
    { name: 'salle-de-sport', icon: 'fa-dumbbell' },
    { name: 'lobby', icon: 'fa-couch' },
    { name: 'terrasse', icon: 'fa-umbrella-beach' },
    { name: 'jardin', icon: 'fa-tree' }
  ],
  'Chambres': [
    { name: 'chambre-101', icon: 'fa-bed' },
    { name: 'chambre-102', icon: 'fa-bed' },
    { name: 'chambre-103', icon: 'fa-bed' },
    { name: 'chambre-201', icon: 'fa-bed' },
    { name: 'chambre-202', icon: 'fa-bed' },
    { name: 'suite-301', icon: 'fa-bed' },
    { name: 'suite-junior', icon: 'fa-bed' }
  ],
  'Opérationnel': [
    { name: 'ménage', icon: 'fa-broom' },
    { name: 'technique', icon: 'fa-screwdriver-wrench' },
    { name: 'cuisine', icon: 'fa-kitchen-set' },
    { name: 'urgence', icon: 'fa-triangle-exclamation' },
    { name: 'objets-trouvés', icon: 'fa-magnifying-glass' },
    { name: 'linge', icon: 'fa-shirt' },
    { name: 'sécurité', icon: 'fa-shield-halved' },
    { name: 'maintenance', icon: 'fa-wrench' },
    { name: 'planning', icon: 'fa-calendar-days' }
  ]
};

