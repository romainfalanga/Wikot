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
  filterStatus: '',
  unreadRequired: 0
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
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('wikot_token');
  localStorage.removeItem('wikot_user');
  state.currentView = 'dashboard'; // reset propre pour la prochaine connexion
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
        <div class="mt-6 p-4 bg-navy-50 rounded-lg">
          <p class="text-xs font-medium text-navy-500 mb-2"><i class="fas fa-info-circle mr-1"></i>Comptes de démonstration :</p>
          <div class="space-y-1 text-xs text-navy-400">
            <p><span class="font-mono bg-white px-1.5 py-0.5 rounded">romain@wikot.app</span> — Super Admin</p>
            <p><span class="font-mono bg-white px-1.5 py-0.5 rounded">marie@grandparis.com</span> — Admin Hôtel</p>
            <p><span class="font-mono bg-white px-1.5 py-0.5 rounded">sophie@grandparis.com</span> — Employé éditeur</p>
            <p><span class="font-mono bg-white px-1.5 py-0.5 rounded">jean@grandparis.com</span> — Employé lecture seule</p>
            <p class="text-navy-300 mt-1">Mot de passe : <span class="font-mono bg-white px-1.5 py-0.5 rounded">demo123</span></p>
          </div>
        </div>
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
    // Admin hôtel : tout sauf suggestions
    menuItems = [
      { id: 'dashboard', icon: 'fa-gauge-high', label: 'Tableau de bord' },
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'search', icon: 'fa-magnifying-glass', label: 'Rechercher' },
      { id: 'changelog', icon: 'fa-clock-rotate-left', label: 'Historique', badge: state.unreadRequired },
      { id: 'users', icon: 'fa-users', label: 'Utilisateurs' },
    ];
  } else {
    // Employé (éditeur ou lecture seule) : pas de dashboard, pas de suggestions
    menuItems = [
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'search', icon: 'fa-magnifying-glass', label: 'Rechercher' },
      { id: 'changelog', icon: 'fa-clock-rotate-left', label: 'Historique', badge: state.unreadRequired },
    ];
  }

  const roleLabels = { super_admin: 'Super Admin', admin: 'Administrateur', employee: canEdit ? 'Employé (éditeur)' : 'Employé' };
  const roleColors = { super_admin: 'bg-purple-100 text-purple-700', admin: 'bg-blue-100 text-blue-700', employee: canEdit ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700' };

  return `
  <div class="flex h-screen overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-64 bg-navy-900 text-white flex flex-col shrink-0">
      <div class="p-5 border-b border-navy-700">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-brand-400 rounded-xl flex items-center justify-center shadow">
            <i class="fas fa-concierge-bell text-white"></i>
          </div>
          <div>
            <h1 class="text-lg font-bold tracking-tight">Wik<span class="text-brand-400">ot</span></h1>
            <p class="text-[10px] text-navy-400 uppercase tracking-wider">Procédures Hôtelières</p>
          </div>
        </div>
      </div>
      
      <nav class="flex-1 py-4 overflow-y-auto">
        ${menuItems.map(item => `
          <button onclick="navigate('${item.id}')" 
            class="sidebar-item ${state.currentView === item.id ? 'active' : ''} w-full text-left px-5 py-2.5 flex items-center gap-3 text-sm text-navy-200 hover:text-white">
            <i class="fas ${item.icon} w-5 text-center text-xs ${state.currentView === item.id ? 'text-brand-400' : ''}"></i>
            <span>${item.label}</span>
            ${item.badge ? `<span class="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">${item.badge}</span>` : ''}
          </button>
        `).join('')}
      </nav>

      <div class="p-4 border-t border-navy-700">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-9 h-9 bg-navy-600 rounded-full flex items-center justify-center text-sm font-semibold">
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
    <main class="flex-1 overflow-y-auto bg-gray-50">
      <div class="p-6 lg:p-8 max-w-7xl mx-auto">
        ${renderCurrentView()}
      </div>
    </main>
  </div>

  <!-- Modal Container -->
  <div id="modal-container"></div>`;
}

function navigate(view) {
  state.currentView = view;
  state.selectedProcedure = null;
  render();
}

