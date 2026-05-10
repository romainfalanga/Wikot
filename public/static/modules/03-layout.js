// ============================================
// WIKOT MODULE — 03-layout
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

// ============================================
// LOGIN PAGE — Espace Équipe uniquement
// ============================================
function renderLoginPage() {
  return `
  <div class="min-h-screen flex flex-col lg:flex-row" style="background: var(--c-cream);">
    <!-- COLONNE GAUCHE — branding premium (caché sur mobile) -->
    <div class="hidden lg:flex lg:w-1/2 relative overflow-hidden" style="background: var(--c-navy);">
      <div class="absolute inset-0 opacity-[0.07]" style="background-image: radial-gradient(circle at 1px 1px, #C9A961 1px, transparent 0); background-size: 32px 32px;"></div>
      <div class="absolute right-0 top-0 bottom-0 w-px" style="background: linear-gradient(to bottom, transparent, var(--c-gold), transparent);"></div>
      <div class="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
        <div>
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl flex items-center justify-center" style="background: var(--c-gold);">
              <i class="fas fa-concierge-bell text-lg" style="color: var(--c-navy);"></i>
            </div>
            <span class="font-display text-2xl font-semibold text-white">Wikot</span>
          </div>
        </div>
        <div class="max-w-md">
          <h2 class="font-display text-4xl xl:text-5xl font-medium text-white leading-tight">
            Chaque détail<br/>
            <span style="color: var(--c-gold);">soigneusement orchestré.</span>
          </h2>
        </div>
        <div></div>
      </div>
    </div>

    <!-- COLONNE DROITE — formulaire de connexion équipe -->
    <div class="flex-1 flex items-center justify-center p-6 lg:p-12">
      <div class="w-full max-w-md">
        <div class="flex lg:hidden items-center justify-center gap-3 mb-8 fade-in">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center" style="background: var(--c-gold);">
            <i class="fas fa-concierge-bell text-lg" style="color: var(--c-navy);"></i>
          </div>
          <span class="font-display text-2xl font-semibold" style="color: var(--c-navy);">Wikot</span>
        </div>

        <div class="bg-white rounded-2xl shadow-premium-lg overflow-hidden fade-in" style="border: 1px solid var(--c-line);">
          <div class="p-7 sm:p-9">
            ${renderStaffLoginForm()}
          </div>
        </div>

        <p class="text-center text-xs mt-6" style="color: rgba(15,27,40,0.4);">
          &copy; ${new Date().getFullYear()} Wikot &middot; Conçu pour l'hôtellerie d'exception
        </p>
      </div>
    </div>
  </div>`;
}

