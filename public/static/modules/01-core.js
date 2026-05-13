// ============================================
// WIKOT - Hotel Procedure Management System
// Frontend Application
// ============================================

const API = '/api';
let state = {
  // Auth STAFF (espace équipe — seul espace de l'application)
  token: localStorage.getItem('wikot_token'),
  user: JSON.parse(localStorage.getItem('wikot_user') || 'null'),
  currentView: 'dashboard',
  currentHotelId: null,
  procedures: [],
  subprocedures: [],
  categories: [],
  templates: [],
  users: [],
  hotels: [],
  stats: {},
  selectedProcedure: null,
  filterCategory: '',
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
  _wikotMaxInitialLoad: false,
  // Back Wikot - workflow atelier
  // step : 'home' | 'select-target' | 'workshop'
  // workflowMode : 'create_procedure' | 'update_procedure' | 'create_info' | 'update_info'
  // targetKind : 'procedure' | 'info_item'
  // targetId : id de la cible en mode update
  // form : payload du formulaire vivant édité par Back Wikot
  backWikotStep: 'home',
  backWikotWorkflowMode: null,
  backWikotTargetKind: null,
  backWikotTargetId: null,
  backWikotForm: null,
  backWikotFormDirty: false,
  backWikotSelectSearch: '',
  backWikotSaving: false,
  // cache pour la liste des cibles à modifier
  backWikotProceduresCache: null,
  backWikotInfoCache: null,
  // Back Wikot ROOT — conversation persistante avec l'orchestrateur (panneau latéral / drawer)
  // L'utilisateur peut écrire en permanence à Back Wikot qui pilote l'UI en autonomie :
  //  - exécute une SÉQUENCE d'actions (respond, enter_workflow, start_create, select_*, prefill_form, ask_followup, back_to_home)
  //  - réutilise toutes les fonctions UI existantes (zéro régression)
  backWikotRootMessages: [],         // [{role:'user'|'assistant', content, ts, _system?}]
  backWikotRootSending: false
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
  // Toasts premium : fond ivoire, liseré gauche coloré selon le type
  const accents = {
    info:    { bar: '#0A1628', icon: '#0A1628', label: 'Information' },
    success: { bar: '#5C8A6E', icon: '#5C8A6E', label: 'Succès' },
    error:   { bar: '#C84C3F', icon: '#C84C3F', label: 'Erreur' },
    warning: { bar: '#C9A961', icon: '#A68845', label: 'Attention' }
  };
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle' };
  const a = accents[type] || accents.info;
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 z-[9999] fade-in max-w-md flex items-center gap-3 pl-4 pr-5 py-3.5 rounded-lg';
  toast.style.cssText = `background: #fff; border: 1px solid rgba(15,27,40,0.08); border-left: 3px solid ${a.bar}; box-shadow: 0 4px 8px rgba(10,22,40,0.06), 0 24px 48px rgba(10,22,40,0.10); color: #0A1628; font-family: 'Inter', sans-serif;`;
  toast.innerHTML = `
    <i class="fas ${icons[type]}" style="color: ${a.icon}; font-size: 16px;"></i>
    <span class="text-sm font-medium">${escapeHtml(message)}</span>
  `;
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

function userCanCreateTasks() {
  if (!state.user) return false;
  return state.user.role === 'admin' || Number(state.user.can_create_tasks) === 1;
}

function userCanAssignTasks() {
  if (!state.user) return false;
  return state.user.role === 'admin' || Number(state.user.can_assign_tasks) === 1;
}

// Permission "peut tout faire sur le tableau Veleda" :
// = admin OU super_admin OU employee avec can_use_veleda = 1
// Tous les autres peuvent voir le tableau (lecture seule).
function userCanUseVeleda() {
  if (!state.user) return false;
  return state.user.role === 'admin' || state.user.role === 'super_admin' || Number(state.user.can_use_veleda) === 1;
}

// Note: la permission can_edit_settings est conservée en DB pour compat,
// mais la page Paramètres hôtel n'existe plus côté UI.

// ============================================
// HISTORY / NAVIGATION (bouton "Retour" navigateur)
// ============================================
// Chaque changement de vue principal (et ouverture d'un détail procédure)
// pousse une entrée dans window.history, et popstate restaure l'état
// correspondant. Permet au bouton "Retour" du navigateur de fonctionner
// dans la SPA au lieu de quitter le site.
//
// Convention pour state object stocké dans history :
//   { view: 'dashboard' | 'procedures' | 'info' | 'wikot' | 'wikot-max'
//        | 'conversations' | 'changelog' | 'templates' | 'users' | 'hotels'
//        | 'procedure-detail' | 'tasks' ...,
//     procedureId: number | null }

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

