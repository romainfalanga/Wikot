// ============================================
// WIKOT MODULE — 02-auth
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

// ============================================
// AUTH
// ============================================
async function login(email, password) {
  const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (data) {
    state.token = data.token;
    state.user = data.user;
    state.currentHotelId = data.user.hotel_id;
    // Super admin → dashboard infrastructure ; admin et employé → procédures (dashboard admin retiré)
    // Super admin → dashboard infra ; admin & employés → Wikot (chatbot) en page d'accueil
    state.currentView = data.user.role === 'super_admin' ? 'dashboard' : 'wikot';
    localStorage.setItem('wikot_token', data.token);
    localStorage.setItem('wikot_user', JSON.stringify(data.user));
    showToast(`Bienvenue ${data.user.name} !`, 'success');
    await loadData();
    // Ancrage de l'historique sur la vue de départ après login
    replaceHistory(state.currentView);
    render();
    ensureChatGlobalPolling();
    ensureProfilePolling();
  }
}

// ============================================
// PROFILE SYNC — Rafraîchissement périodique du profil utilisateur
// Détecte automatiquement les changements de droits (can_edit_procedures, role,
// is_active) appliqués par un admin sans nécessiter de reconnexion.
// ============================================
let profilePollingTimer = null;

function ensureProfilePolling() {
  if (profilePollingTimer) return;
  if (!state.token || !state.user) return;
  // Polling toutes les 20s — léger (1 seule requête, juste la fiche utilisateur)
  profilePollingTimer = setInterval(syncUserProfile, 20000);
  // Refresh immédiat quand l'utilisateur revient sur l'onglet (focus / visibility)
  if (!window._wikotProfileVisListener) {
    window._wikotProfileVisListener = () => {
      if (document.visibilityState === 'visible' && state.token && state.user) {
        syncUserProfile();
      }
    };
    document.addEventListener('visibilitychange', window._wikotProfileVisListener);
    window.addEventListener('focus', window._wikotProfileVisListener);
  }
}

function stopProfilePolling() {
  if (profilePollingTimer) {
    clearInterval(profilePollingTimer);
    profilePollingTimer = null;
  }
}

