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

        ${state.signupReturnStatus === 'success' ? `
          <div class="mb-4 p-4 rounded-xl flex items-start gap-3 fade-in"
            style="background: rgba(22,163,74,0.08); border: 1px solid rgba(22,163,74,0.3); color: #15803D;">
            <i class="fas fa-circle-check text-lg mt-0.5"></i>
            <div class="flex-1">
              <p class="font-semibold text-sm">Paiement confirmé&nbsp;!</p>
              <p class="text-xs mt-1">Votre compte est activé. Connectez-vous avec l'email et le mot de passe que vous venez de créer.</p>
            </div>
            <button onclick="state.signupReturnStatus=null; render();" class="text-lg leading-none" style="color: #15803D; opacity: 0.6;" title="Fermer">×</button>
          </div>
        ` : ''}
        ${state.signupReturnStatus === 'cancel' ? `
          <div class="mb-4 p-4 rounded-xl flex items-start gap-3 fade-in"
            style="background: rgba(184,106,31,0.08); border: 1px solid rgba(184,106,31,0.3); color: #B86A1F;">
            <i class="fas fa-circle-info text-lg mt-0.5"></i>
            <div class="flex-1">
              <p class="font-semibold text-sm">Paiement annulé</p>
              <p class="text-xs mt-1">Votre compte a été créé mais le paiement n'a pas abouti. Connectez-vous pour finaliser l'abonnement.</p>
            </div>
            <button onclick="state.signupReturnStatus=null; render();" class="text-lg leading-none" style="color: #B86A1F; opacity: 0.6;" title="Fermer">×</button>
          </div>
        ` : ''}
        <div class="bg-white rounded-2xl shadow-premium-lg overflow-hidden fade-in" style="border: 1px solid var(--c-line);">
          <div class="p-7 sm:p-9">
            ${state.authMode === 'signup' ? renderSignupForm() : renderStaffLoginForm()}
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
    </form>

    <!-- V18 — Lien création de compte hôtel -->
    <div class="mt-6 pt-6 text-center" style="border-top: 1px solid var(--c-line);">
      <p class="text-xs mb-3" style="color: rgba(15,27,40,0.55);">
        Vous gérez un hôtel et souhaitez utiliser Wikot ?
      </p>
      <button type="button" onclick="switchAuthMode('signup')"
        class="inline-flex items-center gap-2 text-sm font-semibold transition-colors"
        style="color: var(--c-gold-deep);"
        onmouseover="this.style.color='var(--c-navy)'"
        onmouseout="this.style.color='var(--c-gold-deep)'">
        <i class="fas fa-hotel"></i>
        Créer mon compte hôtel
        <i class="fas fa-arrow-right text-xs"></i>
      </button>
    </div>`;
}

// V18 — Formulaire d'inscription hôtel + admin (redirige vers Stripe Checkout)
function renderSignupForm() {
  const submitting = !!state.signupSubmitting;
  return `
    <button type="button" onclick="switchAuthMode('login')"
      class="text-xs mb-4 inline-flex items-center gap-1.5 transition-colors"
      style="color: rgba(15,27,40,0.5);"
      onmouseover="this.style.color='var(--c-navy)'"
      onmouseout="this.style.color='rgba(15,27,40,0.5)'">
      <i class="fas fa-arrow-left text-[10px]"></i>
      Retour à la connexion
    </button>

    <h2 class="font-display text-2xl font-semibold mb-1" style="color: var(--c-navy);">Créer mon compte hôtel</h2>
    <p class="text-xs mb-6" style="color: rgba(15,27,40,0.5);">
      Inscription en moins de 2 minutes. Paiement sécurisé par Stripe.
    </p>

    <!-- Bandeau prix -->
    <div class="mb-6 p-4 rounded-xl" style="background: linear-gradient(135deg, rgba(201,169,97,0.10), rgba(201,169,97,0.04)); border: 1px solid var(--c-gold);">
      <div class="flex items-baseline gap-2 mb-1">
        <span class="font-display text-3xl font-semibold" style="color: var(--c-navy);">50&nbsp;€</span>
        <span class="text-sm" style="color: rgba(15,27,40,0.6);">/ mois</span>
      </div>
      <p class="text-xs" style="color: rgba(15,27,40,0.65);">
        <i class="fas fa-check-circle mr-1" style="color: var(--c-gold-deep);"></i>
        Accès complet · Utilisateurs illimités · Sans engagement
      </p>
    </div>

    <form onsubmit="event.preventDefault(); submitSignup();" id="signup-form">
      <div class="mb-3">
        <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">Nom de l'hôtel</label>
        <div class="relative">
          <i class="fas fa-hotel absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="su_hotel_name" type="text" required maxlength="150" placeholder="Ex: Hôtel Belle Étoile"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm" ${submitting ? 'disabled' : ''}>
        </div>
      </div>
      <div class="mb-3">
        <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">Votre nom</label>
        <div class="relative">
          <i class="fas fa-user absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="su_admin_name" type="text" required maxlength="100" placeholder="Prénom Nom"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm" ${submitting ? 'disabled' : ''}>
        </div>
      </div>
      <div class="mb-3">
        <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">Email administrateur</label>
        <div class="relative">
          <i class="fas fa-envelope absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="su_email" type="email" required placeholder="vous@hotel.com"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm" ${submitting ? 'disabled' : ''}>
        </div>
      </div>
      <div class="mb-5">
        <label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">Mot de passe</label>
        <div class="relative">
          <i class="fas fa-lock absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="su_password" type="password" required minlength="8" placeholder="Minimum 8 caractères"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm" ${submitting ? 'disabled' : ''}>
        </div>
      </div>

      ${state.signupError ? `
        <div class="mb-4 p-3 rounded-lg text-xs flex items-start gap-2" style="background: rgba(200,76,63,0.08); color: #C84C3F; border: 1px solid rgba(200,76,63,0.25);">
          <i class="fas fa-circle-exclamation mt-0.5"></i>
          <span>${escapeHtml(state.signupError)}</span>
        </div>
      ` : ''}

      <button type="submit" ${submitting ? 'disabled' : ''}
        class="btn-premium w-full font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
        style="background: var(--c-navy); color: white; ${submitting ? 'opacity: 0.6; cursor: wait;' : ''}">
        ${submitting ? `
          <i class="fas fa-spinner fa-spin"></i>
          Création en cours…
        ` : `
          <i class="fas fa-credit-card"></i>
          Continuer vers le paiement (50&nbsp;€/mois)
        `}
      </button>

      <p class="text-[10px] text-center mt-4" style="color: rgba(15,27,40,0.4);">
        <i class="fas fa-lock mr-1"></i>
        Paiement sécurisé par Stripe · Vous serez redirigé pour saisir votre carte
      </p>
    </form>`;
}

// V18 — Bascule login ↔ signup
function switchAuthMode(mode) {
  state.authMode = mode;
  state.signupError = null;
  render();
}

// V18 — Soumission du formulaire signup → crée le compte + redirige vers Stripe Checkout
async function submitSignup() {
  const hotel_name = document.getElementById('su_hotel_name')?.value.trim();
  const admin_name = document.getElementById('su_admin_name')?.value.trim();
  const email = document.getElementById('su_email')?.value.trim();
  const password = document.getElementById('su_password')?.value;

  if (!hotel_name || !admin_name || !email || !password) {
    state.signupError = 'Tous les champs sont requis.';
    render();
    return;
  }
  if (password.length < 8) {
    state.signupError = 'Le mot de passe doit faire au moins 8 caractères.';
    render();
    return;
  }

  state.signupSubmitting = true;
  state.signupError = null;
  render();

  try {
    const resp = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotel_name, admin_name, email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      state.signupError = data?.error || 'Erreur lors de la création du compte.';
      state.signupSubmitting = false;
      render();
      return;
    }
    if (data?.checkout_url) {
      // Redirige vers Stripe Checkout — le user paye, et Stripe revient vers / avec ?signup=success
      window.location.href = data.checkout_url;
    } else {
      state.signupError = 'Erreur inattendue (pas d\'URL de paiement).';
      state.signupSubmitting = false;
      render();
    }
  } catch (e) {
    state.signupError = 'Erreur réseau. Veuillez réessayer.';
    state.signupSubmitting = false;
    render();
  }
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
    // V18.12 — Wikot = agent IA principal (ex-Back Wikot). L'ancien agent
    // "Wikot lecture" (mode standard) a été supprimé : il n'existe plus
    // qu'un seul agent, et il s'appelle Wikot.
    menuItems = [
      { id: 'wikot', icon: 'fa-pen-ruler', label: 'Wikot' },
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      { id: 'tasks', icon: 'fa-list-check', label: 'Tâches', badge: state.myTasksPendingCount },
      { id: 'veleda', icon: 'fa-clipboard', label: 'Tableau Véléda' },
      { id: 'users', icon: 'fa-users', label: 'Utilisateurs' },
    ];
  } else {
    // Employé : Wikot conditionnel (permission dédiée + fallback historique) + autres items.
    // V18.12 — Un seul agent IA "Wikot" (ex-Back Wikot).
    // V19 — Bascule sur userCanUseWikotMax (qui regarde can_use_wikot puis fallback)
    const canUseWikot = userCanUseWikotMax();
    menuItems = [
      ...(canUseWikot ? [{ id: 'wikot', icon: 'fa-pen-ruler', label: 'Wikot' }] : []),
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      // Tâches : visible pour TOUS les employés (les permissions limitent juste les actions)
      { id: 'tasks', icon: 'fa-list-check', label: 'Tâches', badge: state.myTasksPendingCount },
      // Tableau Véléda : visible pour TOUS (admin + employé)
      { id: 'veleda', icon: 'fa-clipboard', label: 'Tableau Véléda' },
    ];
  }

  const roleLabels = { super_admin: 'Super Admin', admin: 'Administrateur', employee: canEdit ? 'Employé (éditeur)' : 'Employé' };
  const roleColors = { super_admin: 'bg-purple-100 text-purple-700', admin: 'bg-blue-100 text-blue-700', employee: canEdit ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700' };

  // Titre de la vue active pour le header mobile
  // V18.12 — Un seul Wikot. Les anciens noms 'back-wikot' et 'wikot-max'
  // sont conservés comme alias dans viewTitles pour gérer proprement les
  // anciens favoris / liens historiques (le router les redirige vers wikot).
  const viewTitles = {
    dashboard: 'Tableau de bord',
    wikot: 'Wikot',
    'back-wikot': 'Wikot', // alias retro-compat (ancien nom "Back Wikot")
    'wikot-max': 'Wikot',  // alias retro-compat (ancien nom interne)
    procedures: 'Procédures',
    info: 'Informations',
    conversations: 'Conversations',
    users: 'Utilisateurs',
    hotels: 'Hôtels',
    templates: 'Modèles',
    tasks: 'Tâches',
    veleda: 'Tableau Véléda',
  };
  const currentTitle = viewTitles[state.currentView] || 'Wikot';

  // Bottom nav mobile : prioriser les items selon l'usage. Conversations DOIT y etre pour les employes.
  // On limite a 5 max, en gardant les plus utilises.
  // V18.12 : Wikot (agent IA unique) prend la premiere place quand l'utilisateur y a droit.
  let bottomNavItems;
  if (isSuperAdmin) {
    bottomNavItems = menuItems; // 3 items, tous tiennent
  } else {
    const priorityIds = userCanUseWikotMax()
      ? ['wikot','procedures','info','conversations','tasks']
      : ['procedures','info','conversations','tasks','veleda'];
    bottomNavItems = priorityIds
      .map(id => menuItems.find(i => i.id === id))
      .filter(Boolean)
      .slice(0, 5);
  }

  return `
  <!-- Overlay mobile sidebar -->
  <div id="sidebar-overlay" class="app-sidebar-overlay" onclick="closeSidebar()"></div>

  <div class="app-shell-row">
    <!-- Sidebar premium -->
    <aside id="main-sidebar" class="sidebar-premium app-sidebar">
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
    <main class="app-main flex-1 overflow-y-auto flex flex-col" style="background: var(--c-cream);">
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

      <div id="main-content-container" class="flex-1 ${
        state.currentView === 'conversations'
          ? 'overflow-hidden w-full'
          : state.currentView === 'tasks'
            ? 'p-4 md:p-6 lg:p-8 w-full mobile-content-padding'
            : 'p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full mobile-content-padding'
      }">
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
  document.getElementById('main-sidebar')?.classList.add('is-open');
  document.getElementById('sidebar-overlay')?.classList.add('is-visible');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.getElementById('main-sidebar')?.classList.remove('is-open');
  document.getElementById('sidebar-overlay')?.classList.remove('is-visible');
  document.body.classList.remove('sidebar-open');
}

