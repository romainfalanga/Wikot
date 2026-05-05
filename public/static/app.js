// ============================================
// WIKOT - Hotel Procedure Management System
// Frontend Application
// ============================================

const API = '/api';
let state = {
  token: localStorage.getItem('wikot_token'),
  user: JSON.parse(localStorage.getItem('wikot_user') || 'null'),
  currentView: 'dashboard',
  currentHotelId: null,
  procedures: [],
  categories: [],
  suggestions: [],
  changelog: [],
  templates: [],
  users: [],
  hotels: [],
  stats: {},
  selectedProcedure: null,
  searchQuery: '',
  filterCategory: '',
  unreadRequired: 0,
  // Chat
  chatGroups: [],
  chatChannels: [],
  unreadChatTotal: 0,
  selectedChannelId: null,
  chatMessages: [],
  chatPollingTimer: null,
  chatLastMessageId: null,
  // Hotel Info
  hotelInfoCategories: [],
  hotelInfoItems: [],
  hotelInfoSearchQuery: '',
  hotelInfoActiveCategory: null,
  hotelInfoLoaded: false,
  // Wikot AI Agent — état séparé par mode (standard / max)
  // Wikot classique (lecture / sourcing)
  wikotConversations: [],
  wikotCurrentConvId: null,
  wikotMessages: [],
  wikotActions: [],
  wikotLoading: false,
  wikotSending: false,
  wikotSidebarOpen: false,
  _wikotInitialLoad: false,
  // Wikot Max (rédaction / création / modification)
  wikotMaxConversations: [],
  wikotMaxCurrentConvId: null,
  wikotMaxMessages: [],
  wikotMaxActions: [],
  wikotMaxLoading: false,
  wikotMaxSending: false,
  wikotMaxSidebarOpen: false,
  _wikotMaxInitialLoad: false
};