async function syncUserProfile() {
  if (!state.token || !state.user) return;
  // Appel silencieux — pas de toast d'erreur si le réseau est en vrac
  // cache: 'no-store' + timestamp pour éviter tout cache navigateur/CDN
  let data;
  try {
    const res = await fetch(`${API}/auth/me?_=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) return;
    data = await res.json();
  } catch (e) { return; }

  if (!data || !data.user) return;
  const fresh = data.user;
  const old = state.user;

  // Coercion stricte en nombre pour éviter les comparaisons foireuses
  // (D1 peut renvoyer 0/1 ou "0"/"1" selon la sérialisation)
  const freshCanEdit = Number(fresh.can_edit_procedures) === 1 ? 1 : 0;
  const oldCanEdit = Number(old.can_edit_procedures) === 1 ? 1 : 0;
  const freshIsActive = Number(fresh.is_active);

  // Cas 1 : compte désactivé → déconnexion forcée
  if (freshIsActive === 0) {
    showToast('Votre compte a été désactivé. Déconnexion...', 'warning');
    setTimeout(() => logout(), 1500);
    return;
  }

  // Cas 2 : changement de rôle ou de droits d'édition
  const roleChanged = fresh.role !== old.role;
  const editRightsChanged = freshCanEdit !== oldCanEdit;
  const hotelChanged = fresh.hotel_id !== old.hotel_id;

  if (roleChanged || editRightsChanged || hotelChanged) {
    // Remplacement complet (pas de merge) pour éviter de garder d'anciens champs fantômes
    state.user = {
      id: fresh.id,
      hotel_id: fresh.hotel_id,
      email: fresh.email,
      name: fresh.name,
      role: fresh.role,
      can_edit_procedures: freshCanEdit,
      is_active: freshIsActive
    };
    localStorage.setItem('wikot_user', JSON.stringify(state.user));

    // Si les droits d'édition ont été retirés et qu'on était dans une vue/action
    // qui les requérait, on revient à une vue safe pour éviter les boutons fantômes.
    if (editRightsChanged && freshCanEdit === 0) {
      // Fermer un éventuel modal d'édition ouvert
      try { closeModal(); } catch (e) {}
      // Si on était en train d'éditer une procédure, revenir à la liste
      if (state.currentView === 'procedures' && state.selectedProcedure && state.editingProcedure) {
        state.editingProcedure = null;
      }
    }

    // Message adapté
    if (editRightsChanged) {
      if (freshCanEdit === 1) {
        showToast('Vos droits ont été mis à jour : vous pouvez maintenant créer/modifier des procédures et gérer les salons.', 'success');
      } else {
        showToast('Vos droits d\'édition ont été retirés.', 'warning');
      }
    } else if (roleChanged) {
      showToast(`Votre rôle a été modifié : ${fresh.role}`, 'info');
    } else if (hotelChanged) {
      showToast('Votre hôtel d\'affectation a été modifié.', 'info');
    }

    // Recharger les données et re-render pour refléter les nouveaux droits
    await loadData();
    render();
  }
}

function logout() {
  // Stopper tous les pollings chat AVANT de nettoyer le state
  try { stopChatPolling(); } catch (e) {}
  try {
    if (typeof chatGlobalPollingTimer !== 'undefined' && chatGlobalPollingTimer) {
      clearInterval(chatGlobalPollingTimer);
      chatGlobalPollingTimer = null;
    }
  } catch (e) {}
  // Stopper le polling profil
  try { stopProfilePolling(); } catch (e) {}

  // Reset complet du state
  state.token = null;
  state.user = null;
  state.currentView = 'dashboard';
  state.selectedChannelId = null;
  state.selectedProcedure = null;
  state.chatMessages = [];
  state.chatChannels = [];
  state.chatGroups = [];
  state.unreadChatTotal = 0;
  state.chatLastLoadedAt = null;
  state.procedures = [];
  state.categories = [];
  state.users = [];
  state.hotels = [];
  state.stats = {};


  // Nettoyer le localStorage
  localStorage.removeItem('wikot_token');
  localStorage.removeItem('wikot_user');

  // Fermer le sidebar mobile s'il est ouvert
  document.body.classList.remove('sidebar-open');

  render();
}

// ============================================
// DATA LOADING
// ============================================
async function loadData() {
  if (!state.token) return;
  const hotelParam = state.currentHotelId ? `?hotel_id=${state.currentHotelId}` : '';
  
  // Super admin : uniquement stats + hôtels + users (pas de procédures/templates/historique)
  if (state.user.role === 'super_admin') {
    const [statsData, hotelsData, usersData] = await Promise.all([
      api('/stats'),
      api('/hotels'),
      api('/users')
    ]);
    if (statsData) state.stats = statsData;
    if (hotelsData) state.hotels = hotelsData.hotels || [];
    if (usersData) state.users = usersData.users || [];
    return;
  }

  // Admin / Employee : chargement complet
  // /procedures      → uniquement les procédures principales (is_subprocedure=0)
  // /procedures?include_subprocedures=1 → toutes (utile pour le picker du modal)
  // Pages "Rechercher" et "Historique" (changelog) supprimées : Wikot remplit
  // le rôle de recherche, donc on n'appelle plus /changelog au boot.
  const subParam = hotelParam ? `${hotelParam}&include_subprocedures=1` : '?include_subprocedures=1';
  const [statsData, categoriesData, proceduresData, allProcsData] = await Promise.all([
    api(`/stats${hotelParam}`),
    api(`/categories${hotelParam}`),
    api(`/procedures${hotelParam}`),
    api(`/procedures${subParam}`)
  ]);

  if (statsData) state.stats = statsData;
  if (categoriesData) state.categories = categoriesData.categories || [];
  if (proceduresData) state.procedures = proceduresData.procedures || [];
  // state.subprocedures contient uniquement les procédures marquées is_subprocedure=1
  if (allProcsData) {
    const all = allProcsData.procedures || [];
    state.subprocedures = all.filter(p => p.is_subprocedure === 1 || p.is_subprocedure === true);
  }

  if (state.user.role === 'admin') {
    const usersData = await api('/users');
    if (usersData) state.users = usersData.users || [];
  }
  // Charger les rôles métiers (cache state.jobRoles utilisé par les modales user/job-roles)
  if (typeof loadJobRoles === 'function') {
    await loadJobRoles();
  }
  // Plus de chargement des suggestions (feature supprimée)

  // Chat — charger groupes, salons et compteur global non-lus
  await loadChatData();

  // Badge sidebar "À faire" : compteur des tâches en attente pour moi
  // (silencieux : si l'endpoint échoue, on ignore — la sidebar reste fonctionnelle)
  if (typeof refreshTaskBadge === 'function') refreshTaskBadge();
}

// ============================================
// CHAT — Data loading
// ============================================
async function loadChatData() {
  if (!state.token || !state.user) return;
  if (state.user.role === 'super_admin') return; // Pas de chat pour super_admin

  const overview = await api('/chat/overview');
  if (overview) {
    state.chatGroups = overview.groups || [];
    // Aplatir tous les channels pour accès facile
    state.chatChannels = [];
    for (const g of state.chatGroups) {
      for (const ch of (g.channels || [])) {
        state.chatChannels.push({ ...ch, group_name: g.name });
      }
    }
    state.unreadChatTotal = overview.total_unread || 0;
    state.chatLastLoadedAt = Date.now();
  }
}

// Refresh léger du compteur global non-lus (pour la sidebar + listes)
// Mise à jour ciblée du DOM — PAS de full re-render pour éviter les flashs visibles
async function refreshChatBadges() {
  if (!state.token || !state.user || state.user.role === 'super_admin') return;
  const overview = await api('/chat/overview');
  if (!overview) return;

  const prevTotal = state.unreadChatTotal;
  state.chatGroups = overview.groups || [];
  state.chatChannels = [];
  for (const g of state.chatGroups) {
    for (const ch of (g.channels || [])) {
      state.chatChannels.push({ ...ch, group_name: g.name });
    }
  }
  state.unreadChatTotal = overview.total_unread || 0;
  state.chatLastLoadedAt = Date.now();

  // Mise à jour ciblée des badges (sidebar, header mobile, bottom nav) — sans flash
  updateSidebarBadges();

  // Si on est sur la liste des salons et que le total a changé, mettre à jour les compteurs in-place
  if (state.currentView === 'conversations' && !state.selectedChannelId && prevTotal !== state.unreadChatTotal) {
    updateChannelListBadges();
  }
}

// Met à jour les pastilles de compteur par salon directement dans le DOM
function updateChannelListBadges() {
  for (const g of (state.chatGroups || [])) {
    for (const ch of (g.channels || [])) {
      const row = document.querySelector(`[data-channel-row="${ch.id}"]`);
      if (!row) continue;
      const badge = row.querySelector('[data-channel-unread]');
      const name = row.querySelector('[data-channel-name]');
      const unread = ch.unread_count || 0;
      if (badge) {
        if (unread > 0) {
          badge.textContent = `${unread > 99 ? '99+' : unread} non lu${unread > 1 ? 's' : ''}`;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
      if (name) {
        if (unread > 0) name.classList.add('font-bold');
        else name.classList.remove('font-bold');
      }
    }
    // Compteur du groupe
    const groupCard = document.querySelector(`[data-group-card="${g.id}"]`);
    if (groupCard) {
      const groupBadge = groupCard.querySelector('[data-group-unread]');
      const groupUnread = (g.channels || []).reduce((s, c) => s + (c.unread_count || 0), 0);
      if (groupBadge) {
        if (groupUnread > 0) {
          groupBadge.innerHTML = ` · <span class="text-red-500 font-semibold">${groupUnread} non lu${groupUnread > 1 ? 's' : ''}</span>`;
        } else {
          groupBadge.innerHTML = '';
        }
      }
    }
  }
}

function updateSidebarBadges() {
  // Mise à jour ciblée des pastilles "Conversations" sans full re-render
  document.querySelectorAll('[data-badge-conversations]').forEach(el => {
    const count = state.unreadChatTotal;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : count;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

// ============================================
// RENDER ENGINE
// ============================================
function render() {
  const app = document.getElementById('app');
  // Si un staff est connecté, afficher l'app staff (espace équipe — seul espace de l'app)
  if (state.token && state.user) {
    app.innerHTML = renderMainLayout();
    return;
  }
  // Sinon : page de login espace équipe
  app.innerHTML = renderLoginPage();
}