function renderStaffLoginForm() {
  return `
    <h2 class="font-display text-2xl font-semibold mb-1" style="color: var(--c-navy);">Connexion Équipe</h2>
    <p class="text-xs mb-7" style="color: rgba(15,27,40,0.5);">Réservée au personnel et à la direction de l'hôtel.</p>
    <form onsubmit="event.preventDefault(); login(document.getElementById('email').value, document.getElementById('password').value)">
      <div class="mb-4">
        <label class="block text-xs font-semibold mb-2 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">Email</label>
        <div class="relative">
          <i class="fas fa-envelope absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="email" type="email" required placeholder="votre@email.com"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm">
        </div>
      </div>
      <div class="mb-6">
        <label class="block text-xs font-semibold mb-2 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">Mot de passe</label>
        <div class="relative">
          <i class="fas fa-lock absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="password" type="password" required placeholder="••••••••"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm">
        </div>
      </div>
      <button type="submit" class="btn-premium w-full font-semibold py-3 rounded-lg transition-all" style="background: var(--c-navy); color: white;">
        <i class="fas fa-sign-in-alt mr-2"></i>Se connecter
      </button>
    </form>`;
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
    // Admin hôtel : accès complet aux pages opérationnelles équipe
    menuItems = [
      { id: 'wikot', icon: 'fa-robot', label: 'Wikot' },
      { id: 'wikot-max', icon: 'fa-pen-ruler', label: 'Back Wikot' },
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      { id: 'tasks', icon: 'fa-list-check', label: 'Tâches', badge: state.myTasksPendingCount },
      { id: 'users', icon: 'fa-users', label: 'Utilisateurs' },
    ];
  } else {
    // Employé : Wikot pour tous + items conditionnels selon permissions granulaires
    const canUseMax = userCanEditProcedures() || userCanEditInfo();
    menuItems = [
      { id: 'wikot', icon: 'fa-robot', label: 'Wikot' },
      ...(canUseMax ? [{ id: 'wikot-max', icon: 'fa-pen-ruler', label: 'Back Wikot' }] : []),
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      // Tâches : visible pour TOUS les employés (les permissions limitent juste les actions)
      { id: 'tasks', icon: 'fa-list-check', label: 'Tâches', badge: state.myTasksPendingCount },
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
    info: 'Informations',
    conversations: 'Conversations',
    users: 'Utilisateurs',
    hotels: 'Hôtels',
    templates: 'Modèles',
    tasks: 'Tâches',
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
      : ['wikot','procedures','info','conversations'];
    bottomNavItems = priorityIds
      .map(id => menuItems.find(i => i.id === id))
      .filter(Boolean)
      .slice(0, 5);
  }

  return `
  <!-- Overlay mobile sidebar -->
  <div id="sidebar-overlay" class="fixed inset-0 bg-black/50 z-30 hidden lg:hidden" onclick="closeSidebar()"></div>

  <div class="flex app-shell overflow-hidden">
    <!-- Sidebar premium -->
    <aside id="main-sidebar" class="sidebar-premium fixed lg:relative z-40 lg:z-auto -translate-x-full lg:translate-x-0 transition-transform duration-300 w-72 lg:w-64 flex flex-col shrink-0 h-full">
      <div class="px-6 py-6" style="border-bottom: 1px solid rgba(201,169,97,0.12);">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--c-gold);">
              <i class="fas fa-concierge-bell text-sm" style="color: var(--c-navy);"></i>
            </div>
            <div>
              <h1 class="font-display text-xl font-semibold tracking-tight" style="color: #fff;">Wikot</h1>
            </div>
          </div>
          <button onclick="closeSidebar()" class="lg:hidden p-1" style="color: rgba(255,255,255,0.5);">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <nav class="flex-1 py-4 overflow-y-auto">
        ${menuItems.map(item => `
          <button onclick="navigate('${item.id}'); closeSidebar()"
            class="sidebar-item-premium ${state.currentView === item.id ? 'active' : ''} w-full text-left px-6 py-2.5 flex items-center gap-3 text-sm">
            <i class="fas ${item.icon} w-5 text-center text-sm sidebar-icon"></i>
            <span class="sidebar-label">${item.label}</span>
            <span ${item.id === 'conversations' ? 'data-badge-conversations' : ''} class="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.badge ? '' : 'hidden'}" style="background: var(--c-gold); color: var(--c-navy);">${item.badge ? (item.badge > 99 ? '99+' : item.badge) : ''}</span>
          </button>
        `).join('')}
      </nav>

      <div class="px-5 py-4" style="border-top: 1px solid rgba(201,169,97,0.12);">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0" style="background: var(--c-gold); color: var(--c-navy);">
            ${state.user.name.charAt(0)}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate" style="color: #fff;">${state.user.name}</p>
            <span class="text-[10px] uppercase tracking-wider" style="color: var(--c-gold);">${roleLabels[state.user.role]}</span>
          </div>
        </div>
        <button onclick="showChangePasswordModal()" class="w-full text-left text-xs transition-colors flex items-center gap-2 px-1 mb-2" style="color: rgba(255,255,255,0.5);" onmouseover="this.style.color='var(--c-gold)'" onmouseout="this.style.color='rgba(255,255,255,0.5)'">
          <i class="fas fa-key"></i> Changer de mot de passe
        </button>
        <button onclick="logout()" class="w-full text-left text-xs transition-colors flex items-center gap-2 px-1" style="color: rgba(255,255,255,0.5);" onmouseover="this.style.color='#E27D6E'" onmouseout="this.style.color='rgba(255,255,255,0.5)'">
          <i class="fas fa-sign-out-alt"></i> Déconnexion
        </button>
      </div>
    </aside>

    <!-- Main Content premium -->
    <main class="flex-1 overflow-y-auto flex flex-col" style="background: var(--c-cream);">
      <!-- Header mobile premium avec burger + titre vue active + badges -->
      <div class="lg:hidden sticky top-0 z-20 px-3 sm:px-4 h-14 flex items-center gap-3 shrink-0" style="background: #fff; border-bottom: 1px solid var(--c-line); box-shadow: 0 1px 2px rgba(10,22,40,0.04);">
        <button onclick="openSidebar()" class="w-9 h-9 flex items-center justify-center rounded-lg transition-colors shrink-0" style="background: var(--c-cream-deep); color: var(--c-navy);">
          <i class="fas fa-bars"></i>
        </button>
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style="background: var(--c-gold);">
            <i class="fas fa-concierge-bell text-xs" style="color: var(--c-navy);"></i>
          </div>
          <span class="font-display font-semibold truncate" style="color: var(--c-navy);">${currentTitle}</span>
        </div>
        <div class="ml-auto flex items-center gap-2 shrink-0">
          <button onclick="navigate('conversations')" class="relative w-9 h-9 flex items-center justify-center rounded-lg ${state.unreadChatTotal > 0 ? '' : 'hidden'}" title="Messages non lus" data-mobile-chat-btn style="background: var(--c-cream-deep); color: var(--c-navy);">
            <i class="fas fa-comments"></i>
            <span data-badge-conversations class="absolute -top-1 -right-1 text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center" style="background: var(--c-gold); color: var(--c-navy);">${state.unreadChatTotal > 0 ? (state.unreadChatTotal > 99 ? '99+' : state.unreadChatTotal) : ''}</span>
          </button>

          <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold" style="background: var(--c-navy); color: var(--c-gold);">${state.user.name.charAt(0)}</div>
        </div>
      </div>

      <div id="main-content-container" class="flex-1 ${state.currentView === 'conversations' ? 'overflow-hidden w-full' : 'p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full mobile-content-padding'}">
        ${renderCurrentView()}
      </div>
    </main>
  </div>

  <!-- Bottom navigation premium (mobile uniquement) -->
  <nav class="mobile-bottomnav lg:hidden fixed bottom-0 left-0 right-0 z-20 flex" style="background: var(--c-navy); border-top: 1px solid rgba(201,169,97,0.15);">
    ${bottomNavItems.slice(0, 5).map(item => `
      <button onclick="navigate('${item.id}')" class="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors" style="color: ${state.currentView === item.id ? 'var(--c-gold)' : 'rgba(255,255,255,0.5)'};">
        <i class="fas ${item.icon} text-base"></i>
        <span class="text-[10px] font-medium leading-none mt-0.5">${item.label.split(' ')[0]}</span>
        <span ${item.id === 'conversations' ? 'data-badge-conversations' : ''} class="absolute top-1 right-1/4 text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[14px] text-center leading-none ${item.badge ? '' : 'hidden'}" style="background: var(--c-gold); color: var(--c-navy);">${item.badge ? (item.badge > 99 ? '99+' : item.badge) : ''}</span>
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
  // Ne push une entrée d'historique que si la vue change vraiment
  if (state.currentView !== view) {
    pushHistory(view);
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
  // Garde : seul le super admin a accès au Dashboard. Les autres sont redirigés.
  if (state.currentView === 'dashboard' && state.user && state.user.role !== 'super_admin') {
    state.currentView = 'procedures';
  }
  switch (state.currentView) {
    case 'dashboard': return renderDashboard();
    case 'wikot': return renderWikotView('standard');
    case 'wikot-max': return renderWikotView('max');
    case 'procedures': return state.selectedProcedure ? renderProcedureDetail() : renderProceduresList();
    case 'info': return renderHotelInfoView();
    case 'conversations': return renderConversationsView();
    case 'users': return renderUsersView();
    case 'hotels': return renderHotelsView();
    case 'templates': return renderTemplatesView();
    case 'procedure-detail': return renderProcedureDetail();
    case 'tasks': return renderTasksView();
    case 'hotel-settings': state.currentView = isSuperAdmin ? 'dashboard' : 'wikot'; return renderCurrentView();
    default:
      return (state.user && state.user.role === 'super_admin') ? renderDashboard() : renderProceduresList();
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
      <div class="mb-7 sm:mb-9">
        <p class="section-eyebrow mb-2">Administration</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Tableau de bord</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">Gestion de la plateforme — hôtels &amp; administrateurs</p>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:gap-5 mb-7">
        ${statCard('fa-hotel', 'Hôtels actifs', s.hotels || 0)}
        ${statCard('fa-users', 'Utilisateurs total', s.users || 0)}
      </div>
      <div class="card-premium p-5 sm:p-6">
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
          <div>
            <p class="section-eyebrow mb-1.5">Établissements</p>
            <h3 class="section-title-premium text-lg sm:text-xl">Hôtels enregistrés</h3>
          </div>
          <button onclick="navigate('hotels')" class="btn-premium self-start sm:self-auto text-sm px-5 py-2.5 rounded-lg font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;">
            <i class="fas fa-plus text-xs"></i>Nouvel hôtel
          </button>
        </div>
        ${state.hotels.length === 0 ? `
          <div class="empty-state-premium">
            <div class="empty-icon"><i class="fas fa-hotel"></i></div>
            <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucun hôtel enregistré</p>
            <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Commencez par créer votre premier hôtel.</p>
          </div>
        ` : state.hotels.map(h => `
          <div class="flex items-center justify-between py-3.5 gap-3" style="border-bottom: 1px solid var(--c-line);">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: rgba(201,169,97,0.12);">
                <i class="fas fa-hotel text-sm" style="color: var(--c-gold-deep);"></i>
              </div>
              <div class="min-w-0">
                <p class="font-display font-semibold truncate" style="color: var(--c-navy);">${h.name}</p>
                <p class="text-xs truncate mt-0.5" style="color: rgba(15,27,40,0.5);"><i class="fas fa-map-marker-alt mr-1" style="color: var(--c-gold);"></i>${h.address || 'Adresse non renseignée'}</p>
              </div>
            </div>
            <button onclick="navigate('users')" class="shrink-0 text-xs px-3 py-1.5 rounded-lg transition-all" style="background: var(--c-cream-deep); color: var(--c-navy);" onmouseover="this.style.background='var(--c-gold)'" onmouseout="this.style.background='var(--c-cream-deep)'">
              <i class="fas fa-users mr-1"></i><span class="hidden sm:inline">Gérer les </span>admins
            </button>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // Admin / Employee dashboard premium
  return `
  <div class="fade-in">
    <div class="mb-7 sm:mb-9">
      <p class="section-eyebrow mb-2">Bienvenue</p>
      <h2 class="section-title-premium text-2xl sm:text-3xl">Bonjour, ${escapeHtml(state.user.name)}.</h2>
      <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">${state.user.role === 'admin' ? 'Gérez les procédures de votre hôtel.' : 'Consultez les procédures à suivre.'}</p>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5 mb-7 sm:mb-9">
      ${statCard('fa-sitemap', 'Procédures actives', s.active_procedures || 0)}
      ${statCard('fa-file-pen', 'Brouillons', s.draft_procedures || 0)}
      ${statCard('fa-users', 'Membres de l\'équipe', s.total_users || 0)}
    </div>

    <div class="mb-7">
      <p class="section-eyebrow mb-2">Catégories</p>
      <h3 class="section-title-premium text-lg sm:text-xl mb-4">Accès rapide</h3>
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
        ${state.categories.map(cat => `
          <button onclick="state.filterCategory='${cat.id}'; navigate('procedures')"
            class="card-premium p-3 sm:p-4 text-center group active:scale-95">
            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center mx-auto mb-2" style="background: rgba(201,169,97,0.12);">
              <i class="fas ${cat.icon} text-base sm:text-lg" style="color: var(--c-gold-deep);"></i>
            </div>
            <p class="text-[10px] sm:text-xs font-display font-semibold leading-tight" style="color: var(--c-navy);">${escapeHtml(cat.name)}</p>
            <p class="text-[10px] mt-0.5" style="color: rgba(15,27,40,0.4);">${state.procedures.filter(p => p.category_id == cat.id).length} proc.</p>
          </button>
        `).join('')}
      </div>
    </div>

  </div>`;
}

function statCard(icon, label, value) {
  return `
  <div class="card-premium p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="w-11 h-11 rounded-xl flex items-center justify-center" style="background: rgba(201,169,97,0.12);">
        <i class="fas ${icon} text-base" style="color: var(--c-gold-deep);"></i>
      </div>
      <span class="font-display text-3xl font-semibold" style="color: var(--c-navy);">${value}</span>
    </div>
    <p class="text-[11px] uppercase tracking-wider font-semibold" style="color: rgba(15,27,40,0.55);">${label}</p>
  </div>`;
}

async function switchHotel(hotelId) {
  state.currentHotelId = hotelId;
  await loadData();
  render();
  showToast('Hôtel sélectionné', 'success');
}