// ============================================
// VIEW ROUTER
// ============================================
function renderCurrentView() {
  switch (state.currentView) {
    case 'dashboard': return renderDashboard();
    case 'procedures': return state.selectedProcedure ? renderProcedureDetail() : renderProceduresList();
    case 'search': return renderSearchView();
    case 'changelog': return renderChangelogView();
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
      <div class="mb-8">
        <h2 class="text-2xl font-bold text-navy-900">Tableau de bord <span class="text-brand-400">Super Admin</span></h2>
        <p class="text-navy-500 mt-1">Gestion de la plateforme — hôtels &amp; administrateurs</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        ${statCard('fa-hotel', 'Hôtels actifs', s.hotels || 0, 'bg-blue-500')}
        ${statCard('fa-users', 'Utilisateurs total', s.users || 0, 'bg-green-500')}
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-semibold text-navy-800"><i class="fas fa-hotel mr-2 text-blue-500"></i>Hôtels enregistrés</h3>
          <button onclick="navigate('hotels')" class="text-sm bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm">
            <i class="fas fa-plus mr-1.5"></i>Nouvel hôtel
          </button>
        </div>
        ${state.hotels.length === 0 ? `
          <div class="text-center py-10">
            <i class="fas fa-hotel text-4xl text-navy-200 mb-3"></i>
            <p class="text-navy-400 font-medium">Aucun hôtel enregistré</p>
            <p class="text-navy-300 text-sm mt-1">Commencez par créer votre premier hôtel</p>
          </div>
        ` : state.hotels.map(h => `
          <div class="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-0">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                <i class="fas fa-hotel text-blue-400 text-sm"></i>
              </div>
              <div>
                <p class="font-medium text-navy-800">${h.name}</p>
                <p class="text-xs text-navy-400"><i class="fas fa-map-marker-alt mr-1"></i>${h.address || 'Adresse non renseignée'}</p>
              </div>
            </div>
            <button onclick="navigate('users')" class="text-xs bg-navy-50 hover:bg-navy-100 text-navy-600 px-3 py-1.5 rounded-lg transition-colors">
              <i class="fas fa-users mr-1"></i>Gérer les admins
            </button>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // Admin / Employee dashboard
  return `
  <div class="fade-in">
    <div class="mb-8">
      <h2 class="text-2xl font-bold text-navy-900">Bonjour, <span class="text-brand-400">${state.user.name}</span></h2>
      <p class="text-navy-500 mt-1">${state.user.role === 'admin' ? 'Gérez les procédures de votre hôtel' : 'Consultez les procédures à suivre'}</p>
    </div>

    ${state.unreadRequired > 0 ? `
    <div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3 cursor-pointer hover:bg-red-100 transition-colors" onclick="navigate('changelog')">
      <div class="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
        <i class="fas fa-exclamation-triangle text-red-500"></i>
      </div>
      <div>
        <p class="font-semibold text-red-800">${state.unreadRequired} changement(s) de procédure à lire</p>
        <p class="text-xs text-red-600">Des procédures ont été mises à jour. Consultez les changements.</p>
      </div>
      <i class="fas fa-chevron-right text-red-300 ml-auto"></i>
    </div>` : ''}

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
      ${statCard('fa-sitemap', 'Procédures actives', s.active_procedures || 0, 'bg-green-500')}
      ${statCard('fa-file-pen', 'Brouillons', s.draft_procedures || 0, 'bg-yellow-500')}
      ${statCard('fa-users', 'Membres de l\'équipe', s.total_users || 0, 'bg-blue-500')}
    </div>

    <!-- Quick access to categories -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-navy-800 mb-4"><i class="fas fa-th-large mr-2 text-brand-400"></i>Accès rapide par catégorie</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        ${state.categories.map(cat => `
          <button onclick="state.filterCategory='${cat.id}'; navigate('procedures')" 
            class="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all text-center group">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-2 transition-colors" style="background:${cat.color}15">
              <i class="fas ${cat.icon} text-lg" style="color:${cat.color}"></i>
            </div>
            <p class="text-xs font-medium text-navy-700 group-hover:text-navy-900">${cat.name}</p>
            <p class="text-[10px] text-navy-400">${state.procedures.filter(p => p.category_id == cat.id && p.status === 'active').length} procédures</p>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Recent changes -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 class="text-lg font-semibold text-navy-800 mb-4"><i class="fas fa-clock-rotate-left mr-2 text-navy-400"></i>Derniers changements</h3>
      ${(s.recent_changes || []).length === 0 ? '<p class="text-navy-400 text-sm">Aucun changement récent</p>' :
        (s.recent_changes || []).map(ch => `
          <div class="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
            <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${getActionColor(ch.action)}">
              <i class="fas ${getActionIcon(ch.action)} text-xs"></i>
            </div>
            <div>
              <p class="text-sm text-navy-700">${ch.summary}</p>
              <p class="text-xs text-navy-400">${ch.user_name} · ${formatDate(ch.created_at)}</p>
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
  if (state.filterStatus) filtered = filtered.filter(p => p.status === state.filterStatus);

  // Group by category
  const grouped = {};
  filtered.forEach(p => {
    const catName = p.category_name || 'Sans catégorie';
    if (!grouped[catName]) grouped[catName] = { icon: p.category_icon || 'fa-folder', color: p.category_color || '#6B7280', procedures: [] };
    grouped[catName].procedures.push(p);
  });

  return `
  <div class="fade-in">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-sitemap mr-2 text-brand-400"></i>Procédures</h2>
        <p class="text-navy-500 text-sm mt-1">${filtered.length} procédure(s) · Vue arborescence</p>
      </div>
      <div class="flex gap-2">
        ${canEdit ? `
        <button onclick="showProcedureForm()" class="bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
          <i class="fas fa-plus mr-1.5"></i>Nouvelle procédure
        </button>` : ''}
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-wrap gap-3">
      <select onchange="state.filterCategory=this.value; render()" class="text-sm border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
        <option value="">Toutes les catégories</option>
        ${state.categories.map(c => `<option value="${c.id}" ${state.filterCategory == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
      </select>
      <select onchange="state.filterStatus=this.value; render()" class="text-sm border border-navy-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
        <option value="">Tous les statuts</option>
        <option value="active" ${state.filterStatus === 'active' ? 'selected' : ''}>✅ Active</option>
        <option value="draft" ${state.filterStatus === 'draft' ? 'selected' : ''}>📝 Brouillon</option>
        <option value="archived" ${state.filterStatus === 'archived' ? 'selected' : ''}>📦 Archivée</option>
      </select>
      ${state.filterCategory || state.filterStatus ? `
      <button onclick="state.filterCategory='';state.filterStatus=''; render()" class="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
        <i class="fas fa-times"></i>Réinitialiser
      </button>` : ''}
    </div>

    <!-- Tree View -->
    <div class="space-y-4">
      ${Object.keys(grouped).length === 0 ? `
        <div class="bg-white rounded-xl p-12 text-center border border-gray-100">
          <i class="fas fa-sitemap text-4xl text-navy-200 mb-4"></i>
          <p class="text-navy-400 font-medium">Aucune procédure trouvée</p>
          ${canEdit ? '<p class="text-sm text-navy-300 mt-1">Créez votre première procédure</p>' : ''}
        </div>
      ` : Object.entries(grouped).map(([catName, catData]) => `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-100 flex items-center gap-3" style="background:${catData.color}08">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:${catData.color}15">
              <i class="fas ${catData.icon} text-sm" style="color:${catData.color}"></i>
            </div>
            <h3 class="font-semibold text-navy-800">${catName}</h3>
            <span class="text-xs bg-navy-100 text-navy-500 px-2 py-0.5 rounded-full">${catData.procedures.length}</span>
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
  const statusConfig = {
    active: { label: 'Active', class: 'bg-green-100 text-green-700', icon: 'fa-check-circle' },
    draft: { label: 'Brouillon', class: 'bg-yellow-100 text-yellow-700', icon: 'fa-pen' },
    archived: { label: 'Archivée', class: 'bg-gray-100 text-gray-500', icon: 'fa-archive' }
  };
  const priorityConfig = {
    critical: { label: 'Critique', class: 'text-red-600' },
    high: { label: 'Important', class: 'text-orange-500' },
    normal: { label: 'Normal', class: 'text-blue-500' },
    low: { label: 'Faible', class: 'text-gray-400' }
  };
  const st = statusConfig[proc.status] || statusConfig.draft;
  const pr = priorityConfig[proc.priority] || priorityConfig.normal;

  return `
  <div class="px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer priority-${proc.priority}" onclick="viewProcedure(${proc.id})">
    <div class="flex items-start gap-4">
      <div class="w-10 h-10 bg-navy-50 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
        <i class="fas ${proc.trigger_icon || 'fa-bolt'} text-navy-500"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <h4 class="font-semibold text-navy-800 truncate">${proc.title}</h4>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium ${st.class}">
            <i class="fas ${st.icon} mr-0.5"></i>${st.label}
          </span>
          ${proc.priority !== 'normal' ? `<span class="text-[10px] font-medium ${pr.class}"><i class="fas fa-flag mr-0.5"></i>${pr.label}</span>` : ''}
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <i class="fas fa-bolt text-[10px] text-brand-400"></i>
          <p class="text-sm text-navy-600">${proc.trigger_event}</p>
        </div>
        <div class="flex items-center gap-4 text-[11px] text-navy-400">
          <span><i class="fas fa-list-ol mr-1"></i>${proc.step_count || 0} étapes</span>
          ${proc.condition_count > 0 ? `<span><i class="fas fa-code-branch mr-1"></i>${proc.condition_count} cas spécifiques</span>` : ''}
          <span><i class="fas fa-code-branch mr-1"></i>v${proc.version || 1}</span>
          ${proc.created_by_name ? `<span><i class="fas fa-user mr-1"></i>${proc.created_by_name}</span>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        ${canEdit ? `
          <button onclick="event.stopPropagation(); showProcedureForm(${proc.id})" class="w-8 h-8 rounded-lg bg-navy-50 hover:bg-navy-100 flex items-center justify-center text-navy-400 hover:text-navy-600 transition-colors" title="Modifier">
            <i class="fas fa-pen text-xs"></i>
          </button>
          ${proc.status === 'draft' ? `
          <button onclick="event.stopPropagation(); changeProcedureStatus(${proc.id}, 'active')" class="w-8 h-8 rounded-lg bg-green-50 hover:bg-green-100 flex items-center justify-center text-green-500 hover:text-green-700 transition-colors" title="Activer">
            <i class="fas fa-check text-xs"></i>
          </button>` : ''}
        ` : ''}
        <i class="fas fa-chevron-right text-navy-300 text-xs ml-2"></i>
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

  const priorityBorder = { critical: 'border-red-500', high: 'border-orange-400', normal: 'border-blue-400', low: 'border-gray-300' };

  return `
  <div class="fade-in">
    <!-- Header -->
    <div class="mb-6">
      <button onclick="state.selectedProcedure=null; navigate('procedures')" class="text-sm text-navy-400 hover:text-navy-600 mb-3 inline-flex items-center gap-1.5 transition-colors">
        <i class="fas fa-arrow-left"></i>Retour aux procédures
      </button>
      
      <div class="bg-white rounded-xl shadow-sm border-l-4 ${priorityBorder[proc.priority] || 'border-blue-400'} p-6">
        <div class="flex items-start justify-between">
          <div class="flex items-start gap-4">
            <div class="w-14 h-14 bg-navy-50 rounded-xl flex items-center justify-center">
              <i class="fas ${proc.trigger_icon || 'fa-bolt'} text-2xl text-navy-600"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-navy-900">${proc.title}</h2>
              ${proc.description ? `<p class="text-navy-500 text-sm mt-1">${proc.description}</p>` : ''}
              <div class="flex items-center gap-4 mt-3 text-xs text-navy-400">
                <span class="bg-navy-50 px-2 py-1 rounded">${proc.category_name || 'Sans catégorie'}</span>
                <span>v${proc.version}</span>
                ${proc.approved_by_name ? `<span><i class="fas fa-check-circle text-green-500 mr-1"></i>Approuvé par ${proc.approved_by_name}</span>` : ''}
              </div>
            </div>
          </div>
          ${canEdit ? `
          <div class="flex gap-2">
            <button onclick="showProcedureForm(${proc.id})" class="bg-navy-50 hover:bg-navy-100 text-navy-600 px-3 py-2 rounded-lg text-sm transition-colors">
              <i class="fas fa-pen mr-1"></i>Modifier
            </button>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Trigger -->
    <div class="bg-gradient-to-r from-brand-50 to-yellow-50 rounded-xl border border-brand-200 p-5 mb-6">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-brand-400 rounded-xl flex items-center justify-center shadow">
          <i class="fas fa-bolt text-white"></i>
        </div>
        <div>
          <p class="text-xs font-semibold text-brand-600 uppercase tracking-wide">Déclencheur — Qu'est-ce qu'il se passe ?</p>
          <p class="text-lg font-semibold text-navy-800 mt-0.5">${proc.trigger_event}</p>
          ${proc.trigger_conditions ? `<p class="text-sm text-navy-500 mt-1">${proc.trigger_conditions}</p>` : ''}
        </div>
      </div>
    </div>

    <!-- Steps - What to do -->
    <div class="mb-8">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
          <i class="fas fa-list-check text-white text-sm"></i>
        </div>
        <h3 class="text-lg font-semibold text-navy-800">Qu'est-ce que je dois faire ?</h3>
        <span class="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">${steps.length} étapes</span>
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
  const typeConfig = {
    action: { icon: 'fa-hand-pointer', color: 'bg-blue-500', label: 'Action' },
    decision: { icon: 'fa-code-branch', color: 'bg-purple-500', label: 'Décision' },
    notification: { icon: 'fa-bell', color: 'bg-yellow-500', label: 'Notification' },
    escalation: { icon: 'fa-arrow-up', color: 'bg-red-500', label: 'Escalade' },
    check: { icon: 'fa-clipboard-check', color: 'bg-green-500', label: 'Vérification' }
  };
  const tc = typeConfig[step.step_type] || typeConfig.action;

  return `
  <div class="step-connector ${index === total - 1 ? 'last-step' : ''}">
    <div class="flex gap-4 pb-6">
      <div class="flex flex-col items-center">
        <div class="w-10 h-10 ${tc.color} rounded-xl flex items-center justify-center text-white shadow-sm shrink-0 z-10">
          <span class="text-sm font-bold">${step.step_number}</span>
        </div>
      </div>
      <div class="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
        <div class="flex items-center gap-2 mb-1.5">
          <i class="fas ${tc.icon} text-xs ${tc.color.replace('bg-', 'text-')}"></i>
          <span class="text-[10px] uppercase tracking-wider font-semibold ${tc.color.replace('bg-', 'text-')}">${tc.label}</span>
          ${step.is_optional ? '<span class="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Optionnel</span>' : ''}
          ${step.duration_minutes ? `<span class="text-[10px] text-navy-400"><i class="fas fa-clock mr-0.5"></i>${step.duration_minutes} min</span>` : ''}
        </div>
        <h4 class="font-semibold text-navy-800">${step.title}</h4>
        ${step.description ? `<p class="text-sm text-navy-500 mt-1">${step.description}</p>` : ''}
        ${step.details ? `
        <div class="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p class="text-xs font-semibold text-blue-700 mb-1"><i class="fas fa-info-circle mr-1"></i>Détails</p>
          <p class="text-sm text-blue-800">${step.details}</p>
        </div>` : ''}
        ${step.warning ? `
        <div class="mt-3 bg-red-50 border border-red-100 rounded-lg p-3">
          <p class="text-xs font-semibold text-red-700 mb-1"><i class="fas fa-exclamation-triangle mr-1"></i>Attention</p>
          <p class="text-sm text-red-800">${step.warning}</p>
        </div>` : ''}
        ${step.tip ? `
        <div class="mt-3 bg-green-50 border border-green-100 rounded-lg p-3">
          <p class="text-xs font-semibold text-green-700 mb-1"><i class="fas fa-lightbulb mr-1"></i>Astuce</p>
          <p class="text-sm text-green-800">${step.tip}</p>
        </div>` : ''}
      </div>
    </div>
  </div>`;
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
        <p class="font-semibold text-purple-900">${cond.condition_text}</p>
      </div>
    </div>
    ${cond.description ? `<p class="px-5 pt-3 text-sm text-purple-700">${cond.description}</p>` : ''}
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
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-search mr-2 text-brand-400"></i>Rechercher une procédure</h2>
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
    p.status === 'active' && (
      p.title.toLowerCase().includes(query) ||
      p.trigger_event.toLowerCase().includes(query) ||
      (p.description || '').toLowerCase().includes(query)
    )
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
      ${results.map(proc => `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md cursor-pointer transition-all priority-${proc.priority}" onclick="viewProcedure(${proc.id})">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
              <i class="fas ${proc.trigger_icon || 'fa-bolt'} text-brand-500"></i>
            </div>
            <div class="flex-1">
              <h4 class="font-semibold text-navy-800">${proc.title}</h4>
              <p class="text-sm text-navy-500 mt-0.5"><i class="fas fa-bolt text-brand-400 mr-1 text-xs"></i>${proc.trigger_event}</p>
              <div class="flex gap-3 mt-2 text-[11px] text-navy-400">
                <span>${proc.category_name || 'Sans catégorie'}</span>
                <span>${proc.step_count} étapes</span>
                ${proc.condition_count > 0 ? `<span>${proc.condition_count} cas spécifiques</span>` : ''}
              </div>
            </div>
            <i class="fas fa-chevron-right text-navy-300 mt-2"></i>
          </div>
        </div>
      `).join('')}
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
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-clock-rotate-left mr-2 text-brand-400"></i>Historique des changements</h2>
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
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-users mr-2 text-brand-400"></i>Utilisateurs</h2>
        <p class="text-navy-500 text-sm mt-1">${filteredUsers.length} compte(s)${filterHotelId ? ' — filtré' : ''}</p>
      </div>
      <button onclick="showUserForm()" class="bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
        <i class="fas fa-user-plus mr-1.5"></i>Ajouter
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

    <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="bg-navy-50 text-xs text-navy-500 uppercase tracking-wider">
            <th class="text-left py-3 px-5">Utilisateur</th>
            ${isSuperAdmin ? '<th class="text-left py-3 px-5">Hôtel</th>' : ''}
            <th class="text-left py-3 px-5">Rôle</th>
            <th class="text-left py-3 px-5">Dernière connexion</th>
            <th class="text-left py-3 px-5">Statut</th>
            ${isAdmin ? '<th class="text-left py-3 px-5">Droits procédures</th>' : ''}
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
                ${isEmployee ? `
                  <button onclick="toggleEditPermission(${u.id}, ${hasEditRight ? 0 : 1})" 
                    class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${hasEditRight ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}">
                    <i class="fas ${hasEditRight ? 'fa-shield-halved' : 'fa-shield'}"></i>
                    ${hasEditRight ? 'Éditeur' : 'Lecture seule'}
                  </button>
                ` : `<span class="text-xs text-navy-300 italic">${u.role === 'admin' ? 'Droits admin' : '—'}</span>`}
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

    ${isAdmin ? `
    <div class="mt-4 bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-start gap-3">
      <i class="fas fa-circle-info text-orange-400 mt-0.5"></i>
      <div class="text-xs text-orange-700">
        <p class="font-semibold mb-1">Droits de modification des procédures</p>
        <p>Les <strong>admins</strong> ont toujours accès complet. Les <strong>employés éditeurs</strong> peuvent créer, modifier et supprimer des procédures. Les <strong>employés en lecture seule</strong> consultent uniquement.</p>
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
// HOTELS VIEW (Super Admin)
// ============================================
function renderHotelsView() {
  return `
  <div class="fade-in">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold text-navy-900"><i class="fas fa-hotel mr-2 text-brand-400"></i>Hôtels</h2>
        <p class="text-navy-500 text-sm mt-1">${state.hotels.length} hôtel(s)</p>
      </div>
      <button onclick="showHotelForm()" class="bg-brand-400 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
        <i class="fas fa-plus mr-1.5"></i>Nouvel hôtel
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${state.hotels.length === 0 ? `
        <div class="col-span-2 bg-white rounded-xl p-12 text-center border border-gray-100">
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
          ${t.description ? `<p class="text-sm text-navy-500 mb-3">${t.description}</p>` : ''}
          <div class="bg-navy-50 rounded-lg p-3 mb-3">
            <p class="text-xs text-navy-400 mb-1"><i class="fas fa-bolt mr-1 text-brand-400"></i>Déclencheur</p>
            <p class="text-sm text-navy-700">${t.trigger_event}</p>
          </div>
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
// MODALS
// ============================================
function showModal(title, content) {
  const container = document.getElementById('modal-container');
  container.innerHTML = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)closeModal()">
    <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto fade-in">
      <div class="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
        <h3 class="text-lg font-semibold text-navy-800">${title}</h3>
        <button onclick="closeModal()" class="w-8 h-8 rounded-lg bg-navy-50 hover:bg-navy-100 flex items-center justify-center text-navy-400 transition-colors">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>
      <div class="p-5">
        ${content}
      </div>
    </div>
  </div>`;
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

  const content = `
  <form onsubmit="event.preventDefault(); saveProcedure(${procedureId || 'null'})">
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label class="block text-sm font-medium text-navy-600 mb-1">Titre de la procédure *</label>
          <input id="proc-title" type="text" required value="${proc?.title || ''}" placeholder="Ex: Check-in d'un client"
            class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-navy-600 mb-1">Description</label>
          <textarea id="proc-desc" rows="2" placeholder="Description courte de la procédure"
            class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">${proc?.description || ''}</textarea>
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-navy-600 mb-1"><i class="fas fa-bolt text-brand-400 mr-1"></i>Déclencheur — Qu'est-ce qu'il se passe ? *</label>
          <input id="proc-trigger" type="text" required value="${proc?.trigger_event || ''}" placeholder="Ex: Un client arrive à la réception pour s'enregistrer"
            class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Catégorie</label>
          <select id="proc-category" class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
            <option value="">Sans catégorie</option>
            ${state.categories.map(c => `<option value="${c.id}" ${proc?.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Priorité</label>
          <select id="proc-priority" class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
            <option value="low" ${proc?.priority === 'low' ? 'selected' : ''}>Faible</option>
            <option value="normal" ${!proc || proc?.priority === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="high" ${proc?.priority === 'high' ? 'selected' : ''}>Important</option>
            <option value="critical" ${proc?.priority === 'critical' ? 'selected' : ''}>Critique</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Icône du déclencheur</label>
          <input id="proc-icon" type="text" value="${proc?.trigger_icon || 'fa-bolt'}" placeholder="fa-bolt"
            class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Statut</label>
          <select id="proc-status" class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
            <option value="draft" ${!proc || proc?.status === 'draft' ? 'selected' : ''}>Brouillon</option>
            <option value="active" ${proc?.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="archived" ${proc?.status === 'archived' ? 'selected' : ''}>Archivée</option>
          </select>
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

      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500 hover:text-navy-700 transition-colors">Annuler</button>
        <button type="submit" class="bg-brand-400 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
          <i class="fas fa-save mr-1.5"></i>${proc ? 'Mettre à jour' : 'Créer la procédure'}
        </button>
      </div>
    </div>
  </form>`;

  showModal(proc ? 'Modifier la procédure' : 'Nouvelle procédure', content);
}

let stepCounter = 0;
let conditionCounter = 0;

function stepFieldHTML(index, step = null) {
  const id = stepCounter++;
  return `
  <div class="bg-navy-50 rounded-lg p-3 step-field" data-step-id="${id}">
    <div class="flex items-center gap-2 mb-2">
      <span class="text-xs font-bold text-navy-400">Étape ${index + 1}</span>
      <select class="step-type text-[10px] border border-navy-200 rounded px-1.5 py-0.5">
        <option value="action" ${step?.step_type === 'action' || !step ? 'selected' : ''}>Action</option>
        <option value="check" ${step?.step_type === 'check' ? 'selected' : ''}>Vérification</option>
        <option value="notification" ${step?.step_type === 'notification' ? 'selected' : ''}>Notification</option>
        <option value="escalation" ${step?.step_type === 'escalation' ? 'selected' : ''}>Escalade</option>
        <option value="decision" ${step?.step_type === 'decision' ? 'selected' : ''}>Décision</option>
      </select>
      <button type="button" onclick="this.closest('.step-field').remove()" class="ml-auto text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>
    </div>
    <input type="text" class="step-title w-full border border-navy-200 rounded px-2 py-1.5 text-sm mb-1.5" placeholder="Titre de l'étape *" value="${step?.title || ''}" required>
    <textarea class="step-desc w-full border border-navy-200 rounded px-2 py-1.5 text-xs" rows="1" placeholder="Description">${step?.description || ''}</textarea>
    <textarea class="step-details w-full border border-navy-200 rounded px-2 py-1.5 text-xs mt-1" rows="1" placeholder="Détails / Instructions">${step?.details || ''}</textarea>
    <div class="grid grid-cols-2 gap-1.5 mt-1.5">
      <input type="text" class="step-warning border border-navy-200 rounded px-2 py-1 text-xs" placeholder="⚠️ Attention" value="${step?.warning || ''}">
      <input type="text" class="step-tip border border-navy-200 rounded px-2 py-1 text-xs" placeholder="💡 Astuce" value="${step?.tip || ''}">
    </div>
  </div>`;
}

function conditionFieldHTML(index, cond = null) {
  const id = conditionCounter++;
  const condSteps = cond?.steps || [];
  return `
  <div class="bg-purple-50 rounded-lg p-3 condition-field border border-purple-100" data-cond-id="${id}">
    <div class="flex items-center gap-2 mb-2">
      <i class="fas fa-code-branch text-purple-500 text-xs"></i>
      <span class="text-xs font-bold text-purple-600">Si en plus...</span>
      <button type="button" onclick="this.closest('.condition-field').remove()" class="ml-auto text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>
    </div>
    <input type="text" class="cond-text w-full border border-purple-200 rounded px-2 py-1.5 text-sm mb-1.5" placeholder="Condition - Ex: Le client est un VIP *" value="${cond?.condition_text || ''}" required>
    <textarea class="cond-desc w-full border border-purple-200 rounded px-2 py-1.5 text-xs mb-2" rows="1" placeholder="Description du cas">${cond?.description || ''}</textarea>
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-[10px] font-semibold text-purple-500">Étapes spécifiques à ce cas</span>
      <button type="button" onclick="addCondStepField(this)" class="text-[10px] text-purple-500 hover:text-purple-700"><i class="fas fa-plus mr-1"></i>Ajouter</button>
    </div>
    <div class="cond-steps-container space-y-2">
      ${condSteps.map((s, i) => condStepFieldHTML(i, s)).join('')}
    </div>
  </div>`;
}

function condStepFieldHTML(index, step = null) {
  return `
  <div class="bg-white rounded p-2 cond-step-field border border-purple-100">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-[10px] text-purple-400">Étape ${index + 1}</span>
      <button type="button" onclick="this.closest('.cond-step-field').remove()" class="ml-auto text-red-400 hover:text-red-600 text-[10px]"><i class="fas fa-times"></i></button>
    </div>
    <input type="text" class="cstep-title w-full border border-navy-200 rounded px-2 py-1 text-xs mb-1" placeholder="Titre *" value="${step?.title || ''}">
    <textarea class="cstep-desc w-full border border-navy-200 rounded px-2 py-1 text-[10px]" rows="1" placeholder="Description">${step?.description || ''}</textarea>
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
    steps.push({
      step_number: i + 1,
      title,
      description: el.querySelector('.step-desc').value.trim(),
      step_type: el.querySelector('.step-type').value,
      details: el.querySelector('.step-details').value.trim(),
      warning: el.querySelector('.step-warning').value.trim(),
      tip: el.querySelector('.step-tip').value.trim()
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
      condSteps.push({ step_number: j + 1, title, description: sel.querySelector('.cstep-desc').value.trim() });
    });
    conditions.push({ condition_text: condText, description: el.querySelector('.cond-desc').value.trim(), sort_order: i, steps: condSteps });
  });

  const body = {
    title: document.getElementById('proc-title').value.trim(),
    description: document.getElementById('proc-desc').value.trim(),
    trigger_event: document.getElementById('proc-trigger').value.trim(),
    trigger_icon: document.getElementById('proc-icon').value.trim() || 'fa-bolt',
    category_id: document.getElementById('proc-category').value || null,
    priority: document.getElementById('proc-priority').value,
    status: document.getElementById('proc-status').value,
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
        <label class="block text-sm font-medium text-navy-600 mb-1">Déclencheur *</label>
        <input id="tpl-trigger" type="text" required placeholder="Qu'est-ce qu'il se passe ?"
          class="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
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

  const data = {
    name: document.getElementById('tpl-name').value.trim(),
    description: document.getElementById('tpl-desc').value.trim(),
    category_name: document.getElementById('tpl-category').value.trim(),
    trigger_event: document.getElementById('tpl-trigger').value.trim(),
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
    await loadData();
  }
  render();
}

init();