// ============================================
// API HELPERS
// ============================================
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  try {
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json();
    if (res.status === 401) { logout(); return null; }
    if (!res.ok) { showToast(data.error || 'Erreur', 'error'); return null; }
    return data;
  } catch (e) {
    showToast('Erreur de connexion', 'error');
    return null;
  }
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'info') {
  const colors = { info: 'bg-blue-500', success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500' };
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle' };
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 z-[9999] ${colors[type]} text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-3 fade-in max-w-md`;
  toast.innerHTML = `<i class="fas ${icons[type]}"></i><span class="text-sm font-medium">${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// Helper: can current user edit/create procedures?
function userCanEditProcedures() {
  if (!state.user) return false;
  return state.user.role === 'super_admin' || state.user.role === 'admin' || state.user.can_edit_procedures === 1;
}

// Helper: can current user edit/create hotel info (catégories + items) ?
function userCanEditInfo() {
  if (!state.user) return false;
  return state.user.role === 'super_admin' || state.user.role === 'admin' || state.user.can_edit_info === 1;
}

// Helper: can current user manage chat channels (créer / modifier / organiser les salons) ?
function userCanManageChat() {
  if (!state.user) return false;
  return state.user.role === 'admin' || state.user.can_manage_chat === 1;
}

// ============================================
// AUTH
// ============================================
async function login(email, password) {
  const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (data) {
    state.token = data.token;
    state.user = data.user;
    state.currentHotelId = data.user.hotel_id;
    // Les employés n'ont pas de dashboard → démarrer sur procédures
    state.currentView = data.user.role === 'employee' ? 'procedures' : 'dashboard';
    localStorage.setItem('wikot_token', data.token);
    localStorage.setItem('wikot_user', JSON.stringify(data.user));
    showToast(`Bienvenue ${data.user.name} !`, 'success');
    await loadData();
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
  state.unreadRequired = 0;

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
  const [statsData, categoriesData, proceduresData, changelogData] = await Promise.all([
    api(`/stats${hotelParam}`),
    api(`/categories${hotelParam}`),
    api(`/procedures${hotelParam}`),
    api(`/changelog${hotelParam}`)
  ]);

  if (statsData) state.stats = statsData;
  if (categoriesData) state.categories = categoriesData.categories || [];
  if (proceduresData) state.procedures = proceduresData.procedures || [];
  if (changelogData) {
    state.changelog = changelogData.changelog || [];
    state.unreadRequired = changelogData.unread_required || 0;
  }

  if (state.user.role === 'admin') {
    const usersData = await api('/users');
    if (usersData) state.users = usersData.users || [];
  }
  // Plus de chargement des suggestions (feature supprimée)

  // Chat — charger groupes, salons et compteur global non-lus
  await loadChatData();
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
  if (!state.token || !state.user) {
    app.innerHTML = renderLoginPage();
    return;
  }
  app.innerHTML = renderMainLayout();
}

// ============================================
// LOGIN PAGE
// ============================================
function renderLoginPage() {
  return `
  <div class="min-h-screen bg-gradient-to-br from-navy-900 via-navy-800 to-navy-700 flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8 fade-in">
        <div class="inline-flex items-center justify-center w-20 h-20 bg-brand-400 rounded-2xl shadow-lg mb-4">
          <i class="fas fa-concierge-bell text-3xl text-white"></i>
        </div>
        <h1 class="text-4xl font-bold text-white tracking-tight">Wik<span class="text-brand-400">ot</span></h1>
        <p class="text-navy-300 mt-2 text-sm">Gestion intelligente des procédures hôtelières</p>
      </div>
      <div class="bg-white rounded-2xl shadow-2xl p-8 fade-in">
        <h2 class="text-xl font-semibold text-navy-800 mb-6">Connexion</h2>
        <form onsubmit="event.preventDefault(); login(document.getElementById('email').value, document.getElementById('password').value)">
          <div class="mb-4">
            <label class="block text-sm font-medium text-navy-600 mb-1.5">Email</label>
            <div class="relative">
              <i class="fas fa-envelope absolute left-3 top-3 text-navy-300"></i>
              <input id="email" type="email" required placeholder="votre@email.com" 
                class="w-full pl-10 pr-4 py-2.5 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none text-sm">
            </div>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-navy-600 mb-1.5">Mot de passe</label>
            <div class="relative">
              <i class="fas fa-lock absolute left-3 top-3 text-navy-300"></i>
              <input id="password" type="password" required placeholder="••••••••" 
                class="w-full pl-10 pr-4 py-2.5 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none text-sm">
            </div>
          </div>
          <button type="submit" class="w-full bg-brand-400 hover:bg-brand-500 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-md">
            <i class="fas fa-sign-in-alt mr-2"></i>Se connecter
          </button>
        </form>
      </div>
    </div>
  </div>`;
}

// ============================================
// MAIN LAYOUT
// ============================================
function renderMainLayout() {
  const isSuperAdmin = state.user.role === 'super_admin';
  const isAdmin = state.user.role === 'admin';
  const isEmployee = state.user.role === 'employee';

  const canEdit = userCanEditProcedures();

  // Construction du menu selon le rôle
  let menuItems;
  if (isSuperAdmin) {
    // Super admin : infrastructure uniquement
    menuItems = [
      { id: 'dashboard', icon: 'fa-gauge-high', label: 'Tableau de bord' },
      { id: 'hotels', icon: 'fa-hotel', label: 'Hôtels' },
      { id: 'users', icon: 'fa-users', label: 'Utilisateurs' },
    ];
  } else if (isAdmin) {
    // Admin hôtel : tout sauf suggestions ; les admins ont accès à Back Wikot
    menuItems = [
      { id: 'dashboard', icon: 'fa-gauge-high', label: 'Tableau de bord' },
      { id: 'wikot', icon: 'fa-robot', label: 'Wikot' },
      { id: 'wikot-max', icon: 'fa-pen-ruler', label: 'Back Wikot' },
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'search', icon: 'fa-magnifying-glass', label: 'Rechercher' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      { id: 'changelog', icon: 'fa-clock-rotate-left', label: 'Historique', badge: state.unreadRequired },
      { id: 'users', icon: 'fa-users', label: 'Utilisateurs' },
    ];
  } else {
    // Employé : Wikot pour tous, Back Wikot uniquement si peut éditer procédures OU informations
    const canUseMax = userCanEditProcedures() || userCanEditInfo();
    menuItems = [
      { id: 'wikot', icon: 'fa-robot', label: 'Wikot' },
      ...(canUseMax ? [{ id: 'wikot-max', icon: 'fa-pen-ruler', label: 'Back Wikot' }] : []),
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'search', icon: 'fa-magnifying-glass', label: 'Rechercher' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      { id: 'changelog', icon: 'fa-clock-rotate-left', label: 'Historique', badge: state.unreadRequired },
    ];
  }

  const roleLabels = { super_admin: 'Super Admin', admin: 'Administrateur', employee: canEdit ? 'Employé (éditeur)' : 'Employé' };
  const roleColors = { super_admin: 'bg-purple-100 text-purple-700', admin: 'bg-blue-100 text-blue-700', employee: canEdit ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700' };

  // Titre de la vue active pour le header mobile
  const viewTitles = {
    dashboard: 'Tableau de bord',
    wikot: 'Wikot',
    'wikot-max': 'Back Wikot',
    procedures: 'Procédures',
    search: 'Rechercher',
    info: 'Informations',
    conversations: 'Conversations',
    changelog: 'Historique',
    users: 'Utilisateurs',
    hotels: 'Hôtels',
    templates: 'Modèles',
  };
  const currentTitle = viewTitles[state.currentView] || 'Wikot';

  // Bottom nav mobile : prioriser les items selon l'usage. Conversations DOIT y être pour les employés.
  // On limite à 5 max, en gardant les plus utilisés.
  let bottomNavItems;
  if (isSuperAdmin) {
    bottomNavItems = menuItems; // 3 items, tous tiennent
  } else {
    // Admin et employé : on priorise Wikot, Back Wikot (si dispo), Procédures, Infos, Conversations
    // 5 items max — on garde l'ordre pour rester cohérent avec la sidebar desktop
    const priorityIds = userCanUseWikotMax()
      ? ['wikot','wikot-max','procedures','info','conversations']
      : ['wikot','procedures','info','conversations','search'];
    bottomNavItems = priorityIds
      .map(id => menuItems.find(i => i.id === id))
      .filter(Boolean)
      .slice(0, 5);
  }

  return `
  <!-- Overlay mobile sidebar -->
  <div id="sidebar-overlay" class="fixed inset-0 bg-black/50 z-30 hidden lg:hidden" onclick="closeSidebar()"></div>

  <div class="flex app-shell overflow-hidden">
    <!-- Sidebar -->
    <aside id="main-sidebar" class="fixed lg:relative z-40 lg:z-auto -translate-x-full lg:translate-x-0 transition-transform duration-300 w-72 lg:w-64 bg-navy-900 text-white flex flex-col shrink-0 h-full">
      <div class="p-5 border-b border-navy-700">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-brand-400 rounded-xl flex items-center justify-center shadow">
              <i class="fas fa-concierge-bell text-white"></i>
            </div>
            <div>
              <h1 class="text-lg font-bold tracking-tight">Wik<span class="text-brand-400">ot</span></h1>
              <p class="text-[10px] text-navy-400 uppercase tracking-wider">Procédures Hôtelières</p>
            </div>
          </div>
          <button onclick="closeSidebar()" class="lg:hidden text-navy-400 hover:text-white p-1">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
      
      <nav class="flex-1 py-4 overflow-y-auto">
        ${menuItems.map(item => `
          <button onclick="navigate('${item.id}'); closeSidebar()" 
            class="sidebar-item ${state.currentView === item.id ? 'active' : ''} w-full text-left px-5 py-3 flex items-center gap-3 text-sm text-navy-200 hover:text-white">
            <i class="fas ${item.icon} w-5 text-center text-xs ${state.currentView === item.id ? 'text-brand-400' : ''}"></i>
            <span>${item.label}</span>
            <span ${item.id === 'conversations' ? 'data-badge-conversations' : ''} class="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.badge ? '' : 'hidden'}">${item.badge ? (item.badge > 99 ? '99+' : item.badge) : ''}</span>
          </button>
        `).join('')}
      </nav>

      <div class="p-4 border-t border-navy-700">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-9 h-9 bg-navy-600 rounded-full flex items-center justify-center text-sm font-semibold shrink-0">
            ${state.user.name.charAt(0)}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">${state.user.name}</p>
            <span class="text-[10px] px-1.5 py-0.5 rounded ${roleColors[state.user.role]}">${roleLabels[state.user.role]}</span>
          </div>
        </div>
        <button onclick="showChangePasswordModal()" class="w-full text-left text-xs text-navy-400 hover:text-brand-400 transition-colors flex items-center gap-2 px-1 mb-2">
          <i class="fas fa-key"></i> Changer de mot de passe
        </button>
        <button onclick="logout()" class="w-full text-left text-xs text-navy-400 hover:text-red-400 transition-colors flex items-center gap-2 px-1">
          <i class="fas fa-sign-out-alt"></i> Déconnexion
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <!-- Header mobile avec burger + titre vue active + badges -->
      <div class="lg:hidden sticky top-0 z-20 bg-white border-b border-gray-200 px-3 sm:px-4 h-14 flex items-center gap-3 shadow-sm shrink-0">
        <button onclick="openSidebar()" class="w-9 h-9 flex items-center justify-center rounded-lg bg-navy-50 hover:bg-navy-100 text-navy-600 transition-colors shrink-0">
          <i class="fas fa-bars"></i>
        </button>
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <div class="w-7 h-7 bg-brand-400 rounded-lg flex items-center justify-center shrink-0">
            <i class="fas fa-concierge-bell text-white text-xs"></i>
          </div>
          <span class="font-bold text-navy-800 truncate">${currentTitle}</span>
        </div>
        <div class="ml-auto flex items-center gap-2 shrink-0">
          <button onclick="navigate('conversations')" class="relative w-9 h-9 flex items-center justify-center rounded-lg bg-navy-50 text-navy-600 ${state.unreadChatTotal > 0 ? '' : 'hidden'}" title="Messages non lus" data-mobile-chat-btn>
            <i class="fas fa-comments"></i>
            <span data-badge-conversations class="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center">${state.unreadChatTotal > 0 ? (state.unreadChatTotal > 99 ? '99+' : state.unreadChatTotal) : ''}</span>
          </button>
          ${state.unreadRequired > 0 ? `<button onclick="navigate('changelog')" class="relative w-9 h-9 flex items-center justify-center rounded-lg bg-red-50 text-red-500" title="Changements à lire">
            <i class="fas fa-bell"></i>
            <span class="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center">${state.unreadRequired}</span>
          </button>` : ''}
          <div class="w-8 h-8 bg-navy-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">${state.user.name.charAt(0)}</div>
        </div>
      </div>

      <div id="main-content-container" class="flex-1 ${state.currentView === 'conversations' ? 'overflow-hidden w-full' : 'p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full mobile-content-padding'}">
        ${renderCurrentView()}
      </div>
    </main>
  </div>

  <!-- Bottom navigation (mobile uniquement) -->
  <nav class="mobile-bottomnav lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-navy-900 border-t border-navy-700 flex">
    ${bottomNavItems.slice(0, 5).map(item => `
      <button onclick="navigate('${item.id}')" class="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative ${state.currentView === item.id ? 'text-brand-400' : 'text-navy-400'} hover:text-white transition-colors">
        <i class="fas ${item.icon} text-base"></i>
        <span class="text-[10px] font-medium leading-none mt-0.5">${item.label.split(' ')[0]}</span>
        <span ${item.id === 'conversations' ? 'data-badge-conversations' : ''} class="absolute top-1 right-1/4 bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[14px] text-center leading-none ${item.badge ? '' : 'hidden'}">${item.badge ? (item.badge > 99 ? '99+' : item.badge) : ''}</span>
      </button>
    `).join('')}
  </nav>

  <!-- Modal Container -->
  <div id="modal-container"></div>`;
}

function openSidebar() {
  document.getElementById('main-sidebar')?.classList.remove('-translate-x-full');
  document.getElementById('sidebar-overlay')?.classList.remove('hidden');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.getElementById('main-sidebar')?.classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
  document.body.classList.remove('sidebar-open');
}

function navigate(view) {
  // Si on quitte la vue conversations, stopper le polling messages
  if (state.currentView === 'conversations' && view !== 'conversations') {
    stopChatPolling();
    state.selectedChannelId = null;
    state.chatMessages = [];
  }
  state.currentView = view;
  state.selectedProcedure = null;

  // Pour la vue conversations : si on a déjà les données récentes (< 30s), on render direct.
  // Sinon, on charge AVANT de render pour éviter le double flash.
  if (view === 'conversations') {
    const fresh = state.chatGroups && state.chatGroups.length > 0
      && state.chatLastLoadedAt && (Date.now() - state.chatLastLoadedAt) < 30000;
    if (fresh) {
      render();
    } else {
      // Affiche un état chargement très léger, puis charge, puis render avec les vraies données
      showChatLoadingPlaceholder();
      loadChatData().then(() => render());
    }
  } else {
    render();
  }
  // Lancer le polling léger global pour les badges si on est connecté (chat actif)
  ensureChatGlobalPolling();
}

// Placeholder de chargement minimal pour la vue conversations (évite le flash visible)
function showChatLoadingPlaceholder() {
  // Render normal du layout, mais avec un état de chargement discret dans le contenu
  render();
  const container = document.getElementById('main-content-container');
  if (container && state.currentView === 'conversations' && (!state.chatGroups || state.chatGroups.length === 0)) {
    // Le render a déjà affiché "Aucun salon" — on remplace par un loader subtil
    const target = container.querySelector('.fade-in') || container;
    if (target) {
      const existingList = target.querySelector('.flex-1.overflow-y-auto');
      if (existingList) {
        existingList.innerHTML = `
          <div class="flex items-center justify-center py-10">
            <div class="text-navy-300 text-sm flex items-center gap-2">
              <i class="fas fa-circle-notch fa-spin"></i>
              <span>Chargement des conversations...</span>
            </div>
          </div>`;
      }
    }
  }
}


// ============================================
// VIEW ROUTER
// ============================================
function renderCurrentView() {
  switch (state.currentView) {
    case 'dashboard': return renderDashboard();
    case 'wikot': return renderWikotView('standard');
    case 'wikot-max': return renderWikotView('max');
    case 'procedures': return state.selectedProcedure ? renderProcedureDetail() : renderProceduresList();
    case 'search': return renderSearchView();
    case 'info': return renderHotelInfoView();
    case 'changelog': return renderChangelogView();
    case 'conversations': return renderConversationsView();
    case 'users': return renderUsersView();
    case 'hotels': return renderHotelsView();
    case 'templates': return renderTemplatesView();
    case 'procedure-detail': return renderProcedureDetail();
    default: return renderDashboard();
  }
}

// ============================================
// DASHBOARD
// ============================================
function renderDashboard() {
  const s = state.stats;
  const isSuperAdmin = state.user.role === 'super_admin';

  if (isSuperAdmin) {
    return `
    <div class="fade-in">
      <div class="mb-6 sm:mb-8">
        <h2 class="text-xl sm:text-2xl font-bold text-navy-900">Tableau de bord <span class="text-brand-400">Super Admin</span></h2>
        <p class="text-navy-500 mt-1 text-sm">Gestion de la plateforme — hôtels &amp; administrateurs</p>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:gap-5 mb-6 sm:mb-8">
        ${statCard('fa-hotel', 'Hôtels actifs', s.hotels || 0, 'bg-blue-500')}
        ${statCard('fa-users', 'Utilisateurs total', s.users || 0, 'bg-green-500')}
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <h3 class="text-base sm:text-lg font-semibold text-navy-800"><i class="fas fa-hotel mr-2 text-blue-500"></i>Hôtels enregistrés</h3>
          <button onclick="navigate('hotels')" class="self-start sm:self-auto text-sm bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm flex items-center gap-1.5">
            <i class="fas fa-plus"></i>Nouvel hôtel
          </button>
        </div>
        ${state.hotels.length === 0 ? `
          <div class="text-center py-10">
            <i class="fas fa-hotel text-4xl text-navy-200 mb-3"></i>
            <p class="text-navy-400 font-medium">Aucun hôtel enregistré</p>
            <p class="text-navy-300 text-sm mt-1">Commencez par créer votre premier hôtel</p>
          </div>
        ` : state.hotels.map(h => `
          <div class="flex items-center justify-between py-3 sm:py-3.5 border-b border-gray-50 last:border-0 gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                <i class="fas fa-hotel text-blue-400 text-sm"></i>
              </div>
              <div class="min-w-0">
                <p class="font-medium text-navy-800 truncate">${h.name}</p>
                <p class="text-xs text-navy-400 truncate"><i class="fas fa-map-marker-alt mr-1"></i>${h.address || 'Adresse non renseignée'}</p>
              </div>
            </div>
            <button onclick="navigate('users')" class="shrink-0 text-xs bg-navy-50 hover:bg-navy-100 text-navy-600 px-3 py-1.5 rounded-lg transition-colors">
              <i class="fas fa-users mr-1"></i><span class="hidden sm:inline">Gérer les </span>admins
            </button>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // Admin / Employee dashboard
  return `
  <div class="fade-in">
    <div class="mb-6 sm:mb-8">
      <h2 class="text-xl sm:text-2xl font-bold text-navy-900">Bonjour, <span class="text-brand-400">${state.user.name}</span></h2>
      <p class="text-navy-500 mt-1 text-sm">${state.user.role === 'admin' ? 'Gérez les procédures de votre hôtel' : 'Consultez les procédures à suivre'}</p>
    </div>

    ${state.unreadRequired > 0 ? `
    <div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3 cursor-pointer hover:bg-red-100 transition-colors" onclick="navigate('changelog')">
      <div class="w-9 h-9 sm:w-10 sm:h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
        <i class="fas fa-exclamation-triangle text-red-500 text-sm"></i>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-red-800 text-sm">${state.unreadRequired} changement(s) à lire</p>
        <p class="text-xs text-red-600 mt-0.5">Des procédures ont été mises à jour.</p>
      </div>
      <i class="fas fa-chevron-right text-red-300 mt-1 shrink-0"></i>
    </div>` : ''}

    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5 mb-6 sm:mb-8">
      ${statCard('fa-sitemap', 'Procédures actives', s.active_procedures || 0, 'bg-green-500')}
      ${statCard('fa-file-pen', 'Brouillons', s.draft_procedures || 0, 'bg-yellow-500')}
      ${statCard('fa-users', 'Membres de l\'équipe', s.total_users || 0, 'bg-blue-500')}
    </div>

    <!-- Quick access to categories -->
    <div class="mb-6 sm:mb-8">
      <h3 class="text-base sm:text-lg font-semibold text-navy-800 mb-3 sm:mb-4"><i class="fas fa-th-large mr-2 text-brand-400"></i>Accès rapide par catégorie</h3>
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
        ${state.categories.map(cat => `
          <button onclick="state.filterCategory='${cat.id}'; navigate('procedures')" 
            class="bg-white rounded-xl p-3 sm:p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all text-center group active:scale-95">
            <div class="w-9 h-9 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center mx-auto mb-1.5 sm:mb-2" style="background:${cat.color}15">
              <i class="fas ${cat.icon} text-base sm:text-lg" style="color:${cat.color}"></i>
            </div>
            <p class="text-[10px] sm:text-xs font-medium text-navy-700 leading-tight">${cat.name}</p>
            <p class="text-[9px] sm:text-[10px] text-navy-400">${state.procedures.filter(p => p.category_id == cat.id).length} proc.</p>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Recent changes -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
      <h3 class="text-base sm:text-lg font-semibold text-navy-800 mb-4"><i class="fas fa-clock-rotate-left mr-2 text-navy-400"></i>Derniers changements</h3>
      ${(s.recent_changes || []).length === 0 ? '<p class="text-navy-400 text-sm">Aucun changement récent</p>' :
        (s.recent_changes || []).map(ch => `
          <div class="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
            <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${getActionColor(ch.action)}">
              <i class="fas ${getActionIcon(ch.action)} text-xs"></i>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm text-navy-700 leading-snug">${ch.summary}</p>
              <p class="text-xs text-navy-400 mt-0.5">${ch.user_name} · ${formatDate(ch.created_at)}</p>
            </div>
          </div>
        `).join('')}
    </div>
  </div>`;
}

function statCard(icon, label, value, color) {
  return `
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="w-10 h-10 ${color} bg-opacity-10 rounded-xl flex items-center justify-center">
        <i class="fas ${icon} ${color.replace('bg-', 'text-')}"></i>
      </div>
      <span class="text-2xl font-bold text-navy-900">${value}</span>
    </div>
    <p class="text-xs text-navy-500 font-medium">${label}</p>
  </div>`;
}

async function switchHotel(hotelId) {
  state.currentHotelId = hotelId;
  await loadData();
  render();
  showToast('Hôtel sélectionné', 'success');
}

// ============================================
// PROCEDURES LIST (Tree View)
// ============================================
function renderProceduresList() {
  const canEdit = userCanEditProcedures();
  let filtered = state.procedures;
  if (state.filterCategory) filtered = filtered.filter(p => p.category_id == state.filterCategory);

  // Group by category
  const grouped = {};
  filtered.forEach(p => {
    const catName = p.category_name || 'Sans catégorie';
    if (!grouped[catName]) grouped[catName] = { icon: p.category_icon || 'fa-folder', color: p.category_color || '#6B7280', procedures: [] };
    grouped[catName].procedures.push(p);
  });

  return `
  <div class="fade-in">
    <!-- Header responsive -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-navy-900"><i class="fas fa-sitemap mr-2 text-brand-400"></i>Procédures</h2>
        <p class="text-navy-500 text-sm mt-1">${filtered.length} procédure(s)</p>
      </div>
      ${canEdit ? `
      <button onclick="showProcedureForm()" class="self-start sm:self-auto bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5">
        <i class="fas fa-plus"></i>Nouvelle procédure
      </button>` : ''}
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-3 sm:p-4 mb-6">
      <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <select onchange="state.filterCategory=this.value; render()" class="flex-1 text-sm border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
          <option value="">Toutes les catégories</option>
          ${state.categories.map(c => `<option value="${c.id}" ${state.filterCategory == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
        ${state.filterCategory ? `
        <button onclick="state.filterCategory=''; render()" class="text-xs text-red-500 hover:text-red-700 flex items-center justify-center gap-1 px-3 py-2 border border-red-200 rounded-lg">
          <i class="fas fa-times"></i>Réinitialiser
        </button>` : ''}
      </div>
    </div>

    <!-- Tree View -->
    <div class="space-y-4">
      ${Object.keys(grouped).length === 0 ? `
        <div class="bg-white rounded-xl p-10 sm:p-12 text-center border border-gray-100">
          <i class="fas fa-sitemap text-4xl text-navy-200 mb-4"></i>
          <p class="text-navy-400 font-medium">Aucune procédure trouvée</p>
          ${canEdit ? '<p class="text-sm text-navy-300 mt-1">Créez votre première procédure</p>' : ''}
        </div>
      ` : Object.entries(grouped).map(([catName, catData]) => `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="px-4 sm:px-5 py-3 border-b border-gray-100 flex items-center gap-3" style="background:${catData.color}08">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background:${catData.color}15">
              <i class="fas ${catData.icon} text-sm" style="color:${catData.color}"></i>
            </div>
            <h3 class="font-semibold text-navy-800 truncate">${catName}</h3>
            <span class="text-xs bg-navy-100 text-navy-500 px-2 py-0.5 rounded-full ml-auto shrink-0">${catData.procedures.length}</span>
          </div>
          <div class="divide-y divide-gray-50">
            ${catData.procedures.map(proc => renderProcedureCard(proc, canEdit)).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

function renderProcedureCard(proc, canEdit) {
  const trigger = proc.trigger_event || '';

  return `
  <div class="px-4 sm:px-5 py-3 sm:py-4 hover:bg-gray-50 transition-colors cursor-pointer" onclick="viewProcedure(${proc.id})">
    <div class="flex items-start gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-1.5 mb-1">
          <h4 class="font-semibold text-navy-800 text-sm sm:text-base truncate max-w-full">${escapeHtml(proc.title)}</h4>
        </div>
        ${trigger ? `<p class="text-xs sm:text-sm text-navy-600 mb-1 line-clamp-2"><i class="fas fa-bolt text-brand-400 mr-1 text-[10px]"></i>${escapeHtml(trigger)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-2 sm:gap-4 text-[11px] text-navy-400">
          <span><i class="fas fa-list-ol mr-1"></i>${proc.step_count || 0} étape${(proc.step_count || 0) > 1 ? 's' : ''}</span>
          ${proc.condition_count > 0 ? `<span class="hidden sm:inline"><i class="fas fa-code-branch mr-1"></i>${proc.condition_count} cas</span>` : ''}
          <span class="hidden sm:inline">v${proc.version || 1}</span>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${canEdit ? `
          <button onclick="event.stopPropagation(); showProcedureForm(${proc.id})" class="w-8 h-8 rounded-lg bg-navy-50 hover:bg-navy-100 flex items-center justify-center text-navy-400 hover:text-navy-600 transition-colors" title="Modifier">
            <i class="fas fa-pen text-xs"></i>
          </button>
        ` : ''}
        <i class="fas fa-chevron-right text-navy-300 text-xs ml-1"></i>
      </div>
    </div>
  </div>`;
}

// ============================================
// PROCEDURE DETAIL VIEW
// ============================================
async function viewProcedure(id) {
  const data = await api(`/procedures/${id}`);
  if (data) {
    state.selectedProcedure = data;
    state.currentView = 'procedure-detail';
    render();
  }
}

function renderProcedureDetail() {
  if (!state.selectedProcedure) return '<p>Chargement...</p>';
  const { procedure: proc, steps, conditions } = state.selectedProcedure;
  const canEdit = userCanEditProcedures();

  const procDescription = proc.description || '';
  const procTrigger = proc.trigger_event || '';

  return `
  <div class="fade-in">
    <!-- Header -->
    <div class="mb-5 sm:mb-6">
      <button onclick="state.selectedProcedure=null; navigate('procedures')" class="text-sm text-navy-400 hover:text-navy-600 mb-3 inline-flex items-center gap-1.5 transition-colors">
        <i class="fas fa-arrow-left"></i>Retour aux procédures
      </button>
      
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg sm:text-xl font-bold text-navy-900 leading-tight">${escapeHtml(proc.title)}</h2>
            ${procDescription ? `<p class="text-navy-600 text-sm sm:text-base mt-2 leading-relaxed whitespace-pre-wrap">${formatHotelInfoContent(procDescription)}</p>` : ''}
            <div class="flex flex-wrap items-center gap-2 mt-3 text-xs text-navy-400">
              <span class="bg-navy-50 px-2 py-1 rounded">${proc.category_name || 'Sans catégorie'}</span>
              <span>v${proc.version}</span>
              ${proc.approved_by_name ? `<span><i class="fas fa-check-circle text-green-500 mr-1"></i>Approuvé par ${proc.approved_by_name}</span>` : ''}
            </div>
          </div>
          ${canEdit ? `
          <div class="flex gap-2 sm:shrink-0">
            <button onclick="showProcedureForm(${proc.id})" class="bg-navy-50 hover:bg-navy-100 text-navy-600 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5">
              <i class="fas fa-pen"></i>Modifier
            </button>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Déclencheur -->
    ${procTrigger ? `
    <div class="bg-gradient-to-r from-brand-50 to-yellow-50 rounded-xl border border-brand-200 p-4 sm:p-5 mb-6">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-brand-400 rounded-xl flex items-center justify-center shadow shrink-0">
          <i class="fas fa-bolt text-white"></i>
        </div>
        <div class="min-w-0">
          <p class="text-xs font-semibold text-brand-600 uppercase tracking-wide">Déclencheur — Qu'est-ce qu'il se passe ?</p>
          <p class="text-base sm:text-lg font-semibold text-navy-800 mt-0.5">${escapeHtml(procTrigger)}</p>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Steps - What to do -->
    <div class="mb-8">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
          <i class="fas fa-list-check text-white text-sm"></i>
        </div>
        <h3 class="text-lg font-semibold text-navy-800">Étapes</h3>
        <span class="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">${steps.length} étape${steps.length > 1 ? 's' : ''}</span>
      </div>

      <div class="space-y-0">
        ${steps.map((step, i) => renderStep(step, i, steps.length)).join('')}
      </div>
    </div>

    <!-- Conditions / Sub-cases -->
    ${conditions.length > 0 ? `
    <div class="mb-8">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
          <i class="fas fa-code-branch text-white text-sm"></i>
        </div>
        <h3 class="text-lg font-semibold text-navy-800">Cas spécifiques — Et si en plus...</h3>
        <span class="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">${conditions.length} cas</span>
      </div>

      <div class="space-y-4">
        ${conditions.map(cond => renderCondition(cond)).join('')}
      </div>
    </div>` : ''}


  </div>`;
}

function renderStep(step, index, total) {
  const isLinked = !!step.linked_procedure_id;
  // Style spécifique pour les sous-procédures (couleur violette)
  const bubbleColor = isLinked ? 'bg-purple-500' : 'bg-blue-500';
  // Contenu : on prend content, sinon fallback description (rare, pour anciennes données)
  const stepContent = step.content || step.description || '';

  return `
  <div class="step-connector ${index === total - 1 ? 'last-step' : ''}">
    <div class="flex gap-4 pb-6">
      <div class="flex flex-col items-center">
        <div class="w-10 h-10 ${bubbleColor} rounded-xl flex items-center justify-center text-white shadow-sm shrink-0 z-10">
          <span class="text-sm font-bold">${step.step_number}</span>
        </div>
      </div>
      <div class="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
        ${isLinked ? `
          <!-- Sous-procédure : carte cliquable qui ouvre la procédure liée -->
          <button type="button" onclick="openLinkedProcedure(${step.linked_procedure_id})" class="w-full text-left">
            <div class="flex items-center gap-2 mb-1">
              <i class="fas fa-diagram-project text-xs text-purple-500"></i>
              <span class="text-[10px] uppercase tracking-wider font-semibold text-purple-500">Sous-procédure</span>
              ${step.is_optional ? '<span class="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Optionnel</span>' : ''}
            </div>
            <h4 class="font-semibold text-navy-800 flex items-center gap-2">
              ${escapeHtml(step.title)}
              <i class="fas fa-arrow-right text-xs text-purple-400"></i>
            </h4>
            ${step.linked_procedure_title ? `<p class="text-sm text-purple-600 mt-1"><i class="fas fa-link mr-1 text-xs"></i>${escapeHtml(step.linked_procedure_title)}</p>` : '<p class="text-sm text-red-400 mt-1 italic">Procédure liée introuvable</p>'}
          </button>
        ` : `
          <div class="flex items-center gap-2 mb-1.5">
            ${step.is_optional ? '<span class="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Optionnel</span>' : ''}
            ${step.duration_minutes ? `<span class="text-[10px] text-navy-400"><i class="fas fa-clock mr-0.5"></i>${step.duration_minutes} min</span>` : ''}
          </div>
          <h4 class="font-semibold text-navy-800">${escapeHtml(step.title)}</h4>
          ${stepContent ? `<div class="text-sm text-navy-600 mt-2 leading-relaxed whitespace-pre-wrap">${formatHotelInfoContent(stepContent)}</div>` : ''}
        `}
      </div>
    </div>
  </div>`;
}

// Ouvre une procédure liée (sous-procédure)
async function openLinkedProcedure(procId) {
  const data = await api(`/procedures/${procId}`);
  if (data) {
    state.selectedProcedure = data;
    render();
    // Scroll en haut pour bien voir la procédure ouverte
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderCondition(cond) {
  return `
  <div class="bg-purple-50 rounded-xl border border-purple-100 overflow-hidden">
    <div class="px-5 py-3 bg-purple-100 border-b border-purple-200 flex items-center gap-3">
      <div class="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
        <i class="fas fa-code-branch text-white text-sm"></i>
      </div>
      <div>
        <p class="text-xs font-semibold text-purple-600 uppercase tracking-wide">Si en plus...</p>
        <p class="font-semibold text-purple-900">${escapeHtml(cond.condition_text)}</p>
      </div>
    </div>
    ${cond.description ? `<p class="px-5 pt-3 text-sm text-purple-700">${escapeHtml(cond.description)}</p>` : ''}
    <div class="p-5">
      ${(cond.steps || []).length === 0 ? '<p class="text-sm text-purple-400">Aucune étape spécifique</p>' :
        `<div class="space-y-0">
          ${cond.steps.map((step, i) => renderStep(step, i, cond.steps.length)).join('')}
        </div>`}
    </div>
  </div>`;
}

// ============================================
// SEARCH VIEW
// ============================================
function renderSearchView() {
  return `
  <div class="fade-in">
    <div class="mb-5 sm:mb-6">
      <h2 class="text-xl sm:text-2xl font-bold text-navy-900"><i class="fas fa-search mr-2 text-brand-400"></i>Rechercher</h2>
      <p class="text-navy-500 text-sm mt-1">Trouvez rapidement quoi faire face à une situation</p>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
      <div class="relative">
        <i class="fas fa-search absolute left-4 top-4 text-navy-300 text-lg"></i>
        <input id="search-input" type="text" placeholder="Que se passe-t-il ? Ex: client en colère, alarme incendie, check-in..." 
          value="${state.searchQuery}"
          oninput="state.searchQuery=this.value; renderSearchResults()"
          class="w-full pl-12 pr-4 py-3.5 border border-navy-200 rounded-xl text-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>
    </div>

    <div id="search-results">
      ${state.searchQuery ? renderSearchResults(true) : `
        <div class="text-center py-12">
          <i class="fas fa-magnifying-glass text-5xl text-navy-200 mb-4"></i>
          <p class="text-navy-400 font-medium">Décrivez votre situation</p>
          <p class="text-sm text-navy-300 mt-1">Tapez des mots-clés liés à la situation que vous rencontrez</p>
        </div>
      `}
    </div>
  </div>`;
}

function renderSearchResults(returnString = false) {
  const query = state.searchQuery.toLowerCase().trim();
  if (!query) return '';
  
  const results = state.procedures.filter(p => 
    p.title.toLowerCase().includes(query) ||
    (p.trigger_event || '').toLowerCase().includes(query) ||
    (p.description || '').toLowerCase().includes(query)
  );

  const html = results.length === 0 ? `
    <div class="text-center py-12">
      <i class="fas fa-face-meh text-4xl text-navy-200 mb-4"></i>
      <p class="text-navy-400 font-medium">Aucune procédure trouvée</p>
      <p class="text-sm text-navy-300 mt-1">Essayez d'autres termes ou proposez une nouvelle procédure</p>
    </div>
  ` : `
    <div class="space-y-3">
      <p class="text-sm text-navy-400 mb-2">${results.length} résultat(s)</p>
      ${results.map(proc => {
        const trigger = proc.trigger_event || '';
        return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md cursor-pointer transition-all" onclick="viewProcedure(${proc.id})">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold text-navy-800">${escapeHtml(proc.title)}</h4>
              ${trigger ? `<p class="text-sm text-navy-500 mt-1 line-clamp-2"><i class="fas fa-bolt text-brand-400 mr-1 text-xs"></i>${escapeHtml(trigger)}</p>` : ''}
              <div class="flex gap-3 mt-2 text-[11px] text-navy-400">
                <span>${proc.category_name || 'Sans catégorie'}</span>
                <span>${proc.step_count} étape${proc.step_count > 1 ? 's' : ''}</span>
                ${proc.condition_count > 0 ? `<span>${proc.condition_count} cas spécifiques</span>` : ''}
              </div>
            </div>
            <i class="fas fa-chevron-right text-navy-300 mt-2"></i>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  if (returnString) return html;
  const container = document.getElementById('search-results');
  if (container) container.innerHTML = html;
}

// ============================================
// CHANGELOG VIEW
// ============================================
function renderChangelogView() {
  return `
  <div class="fade-in">
    <div class="mb-5 sm:mb-6">
      <h2 class="text-xl sm:text-2xl font-bold text-navy-900"><i class="fas fa-clock-rotate-left mr-2 text-brand-400"></i>Historique</h2>
      <p class="text-navy-500 text-sm mt-1">Suivi des modifications de procédures</p>
    </div>

    ${state.unreadRequired > 0 ? `
    <div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
      <p class="font-semibold text-red-800"><i class="fas fa-exclamation-triangle mr-2"></i>${state.unreadRequired} changement(s) important(s) non lu(s)</p>
      <p class="text-xs text-red-600 mt-1">Marquez-les comme lus pour confirmer que vous en avez pris connaissance</p>
    </div>` : ''}

    <div class="space-y-3">
      ${state.changelog.length === 0 ? `
        <div class="bg-white rounded-xl p-12 text-center border border-gray-100">
          <i class="fas fa-clock-rotate-left text-4xl text-navy-200 mb-4"></i>
          <p class="text-navy-400 font-medium">Aucun changement enregistré</p>
        </div>
      ` : state.changelog.map(ch => `
        <div class="bg-white rounded-xl shadow-sm border ${ch.is_read_required && !ch.is_read ? 'border-red-200 bg-red-50' : 'border-gray-100'} p-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${getActionColor(ch.action)}">
              <i class="fas ${getActionIcon(ch.action)} text-sm"></i>
            </div>
            <div class="flex-1">
              <p class="font-medium text-navy-800">${ch.summary}</p>
              <div class="flex items-center gap-3 mt-1 text-xs text-navy-400">
                <span><i class="fas fa-user mr-1"></i>${ch.user_name || 'Système'}</span>
                <span><i class="fas fa-clock mr-1"></i>${formatDate(ch.created_at)}</span>
                ${ch.procedure_title ? `<span><i class="fas fa-sitemap mr-1"></i>${ch.procedure_title}</span>` : ''}
              </div>
              ${ch.details ? `<p class="text-sm text-navy-500 mt-2">${ch.details}</p>` : ''}
            </div>
            ${ch.is_read_required && !ch.is_read ? `
              <button onclick="markChangelogRead(${ch.id})" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0">
                <i class="fas fa-check mr-1"></i>Lu
              </button>
            ` : ch.is_read ? `
              <span class="text-[10px] text-green-500 shrink-0"><i class="fas fa-check-circle mr-1"></i>Lu</span>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

async function markChangelogRead(id) {
  await api(`/changelog/${id}/read`, { method: 'POST' });
  await loadData();
  render();
  showToast('Changement marqué comme lu', 'success');
}

// ============================================
// SUGGESTIONS VIEW
// ============================================
function renderSuggestionsView() {
  const isAdmin = state.user.role === 'super_admin' || state.user.role === 'admin';

  return `
  <div class="fade-in">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-lightbulb mr-2 text-brand-400"></i>Suggestions</h2>
        <p class="text-navy-500 text-sm mt-1">${isAdmin ? 'Gérez les suggestions de l\'équipe' : 'Vos suggestions d\'amélioration'}</p>
      </div>
      <button onclick="showSuggestionForm()" class="bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
        <i class="fas fa-plus mr-1.5"></i>Nouvelle suggestion
      </button>
    </div>

    <div class="space-y-3">
      ${state.suggestions.length === 0 ? `
        <div class="bg-white rounded-xl p-12 text-center border border-gray-100">
          <i class="fas fa-lightbulb text-4xl text-navy-200 mb-4"></i>
          <p class="text-navy-400 font-medium">Aucune suggestion</p>
        </div>
      ` : state.suggestions.map(s => {
        const typeConfig = {
          new_procedure: { label: 'Nouvelle procédure', icon: 'fa-plus-circle', color: 'text-blue-500 bg-blue-50' },
          improvement: { label: 'Amélioration', icon: 'fa-wand-magic-sparkles', color: 'text-purple-500 bg-purple-50' },
          issue: { label: 'Problème', icon: 'fa-bug', color: 'text-red-500 bg-red-50' }
        };
        const statusConfig = {
          pending: { label: 'En attente', class: 'bg-yellow-100 text-yellow-700' },
          reviewed: { label: 'En cours de revue', class: 'bg-blue-100 text-blue-700' },
          approved: { label: 'Approuvée', class: 'bg-green-100 text-green-700' },
          rejected: { label: 'Rejetée', class: 'bg-red-100 text-red-700' },
          implemented: { label: 'Implémentée', class: 'bg-purple-100 text-purple-700' }
        };
        const tc = typeConfig[s.type] || typeConfig.improvement;
        const sc = statusConfig[s.status] || statusConfig.pending;

        return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tc.color}">
              <i class="fas ${tc.icon}"></i>
            </div>
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <h4 class="font-semibold text-navy-800">${s.title}</h4>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sc.class}">${sc.label}</span>
              </div>
              <p class="text-sm text-navy-500">${s.description}</p>
              <div class="flex items-center gap-3 mt-2 text-[11px] text-navy-400">
                <span><i class="fas fa-user mr-1"></i>${s.user_name}</span>
                <span><i class="fas fa-clock mr-1"></i>${formatDate(s.created_at)}</span>
                ${s.procedure_title ? `<span><i class="fas fa-sitemap mr-1"></i>${s.procedure_title}</span>` : ''}
              </div>
              ${s.admin_response ? `
              <div class="mt-3 bg-navy-50 rounded-lg p-3">
                <p class="text-xs font-semibold text-navy-500 mb-1"><i class="fas fa-reply mr-1"></i>Réponse de ${s.reviewed_by_name || 'l\'admin'}</p>
                <p class="text-sm text-navy-700">${s.admin_response}</p>
              </div>` : ''}
            </div>
            ${isAdmin && s.status === 'pending' ? `
            <div class="flex gap-1.5 shrink-0">
              <button onclick="reviewSuggestion(${s.id}, 'approved')" class="w-8 h-8 rounded-lg bg-green-50 hover:bg-green-100 flex items-center justify-center text-green-500 transition-colors" title="Approuver">
                <i class="fas fa-check text-xs"></i>
              </button>
              <button onclick="reviewSuggestion(${s.id}, 'rejected')" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-500 transition-colors" title="Rejeter">
                <i class="fas fa-times text-xs"></i>
              </button>
            </div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

async function reviewSuggestion(id, status) {
  const response = prompt(`Votre réponse pour cette suggestion (${status === 'approved' ? 'approbation' : 'rejet'}) :`);
  if (response === null) return;
  await api(`/suggestions/${id}`, { method: 'PUT', body: JSON.stringify({ status, admin_response: response }) });
  await loadData();
  render();
  showToast(`Suggestion ${status === 'approved' ? 'approuvée' : 'rejetée'}`, 'success');
}

async function toggleEditPermission(userId, newValue) {
  const action = newValue === 1 ? 'accorder' : 'retirer';
  if (!confirm(`Voulez-vous ${action} le droit de modifier les procédures à cet employé ?`)) return;
  const result = await api(`/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ can_edit_procedures: newValue }) });
  if (result) {
    await loadData();
    render();
    showToast(newValue === 1 ? 'Droits d\'édition accordés' : 'Droits d\'édition retirés', 'success');
  }
}

// Bascule une permission granulaire (procedures, info, chat) pour un employé
async function togglePermission(userId, permKey, newValue) {
  const labels = {
    can_edit_procedures: 'modifier les procédures',
    can_edit_info: 'modifier les informations',
    can_manage_chat: 'gérer les salons et conversations'
  };
  const verb = newValue === 1 ? 'accorder' : 'retirer';
  if (!confirm(`Voulez-vous ${verb} le droit de ${labels[permKey] || permKey} à cet employé ?`)) return;
  const body = {};
  body[permKey] = newValue;
  const result = await api(`/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify(body) });
  if (result) {
    await loadData();
    render();
    showToast(newValue === 1 ? 'Droit accordé' : 'Droit retiré', 'success');
  }
}

// Composant : 3 cases à cocher pour un employé (versions desktop/mobile)
function permissionCheckboxes(u, compact = false) {
  const perms = [
    { key: 'can_edit_procedures', label: 'Procédures', icon: 'fa-sitemap' },
    { key: 'can_edit_info', label: 'Informations', icon: 'fa-circle-info' },
    { key: 'can_manage_chat', label: 'Salons / chat', icon: 'fa-comments' }
  ];
  return `
    <div class="flex flex-col gap-1.5">
      ${perms.map(p => {
        const checked = u[p.key] === 1;
        return `
          <label class="flex items-center gap-2 cursor-pointer text-xs text-navy-700 hover:bg-gray-50 rounded px-1 py-0.5 transition-colors">
            <input type="checkbox" ${checked ? 'checked' : ''}
              onchange="togglePermission(${u.id}, '${p.key}', this.checked ? 1 : 0)"
              class="w-3.5 h-3.5 rounded border-gray-300 text-brand-500 focus:ring-brand-400">
            <i class="fas ${p.icon} text-navy-400 text-[10px]"></i>
            <span class="${compact ? 'text-[11px]' : ''}">${p.label}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

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

  return `
  <div class="fade-in">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-navy-900"><i class="fas fa-users mr-2 text-brand-400"></i>Utilisateurs</h2>
        <p class="text-navy-500 text-sm mt-1">${filteredUsers.length} compte(s)${filterHotelId ? ' — filtré' : ''}</p>
      </div>
      <button onclick="showUserForm()" class="self-start sm:self-auto bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5">
        <i class="fas fa-user-plus"></i>Ajouter
      </button>
    </div>

    ${isSuperAdmin ? `
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4 flex items-center gap-4 flex-wrap">
      <div class="flex items-center gap-2">
        <i class="fas fa-filter text-navy-400 text-sm"></i>
        <span class="text-sm font-medium text-navy-600">Filtrer par hôtel :</span>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="state.usersFilterHotel=''; render()" 
          class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${!filterHotelId ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-500 hover:bg-navy-100'}">
          Tous
        </button>
        ${state.hotels.map(h => `
          <button onclick="state.usersFilterHotel='${h.id}'; render()" 
            class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${filterHotelId === String(h.id) ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}">
            <i class="fas fa-hotel mr-1"></i>${h.name}
          </button>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- Desktop table (md+) -->
    <div class="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
     <div class="table-scroll-wrapper">
      <table class="w-full min-w-[640px]">
        <thead>
          <tr class="bg-navy-50 text-xs text-navy-500 uppercase tracking-wider">
            <th class="text-left py-3 px-5">Utilisateur</th>
            ${isSuperAdmin ? '<th class="text-left py-3 px-5">Hôtel</th>' : ''}
            <th class="text-left py-3 px-5">Rôle</th>
            <th class="text-left py-3 px-5">Dernière connexion</th>
            <th class="text-left py-3 px-5">Statut</th>
            ${isAdmin ? '<th class="text-left py-3 px-5">Permissions employé</th>' : ''}
            <th class="text-left py-3 px-5">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          ${filteredUsers.length === 0 ? `
            <tr><td colspan="6" class="py-10 text-center text-navy-400 text-sm">Aucun utilisateur</td></tr>
          ` : filteredUsers.map(u => {
            const hasEditRight = u.can_edit_procedures === 1;
            const isEmployee = u.role === 'employee';
            const isSelf = u.id === state.user.id;
            return `
            <tr class="hover:bg-gray-50">
              <td class="py-3 px-5">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 bg-navy-100 rounded-full flex items-center justify-center text-sm font-semibold text-navy-600">${u.name.charAt(0)}</div>
                  <div>
                    <p class="text-sm font-medium text-navy-800">${u.name}${isSelf ? ' <span class="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded ml-1">vous</span>' : ''}</p>
                    <p class="text-xs text-navy-400">${u.email}</p>
                  </div>
                </div>
              </td>
              ${isSuperAdmin ? `<td class="py-3 px-5 text-sm text-navy-600">${u.hotel_name || '<span class="text-navy-300 italic">—</span>'}</td>` : ''}
              <td class="py-3 px-5"><span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${roleColors[u.role]}">${roleLabels[u.role]}</span></td>
              <td class="py-3 px-5 text-xs text-navy-400">${u.last_login ? formatDate(u.last_login) : 'Jamais'}</td>
              <td class="py-3 px-5">
                <span class="w-2 h-2 rounded-full inline-block ${u.is_active ? 'bg-green-500' : 'bg-red-500'}"></span>
                <span class="text-xs text-navy-400 ml-1">${u.is_active ? 'Actif' : 'Inactif'}</span>
              </td>
              ${isAdmin ? `
              <td class="py-3 px-5">
                ${isEmployee ? permissionCheckboxes(u) : `<span class="text-xs text-navy-300 italic">${u.role === 'admin' ? 'Droits admin (complets)' : '—'}</span>`}
              </td>` : ''}
              <td class="py-3 px-5">
                ${isSelf ? '<span class="text-xs text-navy-300 italic">—</span>' : `
                  <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')" 
                    class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 hover:text-red-600 transition-colors" 
                    title="Supprimer ${u.name.replace(/'/g, "\\'")}">
                    <i class="fas fa-trash text-xs"></i>
                  </button>
                `}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
     </div>
    </div>

    <!-- Mobile cards (< md) -->
    <div class="md:hidden space-y-3">
      ${filteredUsers.length === 0 ? `
        <div class="bg-white rounded-xl p-8 text-center border border-gray-100">
          <p class="text-navy-400 text-sm">Aucun utilisateur</p>
        </div>
      ` : filteredUsers.map(u => {
        const hasEditRight = u.can_edit_procedures === 1;
        const isEmployee = u.role === 'employee';
        const isSelf = u.id === state.user.id;
        return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 bg-navy-100 rounded-full flex items-center justify-center text-sm font-bold text-navy-600 shrink-0">${u.name.charAt(0)}</div>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-navy-800 truncate">${u.name}${isSelf ? ' <span class="text-[10px] bg-gray-100 text-gray-400 px-1 py-0.5 rounded">vous</span>' : ''}</p>
                <p class="text-xs text-navy-400 truncate">${u.email}</p>
                ${isSuperAdmin && u.hotel_name ? `<p class="text-xs text-blue-500 mt-0.5"><i class="fas fa-hotel mr-1"></i>${u.hotel_name}</p>` : ''}
              </div>
            </div>
            ${isSelf ? '' : `
            <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')" 
              class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 shrink-0">
              <i class="fas fa-trash text-xs"></i>
            </button>`}
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-50">
            <span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${roleColors[u.role]}">${roleLabels[u.role]}</span>
            <span class="flex items-center gap-1 text-xs text-navy-400">
              <span class="w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-red-500'}"></span>
              ${u.is_active ? 'Actif' : 'Inactif'}
            </span>
            <span class="text-[10px] text-navy-400"><i class="fas fa-clock mr-0.5"></i>${u.last_login ? formatDate(u.last_login) : 'Jamais connecté'}</span>
          </div>
          ${isAdmin && isEmployee ? `
          <div class="mt-3 pt-3 border-t border-gray-50">
            <p class="text-[10px] uppercase tracking-wider text-navy-400 font-semibold mb-2">Permissions</p>
            ${permissionCheckboxes(u, true)}
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>

    ${isAdmin ? `
    <div class="mt-4 bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
      <i class="fas fa-circle-info text-blue-400 mt-0.5"></i>
      <div class="text-xs text-blue-700 space-y-1">
        <p class="font-semibold mb-1">Permissions des employés</p>
        <p>Tu peux activer / désactiver indépendamment trois droits pour chaque employé :</p>
        <ul class="list-disc pl-5 space-y-0.5">
          <li><strong>Procédures</strong> — créer, modifier et supprimer les procédures.</li>
          <li><strong>Informations</strong> — créer et modifier les informations de l'hôtel (catégories + items).</li>
          <li><strong>Salons / chat</strong> — créer, modifier et organiser les salons et conversations.</li>
        </ul>
        <p class="mt-1">Les <strong>admins</strong> ont toujours accès complet à tout, sans cases à cocher.</p>
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
        <i class="fas fa-circle-notch fa-spin text-3xl text-brand-400 mb-3"></i>
        <p class="text-navy-500 text-sm">Chargement des informations...</p>
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

  // Si recherche active : on affiche une liste à plat des résultats
  // Sinon : groupé par catégorie en accordéon
  return `
  <div class="fade-in">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div class="min-w-0">
        <h2 class="text-xl sm:text-2xl font-bold text-navy-900">
          <i class="fas fa-circle-info mr-2 text-brand-400"></i>Informations
        </h2>
        <p class="text-navy-500 text-sm mt-1">Tout ce qu'il faut savoir sur l'hôtel, à portée de main.</p>
      </div>
      ${canEditInfo ? `
        <div class="flex flex-wrap gap-2 shrink-0">
          <button onclick="showHotelInfoCategoryModal()" class="bg-white border border-navy-200 hover:bg-navy-50 text-navy-700 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <i class="fas fa-folder-plus"></i><span class="hidden sm:inline">Catégorie</span>
          </button>
          <button onclick="showHotelInfoItemModal()" class="bg-brand-400 hover:bg-brand-500 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 shadow">
            <i class="fas fa-plus"></i><span>Nouvelle info</span>
          </button>
        </div>
      ` : ''}
    </div>

    <!-- Barre de recherche sticky -->
    <div class="sticky top-0 z-10 bg-gray-50 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-3 mb-4 border-b border-gray-200">
      <div class="relative max-w-2xl">
        <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 text-sm"></i>
        <input id="hotel-info-search" type="text" value="${escapeHtml(state.hotelInfoSearchQuery || '')}"
          oninput="state.hotelInfoSearchQuery = this.value; renderHotelInfoBody()"
          placeholder="Rechercher une info (parking, petit-déjeuner, jacuzzi…)"
          class="form-input-mobile w-full pl-10 pr-10 py-2.5 border border-navy-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-400 bg-white shadow-sm">
        ${q ? `<button onclick="state.hotelInfoSearchQuery=''; document.getElementById('hotel-info-search').value=''; renderHotelInfoBody()" class="absolute right-3 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700"><i class="fas fa-xmark"></i></button>` : ''}
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
    <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">
      <i class="fas fa-magnifying-glass text-4xl text-navy-200 mb-3"></i>
      <p class="text-navy-600 font-semibold">Aucun résultat pour « ${escapeHtml(q)} »</p>
      <p class="text-navy-400 text-sm mt-1">Essayez avec un autre terme.</p>
    </div>`;
  }

  if (cats.length === 0 && filteredItems.length === 0) {
    return `
    <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">
      <i class="fas fa-circle-info text-4xl text-navy-200 mb-3"></i>
      <p class="text-navy-600 font-semibold">Aucune information renseignée pour le moment.</p>
      ${canEditInfo ? '<p class="text-navy-400 text-sm mt-1">Cliquez sur « Nouvelle info » pour commencer.</p>' : ''}
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
  <div class="space-y-3">
    ${cats.map(cat => {
      const catItems = itemsByCat[cat.id] || [];
      const isOpen = state.hotelInfoActiveCategory === cat.id;
      return `
      <div id="info-cat-${cat.id}" class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <!-- Header de la catégorie : zone clickable à gauche, actions à droite -->
        <div class="flex items-stretch">
          <!-- Zone clickable : icône + nom + nb infos -->
          <button type="button" onclick="toggleHotelInfoCategory(${cat.id})"
            class="flex-1 min-w-0 flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-navy-50 transition-colors text-left">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style="background:${cat.color || '#3B82F6'}">
              <i class="fas ${cat.icon || 'fa-circle-info'}"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-navy-800 text-sm sm:text-base truncate">${escapeHtml(cat.name)}</h3>
              <p class="text-xs text-navy-500">${catItems.length} info${catItems.length > 1 ? 's' : ''}</p>
            </div>
          </button>
          <!-- Zone d'actions à droite : édition / suppression / chevron -->
          <div class="flex items-center gap-1 pr-3 sm:pr-4 shrink-0">
            ${canEditInfo ? `
              <button type="button" onclick="showHotelInfoCategoryModal(${cat.id})" title="Renommer la catégorie"
                class="w-9 h-9 rounded-lg hover:bg-navy-100 text-navy-400 hover:text-navy-700 flex items-center justify-center transition-colors">
                <i class="fas fa-pen text-sm"></i>
              </button>
              <button type="button" onclick="deleteHotelInfoCategory(${cat.id})" title="Supprimer"
                class="w-9 h-9 rounded-lg hover:bg-red-50 text-navy-400 hover:text-red-500 flex items-center justify-center transition-colors">
                <i class="fas fa-trash text-sm"></i>
              </button>
              <div class="w-px h-6 bg-gray-200 mx-1"></div>
            ` : ''}
            <button type="button" onclick="toggleHotelInfoCategory(${cat.id})" title="Ouvrir / fermer"
              class="w-9 h-9 rounded-lg hover:bg-navy-100 text-navy-500 hover:text-navy-800 flex items-center justify-center transition-colors">
              <i id="info-cat-chevron-${cat.id}" class="fas fa-chevron-${isOpen ? 'up' : 'down'} text-sm transition-transform"></i>
            </button>
          </div>
        </div>
        <!-- Contenu (toujours rendu, juste caché quand fermé pour éviter le scroll-jump) -->
        <div id="info-cat-content-${cat.id}" class="${isOpen ? '' : 'hidden'} border-t border-gray-100 p-3 sm:p-4 space-y-2 bg-gray-50">
          ${catItems.length === 0 ? `
            <p class="text-sm text-navy-400 italic px-2 py-3">Aucune info dans cette catégorie.</p>
          ` : catItems.map(it => renderHotelInfoItemCard(it, cat, canEditInfo, false)).join('')}
          ${canEditInfo ? `
            <button onclick="showHotelInfoItemModal(null, ${cat.id})" class="w-full mt-2 px-3 py-2 border-2 border-dashed border-navy-200 hover:border-brand-400 hover:bg-brand-50 text-navy-500 hover:text-brand-600 rounded-lg text-sm font-medium transition-colors">
              <i class="fas fa-plus mr-1"></i>Ajouter une info dans « ${escapeHtml(cat.name)} »
            </button>
          ` : ''}
        </div>
      </div>`;
    }).join('')}

    ${orphanItems.length > 0 ? `
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="px-4 sm:px-5 py-3 border-b border-gray-100 bg-navy-50">
          <h3 class="text-sm font-semibold text-navy-700"><i class="fas fa-folder-open mr-2 text-navy-400"></i>Sans catégorie</h3>
        </div>
        <div class="p-3 sm:p-4 space-y-2">
          ${orphanItems.map(it => renderHotelInfoItemCard(it, null, canEditInfo, false)).join('')}
        </div>
      </div>
    ` : ''}
  </div>`;
}

function renderHotelInfoItemCard(item, category, canEditInfo, showCategoryBadge) {
  return `
  <div class="bg-white rounded-lg border border-gray-200 hover:border-brand-300 transition-colors">
    <div class="px-4 py-3 flex items-start gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap mb-1">
          <h4 class="font-semibold text-navy-800 text-sm sm:text-base">${escapeHtml(item.title)}</h4>
          ${showCategoryBadge && category ? `
            <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold" style="background:${category.color || '#3B82F6'}20; color:${category.color || '#3B82F6'}">
              <i class="fas ${category.icon || 'fa-circle-info'} mr-1"></i>${escapeHtml(category.name)}
            </span>
          ` : ''}
        </div>
        ${item.content ? `<div class="text-sm text-navy-600 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(item.content)}</div>` : ''}
      </div>
      ${canEditInfo ? `
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="showHotelInfoItemModal(${item.id})" title="Modifier"
            class="w-8 h-8 rounded-lg hover:bg-navy-50 text-navy-400 hover:text-navy-700 flex items-center justify-center">
            <i class="fas fa-pen text-xs"></i>
          </button>
          <button onclick="deleteHotelInfoItem(${item.id})" title="Supprimer"
            class="w-8 h-8 rounded-lg hover:bg-red-50 text-navy-400 hover:text-red-500 flex items-center justify-center">
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

// Modaux édition catégorie
function showHotelInfoCategoryModal(catId = null) {
  const cat = catId ? (state.hotelInfoCategories || []).find(c => c.id === catId) : null;
  const isEdit = !!cat;
  showModal(isEdit ? 'Renommer la catégorie' : 'Nouvelle catégorie', `
    <form onsubmit="event.preventDefault(); submitHotelInfoCategory(${catId || 'null'})">
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Nom de la catégorie *</label>
        <input id="info-cat-name" type="text" required maxlength="60" value="${cat ? escapeHtml(cat.name) : ''}"
          placeholder="Ex: Restauration, Loisirs..."
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Couleur</label>
        <input id="info-cat-color" type="color" value="${cat ? cat.color || '#3B82F6' : '#3B82F6'}"
          class="w-full h-11 border border-navy-200 rounded-lg cursor-pointer">
        <p class="text-xs text-navy-400 mt-1">Couleur d'identification de la catégorie.</p>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 bg-brand-400 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold shadow">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>
  `);
}

async function submitHotelInfoCategory(catId) {
  const name = document.getElementById('info-cat-name').value.trim();
  const color = document.getElementById('info-cat-color').value || '#3B82F6';
  if (!name) return;

  const path = catId ? `/hotel-info/categories/${catId}` : '/hotel-info/categories';
  const method = catId ? 'PUT' : 'POST';
  // Icône par défaut fixe (pas demandée à l'utilisateur)
  const icon = 'fa-circle-info';
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
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Catégorie</label>
        <select id="info-item-cat" class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-400 bg-white">
          <option value="">Sans catégorie</option>
          ${cats.map(c => `<option value="${c.id}" ${c.id === currentCatId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Contenu</label>
        <textarea id="info-item-content" rows="8" oninput="autoResizeTextarea(this)" placeholder="Toutes les infos utiles : horaires, tarifs, conditions, etc.&#10;&#10;Astuces : utilisez **gras** pour mettre en valeur, • pour des puces."
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-400">${item ? escapeHtml(item.content || '') : ''}</textarea>
        <p class="text-xs text-navy-400 mt-1">Vous pouvez utiliser **gras** et des puces (• ou -)</p>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2 sticky bottom-0 bg-white -mx-4 sm:-mx-5 px-4 sm:px-5 -mb-4 sm:-mb-5 pb-4 sm:pb-5 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 bg-brand-400 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold shadow">${isEdit ? 'Enregistrer' : 'Créer'}</button>
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
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-navy-900"><i class="fas fa-hotel mr-2 text-brand-400"></i>Hôtels</h2>
        <p class="text-navy-500 text-sm mt-1">${state.hotels.length} hôtel(s)</p>
      </div>
      <button onclick="showHotelForm()" class="self-start sm:self-auto bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5">
        <i class="fas fa-plus"></i>Nouvel hôtel
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      ${state.hotels.length === 0 ? `
        <div class="md:col-span-2 xl:col-span-3 bg-white rounded-xl p-12 text-center border border-gray-100">
          <i class="fas fa-hotel text-4xl text-navy-200 mb-4"></i>
          <p class="text-navy-400 font-medium">Aucun hôtel enregistré</p>
        </div>
      ` : state.hotels.map(h => `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
              <i class="fas fa-hotel text-blue-500 text-xl"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-navy-800 text-lg truncate">${h.name}</h3>
              ${h.address ? `<p class="text-sm text-navy-400 mt-0.5"><i class="fas fa-map-marker-alt mr-1"></i>${h.address}</p>` : '<p class="text-sm text-navy-300 italic mt-0.5">Adresse non renseignée</p>'}
              <p class="text-xs text-navy-300 mt-2"><i class="fas fa-calendar mr-1"></i>Créé le ${formatDate(h.created_at)}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-4 pt-4 border-t border-gray-50">
            <button onclick="showHotelEditForm(${h.id}, '${h.name.replace(/'/g, "\\'")}', '${(h.address || '').replace(/'/g, "\\'")}')" 
              class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-navy-50 hover:bg-navy-100 text-navy-600 transition-colors">
              <i class="fas fa-pen"></i>Modifier
            </button>
            <button onclick="showHotelUsers(${h.id})"
              class="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors">
              <i class="fas fa-users"></i>Voir les admins
            </button>
            <button onclick="deleteHotel(${h.id}, '${h.name.replace(/'/g, "\\'")}')" 
              class="w-9 h-9 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors" 
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
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Adresse</label>
        <input id="hotel-edit-address" type="text" value="${address}" placeholder="Adresse complète"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
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
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-copy mr-2 text-brand-400"></i>Templates</h2>
        <p class="text-navy-500 text-sm mt-1">Modèles de procédures pour les hôtels</p>
      </div>
      <button onclick="showTemplateForm()" class="bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
        <i class="fas fa-plus mr-1.5"></i>Nouveau template
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${state.templates.map(t => {
        const steps = JSON.parse(t.steps_json || '[]');
        return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
              <i class="fas fa-copy text-purple-500"></i>
            </div>
            <div class="flex-1">
              <h4 class="font-semibold text-navy-800">${t.name}</h4>
              ${t.category_name ? `<span class="text-[10px] bg-navy-50 text-navy-500 px-1.5 py-0.5 rounded">${t.category_name}</span>` : ''}
            </div>
          </div>
          ${t.description ? `<p class="text-sm text-navy-500 mb-3 whitespace-pre-wrap">${escapeHtml(t.description)}</p>` : (t.trigger_event ? `<p class="text-sm text-navy-500 mb-3 whitespace-pre-wrap">${escapeHtml(t.trigger_event)}</p>` : '')}
          <div class="flex items-center justify-between">
            <span class="text-xs text-navy-400"><i class="fas fa-list mr-1"></i>${steps.length} étapes</span>
            <button onclick="deleteTemplate(${t.id})" class="text-xs text-red-400 hover:text-red-600 transition-colors">
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

// ============================================
// WIKOT — AGENTS IA (vue chat) — Wikot (standard) + Back Wikot (max)
// ============================================
// Helper : récupère/écrit l'état chat correspondant au mode (state.wikot* ou state.wikotMax*)
function wikotState(mode) {
  // mode = 'standard' | 'max'
  const prefix = mode === 'max' ? 'wikotMax' : 'wikot';
  return {
    get conversations() { return state[prefix + 'Conversations']; },
    set conversations(v) { state[prefix + 'Conversations'] = v; },
    get currentConvId() { return state[prefix + 'CurrentConvId']; },
    set currentConvId(v) { state[prefix + 'CurrentConvId'] = v; },
    get messages() { return state[prefix + 'Messages']; },
    set messages(v) { state[prefix + 'Messages'] = v; },
    get actions() { return state[prefix + 'Actions']; },
    set actions(v) { state[prefix + 'Actions'] = v; },
    get loading() { return state[prefix + 'Loading']; },
    set loading(v) { state[prefix + 'Loading'] = v; },
    get sending() { return state[prefix + 'Sending']; },
    set sending(v) { state[prefix + 'Sending'] = v; },
    get sidebarOpen() { return state[prefix + 'SidebarOpen']; },
    set sidebarOpen(v) { state[prefix + 'SidebarOpen'] = v; }
  };
}

// Détermine le mode actif selon la vue courante
function activeWikotMode() {
  return state.currentView === 'wikot-max' ? 'max' : 'standard';
}

// L'utilisateur a-t-il accès à Back Wikot ?
function userCanUseWikotMax() {
  if (!state.user) return false;
  if (state.user.role === 'admin' || state.user.role === 'super_admin') return true;
  return state.user.can_edit_procedures === 1 || state.user.can_edit_info === 1;
}

async function loadWikotConversations(mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  const data = await api(`/wikot/conversations?mode=${mode}`);
  if (data) s.conversations = data.conversations || [];
}

async function loadWikotConversation(convId, mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  s.loading = true;
  render();
  const data = await api(`/wikot/conversations/${convId}`);
  s.loading = false;
  if (!data) return;
  s.currentConvId = convId;
  s.messages = (data.messages || []).map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    references: m.references_json ? JSON.parse(m.references_json) : []
  }));
  s.actions = data.actions || [];
  render();
  scrollWikotToBottom(mode);
}

async function newWikotConversation(mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  const data = await api('/wikot/conversations', {
    method: 'POST',
    body: JSON.stringify({ mode })
  });
  if (!data) return;
  await loadWikotConversations(mode);
  s.currentConvId = data.id;
  s.messages = [];
  s.actions = [];
  render();
  setTimeout(() => {
    const input = document.getElementById(mode === 'max' ? 'wikot-max-input' : 'wikot-input');
    if (input) input.focus();
  }, 100);
}

async function deleteWikotConversation(convId, ev, mode) {
  if (ev) ev.stopPropagation();
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  if (!confirm('Archiver cette conversation ?')) return;
  await api(`/wikot/conversations/${convId}`, { method: 'DELETE' });
  if (s.currentConvId === convId) {
    s.currentConvId = null;
    s.messages = [];
    s.actions = [];
  }
  await loadWikotConversations(mode);
  render();
}

async function sendWikotMessage(mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  const inputId = mode === 'max' ? 'wikot-max-input' : 'wikot-input';
  const input = document.getElementById(inputId);
  if (!input) return;
  const content = input.value.trim();
  if (!content || s.sending) return;

  // Si pas de conversation active, on en crée une avec le bon mode
  if (!s.currentConvId) {
    const data = await api('/wikot/conversations', {
      method: 'POST',
      body: JSON.stringify({ mode })
    });
    if (!data) return;
    s.currentConvId = data.id;
  }

  // Affichage optimiste du message utilisateur
  s.messages.push({ id: 'temp-' + Date.now(), role: 'user', content, references: [] });
  s.sending = true;
  input.value = '';
  autoResizeTextarea(input);
  render();
  scrollWikotToBottom(mode);

  const result = await api(`/wikot/conversations/${s.currentConvId}/message`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
  s.sending = false;

  if (!result) {
    s.messages.pop();
    render();
    return;
  }

  const lastUser = s.messages[s.messages.length - 1];
  if (lastUser && lastUser.role === 'user') lastUser.id = result.user_message_id;

  s.messages.push({
    id: result.assistant_message.id,
    role: 'assistant',
    content: result.assistant_message.content,
    references: result.assistant_message.references || []
  });

  if (result.actions && result.actions.length > 0) {
    s.actions.push(...result.actions);
  }

  await loadWikotConversations(mode);
  render();
  scrollWikotToBottom(mode);
}

async function acceptWikotAction(actionId) {
  if (!confirm('Appliquer cette modification ?')) return;
  const r = await api(`/wikot/actions/${actionId}/accept`, { method: 'POST' });
  if (!r) return;
  // Mettre à jour le statut local — chercher dans les deux modes
  const all = [...(state.wikotActions || []), ...(state.wikotMaxActions || [])];
  const a = all.find(x => x.id === actionId);
  if (a) a.status = 'accepted';
  showToast('Modification appliquée par Back Wikot', 'success');
  await loadData();
  render();
}

async function rejectWikotAction(actionId) {
  const r = await api(`/wikot/actions/${actionId}/reject`, { method: 'POST' });
  if (!r) return;
  const all = [...(state.wikotActions || []), ...(state.wikotMaxActions || [])];
  const a = all.find(x => x.id === actionId);
  if (a) a.status = 'rejected';
  render();
}

function viewWikotReference(ref) {
  if (ref.type === 'procedure') {
    viewProcedure(ref.id);
  } else if (ref.type === 'info_item') {
    state.currentView = 'info';
    state.hotelInfoActiveCategory = null;
    state.hotelInfoSearchQuery = '';
    render();
    // Scroll vers l'item après render
    setTimeout(() => {
      const el = document.getElementById('info-item-' + ref.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-brand-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400'), 2000);
      }
    }, 200);
  }
}

function scrollWikotToBottom(mode) {
  mode = mode || activeWikotMode();
  const containerId = mode === 'max' ? 'wikot-max-messages' : 'wikot-messages';
  setTimeout(() => {
    const container = document.getElementById(containerId);
    if (container) container.scrollTop = container.scrollHeight;
  }, 50);
}

function toggleWikotSidebar(mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  s.sidebarOpen = !s.sidebarOpen;
  render();
}

function formatWikotContent(text) {
  if (!text) return '';
  const escaped = (text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[•\-]\s+(.+)$/gm, '<div class="ml-3 flex gap-2"><span class="text-brand-400">•</span><span>$1</span></div>')
    .replace(/\n/g, '<br>');
}

function renderWikotMessage(msg, mode) {
  mode = mode || activeWikotMode();
  const userBubbleColor = mode === 'max' ? 'bg-orange-500' : 'bg-brand-500';
  if (msg.role === 'user') {
    return `
      <div class="flex justify-end mb-4">
        <div class="max-w-[85%] sm:max-w-[75%] ${userBubbleColor} text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          ${escapeHtml(msg.content)}
        </div>
      </div>
    `;
  }
  // Assistant
  const refs = msg.references || [];
  const actionsArr = mode === 'max' ? (state.wikotMaxActions || []) : (state.wikotActions || []);
  const actionsForMsg = actionsArr.filter(a => a.message_id === msg.id);
  const cfg = WIKOT_MODE_CONFIG[mode] || WIKOT_MODE_CONFIG.standard;

  return `
    <div class="flex justify-start mb-4">
      <div class="flex gap-2 max-w-[90%] sm:max-w-[80%]">
        <div class="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br ${cfg.avatarGradient} flex items-center justify-center text-white text-xs">
          <i class="fas ${cfg.icon}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm">
            <div class="text-navy-800">${formatWikotContent(msg.content || '')}</div>
            ${refs.length > 0 ? `
              <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
                ${refs.map(r => `
                  <button onclick='viewWikotReference(${JSON.stringify(r)})' class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-lg border border-brand-200 transition-colors">
                    <i class="fas ${r.type === 'procedure' ? 'fa-sitemap' : 'fa-circle-info'}"></i>
                    ${r.type === 'procedure' ? 'Voir la procédure' : "Voir l'information"} : ${escapeHtml(r.title)}
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>
          ${actionsForMsg.map(a => renderWikotActionCard(a)).join('')}
        </div>
      </div>
    </div>
  `;
}

// Helper : formate un bloc d'étapes pour affichage complet (titre + contenu, sans troncature)
function renderActionCardSteps(steps, colorClass) {
  if (!steps || !steps.length) return '';
  return `
    <ol class="space-y-2 mt-2">
      ${steps.map((s, idx) => `
        <li class="bg-white border ${colorClass} rounded-lg p-2.5">
          <div class="flex items-start gap-2">
            <span class="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-700 text-[10px] font-bold flex items-center justify-center mt-0.5">${s.step_number || (idx + 1)}</span>
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-navy-800 text-xs">${escapeHtml(s.title || '(sans titre)')}</div>
              ${s.content ? `<div class="text-[11px] text-navy-600 mt-1 whitespace-pre-wrap leading-relaxed">${escapeHtml(s.content)}</div>` : ''}
              ${s.linked_procedure_id ? `<div class="text-[10px] text-blue-600 mt-1"><i class="fas fa-link mr-1"></i>Sous-procédure liée (id ${s.linked_procedure_id})</div>` : ''}
            </div>
          </div>
        </li>
      `).join('')}
    </ol>
  `;
}

function renderWikotActionCard(action) {
  const payload = typeof action.payload === 'string' ? JSON.parse(action.payload) : action.payload;
  const before = action.before_snapshot ? (typeof action.before_snapshot === 'string' ? JSON.parse(action.before_snapshot) : action.before_snapshot) : null;

  const actionLabels = {
    'create_procedure': { label: 'Créer une procédure', icon: 'fa-plus', color: 'green' },
    'update_procedure': { label: 'Modifier une procédure', icon: 'fa-pen', color: 'orange' },
    'create_info_item': { label: 'Créer une information', icon: 'fa-plus', color: 'green' },
    'update_info_item': { label: "Modifier une information", icon: 'fa-pen', color: 'orange' },
    'create_info_category': { label: "Créer une catégorie d'info", icon: 'fa-plus', color: 'green' }
  };
  const meta = actionLabels[action.action_type] || { label: action.action_type, icon: 'fa-cog', color: 'blue' };

  let statusBadge = '';
  if (action.status === 'accepted') statusBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-medium"><i class="fas fa-check"></i>Appliquée</span>';
  else if (action.status === 'rejected') statusBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium"><i class="fas fa-xmark"></i>Refusée</span>';
  else if (action.status === 'failed') statusBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-medium"><i class="fas fa-triangle-exclamation"></i>Échec</span>';

  const title = payload.title || (before && before.title) || '';
  const stepsCount = payload.steps ? payload.steps.length : 0;
  const isUpdate = action.action_type.startsWith('update_');

  // Bloc « Après » (toujours affiché, contenu COMPLET — toutes les étapes, sans troncature)
  const afterBlockHtml = `
    <div class="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
      <div class="font-semibold text-green-800 text-xs uppercase tracking-wide flex items-center gap-1.5">
        <i class="fas fa-arrow-right text-green-600"></i>${isUpdate ? 'Après modification' : 'Nouveau contenu proposé'}
      </div>
      ${payload.title ? `<div class="text-sm"><strong class="text-navy-700">Titre :</strong> <span class="text-navy-800">${escapeHtml(payload.title)}</span></div>` : ''}
      ${payload.trigger_event ? `<div class="text-xs text-navy-700"><strong>Déclencheur :</strong> ${escapeHtml(payload.trigger_event)}</div>` : ''}
      ${payload.description ? `<div class="text-xs text-navy-700"><strong>Description :</strong><div class="whitespace-pre-wrap mt-1">${escapeHtml(payload.description)}</div></div>` : ''}
      ${payload.content ? `<div class="text-xs text-navy-700"><strong>Contenu :</strong><div class="whitespace-pre-wrap mt-1 leading-relaxed">${escapeHtml(payload.content)}</div></div>` : ''}
      ${payload.color ? `<div class="text-xs text-navy-700"><strong>Couleur :</strong> <span class="inline-block w-3 h-3 rounded-full align-middle ml-1" style="background-color:${escapeHtml(payload.color)}"></span> <code class="text-[10px]">${escapeHtml(payload.color)}</code></div>` : ''}
      ${stepsCount > 0 ? `
        <div class="text-xs text-navy-700">
          <strong><i class="fas fa-list-ol mr-1"></i>${stepsCount} étape${stepsCount > 1 ? 's' : ''} ${isUpdate ? '(remplaceront les étapes actuelles)' : ''} :</strong>
          ${renderActionCardSteps(payload.steps, 'border-green-200')}
        </div>
      ` : ''}
    </div>
  `;

  // Bloc « Avant » (uniquement pour modifications, COMPLET aussi)
  const beforeBlockHtml = (isUpdate && before) ? `
    <div class="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2 mb-2">
      <div class="font-semibold text-red-800 text-xs uppercase tracking-wide flex items-center gap-1.5">
        <i class="fas fa-clock-rotate-left text-red-600"></i>État actuel (avant)
      </div>
      ${before.title ? `<div class="text-sm"><strong class="text-navy-700">Titre :</strong> <span class="text-navy-800">${escapeHtml(before.title)}</span></div>` : ''}
      ${before.trigger_event ? `<div class="text-xs text-navy-700"><strong>Déclencheur :</strong> ${escapeHtml(before.trigger_event)}</div>` : ''}
      ${before.description ? `<div class="text-xs text-navy-700"><strong>Description :</strong><div class="whitespace-pre-wrap mt-1">${escapeHtml(before.description)}</div></div>` : ''}
      ${before.content ? `<div class="text-xs text-navy-700"><strong>Contenu :</strong><div class="whitespace-pre-wrap mt-1 leading-relaxed">${escapeHtml(before.content)}</div></div>` : ''}
      ${(before.steps && before.steps.length) ? `
        <div class="text-xs text-navy-700">
          <strong><i class="fas fa-list-ol mr-1"></i>${before.steps.length} étape${before.steps.length > 1 ? 's' : ''} actuelle${before.steps.length > 1 ? 's' : ''} :</strong>
          ${renderActionCardSteps(before.steps, 'border-red-200')}
        </div>
      ` : ''}
    </div>
  ` : '';

  return `
    <div class="mt-3 bg-white border-2 border-${meta.color}-200 rounded-xl overflow-hidden shadow-sm" id="wikot-action-${action.id}">
      <div class="bg-${meta.color}-50 px-4 py-2.5 flex items-center justify-between gap-2 border-b border-${meta.color}-100">
        <div class="flex items-center gap-2 min-w-0">
          <i class="fas ${meta.icon} text-${meta.color}-600"></i>
          <span class="font-semibold text-${meta.color}-800 text-sm truncate">${meta.label}</span>
        </div>
        ${statusBadge}
      </div>
      <div class="px-4 py-3 space-y-2 text-sm">
        ${title ? `<div class="font-medium text-navy-800 text-base">${escapeHtml(title)}</div>` : ''}

        ${beforeBlockHtml}
        ${afterBlockHtml}

        ${action.status === 'pending' ? `
          <div class="flex gap-2 pt-3 sticky bottom-0 bg-white">
            <button onclick="acceptWikotAction(${action.id})" class="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5">
              <i class="fas fa-check"></i>Accepter
            </button>
            <button onclick="rejectWikotAction(${action.id})" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5">
              <i class="fas fa-xmark"></i>Refuser
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Configuration visuelle/textuelle de chaque mode (Wikot vs Back Wikot)
const WIKOT_MODE_CONFIG = {
  standard: {
    title: 'Wikot',
    subtitle: 'Ton assistant de consultation',
    icon: 'fa-robot',
    avatarGradient: 'from-brand-400 to-purple-500',
    sendButton: 'bg-brand-500 hover:bg-brand-600',
    newButton: 'bg-brand-500 hover:bg-brand-600',
    focusRing: 'focus:ring-brand-400',
    selectedConv: 'bg-brand-50 border-l-2 border-l-brand-400',
    bouncingDots: 'bg-brand-400',
    placeholder: 'Pose ta question à Wikot…',
    inputId: 'wikot-input',
    messagesId: 'wikot-messages',
    emptyTitle: 'Bonjour, je suis Wikot',
    emptyText: "Je connais toutes les procédures et informations de l'hôtel. Pose-moi une question, je cherche, je résume et je te donne le bouton pour aller voir le détail.",
    quickButtons: [
      { label: 'Comment faire un check-in ?', q: 'Comment je fais un check-in ?' },
      { label: 'Horaires de la piscine ?', q: 'Quelles sont les horaires de la piscine ?' },
      { label: 'Carte démagnétisée ?', q: 'Que faire si une carte de chambre est démagnétisée ?' },
      { label: 'Procédures de réception', q: 'Liste-moi toutes les procédures de réception' }
    ],
    footer: 'Wikot peut faire des erreurs — vérifie les informations importantes.'
  },
  max: {
    title: 'Back Wikot',
    subtitle: 'Ton assistant de rédaction et création',
    icon: 'fa-pen-ruler',
    avatarGradient: 'from-orange-400 to-rose-500',
    sendButton: 'bg-orange-500 hover:bg-orange-600',
    newButton: 'bg-orange-500 hover:bg-orange-600',
    focusRing: 'focus:ring-orange-400',
    selectedConv: 'bg-orange-50 border-l-2 border-l-orange-400',
    bouncingDots: 'bg-orange-400',
    placeholder: 'Décris la procédure ou l\'information à créer / modifier…',
    inputId: 'wikot-max-input',
    messagesId: 'wikot-max-messages',
    emptyTitle: 'Bonjour, je suis Back Wikot',
    emptyText: "Je suis spécialisé dans la rédaction et la modification des procédures et informations. Décris-moi ce que tu veux créer ou modifier — je rédige, je structure, et tu valides via une carte avant/après.",
    quickButtons: [
      { label: 'Créer une procédure check-out', q: 'Crée-moi une procédure de check-out à la réception, du moment où le client se présente jusqu\'à son départ.' },
      { label: 'Ajouter une info Wi-Fi', q: 'Ajoute une information sur le Wi-Fi (nom du réseau, mot de passe, contact en cas de panne).' },
      { label: 'Modifier les horaires piscine', q: 'Je veux modifier les horaires d\'ouverture de la piscine.' },
      { label: 'Créer une procédure réclamation', q: 'Crée une procédure pour gérer une réclamation client à la réception.' }
    ],
    footer: 'Back Wikot propose les modifications — rien n\'est appliqué tant que tu n\'as pas validé la carte avant/après.'
  }
};

function renderWikotView(mode) {
  mode = mode || activeWikotMode();
  const cfg = WIKOT_MODE_CONFIG[mode];
  const s = wikotState(mode);
  const initialFlag = mode === 'max' ? '_wikotMaxInitialLoad' : '_wikotInitialLoad';

  // Lazy-load la liste des conversations à la première ouverture
  if (!state[initialFlag]) {
    state[initialFlag] = true;
    loadWikotConversations(mode).then(() => render());
  }

  const convs = s.conversations || [];
  const currentConv = convs.find(c => c.id === s.currentConvId);
  const messages = s.messages || [];
  const sidebarVisible = s.sidebarOpen;
  const isLoading = s.loading;
  const isSending = s.sending;

  const quickButtonsHtml = cfg.quickButtons.map(btn => `
    <button onclick="quickWikot('${btn.q.replace(/'/g, "\\'")}', '${mode}')" class="text-xs text-left bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 rounded-lg px-3 py-2 transition-colors">
      <i class="fas fa-question-circle text-gray-400 mr-1"></i>${escapeHtml(btn.label)}
    </button>
  `).join('');

  const emptyState = `
    <div class="flex flex-col items-center justify-center h-full p-6 text-center">
      <div class="w-20 h-20 rounded-full bg-gradient-to-br ${cfg.avatarGradient} flex items-center justify-center text-white text-3xl mb-4 shadow-lg">
        <i class="fas ${cfg.icon}"></i>
      </div>
      <h3 class="text-xl font-bold text-navy-800 mb-2">${cfg.emptyTitle}</h3>
      <p class="text-sm text-navy-500 max-w-md mb-6">${cfg.emptyText}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md w-full">
        ${quickButtonsHtml}
      </div>
    </div>
  `;

  return `
  <div class="fade-in flex flex-col" style="height: calc(100vh - 8rem); max-height: calc(100vh - 8rem);">
    <!-- Header Wikot/Back Wikot -->
    <div class="flex items-center justify-between mb-3 sm:mb-4 shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <button onclick="toggleWikotSidebar('${mode}')" class="lg:hidden w-9 h-9 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-navy-600 transition-colors" title="Mes conversations">
          <i class="fas fa-list"></i>
        </button>
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${cfg.avatarGradient} flex items-center justify-center text-white shadow-sm shrink-0">
          <i class="fas ${cfg.icon}"></i>
        </div>
        <div class="min-w-0">
          <h1 class="text-lg sm:text-xl font-bold text-navy-900 truncate">${cfg.title}</h1>
          <p class="text-xs text-navy-500 truncate">${currentConv ? escapeHtml(currentConv.title) : cfg.subtitle}</p>
        </div>
      </div>
      <button onclick="newWikotConversation('${mode}')" class="${cfg.newButton} text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5 shrink-0">
        <i class="fas fa-plus"></i><span class="hidden sm:inline">Nouvelle</span>
      </button>
    </div>

    <!-- Layout chat avec sidebar conversations -->
    <div class="flex-1 flex gap-4 min-h-0 overflow-hidden">
      <!-- Sidebar des conversations -->
      <div class="${sidebarVisible ? 'fixed inset-0 z-30 bg-black/40 lg:bg-transparent lg:relative lg:inset-auto lg:z-auto' : 'hidden'} lg:block">
        <div class="${sidebarVisible ? 'absolute left-0 top-0 bottom-0 w-72 lg:relative lg:w-64' : 'lg:w-64'} bg-white border-r lg:border border-gray-200 lg:rounded-xl flex flex-col h-full">
          <div class="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
            <span class="text-sm font-semibold text-navy-700">Mes conversations</span>
            <button onclick="toggleWikotSidebar('${mode}')" class="lg:hidden w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-navy-500" title="Fermer">
              <i class="fas fa-xmark"></i>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            ${convs.length === 0 ? `
              <div class="p-4 text-center text-xs text-navy-400">
                Aucune conversation.<br>Clique sur « Nouvelle » pour démarrer.
              </div>
            ` : convs.map(c => `
              <div onclick="loadWikotConversation(${c.id}, '${mode}'); ${mode === 'max' ? 'state.wikotMaxSidebarOpen' : 'state.wikotSidebarOpen'}=false;" class="px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${s.currentConvId === c.id ? cfg.selectedConv : ''}">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-navy-800 truncate">${escapeHtml(c.title)}</div>
                    <div class="text-[10px] text-navy-400 mt-0.5">${new Date(c.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <button onclick="deleteWikotConversation(${c.id}, event, '${mode}')" class="w-6 h-6 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 flex items-center justify-center shrink-0 transition-colors" title="Archiver">
                    <i class="fas fa-trash text-[10px]"></i>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Zone chat principale -->
      <div class="flex-1 flex flex-col bg-gradient-to-b from-gray-50 to-white border border-gray-200 rounded-xl overflow-hidden min-w-0">
        <div id="${cfg.messagesId}" class="flex-1 overflow-y-auto p-3 sm:p-4">
          ${messages.length === 0 && !isLoading ? emptyState : ''}
          ${isLoading ? '<div class="flex justify-center items-center h-full text-navy-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>' : ''}
          ${messages.map(m => renderWikotMessage(m, mode)).join('')}
          ${isSending ? `
            <div class="flex justify-start mb-4">
              <div class="flex gap-2">
                <div class="w-8 h-8 rounded-full bg-gradient-to-br ${cfg.avatarGradient} flex items-center justify-center text-white text-xs">
                  <i class="fas ${cfg.icon}"></i>
                </div>
                <div class="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <div class="flex gap-1">
                    <div class="w-2 h-2 rounded-full ${cfg.bouncingDots} animate-bounce" style="animation-delay: 0ms"></div>
                    <div class="w-2 h-2 rounded-full ${cfg.bouncingDots} animate-bounce" style="animation-delay: 150ms"></div>
                    <div class="w-2 h-2 rounded-full ${cfg.bouncingDots} animate-bounce" style="animation-delay: 300ms"></div>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Zone de saisie -->
        <div class="border-t border-gray-200 bg-white p-2 sm:p-3 shrink-0">
          <div class="flex items-end gap-2">
            <textarea id="${cfg.inputId}" rows="1"
              placeholder="${cfg.placeholder}"
              oninput="autoResizeTextarea(this)"
              onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendWikotMessage('${mode}');}"
              ${isSending ? 'disabled' : ''}
              class="form-input-mobile flex-1 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 ${cfg.focusRing} resize-none max-h-32 text-sm"></textarea>
            <button onclick="sendWikotMessage('${mode}')" ${isSending ? 'disabled' : ''} class="w-10 h-10 rounded-xl ${cfg.sendButton} disabled:bg-gray-300 text-white flex items-center justify-center shrink-0 transition-colors" title="Envoyer">
              <i class="fas ${isSending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i>
            </button>
          </div>
          <p class="text-[10px] text-navy-400 mt-1.5 text-center">${cfg.footer}</p>
        </div>
      </div>
    </div>
  </div>
  `;
}

function quickWikot(text, mode) {
  mode = mode || activeWikotMode();
  const cfg = WIKOT_MODE_CONFIG[mode];
  const input = document.getElementById(cfg.inputId);
  if (input) {
    input.value = text;
    sendWikotMessage(mode);
  }
}

// ============================================
// CONVERSATIONS (chat employés existant)
// ============================================
function renderConversationsView() {
  const canManage = userCanManageChannels();
  const groups = state.chatGroups || [];
  const hasSelected = !!state.selectedChannelId;

  // Mobile : si un salon est sélectionné → vue salon plein écran (pas de liste visible)
  // Desktop/tablette (lg+) : liste à gauche + chat à droite en permanence
  return `
  <div class="fade-in flex chat-view-shell w-full">
    <!-- Colonne liste des salons -->
    <div class="${hasSelected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 xl:w-96 lg:border-r lg:border-gray-200 bg-white lg:bg-gray-50 overflow-hidden shrink-0">
      <div class="px-4 sm:px-5 py-3 border-b border-gray-200 bg-white shrink-0 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-base sm:text-lg font-bold text-navy-900 truncate">
            <i class="fas fa-comments text-brand-400 mr-2"></i>Conversations
          </h2>
          <p class="text-[11px] text-navy-500 hidden sm:block">Salons de l'équipe</p>
        </div>
        ${canManage ? `
          <button onclick="showCreateChannelModal()" class="bg-brand-400 hover:bg-brand-500 text-white px-3 py-2 rounded-lg text-xs font-semibold shadow flex items-center gap-1.5 shrink-0">
            <i class="fas fa-plus"></i><span class="hidden sm:inline">Nouveau salon</span><span class="sm:hidden">Salon</span>
          </button>
        ` : ''}
      </div>

      <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        ${groups.length === 0 ? `
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <i class="fas fa-comments text-3xl text-navy-200 mb-2"></i>
            <p class="text-navy-500 text-sm">Aucun salon pour le moment.</p>
          </div>
        ` : groups.map(g => renderGroupCard(g, canManage)).join('')}
      </div>
    </div>

    <!-- Colonne salon ouvert (mobile : fullscreen fixe / desktop : 2e colonne qui prend tout l'espace restant) -->
    <div class="${hasSelected ? 'chat-mobile-fullscreen lg:flex lg:flex-col lg:flex-1 lg:min-w-0 lg:bg-white' : 'hidden lg:flex flex-col flex-1 min-w-0 bg-white'}">
      ${hasSelected ? renderChannelView() : `
        <div class="flex-1 flex items-center justify-center p-6 text-center bg-gray-50">
          <div>
            <div class="w-16 h-16 mx-auto bg-brand-50 rounded-2xl flex items-center justify-center mb-3">
              <i class="fas fa-comment-dots text-brand-400 text-2xl"></i>
            </div>
            <p class="text-navy-700 font-semibold">Sélectionnez un salon</p>
            <p class="text-navy-400 text-sm mt-1">Choisissez un salon dans la liste pour commencer à discuter.</p>
          </div>
        </div>
      `}
    </div>
  </div>`;
}

function renderGroupCard(group, canManage) {
  const channels = group.channels || [];
  const groupUnread = channels.reduce((s, c) => s + (c.unread_count || 0), 0);

  return `
  <div class="mb-5 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" data-group-card="${group.id}">
    <div class="px-4 sm:px-5 py-3 bg-navy-50 border-b border-gray-200 flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style="background:${group.color || '#3B82F6'}">
        <i class="fas ${group.icon || 'fa-folder'}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold text-navy-800 text-sm sm:text-base truncate">
          ${escapeHtml(group.name)}
          ${group.is_system ? '<span class="ml-2 text-[9px] uppercase font-bold text-navy-400 tracking-wider">par défaut</span>' : ''}
        </h3>
        <p class="text-xs text-navy-500">${channels.length} salon${channels.length > 1 ? 's' : ''}<span data-group-unread>${groupUnread > 0 ? ` · <span class="text-red-500 font-semibold">${groupUnread} non lu${groupUnread > 1 ? 's' : ''}</span>` : ''}</span></p>
      </div>
      ${canManage ? `
        <div class="flex items-center gap-1">
          <button onclick="showCreateChannelModal(${group.id})" title="Ajouter un salon dans ce groupe"
            class="w-8 h-8 rounded-lg bg-white hover:bg-brand-50 text-brand-500 transition-colors flex items-center justify-center">
            <i class="fas fa-plus text-xs"></i>
          </button>
          <button onclick="showEditGroupModal(${group.id})" title="Renommer le groupe"
            class="w-8 h-8 rounded-lg bg-white hover:bg-navy-100 text-navy-500 transition-colors flex items-center justify-center">
            <i class="fas fa-pen text-xs"></i>
          </button>
          ${!group.is_system ? `
            <button onclick="deleteGroup(${group.id})" title="Supprimer le groupe"
              class="w-8 h-8 rounded-lg bg-white hover:bg-red-50 text-red-500 transition-colors flex items-center justify-center">
              <i class="fas fa-trash text-xs"></i>
            </button>
          ` : ''}
        </div>
      ` : ''}
    </div>
    <div class="divide-y divide-gray-100">
      ${channels.length === 0 ? `
        <div class="px-5 py-4 text-sm text-navy-400 italic">Aucun salon dans ce groupe</div>
      ` : channels.map(ch => renderChannelRow(ch, canManage)).join('')}
    </div>
  </div>`;
}

function renderChannelRow(ch, canManage) {
  const unread = ch.unread_count || 0;
  return `
  <div class="px-4 sm:px-5 py-3 hover:bg-navy-50 transition-colors flex items-center gap-3 cursor-pointer group"
       onclick="openChannel(${ch.id})" data-channel-row="${ch.id}">
    <div class="w-8 h-8 rounded-lg bg-navy-100 text-navy-600 flex items-center justify-center shrink-0">
      <i class="fas ${ch.icon || 'fa-comment'} text-xs"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span data-channel-name class="text-navy-700 font-medium text-sm truncate ${unread > 0 ? 'font-bold' : ''}">${escapeHtml(ch.name)}</span>
        <span data-channel-unread class="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ${unread > 0 ? '' : 'hidden'}">${unread > 0 ? `${unread > 99 ? '99+' : unread} non lu${unread > 1 ? 's' : ''}` : ''}</span>
      </div>
      ${ch.description ? `<p class="text-xs text-navy-400 truncate">${escapeHtml(ch.description)}</p>` : ''}
    </div>
    ${canManage ? `
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onclick="event.stopPropagation(); showEditChannelModal(${ch.id})" title="Modifier"
          class="w-7 h-7 rounded bg-white border border-gray-200 hover:bg-navy-50 text-navy-500 flex items-center justify-center">
          <i class="fas fa-pen text-[10px]"></i>
        </button>
        <button onclick="event.stopPropagation(); deleteChannel(${ch.id})" title="Supprimer"
          class="w-7 h-7 rounded bg-white border border-gray-200 hover:bg-red-50 text-red-500 flex items-center justify-center">
          <i class="fas fa-trash text-[10px]"></i>
        </button>
      </div>
    ` : ''}
    <i class="fas fa-chevron-right text-navy-300 text-xs ml-1"></i>
  </div>`;
}

// ============================================
// CONVERSATIONS — Vue d'un salon ouvert
// ============================================
function renderChannelView() {
  const ch = state.chatChannels.find(c => c.id === state.selectedChannelId);
  if (!ch) {
    state.selectedChannelId = null;
    return renderConversationsView();
  }
  const messages = state.chatMessages || [];

  return `
  <div class="flex flex-col h-full w-full bg-white min-h-0">
    <!-- Header salon -->
    <div class="px-3 sm:px-5 py-3 border-b border-gray-200 flex items-center gap-3 shrink-0 bg-white">
      <button onclick="closeChannel()" class="w-9 h-9 rounded-lg hover:bg-navy-50 text-navy-600 flex items-center justify-center shrink-0 lg:hidden">
        <i class="fas fa-arrow-left"></i>
      </button>
      <div class="w-9 h-9 rounded-lg bg-navy-100 text-navy-600 flex items-center justify-center shrink-0">
        <i class="fas ${ch.icon || 'fa-comment'}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold text-navy-800 truncate">${escapeHtml(ch.name)}</h3>
        ${ch.description ? `<p class="text-xs text-navy-500 truncate">${escapeHtml(ch.description)}</p>` : `<p class="text-xs text-navy-400 italic truncate">${escapeHtml(ch.group_name || '')}</p>`}
      </div>
    </div>

    <!-- Zone messages -->
    <div id="chat-messages-zone" class="chat-messages-scroll px-3 sm:px-5 py-4 space-y-3 bg-gray-50">
      ${messages.length === 0 ? `
        <div class="text-center py-12">
          <i class="fas fa-comment-dots text-4xl text-navy-200 mb-2"></i>
          <p class="text-sm text-navy-400">Aucun message pour le moment.</p>
          <p class="text-xs text-navy-300 mt-1">Soyez le premier à écrire dans ce salon !</p>
        </div>
      ` : messages.map((m, i) => renderMessage(m, messages[i - 1])).join('')}
    </div>

    <!-- Champ d'envoi -->
    <div class="chat-input-bar border-t border-gray-200 p-2 sm:p-3 bg-white">
      <form onsubmit="event.preventDefault(); sendMessage()" class="flex items-end gap-2">
        <textarea id="chat-input" rows="1" placeholder="Écrivez votre message..."
          class="flex-1 resize-none px-3 sm:px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none text-sm max-h-32"
          onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); sendMessage();}"
          oninput="autoResizeTextarea(this)"></textarea>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow">
          <i class="fas fa-paper-plane text-sm"></i>
        </button>
      </form>
    </div>
  </div>`;
}

function renderMessage(m, prevMsg) {
  // Regrouper les messages consécutifs du même auteur en moins de 5 minutes
  const sameAuthor = prevMsg && prevMsg.user_id === m.user_id 
    && (new Date(m.created_at) - new Date(prevMsg.created_at)) < 5 * 60 * 1000;
  const isMe = state.user && m.user_id === state.user.id;
  const initials = (m.user_name || '?').charAt(0).toUpperCase();
  const time = formatChatTime(m.created_at);
  const roleBadge = m.user_role === 'admin' ? '<span class="text-[9px] uppercase font-bold text-blue-600 ml-1">admin</span>'
    : (m.user_role === 'employee' && m.user_can_edit ? '<span class="text-[9px] uppercase font-bold text-orange-500 ml-1">éditeur</span>' : '');

  if (sameAuthor) {
    return `
    <div class="flex gap-3 pl-12 hover:bg-white/50 -mx-3 px-3 py-0.5 rounded">
      <div class="flex-1 min-w-0">
        <p class="text-sm text-navy-700 whitespace-pre-wrap break-words">${escapeHtml(m.content)}${m.edited_at ? '<span class="text-[10px] text-navy-300 ml-1">(modifié)</span>' : ''}</p>
      </div>
    </div>`;
  }

  return `
  <div class="flex gap-3 hover:bg-white/50 -mx-3 px-3 py-1.5 rounded">
    <div class="w-9 h-9 rounded-full ${isMe ? 'bg-brand-400' : 'bg-navy-600'} text-white flex items-center justify-center font-semibold text-sm shrink-0">
      ${initials}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="font-semibold text-navy-800 text-sm">${escapeHtml(m.user_name || 'Inconnu')}</span>
        ${roleBadge}
        <span class="text-[11px] text-navy-400">${time}</span>
      </div>
      <p class="text-sm text-navy-700 whitespace-pre-wrap break-words mt-0.5">${escapeHtml(m.content)}${m.edited_at ? '<span class="text-[10px] text-navy-300 ml-1">(modifié)</span>' : ''}</p>
    </div>
  </div>`;
}

// ============================================
// CONVERSATIONS — Actions
// ============================================
function userCanManageChannels() {
  // Délègue au helper de permission granulaire (can_manage_chat)
  return userCanManageChat();
}

async function openChannel(channelId) {
  state.selectedChannelId = channelId;
  state.chatMessages = [];
  state.chatLastMessageId = null;
  render();
  // Charger les messages
  await loadChannelMessages();
  scrollChatToBottom();
  // Marquer comme lu
  await api(`/chat/channels/${channelId}/read`, { method: 'POST' });
  // Rafraîchir les badges en arrière-plan
  refreshChatBadges();
  // Lancer le polling des nouveaux messages
  startChannelPolling();
}

function closeChannel() {
  stopChannelPolling();
  state.selectedChannelId = null;
  state.chatMessages = [];
  // Recharger l'overview pour avoir les compteurs à jour
  refreshChatBadges();
  render();
}

async function loadChannelMessages() {
  if (!state.selectedChannelId) return;
  const data = await api(`/chat/channels/${state.selectedChannelId}/messages`);
  if (data) {
    state.chatMessages = data.messages || [];
    if (state.chatMessages.length > 0) {
      state.chatLastMessageId = state.chatMessages[state.chatMessages.length - 1].id;
    }
  }
}

async function pollNewMessages() {
  if (!state.selectedChannelId) return;
  const after = state.chatLastMessageId || 0;
  const data = await api(`/chat/channels/${state.selectedChannelId}/messages?after=${after}`);
  if (!data || !data.messages || data.messages.length === 0) return;

  // Nouveaux messages reçus
  state.chatMessages = [...(state.chatMessages || []), ...data.messages];
  state.chatLastMessageId = data.messages[data.messages.length - 1].id;
  // Re-render uniquement la zone messages
  const zone = document.getElementById('chat-messages-zone');
  if (zone) {
    const wasNearBottom = (zone.scrollHeight - zone.scrollTop - zone.clientHeight) < 100;
    // Re-render complet de la zone
    zone.innerHTML = state.chatMessages.map((m, i) => renderMessage(m, state.chatMessages[i - 1])).join('');
    if (wasNearBottom) scrollChatToBottom();
  }
  // Marquer comme lu (on est dans le salon ouvert)
  await api(`/chat/channels/${state.selectedChannelId}/read`, { method: 'POST' });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content || !state.selectedChannelId) return;

  input.value = '';
  input.style.height = 'auto';

  const data = await api(`/chat/channels/${state.selectedChannelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
  if (data && data.message) {
    state.chatMessages = [...(state.chatMessages || []), data.message];
    state.chatLastMessageId = data.message.id;
    const zone = document.getElementById('chat-messages-zone');
    if (zone) {
      zone.innerHTML = state.chatMessages.map((m, i) => renderMessage(m, state.chatMessages[i - 1])).join('');
      scrollChatToBottom();
    }
  }
}

function scrollChatToBottom() {
  setTimeout(() => {
    const zone = document.getElementById('chat-messages-zone');
    if (zone) zone.scrollTop = zone.scrollHeight;
  }, 50);
}

function autoResizeTextarea(el) {
  // Pour la barre d'envoi du chat : plafond 128px
  // Pour les textareas dans les modaux d'édition : plafond plus grand pour voir le contenu
  el.style.height = 'auto';
  const isInModal = !!el.closest('#modal-container');
  const maxHeight = isInModal ? 400 : 128;
  el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
}

// ============================================
// CONVERSATIONS — Polling
// ============================================
let chatGlobalPollingTimer = null;
let chatChannelPollingTimer = null;

function ensureChatGlobalPolling() {
  if (chatGlobalPollingTimer) return;
  if (!state.user || state.user.role === 'super_admin') return;
  // Toutes les 15s, refresh des compteurs globaux (sauf si on est dans un salon où le polling salon prend le relais)
  chatGlobalPollingTimer = setInterval(() => {
    if (!state.selectedChannelId) {
      refreshChatBadges();
    }
  }, 15000);
}

function stopChatPolling() {
  // Pas utilisé ici en pratique, mais kill le polling salon
  stopChannelPolling();
}

function startChannelPolling() {
  stopChannelPolling();
  // Toutes les 4s, check les nouveaux messages
  chatChannelPollingTimer = setInterval(pollNewMessages, 4000);
}

function stopChannelPolling() {
  if (chatChannelPollingTimer) {
    clearInterval(chatChannelPollingTimer);
    chatChannelPollingTimer = null;
  }
}

// ============================================
// CONVERSATIONS — Modals création/édition
// ============================================
function showCreateChannelModal(presetGroupId = null) {
  const groups = state.chatGroups || [];
  if (groups.length === 0) {
    showToast('Aucun groupe disponible', 'error');
    return;
  }
  const selectedGroupId = presetGroupId || groups[0].id;
  const selectedGroup = groups.find(g => g.id === selectedGroupId) || groups[0];
  const suggestions = CHANNEL_SUGGESTIONS[selectedGroup.name] || [];

  showModal('Créer un salon', `
    <form onsubmit="event.preventDefault(); submitCreateChannel()">
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Groupe</label>
        <select id="ch-group" onchange="refreshChannelSuggestions()" class="w-full px-3 py-2 border border-navy-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
          ${groups.map(g => `<option value="${g.id}" ${g.id === selectedGroupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Suggestions <span class="text-navy-400 font-normal text-xs">(cliquez pour pré-remplir)</span></label>
        <div id="ch-suggestions" class="flex flex-wrap gap-2">
          ${suggestions.map(s => `
            <button type="button" onclick="applyChannelSuggestion('${escapeHtml(s.name)}', '${s.icon}')"
              class="px-3 py-1.5 bg-navy-50 hover:bg-brand-50 hover:text-brand-600 border border-navy-200 hover:border-brand-300 rounded-full text-xs text-navy-600 transition-colors flex items-center gap-1.5">
              <i class="fas ${s.icon} text-[10px]"></i>${escapeHtml(s.name)}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Nom du salon <span class="text-red-500">*</span></label>
        <input id="ch-name" type="text" required maxlength="60" placeholder="ex: chambre-301"
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Description <span class="text-navy-400 font-normal text-xs">(facultatif)</span></label>
        <textarea id="ch-description" rows="3" maxlength="200" oninput="autoResizeTextarea(this)" placeholder="ex: Discussions liées à cette chambre"
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"></textarea>
      </div>

      <input type="hidden" id="ch-icon" value="fa-hashtag">

      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 bg-brand-400 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold shadow">
          <i class="fas fa-check mr-1"></i>Créer
        </button>
      </div>
    </form>
  `);
}

function refreshChannelSuggestions() {
  const groupId = parseInt(document.getElementById('ch-group').value);
  const group = (state.chatGroups || []).find(g => g.id === groupId);
  if (!group) return;
  const suggestions = CHANNEL_SUGGESTIONS[group.name] || [];
  const container = document.getElementById('ch-suggestions');
  if (container) {
    container.innerHTML = suggestions.map(s => `
      <button type="button" onclick="applyChannelSuggestion('${escapeHtml(s.name)}', '${s.icon}')"
        class="px-3 py-1.5 bg-navy-50 hover:bg-brand-50 hover:text-brand-600 border border-navy-200 hover:border-brand-300 rounded-full text-xs text-navy-600 transition-colors flex items-center gap-1.5">
        <i class="fas ${s.icon} text-[10px]"></i>${escapeHtml(s.name)}
      </button>
    `).join('') || '<span class="text-xs text-navy-400 italic">Aucune suggestion pour ce groupe</span>';
  }
}

function applyChannelSuggestion(name, icon) {
  const nameInput = document.getElementById('ch-name');
  const iconInput = document.getElementById('ch-icon');
  if (nameInput) nameInput.value = name;
  if (iconInput) iconInput.value = icon;
}

async function submitCreateChannel() {
  const group_id = parseInt(document.getElementById('ch-group').value);
  const name = document.getElementById('ch-name').value.trim();
  const description = document.getElementById('ch-description').value.trim();
  const icon = document.getElementById('ch-icon').value || 'fa-hashtag';
  if (!name) return;

  const data = await api('/chat/channels', {
    method: 'POST',
    body: JSON.stringify({ group_id, name, description, icon })
  });
  if (data && data.id) {
    closeModal();
    showToast('Salon créé', 'success');
    await loadChatData();
    render();
  }
}

function showEditChannelModal(channelId) {
  const ch = state.chatChannels.find(c => c.id === channelId);
  if (!ch) return;
  const groups = state.chatGroups || [];

  showModal('Modifier le salon', `
    <form onsubmit="event.preventDefault(); submitEditChannel(${channelId})">
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Groupe</label>
        <select id="ch-group" class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white">
          ${groups.map(g => `<option value="${g.id}" ${g.id === ch.group_id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Nom du salon</label>
        <input id="ch-name" type="text" required maxlength="60" value="${escapeHtml(ch.name)}"
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Description</label>
        <textarea id="ch-description" rows="3" maxlength="200" oninput="autoResizeTextarea(this)"
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">${escapeHtml(ch.description || '')}</textarea>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 bg-brand-400 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold shadow">Enregistrer</button>
      </div>
    </form>
  `);
}

async function submitEditChannel(channelId) {
  const group_id = parseInt(document.getElementById('ch-group').value);
  const name = document.getElementById('ch-name').value.trim();
  const description = document.getElementById('ch-description').value.trim();
  if (!name) return;
  const data = await api(`/chat/channels/${channelId}`, {
    method: 'PUT',
    body: JSON.stringify({ name, description, group_id })
  });
  if (data) {
    closeModal();
    showToast('Salon modifié', 'success');
    await loadChatData();
    render();
  }
}

async function deleteChannel(channelId) {
  const ch = state.chatChannels.find(c => c.id === channelId);
  if (!ch) return;
  if (!confirm(`Supprimer le salon "#${ch.name}" et tous ses messages ? Cette action est irréversible.`)) return;
  await api(`/chat/channels/${channelId}`, { method: 'DELETE' });
  showToast('Salon supprimé', 'success');
  await loadChatData();
  render();
}

function showEditGroupModal(groupId) {
  const g = (state.chatGroups || []).find(gr => gr.id === groupId);
  if (!g) return;
  showModal('Renommer le groupe', `
    <form onsubmit="event.preventDefault(); submitEditGroup(${groupId})">
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Nom du groupe</label>
        <input id="grp-name" type="text" required maxlength="60" value="${escapeHtml(g.name)}"
          class="form-input-mobile w-full px-3 py-2 border border-navy-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 bg-brand-400 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold shadow">Enregistrer</button>
      </div>
    </form>
  `);
}

async function submitEditGroup(groupId) {
  const name = document.getElementById('grp-name').value.trim();
  if (!name) return;
  await api(`/chat/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ name }) });
  closeModal();
  showToast('Groupe renommé', 'success');
  await loadChatData();
  render();
}

async function deleteGroup(groupId) {
  const g = (state.chatGroups || []).find(gr => gr.id === groupId);
  if (!g) return;
  if (!confirm(`Supprimer le groupe "${g.name}" et tous ses salons ? Cette action est irréversible.`)) return;
  await api(`/chat/groups/${groupId}`, { method: 'DELETE' });
  showToast('Groupe supprimé', 'success');
  await loadChatData();
  render();
}

// ============================================
// CHAT — Helpers
// ============================================
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChatTime(iso) {
  if (!iso) return '';
  // SQLite renvoie "YYYY-MM-DD HH:MM:SS" en UTC → on parse explicitement
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `aujourd'hui à ${time}`;
  if (isYesterday) return `hier à ${time}`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' à ' + time;
}

// ============================================
// MODALS
// ============================================
function showModal(title, content) {
  const container = document.getElementById('modal-container');
  container.innerHTML = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4 modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="bg-white shadow-2xl w-full max-w-2xl modal-panel fade-in">
      <div class="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 sticky top-0 bg-white z-10 modal-header">
        <h3 class="text-base sm:text-lg font-semibold text-navy-800 truncate pr-3">${title}</h3>
        <button onclick="closeModal()" class="w-9 h-9 rounded-lg bg-navy-50 hover:bg-navy-100 flex items-center justify-center text-navy-500 transition-colors shrink-0">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="p-4 sm:p-5 modal-body">
        ${content}
      </div>
    </div>
  </div>`;
  // Auto-resize toutes les textareas de saisie longue ouvertes dans le modal
  setTimeout(() => {
    document.querySelectorAll('#modal-container textarea[oninput*="autoResizeTextarea"]').forEach(t => {
      try { autoResizeTextarea(t); } catch(e) {}
    });
  }, 30);
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

// Procedure Form
async function showProcedureForm(procedureId = null) {
  let proc = null, steps = [], conditions = [];
  if (procedureId) {
    const data = await api(`/procedures/${procedureId}`);
    if (data) { proc = data.procedure; steps = data.steps; conditions = data.conditions; }
  }

  // Tracker la procédure courante pour exclure de la liste des sous-procédures dans stepFieldHTML
  currentEditingProcId = procedureId;

  const content = `
  <form onsubmit="event.preventDefault(); saveProcedure(${procedureId || 'null'})">
    <div class="space-y-4">
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Titre de la procédure *</label>
          <input id="proc-title" type="text" required value="${proc?.title || ''}" placeholder="Ex: Check-in d'un client" data-proc-id="${procedureId || ''}"
            class="form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1"><i class="fas fa-bolt text-brand-400 mr-1"></i>Déclencheur — Qu'est-ce qu'il se passe ? *</label>
          <input id="proc-trigger" type="text" required value="${proc?.trigger_event || ''}" placeholder="Ex: Un client arrive à la réception pour s'enregistrer"
            class="form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Description / Contexte</label>
          <textarea id="proc-desc" rows="3" oninput="autoResizeTextarea(this)" placeholder="Contexte, objectif, infos importantes à savoir avant de commencer..."
            class="form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">${proc?.description || ''}</textarea>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-navy-600 mb-1">Catégorie</label>
            <select id="proc-category" class="form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400 bg-white">
              <option value="">Sans catégorie</option>
              ${state.categories.map(c => `<option value="${c.id}" ${proc?.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Steps -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-semibold text-navy-700"><i class="fas fa-list-check mr-1 text-blue-500"></i>Étapes — Qu'est-ce que je dois faire ?</label>
          <button type="button" onclick="addStepField()" class="text-xs text-blue-500 hover:text-blue-700"><i class="fas fa-plus mr-1"></i>Ajouter une étape</button>
        </div>
        <div id="steps-container" class="space-y-3">
          ${steps.length > 0 ? steps.map((s, i) => stepFieldHTML(i, s)).join('') : stepFieldHTML(0)}
        </div>
      </div>

      <!-- Conditions -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-semibold text-navy-700"><i class="fas fa-code-branch mr-1 text-purple-500"></i>Cas spécifiques (optionnel)</label>
          <button type="button" onclick="addConditionField()" class="text-xs text-purple-500 hover:text-purple-700"><i class="fas fa-plus mr-1"></i>Ajouter un cas</button>
        </div>
        <div id="conditions-container" class="space-y-4">
          ${conditions.map((c, i) => conditionFieldHTML(i, c)).join('')}
        </div>
      </div>

      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-4 border-t border-gray-100 sticky bottom-0 bg-white -mx-4 sm:-mx-5 px-4 sm:px-5 -mb-4 sm:-mb-5 pb-4 sm:pb-5 z-10">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 text-sm font-medium text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-lg transition-colors">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-3 sm:py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm">
          <i class="fas fa-save mr-1.5"></i>${proc ? 'Mettre à jour' : 'Créer la procédure'}
        </button>
      </div>
    </div>
  </form>`;

  showModal(proc ? 'Modifier la procédure' : 'Nouvelle procédure', content);
}

let stepCounter = 0;
let conditionCounter = 0;

// Variable globale pour tracker la procédure actuellement en édition
// (utilisée par stepFieldHTML pour exclure la procédure courante de la liste des sous-procédures)
let currentEditingProcId = null;

function stepFieldHTML(index, step = null) {
  const id = stepCounter++;
  // Liste des procédures dispo pour la sous-procédure (on exclut celle qu'on édite)
  const availableProcedures = (state.procedures || []).filter(p => !currentEditingProcId || String(p.id) !== String(currentEditingProcId));
  const isLinked = step && step.linked_procedure_id;
  const linkedId = step?.linked_procedure_id || '';

  return `
  <div class="bg-navy-50 rounded-lg p-3 sm:p-4 step-field" data-step-id="${id}">
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <span class="text-sm font-bold text-navy-500">Étape ${index + 1}</span>
      <button type="button" onclick="this.closest('.step-field').remove()" class="ml-auto text-red-400 hover:text-red-600 text-sm w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center"><i class="fas fa-trash"></i></button>
    </div>

    <!-- Type d'étape : simple ou sous-procédure -->
    <div class="flex gap-2 mb-3 p-1 bg-white rounded-lg border border-navy-200">
      <label class="flex-1 cursor-pointer">
        <input type="radio" name="step-kind-${id}" class="step-kind sr-only" value="simple" ${!isLinked ? 'checked' : ''} onchange="toggleStepKind(this)">
        <div class="text-center text-sm font-medium px-3 py-2 rounded-md transition-colors ${!isLinked ? 'bg-brand-400 text-white' : 'text-navy-500 hover:bg-navy-50'}">
          <i class="fas fa-pen-to-square mr-1.5"></i>Étape simple
        </div>
      </label>
      <label class="flex-1 cursor-pointer">
        <input type="radio" name="step-kind-${id}" class="step-kind sr-only" value="linked" ${isLinked ? 'checked' : ''} onchange="toggleStepKind(this)">
        <div class="text-center text-sm font-medium px-3 py-2 rounded-md transition-colors ${isLinked ? 'bg-purple-500 text-white' : 'text-navy-500 hover:bg-navy-50'}">
          <i class="fas fa-diagram-project mr-1.5"></i>Sous-procédure
        </div>
      </label>
    </div>

    <label class="block text-xs font-medium text-navy-500 mb-1">Titre *</label>
    <input type="text" class="step-title form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2.5 text-base mb-3" placeholder="Ex: Vérifier l'identité du client" value="${step?.title || ''}" required>

    <!-- Bloc étape simple -->
    <div class="step-simple-block ${isLinked ? 'hidden' : ''}">
      <label class="block text-xs font-medium text-navy-500 mb-1">Contenu / Instructions</label>
      <textarea class="step-content form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2.5 text-base" rows="5" oninput="autoResizeTextarea(this)" placeholder="Détails complets de l'étape : ce qu'il faut faire, dire, vérifier...&#10;&#10;Astuces : utilisez **gras** pour mettre en valeur, • pour des puces.">${step?.content || ''}</textarea>
      <p class="text-xs text-navy-400 mt-1">Vous pouvez utiliser **gras** et des puces (• ou -)</p>
    </div>

    <!-- Bloc sous-procédure -->
    <div class="step-linked-block ${isLinked ? '' : 'hidden'}">
      <label class="block text-xs font-medium text-purple-600 mb-1"><i class="fas fa-diagram-project mr-1"></i>Procédure liée</label>
      <select class="step-linked-id form-input-mobile w-full border border-purple-200 rounded-lg px-3 py-2.5 text-base bg-white">
        <option value="">— Choisir une procédure —</option>
        ${availableProcedures.map(p => `<option value="${p.id}" ${String(p.id) === String(linkedId) ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
      </select>
      <p class="text-xs text-navy-400 mt-1">Cette étape ouvrira la procédure sélectionnée en sous-vue.</p>
    </div>
  </div>`;
}

// Toggle UI des deux variantes d'étape (simple / sous-procédure)
function toggleStepKind(radio) {
  const field = radio.closest('.step-field');
  if (!field) return;
  const kind = radio.value;
  const simpleBlock = field.querySelector('.step-simple-block');
  const linkedBlock = field.querySelector('.step-linked-block');
  if (simpleBlock) simpleBlock.classList.toggle('hidden', kind !== 'simple');
  if (linkedBlock) linkedBlock.classList.toggle('hidden', kind !== 'linked');
  // Mise à jour visuelle des labels (couleur active)
  field.querySelectorAll('.step-kind').forEach(r => {
    const wrapper = r.parentElement.querySelector('div');
    if (!wrapper) return;
    const isActive = r.checked;
    if (r.value === 'simple') {
      wrapper.className = `text-center text-sm font-medium px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-brand-400 text-white' : 'text-navy-500 hover:bg-navy-50'}`;
    } else {
      wrapper.className = `text-center text-sm font-medium px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-purple-500 text-white' : 'text-navy-500 hover:bg-navy-50'}`;
    }
  });
}

function conditionFieldHTML(index, cond = null) {
  const id = conditionCounter++;
  const condSteps = cond?.steps || [];
  return `
  <div class="bg-purple-50 rounded-lg p-3 sm:p-4 condition-field border border-purple-100" data-cond-id="${id}">
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <i class="fas fa-code-branch text-purple-500 text-sm"></i>
      <span class="text-sm font-bold text-purple-600">Si en plus...</span>
      <button type="button" onclick="this.closest('.condition-field').remove()" class="ml-auto text-red-400 hover:text-red-600 text-sm w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center"><i class="fas fa-trash"></i></button>
    </div>
    <label class="block text-xs font-medium text-purple-600 mb-1">Condition *</label>
    <input type="text" class="cond-text form-input-mobile w-full border border-purple-200 rounded-lg px-3 py-2.5 text-base mb-3" placeholder="Ex: Le client est un VIP" value="${cond?.condition_text || ''}" required>
    <label class="block text-xs font-medium text-purple-600 mb-1">Description du cas</label>
    <textarea class="cond-desc form-input-mobile w-full border border-purple-200 rounded-lg px-3 py-2.5 text-base mb-3" rows="3" oninput="autoResizeTextarea(this)" placeholder="Décrivez ce cas particulier">${cond?.description || ''}</textarea>
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-semibold text-purple-600">Étapes spécifiques à ce cas</span>
      <button type="button" onclick="addCondStepField(this)" class="text-xs text-purple-600 hover:text-purple-800 font-medium px-2 py-1 rounded hover:bg-purple-100"><i class="fas fa-plus mr-1"></i>Ajouter</button>
    </div>
    <div class="cond-steps-container space-y-2">
      ${condSteps.map((s, i) => condStepFieldHTML(i, s)).join('')}
    </div>
  </div>`;
}

function condStepFieldHTML(index, step = null) {
  return `
  <div class="bg-white rounded-lg p-3 cond-step-field border border-purple-100">
    <div class="flex items-center gap-2 mb-2">
      <span class="text-xs font-semibold text-purple-500">Étape ${index + 1}</span>
      <button type="button" onclick="this.closest('.cond-step-field').remove()" class="ml-auto text-red-400 hover:text-red-600 w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center"><i class="fas fa-times text-sm"></i></button>
    </div>
    <input type="text" class="cstep-title form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2.5 text-base mb-2" placeholder="Titre de l'étape" value="${step?.title || ''}">
    <textarea class="cstep-content form-input-mobile w-full border border-navy-200 rounded-lg px-3 py-2.5 text-base" rows="3" oninput="autoResizeTextarea(this)" placeholder="Contenu / instructions">${step?.content || step?.description || ''}</textarea>
  </div>`;
}

function addStepField() {
  const container = document.getElementById('steps-container');
  const count = container.querySelectorAll('.step-field').length;
  container.insertAdjacentHTML('beforeend', stepFieldHTML(count));
}

function addConditionField() {
  const container = document.getElementById('conditions-container');
  const count = container.querySelectorAll('.condition-field').length;
  container.insertAdjacentHTML('beforeend', conditionFieldHTML(count));
}

function addCondStepField(btn) {
  const container = btn.closest('.condition-field').querySelector('.cond-steps-container');
  const count = container.querySelectorAll('.cond-step-field').length;
  container.insertAdjacentHTML('beforeend', condStepFieldHTML(count));
}

async function saveProcedure(existingId) {
  const steps = [];
  document.querySelectorAll('.step-field').forEach((el, i) => {
    const title = el.querySelector('.step-title').value.trim();
    if (!title) return;
    const kind = el.querySelector('.step-kind:checked')?.value || 'simple';
    const linkedId = el.querySelector('.step-linked-id')?.value;
    const isLinked = kind === 'linked' && linkedId;
    steps.push({
      step_number: i + 1,
      title,
      content: isLinked ? '' : (el.querySelector('.step-content')?.value.trim() || ''),
      linked_procedure_id: isLinked ? parseInt(linkedId) : null
    });
  });

  const conditions = [];
  document.querySelectorAll('.condition-field').forEach((el, i) => {
    const condText = el.querySelector('.cond-text').value.trim();
    if (!condText) return;
    const condSteps = [];
    el.querySelectorAll('.cond-step-field').forEach((sel, j) => {
      const title = sel.querySelector('.cstep-title').value.trim();
      if (!title) return;
      condSteps.push({ step_number: j + 1, title, content: sel.querySelector('.cstep-content').value.trim() });
    });
    conditions.push({ condition_text: condText, description: el.querySelector('.cond-desc').value.trim(), sort_order: i, steps: condSteps });
  });

  const desc = document.getElementById('proc-desc').value.trim();
  const trigger = document.getElementById('proc-trigger').value.trim();
  const body = {
    title: document.getElementById('proc-title').value.trim(),
    description: desc,
    trigger_event: trigger,
    category_id: document.getElementById('proc-category').value || null,
    steps,
    conditions
  };

  const result = existingId
    ? await api(`/procedures/${existingId}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/procedures', { method: 'POST', body: JSON.stringify(body) });

  if (result) {
    closeModal();
    await loadData();
    render();
    showToast(existingId ? 'Procédure mise à jour' : 'Procédure créée', 'success');
  }
}

async function changeProcedureStatus(id, status) {
  if (!confirm(`Voulez-vous passer cette procédure en "${status}" ?`)) return;
  await api(`/procedures/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
  await loadData();
  render();
  showToast('Statut mis à jour', 'success');
}

// Suggestion Form
function showSuggestionForm(procedureId = null) {
  const content = `
  <form onsubmit="event.preventDefault(); submitSuggestion(${procedureId || 'null'})">
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Type de suggestion *</label>
        <select id="sugg-type" required class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="improvement">💡 Amélioration d'une procédure existante</option>
          <option value="new_procedure">➕ Proposition de nouvelle procédure</option>
          <option value="issue">🐛 Signaler un problème</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Titre *</label>
        <input id="sugg-title" type="text" required placeholder="Résumé court de votre suggestion"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Description détaillée *</label>
        <textarea id="sugg-desc" rows="4" required placeholder="Décrivez en détail votre suggestion..."
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"></textarea>
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="bg-purple-500 hover:bg-purple-600 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          <i class="fas fa-paper-plane mr-1.5"></i>Envoyer la suggestion
        </button>
      </div>
    </div>
  </form>`;
  showModal('Nouvelle suggestion', content);
}

async function submitSuggestion(procedureId) {
  const data = {
    procedure_id: procedureId,
    type: document.getElementById('sugg-type').value,
    title: document.getElementById('sugg-title').value.trim(),
    description: document.getElementById('sugg-desc').value.trim()
  };
  const result = await api('/suggestions', { method: 'POST', body: JSON.stringify(data) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Suggestion envoyée', 'success');
  }
}

// User Form
function showUserForm() {
  const isSuperAdmin = state.user.role === 'super_admin';

  // Super admin : sélection hôtel obligatoire, rôle forcé à "admin"
  // Admin hôtel : crée des employés (ou admins) pour son hôtel
  const content = `
  <form onsubmit="event.preventDefault(); createUser()">
    <div class="space-y-4">
      ${isSuperAdmin ? `
      <div class="bg-blue-50 rounded-lg px-4 py-3 text-xs text-blue-700 flex items-center gap-2 mb-2">
        <i class="fas fa-circle-info"></i>
        En tant que Super Admin, vous créez uniquement des comptes administrateurs d'hôtel.
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Hôtel *</label>
        <select id="user-hotel" required class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="">— Sélectionner un hôtel —</option>
          ${state.hotels.map(h => `<option value="${h.id}">${h.name}</option>`).join('')}
        </select>
      </div>` : ''}
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nom complet *</label>
        <input id="user-name" type="text" required placeholder="Prénom Nom"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Email *</label>
        <input id="user-email" type="email" required placeholder="email@hotel.com"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Mot de passe *</label>
        <input id="user-password" type="password" required placeholder="••••••••"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      ${!isSuperAdmin ? `
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Rôle *</label>
        <select id="user-role" class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="employee">Employé</option>
          <option value="admin">Administrateur</option>
        </select>
      </div>` : '<input type="hidden" id="user-role" value="admin">'}
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          <i class="fas fa-user-plus mr-1.5"></i>Créer le compte
        </button>
      </div>
    </div>
  </form>`;
  showModal(isSuperAdmin ? 'Nouvel administrateur d\'hôtel' : 'Nouvel utilisateur', content);
}

async function createUser() {
  const data = {
    hotel_id: document.getElementById('user-hotel')?.value,
    name: document.getElementById('user-name').value.trim(),
    email: document.getElementById('user-email').value.trim(),
    password: document.getElementById('user-password').value,
    role: document.getElementById('user-role').value
  };
  const result = await api('/users', { method: 'POST', body: JSON.stringify(data) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Utilisateur créé', 'success');
  }
}

// Hotel Form
function showHotelForm() {
  const content = `
  <form onsubmit="event.preventDefault(); createHotel()">
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nom de l'hôtel *</label>
        <input id="hotel-name" type="text" required placeholder="Ex: Hôtel Le Grand Paris"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Adresse</label>
        <input id="hotel-address" type="text" placeholder="Adresse complète"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          <i class="fas fa-hotel mr-1.5"></i>Créer l'hôtel
        </button>
      </div>
    </div>
  </form>`;
  showModal('Nouvel hôtel', content);
}

async function createHotel() {
  const data = {
    name: document.getElementById('hotel-name').value.trim(),
    address: document.getElementById('hotel-address').value.trim()
  };
  const result = await api('/hotels', { method: 'POST', body: JSON.stringify(data) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Hôtel créé', 'success');
  }
}

// Template Form
function showTemplateForm() {
  const content = `
  <form onsubmit="event.preventDefault(); createTemplate()">
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nom du template *</label>
        <input id="tpl-name" type="text" required class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Description</label>
        <textarea id="tpl-desc" rows="2" class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"></textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Catégorie suggérée</label>
        <input id="tpl-category" type="text" placeholder="Ex: Réception" class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium text-navy-600">Étapes</label>
          <button type="button" onclick="addTplStep()" class="text-xs text-blue-500 hover:text-blue-700"><i class="fas fa-plus mr-1"></i>Ajouter</button>
        </div>
        <div id="tpl-steps-container" class="space-y-2">
          <div class="tpl-step flex gap-2">
            <input type="text" class="tpl-step-title flex-1 border border-navy-200 rounded px-2 py-1.5 text-sm" placeholder="Titre de l'étape">
            <input type="text" class="tpl-step-desc flex-1 border border-navy-200 rounded px-2 py-1.5 text-sm" placeholder="Description">
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          <i class="fas fa-save mr-1.5"></i>Créer le template
        </button>
      </div>
    </div>
  </form>`;
  showModal('Nouveau template', content);
}

function addTplStep() {
  document.getElementById('tpl-steps-container').insertAdjacentHTML('beforeend', `
    <div class="tpl-step flex gap-2">
      <input type="text" class="tpl-step-title flex-1 border border-navy-200 rounded px-2 py-1.5 text-sm" placeholder="Titre de l'étape">
      <input type="text" class="tpl-step-desc flex-1 border border-navy-200 rounded px-2 py-1.5 text-sm" placeholder="Description">
      <button type="button" onclick="this.closest('.tpl-step').remove()" class="text-red-400 hover:text-red-600 px-1"><i class="fas fa-times"></i></button>
    </div>`);
}

async function createTemplate() {
  const steps = [];
  document.querySelectorAll('.tpl-step').forEach((el, i) => {
    const title = el.querySelector('.tpl-step-title').value.trim();
    if (!title) return;
    steps.push({ step_number: i + 1, title, description: el.querySelector('.tpl-step-desc').value.trim(), step_type: 'action' });
  });

  const desc = document.getElementById('tpl-desc').value.trim();
  const data = {
    name: document.getElementById('tpl-name').value.trim(),
    description: desc,
    category_name: document.getElementById('tpl-category').value.trim(),
    // trigger_event toujours requis côté DB : on réutilise la description ou le nom
    trigger_event: desc || document.getElementById('tpl-name').value.trim(),
    steps
  };
  const result = await api('/templates', { method: 'POST', body: JSON.stringify(data) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Template créé', 'success');
  }
}

// Import Template Modal
async function showImportTemplateModal() {
  const data = await api('/templates');
  if (!data) return;

  const templates = data.templates || [];
  const content = templates.length === 0 ? `
    <p class="text-navy-400 text-center py-8">Aucun template disponible</p>
  ` : `
    <div class="space-y-3">
      <p class="text-sm text-navy-500 mb-4">Sélectionnez un template à importer dans vos procédures :</p>
      ${templates.map(t => `
        <div class="bg-navy-50 rounded-lg p-4 flex items-center justify-between hover:bg-navy-100 transition-colors">
          <div>
            <p class="font-medium text-navy-800">${t.name}</p>
            <p class="text-xs text-navy-400">${t.trigger_event}</p>
          </div>
          <button onclick="importTemplate(${t.id})" class="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
            <i class="fas fa-download mr-1"></i>Importer
          </button>
        </div>
      `).join('')}
    </div>`;
  showModal('Importer un template', content);
}

async function importTemplate(templateId) {
  const result = await api(`/templates/${templateId}/import`, { method: 'POST' });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast(result.message || 'Template importé', 'success');
  }
}

// ============================================
// CHANGE PASSWORD MODAL
// ============================================
function showChangePasswordModal() {
  const content = `
  <form onsubmit="event.preventDefault(); submitChangePassword()">
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Mot de passe actuel *</label>
        <input id="cp-current" type="password" required placeholder="••••••••"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nouveau mot de passe *</label>
        <input id="cp-new" type="password" required placeholder="••••••••" minlength="6"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Confirmer le nouveau mot de passe *</label>
        <input id="cp-confirm" type="password" required placeholder="••••••••" minlength="6"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          <i class="fas fa-key mr-1.5"></i>Changer le mot de passe
        </button>
      </div>
    </div>
  </form>`;
  showModal('Changer de mot de passe', content);
}

async function submitChangePassword() {
  const current = document.getElementById('cp-current').value;
  const newPwd = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;

  if (newPwd !== confirm) {
    showToast('Les mots de passe ne correspondent pas', 'error');
    return;
  }
  if (newPwd.length < 6) {
    showToast('Le mot de passe doit faire au moins 6 caractères', 'error');
    return;
  }

  const result = await api('/auth/change-password', {
    method: 'PUT',
    body: JSON.stringify({ current_password: current, new_password: newPwd })
  });
  if (result) {
    closeModal();
    showToast('Mot de passe modifié avec succès', 'success');
  }
}

// ============================================
// HELPERS
// ============================================
function getActionColor(action) {
  const colors = {
    created: 'bg-blue-100 text-blue-600',
    updated: 'bg-yellow-100 text-yellow-600',
    activated: 'bg-green-100 text-green-600',
    archived: 'bg-gray-100 text-gray-500',
    approved: 'bg-green-100 text-green-600',
    rejected: 'bg-red-100 text-red-600'
  };
  return colors[action] || 'bg-gray-100 text-gray-500';
}

function getActionIcon(action) {
  const icons = {
    created: 'fa-plus',
    updated: 'fa-pen',
    activated: 'fa-check-circle',
    archived: 'fa-archive',
    approved: 'fa-check-double',
    rejected: 'fa-times-circle'
  };
  return icons[action] || 'fa-circle';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'À l\'instant';
    if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `Il y a ${Math.floor(diff / 86400000)} jour(s)`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  if (state.token && state.user) {
    state.currentHotelId = state.user.hotel_id;
    // Les employés n'ont pas de dashboard → vue initiale = procédures
    if (state.user.role === 'employee') {
      state.currentView = 'procedures';
    }
    // Sync immédiat du profil au démarrage pour récupérer les éventuels
    // changements de droits effectués pendant que l'onglet était fermé
    await syncUserProfile();
    await loadData();
    ensureChatGlobalPolling();
    ensureProfilePolling();
  }
  render();
}

init();