function navigate(view) {
  // Si on quitte la vue conversations, stopper le polling messages
  if (state.currentView === 'conversations' && view !== 'conversations') {
    stopChatPolling();
    state.selectedChannelId = null;
    state.chatMessages = [];
  }
  // Si on quitte la vue Tableau Véléda, stopper son polling
  if (state.currentView === 'veleda' && view !== 'veleda') {
    if (typeof stopVeledaPolling === 'function') stopVeledaPolling();
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
  // renderNow() (et non render()) car on lit le DOM immédiatement après
  renderNow();
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
    // V18.12 — Un seul agent IA "Wikot" (ex-Back Wikot, mode 'max' en interne).
    // L'ancien mode lecture 'standard' n'est plus expose dans l'UI.
    // Les alias 'back-wikot' et 'wikot-max' redirigent vers la nouvelle route
    // pour preserver les anciens favoris / liens partages.
    case 'wikot':
    case 'back-wikot':
    case 'wikot-max': return renderWikotView('max');
    case 'procedures': return state.selectedProcedure ? renderProcedureDetail() : renderProceduresList();
    case 'info': return renderHotelInfoView();
    case 'conversations': return renderConversationsView();
    case 'users': return renderUsersView();
    case 'hotels': return renderHotelsView();
    case 'templates': return renderTemplatesView();
    case 'procedure-detail': return renderProcedureDetail();
    case 'tasks': return renderTasksView();
    case 'veleda': return renderVeledaView();
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


// ============================================
// V18 — PAGE "ABONNEMENT REQUIS"
// Affichée à un user connecté dont l'hôtel a un subscription_status ≠ 'active'
// (pending = jamais payé, past_due = paiement échoué, canceled = annulé)
// ============================================
function renderSubscriptionRequired() {
  const status = state.user.subscription_status || 'pending';
  const isAdmin = state.user.role === 'admin';
  const titles = {
    pending: 'Finaliser votre abonnement',
    past_due: 'Paiement en attente',
    canceled: 'Abonnement annulé',
    incomplete: 'Paiement incomplet',
  };
  const messages = {
    pending: 'Votre compte a bien été créé. Pour accéder à Wikot, finalisez votre paiement.',
    past_due: 'Votre dernier paiement n\'a pas pu être effectué. Mettez à jour votre moyen de paiement pour continuer à utiliser Wikot.',
    canceled: 'Votre abonnement a été annulé. Pour réactiver Wikot, souscrivez à nouveau.',
    incomplete: 'Votre paiement n\'a pas été finalisé. Veuillez le compléter pour accéder à Wikot.',
  };
  const icons = {
    pending: 'fa-credit-card',
    past_due: 'fa-triangle-exclamation',
    canceled: 'fa-circle-xmark',
    incomplete: 'fa-hourglass-half',
  };
  return `
  <div class="min-h-screen flex items-center justify-center p-6" style="background: var(--c-cream);">
    <div class="w-full max-w-md fade-in">
      <div class="bg-white rounded-2xl shadow-premium-lg overflow-hidden" style="border: 1px solid var(--c-line);">
        <!-- Header avec icone -->
        <div class="px-8 pt-8 pb-6 text-center" style="background: linear-gradient(135deg, rgba(201,169,97,0.08), transparent);">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style="background: var(--c-navy);">
            <i class="fas ${icons[status] || 'fa-credit-card'} text-2xl" style="color: var(--c-gold);"></i>
          </div>
          <h1 class="font-display text-2xl font-semibold mb-2" style="color: var(--c-navy);">
            ${titles[status] || 'Abonnement requis'}
          </h1>
          <p class="text-sm" style="color: rgba(15,27,40,0.65);">
            ${messages[status] || 'Un abonnement actif est requis pour accéder à Wikot.'}
          </p>
        </div>

        <div class="px-8 py-6">
          <!-- Bandeau prix -->
          <div class="mb-6 p-4 rounded-xl text-center" style="background: linear-gradient(135deg, rgba(201,169,97,0.10), rgba(201,169,97,0.04)); border: 1px solid var(--c-gold);">
            <div class="flex items-baseline justify-center gap-2 mb-1">
              <span class="font-display text-3xl font-semibold" style="color: var(--c-navy);">50&nbsp;€</span>
              <span class="text-sm" style="color: rgba(15,27,40,0.6);">/ mois</span>
            </div>
            <p class="text-xs" style="color: rgba(15,27,40,0.65);">
              Accès complet · Utilisateurs illimités · Sans engagement
            </p>
          </div>

          ${isAdmin ? `
            <button onclick="goToBillingCheckout()" id="billing-cta-btn"
              class="btn-premium w-full font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2 mb-3"
              style="background: var(--c-navy); color: white;">
              <i class="fas fa-credit-card"></i>
              ${status === 'past_due' ? 'Mettre à jour mon paiement' : 'Procéder au paiement'}
            </button>
            ${state.user.stripe_customer_id ? `
              <button onclick="goToBillingPortal()"
                class="w-full text-sm font-semibold py-2.5 rounded-lg transition-all"
                style="color: var(--c-navy); background: transparent; border: 1px solid var(--c-line-strong);">
                <i class="fas fa-arrow-up-right-from-square mr-2"></i>
                Gérer ma facturation (Stripe)
              </button>
            ` : ''}
          ` : `
            <div class="p-4 rounded-lg text-sm text-center" style="background: var(--c-cream-deep); color: var(--c-navy);">
              <i class="fas fa-info-circle mr-1" style="color: var(--c-gold-deep);"></i>
              Contactez l'administrateur de votre hôtel pour réactiver l'abonnement.
            </div>
          `}

          <button onclick="logout()"
            class="w-full mt-4 text-xs text-center py-2 transition-colors"
            style="color: rgba(15,27,40,0.5);"
            onmouseover="this.style.color='var(--c-navy)'"
            onmouseout="this.style.color='rgba(15,27,40,0.5)'">
            <i class="fas fa-sign-out-alt mr-1"></i>Se déconnecter
          </button>
        </div>
      </div>

      <p class="text-center text-xs mt-6" style="color: rgba(15,27,40,0.4);">
        <i class="fas fa-lock mr-1"></i>
        Paiement sécurisé par Stripe
      </p>
    </div>
  </div>`;
}

// V18 — Lance une nouvelle session Stripe Checkout (pour user déjà connecté en past_due / canceled)
async function goToBillingCheckout() {
  const btn = document.getElementById('billing-cta-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Redirection…';
  }
  try {
    const resp = await fetch('/api/billing/create-checkout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (data?.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      showToast(data?.error || 'Erreur lors de la création de la session', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card"></i> Procéder au paiement'; }
    }
  } catch (e) {
    showToast('Erreur réseau', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card"></i> Procéder au paiement'; }
  }
}

// V18 — Ouvre le Customer Portal Stripe (mettre à jour CB, annuler, factures)
async function goToBillingPortal() {
  try {
    const resp = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (data?.portal_url) {
      window.location.href = data.portal_url;
    } else {
      showToast(data?.error || 'Erreur', 'error');
    }
  } catch (e) {
    showToast('Erreur réseau', 'error');
  }
}
