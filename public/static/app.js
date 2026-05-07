// ============================================
// WIKOT - Hotel Procedure Management System
// Frontend Application
// ============================================

const API = '/api';
let state = {
  // Auth STAFF
  token: localStorage.getItem('wikot_token'),
  user: JSON.parse(localStorage.getItem('wikot_user') || 'null'),
  // Auth CLIENT (Front Wikot — chambre client)
  clientToken: localStorage.getItem('wikot_client_token'),
  client: JSON.parse(localStorage.getItem('wikot_client') || 'null'),
  loginTab: 'client', // 'staff' | 'client' — onglet actif sur la page de login (client par défaut)
  // Vues client
  clientView: 'wikot', // 'wikot' | 'restaurant' | 'info' — Front Wikot par défaut
  clientWikotConversations: [],
  clientWikotCurrentConvId: null,
  clientWikotMessages: [],
  clientWikotSending: false,
  clientRestaurantDate: null,
  clientRestaurantAvailability: null,
  clientRestaurantReservations: [],
  clientHotelInfoCategories: [],
  clientHotelInfoItems: [],
  // Staff — vues étendues
  rooms: [],
  occupancyEntries: {}, // {room_id: {guest_name, checkout_date}}
  restaurantSchedule: [],
  restaurantExceptions: [],
  restaurantReservations: [],
  restaurantDashboard: null,
  restaurantDashboardFrom: null,
  restaurantDashboardTo: null,
  restaurantPickedDate: null,
  // hotelSettings retiré : la page Paramètres hôtel n'existe plus.
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
  backWikotInfoCache: null
};

// ============================================
// VOICE RECORDER — capture audio MediaRecorder + upload R2 via /api/audio/upload
// ============================================
// state.voice : { active: 'staff'|'client'|null, mode: 'wikot'|'wikot-max'|'client-wikot'|null,
//                 recording: bool, blob: Blob|null, mime: string|null, durationMs: number,
//                 mediaRecorder: MediaRecorder|null, stream: MediaStream|null,
//                 chunks: Blob[], startedAt: number, timerInterval: any, previewUrl: string|null }
function initVoiceState() {
  if (!state.voice) state.voice = { active: null, mode: null, recording: false, blob: null, mime: null, durationMs: 0, mediaRecorder: null, stream: null, chunks: [], startedAt: 0, timerInterval: null, previewUrl: null };
  return state.voice;
}

function pickAudioMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/aac'];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return '';
}

async function startVoiceRecording(scope, mode) {
  const v = initVoiceState();
  if (v.recording) { showToast('Enregistrement déjà en cours', 'warning'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('Votre navigateur ne supporte pas l\'enregistrement vocal', 'error');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    showToast('Accès au micro refusé', 'error');
    return;
  }
  const mime = pickAudioMime();
  let mr;
  try {
    mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    showToast('Impossible de démarrer l\'enregistrement', 'error');
    return;
  }
  v.active = scope; v.mode = mode; v.recording = true;
  v.blob = null; v.mime = mime || mr.mimeType || 'audio/webm';
  v.durationMs = 0; v.startedAt = Date.now(); v.chunks = [];
  v.mediaRecorder = mr; v.stream = stream;
  if (v.previewUrl) { try { URL.revokeObjectURL(v.previewUrl); } catch {} v.previewUrl = null; }

  mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) v.chunks.push(e.data); };
  mr.onstop = () => {
    const blob = new Blob(v.chunks, { type: v.mime });
    v.blob = blob;
    v.durationMs = Date.now() - v.startedAt;
    if (v.timerInterval) { clearInterval(v.timerInterval); v.timerInterval = null; }
    if (v.stream) { v.stream.getTracks().forEach(t => t.stop()); v.stream = null; }
    v.recording = false;
    if (v.previewUrl) { try { URL.revokeObjectURL(v.previewUrl); } catch {} }
    v.previewUrl = URL.createObjectURL(blob);
    render();
  };
  mr.start();
  v.timerInterval = setInterval(() => {
    // Force re-render du compteur dans la zone de saisie active
    const el = document.getElementById('voice-timer-' + scope);
    if (el) {
      const ms = Date.now() - v.startedAt;
      const sec = Math.floor(ms / 1000);
      el.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    }
  }, 250);
  // Limite dure : 5 min
  setTimeout(() => { if (v.recording) stopVoiceRecording(); }, 5 * 60 * 1000);
  render();
}

function stopVoiceRecording() {
  const v = initVoiceState();
  if (!v.recording || !v.mediaRecorder) return;
  try { v.mediaRecorder.stop(); } catch {}
}

function discardVoiceRecording() {
  const v = initVoiceState();
  if (v.recording) { try { v.mediaRecorder && v.mediaRecorder.stop(); } catch {} }
  if (v.stream) { v.stream.getTracks().forEach(t => t.stop()); v.stream = null; }
  if (v.timerInterval) { clearInterval(v.timerInterval); v.timerInterval = null; }
  if (v.previewUrl) { try { URL.revokeObjectURL(v.previewUrl); } catch {} }
  state.voice = { active: null, mode: null, recording: false, blob: null, mime: null, durationMs: 0, mediaRecorder: null, stream: null, chunks: [], startedAt: 0, timerInterval: null, previewUrl: null };
  render();
}

async function uploadCurrentVoice(scope) {
  const v = initVoiceState();
  if (!v.blob) return null;
  const isClient = scope === 'client';
  const url = `${API}${isClient ? '/client/audio/upload' : '/audio/upload'}`;
  const headers = {
    'Content-Type': v.mime || 'audio/webm',
    'X-Audio-Duration-Ms': String(v.durationMs || 0)
  };
  const token = isClient ? state.clientToken : state.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: v.blob });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Échec de l\'envoi audio', 'error'); return null; }
    return data; // { audio_key, audio_mime, audio_size_bytes, audio_duration_ms }
  } catch (e) {
    showToast('Erreur réseau lors de l\'envoi audio', 'error');
    return null;
  }
}

function formatVoiceDuration(ms) {
  const sec = Math.max(0, Math.floor((ms || 0) / 1000));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

// Rendu d'un widget bouton micro / barre d'enregistrement / preview à côté du send
function renderVoiceWidget(scope, mode) {
  const v = initVoiceState();
  const mine = v.active === scope && v.mode === mode;
  // Pas d'enregistrement actif sur cette zone : bouton micro simple
  if (!mine) {
    return `<button type="button" onclick="startVoiceRecording('${scope}','${mode}')" class="btn-premium w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);" title="Enregistrer un message vocal"><i class="fas fa-microphone"></i></button>`;
  }
  // Enregistrement en cours
  if (v.recording) {
    return `
      <div class="flex items-center gap-2 px-3 py-2 rounded-xl shrink-0" style="background: rgba(200,76,63,0.10); border: 1px solid rgba(200,76,63,0.35);">
        <span class="inline-block w-2 h-2 rounded-full" style="background: #C84C3F; animation: pulse 1s infinite;"></span>
        <span id="voice-timer-${scope}" class="text-xs font-mono font-semibold" style="color: #C84C3F;">00:00</span>
        <button type="button" onclick="stopVoiceRecording()" class="text-xs font-semibold px-2 py-1 rounded" style="background: #C84C3F; color: #fff;" title="Arrêter"><i class="fas fa-stop"></i></button>
        <button type="button" onclick="discardVoiceRecording()" class="text-xs px-1.5 py-1 rounded" style="color: #C84C3F;" title="Annuler"><i class="fas fa-times"></i></button>
      </div>`;
  }
  // Preview prête à envoyer
  if (v.blob && v.previewUrl) {
    return `
      <div class="flex items-center gap-2 px-2 py-1.5 rounded-xl shrink-0" style="background: var(--c-cream-deep); border: 1px solid var(--c-line);">
        <audio src="${v.previewUrl}" controls preload="metadata" style="height: 32px; max-width: 180px;"></audio>
        <span class="text-[10px] font-mono" style="color: rgba(15,27,40,0.55);">${formatVoiceDuration(v.durationMs)}</span>
        <button type="button" onclick="discardVoiceRecording()" class="text-xs w-6 h-6 rounded flex items-center justify-center" style="background: rgba(200,76,63,0.10); color: #C84C3F;" title="Supprimer"><i class="fas fa-trash text-[10px]"></i></button>
      </div>`;
  }
  return '';
}

// Rendu d'un message vocal (lecteur audio inline) — utilisé dans renderWikotMessage et renderFrontWikotMessage
function renderVoiceMessageBubble(msg, opts) {
  opts = opts || {};
  const isClient = !!opts.isClient;
  const audioKey = msg.audio_key;
  if (!audioKey) return '';
  const token = isClient ? state.clientToken : state.token;
  const path = isClient ? '/client/audio/' : '/audio/';
  // On utilise un fetch authentifié → blob URL au moment du render via data-attr
  const audioId = 'audio-' + (msg.id || Math.random().toString(36).slice(2));
  const fetchUrl = `${API}${path}${encodeURI(audioKey)}`;
  // Charge en async le blob et bind sur l'élément
  setTimeout(() => {
    const el = document.getElementById(audioId);
    if (!el || el.dataset.loaded === '1') return;
    el.dataset.loaded = '1';
    fetch(fetchUrl, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.blob() : null)
      .then(b => { if (b) { el.src = URL.createObjectURL(b); } })
      .catch(() => {});
  }, 50);
  const dur = msg.audio_duration_ms ? formatVoiceDuration(msg.audio_duration_ms) : '';
  return `<div class="flex items-center gap-2 mt-1.5 pt-1.5" style="border-top: 1px solid rgba(255,255,255,0.15);"><i class="fas fa-microphone text-xs" style="opacity: 0.7;"></i><audio id="${audioId}" controls preload="none" style="height: 32px; max-width: 220px;"></audio>${dur ? `<span class="text-[10px] font-mono" style="opacity: 0.7;">${dur}</span>` : ''}</div>`;
}

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

function userCanEditClients() {
  if (!state.user) return false;
  return state.user.role === 'admin' || Number(state.user.can_edit_clients) === 1;
}

function userCanEditRestaurant() {
  if (!state.user) return false;
  return state.user.role === 'admin' || Number(state.user.can_edit_restaurant) === 1;
}

function userCanCreateTasks() {
  if (!state.user) return false;
  return state.user.role === 'admin' || Number(state.user.can_create_tasks) === 1;
}

function userCanAssignTasks() {
  if (!state.user) return false;
  return state.user.role === 'admin' || Number(state.user.can_assign_tasks) === 1;
}

// Note: la permission can_edit_settings est conservée en DB pour compat,
// mais la page Paramètres hôtel n'existe plus côté UI.

// ============================================
// CLIENT API HELPER (token séparé du staff)
// ============================================
async function clientApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.clientToken) headers['Authorization'] = `Bearer ${state.clientToken}`;
  try {
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json();
    if (res.status === 401) { clientLogout(); return null; }
    if (!res.ok) { showToast(data.error || 'Erreur', 'error'); return null; }
    return data;
  } catch (e) {
    showToast('Erreur de connexion', 'error');
    return null;
  }
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
  // Priorité 1 : si un client est connecté, afficher l'app Front Wikot client
  if (state.clientToken && state.client) {
    app.innerHTML = renderClientApp();
    return;
  }
  // Priorité 2 : si un staff est connecté, afficher l'app staff
  if (state.token && state.user) {
    app.innerHTML = renderMainLayout();
    return;
  }
  // Priorité 3 : page de login (avec onglet staff/client)
  app.innerHTML = renderLoginPage();
}

// ============================================
// CLIENT AUTH
// ============================================
async function clientLogin(hotelCode, roomNumber, guestName) {
  try {
    const res = await fetch(`${API}/client/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotel_code: hotelCode, room_number: roomNumber, guest_name: guestName })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Connexion impossible', 'error'); return; }
    state.clientToken = data.token;
    state.client = data.client;
    localStorage.setItem('wikot_client_token', data.token);
    localStorage.setItem('wikot_client', JSON.stringify(data.client));
    state.clientView = 'wikot';
    state._clientWikotLoaded = false;
    showToast(`Bienvenue ${data.client.guest_name} !`, 'success');
    render();
    // Pré-charger Front Wikot immédiatement après login
    ensureClientWikotLoaded();
  } catch (e) {
    showToast('Erreur réseau', 'error');
  }
}

function clientLogout() {
  // Tenter logout serveur (silencieux)
  if (state.clientToken) {
    fetch(`${API}/client/logout`, { method: 'POST', headers: { 'Authorization': `Bearer ${state.clientToken}` } }).catch(() => {});
  }
  state.clientToken = null;
  state.client = null;
  state.clientView = 'wikot';
  state.clientWikotConversations = [];
  state.clientWikotCurrentConvId = null;
  state.clientWikotMessages = [];
  localStorage.removeItem('wikot_client_token');
  localStorage.removeItem('wikot_client');
  render();
}

function setLoginTab(tab) {
  state.loginTab = tab;
  render();
}

// ============================================
// LOGIN PAGE
// ============================================
function renderLoginPage() {
  const tab = state.loginTab || 'client';
  return `
  <div class="min-h-screen flex flex-col lg:flex-row" style="background: var(--c-cream);">
    <!-- COLONNE GAUCHE — branding premium (caché sur mobile) -->
    <div class="hidden lg:flex lg:w-1/2 relative overflow-hidden" style="background: var(--c-navy);">
      <!-- Pattern subtil en SVG inline (ultra-léger, pas d'image) -->
      <div class="absolute inset-0 opacity-[0.07]" style="background-image: radial-gradient(circle at 1px 1px, #C9A961 1px, transparent 0); background-size: 32px 32px;"></div>
      <!-- Liseré or à droite -->
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
          <p class="text-xs uppercase tracking-[0.2em] mb-4" style="color: var(--c-gold);">L'excellence hôtelière</p>
          <h2 class="font-display text-4xl xl:text-5xl font-medium text-white leading-tight">
            Chaque détail<br/>
            <span style="color: var(--c-gold);">soigneusement orchestré.</span>
          </h2>
        </div>
        <div></div>
      </div>
    </div>

    <!-- COLONNE DROITE — formulaires -->
    <div class="flex-1 flex items-center justify-center p-6 lg:p-12">
      <div class="w-full max-w-md">
        <!-- Logo mobile uniquement -->
        <div class="flex lg:hidden items-center justify-center gap-3 mb-8 fade-in">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center" style="background: var(--c-gold);">
            <i class="fas fa-concierge-bell text-lg" style="color: var(--c-navy);"></i>
          </div>
          <span class="font-display text-2xl font-semibold" style="color: var(--c-navy);">Wikot</span>
        </div>

        <div class="bg-white rounded-2xl shadow-premium-lg overflow-hidden fade-in" style="border: 1px solid var(--c-line);">
          <!-- Tabs Client / Équipe -->
          <div class="flex" style="background: var(--c-cream-deep);">
            <button onclick="setLoginTab('client')"
              class="flex-1 py-4 text-sm font-semibold transition-all"
              style="${tab === 'client' ? 'background: white; color: var(--c-navy); box-shadow: inset 0 -2px 0 var(--c-gold);' : 'color: rgba(15,27,40,0.5);'}">
              <i class="fas fa-bed mr-2"></i>Espace Client
            </button>
            <button onclick="setLoginTab('staff')"
              class="flex-1 py-4 text-sm font-semibold transition-all"
              style="${tab === 'staff' ? 'background: white; color: var(--c-navy); box-shadow: inset 0 -2px 0 var(--c-gold);' : 'color: rgba(15,27,40,0.5);'}">
              <i class="fas fa-user-tie mr-2"></i>Espace Équipe
            </button>
          </div>
          <div class="p-7 sm:p-9">
            ${tab === 'client' ? renderClientLoginForm() : renderStaffLoginForm()}
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

function renderClientLoginForm() {
  const stepBadge = (n) => `<span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2" style="background: var(--c-gold); color: var(--c-navy);">${n}</span>`;
  return `
    <h2 class="font-display text-2xl font-semibold mb-1" style="color: var(--c-navy);">Bienvenue dans votre hôtel</h2>
    <p class="text-xs mb-7" style="color: rgba(15,27,40,0.5);">Munissez-vous de la fiche présente dans votre chambre.</p>
    <form onsubmit="event.preventDefault(); clientLogin(document.getElementById('client_hotel_code').value, document.getElementById('client_room_number').value, document.getElementById('client_guest_name').value)">
      <div class="mb-4">
        <label class="block text-xs font-semibold mb-2 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">
          ${stepBadge(1)}Code de l'hôtel
        </label>
        <div class="relative">
          <i class="fas fa-hotel absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="client_hotel_code" type="text" required placeholder="Ex: GRDPARIS" autocomplete="off"
            style="text-transform: uppercase; letter-spacing: 1.5px;"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm font-mono">
        </div>
      </div>
      <div class="mb-4">
        <label class="block text-xs font-semibold mb-2 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">
          ${stepBadge(2)}Numéro de chambre
        </label>
        <div class="relative">
          <i class="fas fa-door-open absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="client_room_number" type="text" required placeholder="Ex: 12" autocomplete="off"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm">
        </div>
      </div>
      <div class="mb-6">
        <label class="block text-xs font-semibold mb-2 uppercase tracking-wider" style="color: var(--c-navy); opacity:0.7;">
          ${stepBadge(3)}Votre nom
        </label>
        <div class="relative">
          <i class="fas fa-user absolute left-3.5 top-3.5 text-sm" style="color: var(--c-gold);"></i>
          <input id="client_guest_name" type="text" required placeholder="Ex: Dupont" autocomplete="off"
            class="input-premium w-full pl-10 pr-4 py-3 rounded-lg outline-none text-sm">
        </div>
        <p class="text-[11px] mt-2" style="color: rgba(15,27,40,0.4);"><i class="fas fa-info-circle mr-1" style="color: var(--c-gold);"></i>Le nom utilisé lors de la réservation.</p>
      </div>
      <button type="submit" class="btn-premium w-full font-semibold py-3 rounded-lg transition-all" style="background: var(--c-navy); color: white;">
        <i class="fas fa-key mr-2"></i>Accéder à mon espace
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
    // Admin hôtel : accès complet à toutes les pages opérationnelles
    menuItems = [
      { id: 'wikot', icon: 'fa-robot', label: 'Wikot' },
      { id: 'wikot-max', icon: 'fa-pen-ruler', label: 'Back Wikot' },
      { id: 'procedures', icon: 'fa-sitemap', label: 'Procédures' },
      { id: 'info', icon: 'fa-circle-info', label: 'Informations' },
      { id: 'conversations', icon: 'fa-comments', label: 'Conversations', badge: state.unreadChatTotal },
      { id: 'rooms', icon: 'fa-door-closed', label: 'Chambres' },
      { id: 'occupancy', icon: 'fa-id-card', label: 'Code Wikot' },
      { id: 'restaurant', icon: 'fa-utensils', label: 'Restaurant' },
      { id: 'tasks', icon: 'fa-list-check', label: 'À faire' },
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
      ...(userCanEditClients() ? [
        { id: 'rooms', icon: 'fa-door-closed', label: 'Chambres' },
        { id: 'occupancy', icon: 'fa-id-card', label: 'Code Wikot' }
      ] : []),
      ...(userCanEditRestaurant() ? [
        { id: 'restaurant', icon: 'fa-utensils', label: 'Restaurant' }
      ] : []),
      // À faire : visible pour TOUS les employés (les permissions limitent juste les actions)
      { id: 'tasks', icon: 'fa-list-check', label: 'À faire' },
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
    rooms: 'Chambres',
    occupancy: 'Code Wikot',
    restaurant: 'Restaurant',
    tasks: 'À faire',
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
              <p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--c-gold);">L'excellence hôtelière</p>
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
    case 'rooms': return renderRoomsView();
    case 'occupancy': return renderOccupancyView();
    case 'restaurant': return renderRestaurantView();
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
    <!-- Header premium -->
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
      <div>
        <p class="section-eyebrow mb-2">Savoir-faire</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Procédures</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.5);">${filtered.length} procédure${filtered.length > 1 ? 's' : ''} référencée${filtered.length > 1 ? 's' : ''}</p>
      </div>
      ${canEdit ? `
      <button onclick="showProcedureForm()" class="btn-premium self-start sm:self-auto px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2" style="background: var(--c-navy); color: #fff;">
        <i class="fas fa-plus text-xs"></i>Nouvelle procédure
      </button>` : ''}
    </div>

    <!-- Filters premium -->
    <div class="card-premium p-3 sm:p-4 mb-6">
      <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <select onchange="state.filterCategory=this.value; render()" class="input-premium flex-1 text-sm rounded-lg px-3 py-2.5 outline-none">
          <option value="">Toutes les catégories</option>
          ${state.categories.map(c => `<option value="${c.id}" ${state.filterCategory == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
        ${state.filterCategory ? `
        <button onclick="state.filterCategory=''; render()" class="text-xs flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg transition-colors" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line-strong);">
          <i class="fas fa-times"></i>Réinitialiser
        </button>` : ''}
      </div>
    </div>

    <!-- Tree View premium -->
    <div class="space-y-5">
      ${Object.keys(grouped).length === 0 ? `
        <div class="card-premium empty-state-premium">
          <div class="empty-icon"><i class="fas fa-sitemap"></i></div>
          <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucune procédure trouvée</p>
          ${canEdit ? `<p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Créez votre première procédure pour commencer.</p>` : ''}
        </div>
      ` : Object.entries(grouped).map(([catName, catData]) => `
        <div class="card-premium">
          <div class="px-5 py-4 flex items-center gap-3" style="border-bottom: 1px solid var(--c-line); background: linear-gradient(180deg, #fff 0%, var(--c-cream) 100%); position: relative;">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: rgba(201,169,97,0.12);">
              <i class="fas ${catData.icon} text-sm" style="color: var(--c-gold-deep);"></i>
            </div>
            <h3 class="font-display font-semibold truncate" style="color: var(--c-navy);">${catName}</h3>
            <span class="pill-gold ml-auto shrink-0">${catData.procedures.length}</span>
          </div>
          <div>
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
  <div class="card-row-premium px-4 sm:px-5 py-3.5 sm:py-4 cursor-pointer" onclick="viewProcedure(${proc.id})">
    <div class="flex items-start gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-1.5 mb-1">
          <h4 class="font-display font-semibold text-sm sm:text-base truncate max-w-full" style="color: var(--c-navy);">${escapeHtml(proc.title)}</h4>
        </div>
        ${trigger ? `<p class="text-xs sm:text-sm mb-1.5 line-clamp-2" style="color: rgba(15,27,40,0.65);"><i class="fas fa-bolt mr-1 text-[10px]" style="color: var(--c-gold);"></i>${escapeHtml(trigger)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-2 sm:gap-4 text-[11px]" style="color: rgba(15,27,40,0.45);">
          <span><i class="fas fa-list-ol mr-1" style="color: var(--c-gold);"></i>${proc.step_count || 0} étape${(proc.step_count || 0) > 1 ? 's' : ''}</span>
          ${proc.condition_count > 0 ? `<span class="hidden sm:inline"><i class="fas fa-code-branch mr-1" style="color: var(--c-gold);"></i>${proc.condition_count} cas</span>` : ''}
          <span class="hidden sm:inline uppercase tracking-wider">v${proc.version || 1}</span>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${canEdit ? `
          <button onclick="event.stopPropagation(); showProcedureForm(${proc.id})" class="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);" onmouseover="this.style.background='var(--c-gold)'; this.style.color='var(--c-navy)';" onmouseout="this.style.background='var(--c-cream-deep)'; this.style.color='rgba(15,27,40,0.5)';" title="Modifier">
            <i class="fas fa-pen text-xs"></i>
          </button>
        ` : ''}
        <i class="fas fa-chevron-right text-xs ml-1" style="color: rgba(15,27,40,0.25);"></i>
      </div>
    </div>
  </div>`;
}

// ============================================
// PROCEDURE DETAIL VIEW
// ============================================
async function viewProcedure(id) {
  // include_subprocedures=1 pour pouvoir charger n'importe quelle procédure,
  // y compris les sous-procédures, depuis Wikot ou un step parent.
  const data = await api(`/procedures/${id}?include_subprocedures=1`);
  if (data) {
    state.selectedProcedure = data;
    // Push une entrée d'historique pour que "Retour" ramène à la vue précédente
    pushHistory('procedure-detail', { procedureId: id });
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
    <!-- Header premium -->
    <div class="mb-5 sm:mb-6">
      <button onclick="state.selectedProcedure=null; navigate('procedures')" class="text-sm mb-4 inline-flex items-center gap-1.5 transition-colors" style="color: rgba(15,27,40,0.5);" onmouseover="this.style.color='var(--c-navy)'" onmouseout="this.style.color='rgba(15,27,40,0.5)'">
        <i class="fas fa-arrow-left"></i>Retour aux procédures
      </button>
      
      <div class="card-premium p-5 sm:p-7">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div class="flex-1 min-w-0">
            <p class="section-eyebrow mb-2">Procédure</p>
            <h2 class="font-display text-xl sm:text-2xl font-semibold leading-tight" style="color: var(--c-navy);">${escapeHtml(proc.title)}</h2>
            ${procDescription ? `<p class="text-sm sm:text-base mt-3 leading-relaxed whitespace-pre-wrap" style="color: rgba(15,27,40,0.7);">${formatHotelInfoContent(procDescription)}</p>` : ''}
            <div class="flex flex-wrap items-center gap-2 mt-4 text-xs">
              <span class="pill-gold">${proc.category_name || 'Sans catégorie'}</span>
              <span class="text-[11px] uppercase tracking-wider" style="color: rgba(15,27,40,0.4);">v${proc.version}</span>
            </div>
          </div>
          ${canEdit ? `
          <div class="flex gap-2 sm:shrink-0">
            <button onclick="showProcedureForm(${proc.id})" class="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5" style="background: var(--c-cream-deep); color: var(--c-navy);" onmouseover="this.style.background='var(--c-gold)'" onmouseout="this.style.background='var(--c-cream-deep)'">
              <i class="fas fa-pen text-xs"></i>Modifier
            </button>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Déclencheur premium -->
    ${procTrigger ? `
    <div class="card-premium p-5 mb-6" style="background: linear-gradient(135deg, var(--c-cream-deep) 0%, rgba(201,169,97,0.08) 100%); border-left: 3px solid var(--c-gold);">
      <div class="flex items-center gap-4">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy);">
          <i class="fas fa-bolt" style="color: var(--c-gold);"></i>
        </div>
        <div class="min-w-0">
          <p class="section-eyebrow">Déclencheur — Qu'est-ce qu'il se passe ?</p>
          <p class="font-display text-base sm:text-lg font-semibold mt-0.5" style="color: var(--c-navy);">${escapeHtml(procTrigger)}</p>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Steps premium -->
    <div class="mb-8">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background: var(--c-navy);">
          <i class="fas fa-list-check text-sm" style="color: var(--c-gold);"></i>
        </div>
        <h3 class="font-display text-lg font-semibold" style="color: var(--c-navy);">Étapes</h3>
        <span class="pill-gold">${steps.length} étape${steps.length > 1 ? 's' : ''}</span>
      </div>

      <div class="space-y-0">
        ${steps.map((step, i) => renderStep(step, i, steps.length)).join('')}
      </div>
    </div>

    <!-- Conditions premium -->
    ${conditions.length > 0 ? `
    <div class="mb-8">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background: var(--c-navy);">
          <i class="fas fa-code-branch text-sm" style="color: var(--c-gold);"></i>
        </div>
        <h3 class="font-display text-lg font-semibold" style="color: var(--c-navy);">Cas spécifiques — Et si en plus...</h3>
        <span class="pill-gold">${conditions.length} cas</span>
      </div>

      <div class="space-y-4">
        ${conditions.map(cond => renderCondition(cond)).join('')}
      </div>
    </div>` : ''}


  </div>`;
}

function renderStep(step, index, total) {
  const isLinked = !!step.linked_procedure_id;
  // Contenu : on prend content, sinon fallback description (rare, pour anciennes données)
  const stepContent = step.content || step.description || '';

  return `
  <div class="step-connector ${index === total - 1 ? 'last-step' : ''}">
    <div class="flex gap-4 pb-6">
      <div class="flex flex-col items-center">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 z-10" style="background: var(--c-navy); border: 1.5px solid var(--c-gold);">
          <span class="text-sm font-bold" style="color: var(--c-gold);">${step.step_number}</span>
        </div>
      </div>
      <div class="flex-1 card-premium p-4 transition-shadow">
        ${isLinked ? `
          <button type="button" onclick="openLinkedProcedure(${step.linked_procedure_id})" class="w-full text-left">
            <div class="flex items-center gap-2 mb-1">
              <i class="fas fa-diagram-project text-xs" style="color: var(--c-gold-deep);"></i>
              <span class="section-eyebrow">Sous-procédure</span>
              ${step.is_optional ? '<span class="text-[10px] px-1.5 py-0.5 rounded" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">Optionnel</span>' : ''}
            </div>
            <h4 class="font-display font-semibold flex items-center gap-2" style="color: var(--c-navy);">
              ${escapeHtml(step.title)}
              <i class="fas fa-arrow-right text-xs" style="color: var(--c-gold);"></i>
            </h4>
            ${step.linked_procedure_title ? `<p class="text-sm mt-1" style="color: var(--c-gold-deep);"><i class="fas fa-link mr-1 text-xs"></i>${escapeHtml(step.linked_procedure_title)}</p>` : '<p class="text-sm mt-1 italic" style="color: #C84C3F;">Procédure liée introuvable</p>'}
          </button>
        ` : `
          <div class="flex items-center gap-2 mb-1.5">
            ${step.is_optional ? '<span class="text-[10px] px-1.5 py-0.5 rounded" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">Optionnel</span>' : ''}
            ${step.duration_minutes ? `<span class="text-[10px]" style="color: rgba(15,27,40,0.45);"><i class="fas fa-clock mr-0.5"></i>${step.duration_minutes} min</span>` : ''}
          </div>
          <h4 class="font-display font-semibold" style="color: var(--c-navy);">${escapeHtml(step.title)}</h4>
          ${stepContent ? `<div class="text-sm mt-2 leading-relaxed whitespace-pre-wrap" style="color: rgba(15,27,40,0.7);">${formatHotelInfoContent(stepContent)}</div>` : ''}
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
  <div class="card-premium overflow-hidden" style="border-left: 3px solid var(--c-gold);">
    <div class="px-5 py-4 flex items-center gap-3" style="background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
      <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--c-navy);">
        <i class="fas fa-code-branch text-sm" style="color: var(--c-gold);"></i>
      </div>
      <div class="min-w-0">
        <p class="section-eyebrow">Si en plus...</p>
        <p class="font-display font-semibold" style="color: var(--c-navy);">${escapeHtml(cond.condition_text)}</p>
      </div>
    </div>
    ${cond.description ? `<p class="px-5 pt-3 text-sm" style="color: rgba(15,27,40,0.65);">${escapeHtml(cond.description)}</p>` : ''}
    <div class="p-5">
      ${(cond.steps || []).length === 0 ? '<p class="text-sm italic" style="color: rgba(15,27,40,0.4);">Aucune étape spécifique</p>' :
        `<div class="space-y-0">
          ${cond.steps.map((step, i) => renderStep(step, i, cond.steps.length)).join('')}
        </div>`}
    </div>
  </div>`;
}

// ============================================
// SUGGESTIONS VIEW
// ============================================
function renderSuggestionsView() {
  const isAdmin = state.user.role === 'super_admin' || state.user.role === 'admin';

  return `
  <div class="fade-in">
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <p class="section-eyebrow mb-2">Boîte à idées</p>
        <h2 class="section-title-premium text-2xl sm:text-3xl">Suggestions</h2>
        <p class="text-sm mt-1.5" style="color: rgba(15,27,40,0.55);">${isAdmin ? 'Gérez les suggestions de l\'équipe' : 'Vos suggestions d\'amélioration'}</p>
      </div>
      <button onclick="showSuggestionForm()" class="btn-premium px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 self-start sm:self-auto" style="background: var(--c-navy); color: #fff;">
        <i class="fas fa-plus text-xs"></i>Nouvelle suggestion
      </button>
    </div>

    <div class="space-y-3">
      ${state.suggestions.length === 0 ? `
        <div class="card-premium empty-state-premium">
          <div class="empty-icon"><i class="fas fa-lightbulb"></i></div>
          <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucune suggestion</p>
          <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Lancez la conversation en ajoutant la première idée.</p>
        </div>
      ` : state.suggestions.map(s => {
        const typeConfig = {
          new_procedure: { label: 'Nouvelle procédure', icon: 'fa-plus-circle' },
          improvement: { label: 'Amélioration', icon: 'fa-wand-magic-sparkles' },
          issue: { label: 'Problème', icon: 'fa-bug' }
        };
        const statusConfig = {
          pending: { label: 'En attente', bg: 'rgba(201,169,97,0.15)', color: 'var(--c-gold-deep)' },
          reviewed: { label: 'En cours de revue', bg: 'rgba(15,27,40,0.06)', color: 'var(--c-navy)' },
          approved: { label: 'Approuvée', bg: 'rgba(201,169,97,0.20)', color: 'var(--c-gold-deep)' },
          rejected: { label: 'Rejetée', bg: 'rgba(226,125,110,0.12)', color: '#C84C3F' },
          implemented: { label: 'Implémentée', bg: 'var(--c-navy)', color: 'var(--c-gold)' }
        };
        const tc = typeConfig[s.type] || typeConfig.improvement;
        const sc = statusConfig[s.status] || statusConfig.pending;

        return `
        <div class="card-premium p-5">
          <div class="flex items-start gap-4">
            <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy);">
              <i class="fas ${tc.icon}" style="color: var(--c-gold);"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <h4 class="font-display font-semibold" style="color: var(--c-navy);">${s.title}</h4>
                <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold" style="background: ${sc.bg}; color: ${sc.color};">${sc.label}</span>
              </div>
              <p class="text-sm" style="color: rgba(15,27,40,0.65);">${s.description}</p>
              <div class="flex items-center gap-3 mt-2 text-[11px]" style="color: rgba(15,27,40,0.45);">
                <span><i class="fas fa-user mr-1" style="color: var(--c-gold);"></i>${s.user_name}</span>
                <span><i class="fas fa-clock mr-1" style="color: var(--c-gold);"></i>${formatDate(s.created_at)}</span>
                ${s.procedure_title ? `<span><i class="fas fa-sitemap mr-1" style="color: var(--c-gold);"></i>${s.procedure_title}</span>` : ''}
              </div>
              ${s.admin_response ? `
              <div class="mt-3 rounded-lg p-3" style="background: var(--c-cream-deep); border-left: 3px solid var(--c-gold);">
                <p class="section-eyebrow mb-1"><i class="fas fa-reply mr-1"></i>Réponse de ${s.reviewed_by_name || 'l\'admin'}</p>
                <p class="text-sm" style="color: var(--c-navy);">${s.admin_response}</p>
              </div>` : ''}
            </div>
            ${isAdmin && s.status === 'pending' ? `
            <div class="flex gap-1.5 shrink-0">
              <button onclick="reviewSuggestion(${s.id}, 'approved')" class="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style="background: rgba(201,169,97,0.12); color: var(--c-gold-deep);" onmouseover="this.style.background='var(--c-gold)';this.style.color='var(--c-navy)';" onmouseout="this.style.background='rgba(201,169,97,0.12)';this.style.color='var(--c-gold-deep)';" title="Approuver">
                <i class="fas fa-check text-xs"></i>
              </button>
              <button onclick="reviewSuggestion(${s.id}, 'rejected')" class="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style="background: rgba(226,125,110,0.10); color: #C84C3F;" onmouseover="this.style.background='rgba(226,125,110,0.20)'" onmouseout="this.style.background='rgba(226,125,110,0.10)'" title="Rejeter">
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

// Bascule une permission granulaire pour un employé.
// Mutation LOCALE de state.users + re-render ciblé (zéro refresh / zéro reload).
async function togglePermission(userId, permKey, newValue) {
  const labels = {
    can_edit_procedures: 'modifier les procédures',
    can_edit_info: 'modifier les informations',
    can_manage_chat: 'gérer les salons et conversations',
    can_edit_clients: 'gérer les chambres et le Code Wikot',
    can_edit_restaurant: 'gérer le restaurant',
    can_create_tasks: 'créer et modifier des tâches',
    can_assign_tasks: 'attribuer des tâches aux employés'
  };
  // Optimistic update : on met à jour le state local immédiatement
  const list = state.users || [];
  const idx = list.findIndex(u => u.id === userId);
  const previousValue = idx >= 0 ? Number(list[idx][permKey]) : 0;
  if (idx >= 0) {
    list[idx] = { ...list[idx], [permKey]: newValue };
  }
  const body = {};
  body[permKey] = newValue;
  const result = await api(`/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify(body) });
  if (result) {
    // Pas de loadData() ni de render() complet : la case est déjà cochée localement.
    showToast(newValue === 1 ? `Droit accordé : ${labels[permKey] || permKey}` : `Droit retiré : ${labels[permKey] || permKey}`, 'success');
  } else if (idx >= 0) {
    // Échec serveur : on annule l'optimistic update et on re-render
    list[idx] = { ...list[idx], [permKey]: previousValue };
    render();
  }
}

// Composant : 6 cases à cocher pour un employé (versions desktop/mobile)
// Couvre : procédures, infos, chat, chambres, restaurant, paramètres
function permissionCheckboxes(u, compact = false) {
  const perms = [
    { key: 'can_edit_procedures',  label: 'Procédures',          icon: 'fa-sitemap' },
    { key: 'can_edit_info',        label: 'Informations',        icon: 'fa-circle-info' },
    { key: 'can_manage_chat',      label: 'Salons / chat',       icon: 'fa-comments' },
    { key: 'can_edit_clients',     label: 'Chambres & Code Wikot', icon: 'fa-door-closed' },
    { key: 'can_edit_restaurant',  label: 'Restaurant',          icon: 'fa-utensils' },
    { key: 'can_create_tasks',     label: 'Créer des tâches',    icon: 'fa-list-check' },
    { key: 'can_assign_tasks',     label: 'Attribuer des tâches',icon: 'fa-user-tag' }
  ];
  return `
    <div class="flex flex-col gap-1.5">
      ${perms.map(p => {
        const checked = Number(u[p.key]) === 1;
        return `
          <label class="flex items-center gap-2 cursor-pointer text-xs text-navy-700 hover:bg-gray-50 rounded px-1 py-0.5 transition-colors">
            <input type="checkbox" ${checked ? 'checked' : ''}
              onchange="togglePermission(${u.id}, '${p.key}', this.checked ? 1 : 0)"
              class="w-3.5 h-3.5 rounded border-gray-300 text-brand-500 focus:ring-brand-400">
            <i class="fas ${p.icon} text-navy-400 text-[10px] w-3 text-center"></i>
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
              <td class="py-3.5 px-5">${rolePill(u.role)}</td>
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
                ${isSelf ? '<span class="text-xs italic" style="color: rgba(15,27,40,0.3);">—</span>' : `
                  <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
                    class="w-8 h-8 rounded-lg flex items-center justify-center transition-all" style="color: rgba(15,27,40,0.4);" onmouseover="this.style.background='rgba(226,125,110,0.12)'; this.style.color='#C84C3F';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.4)';"
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
            ${isSelf ? '' : `
            <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
              class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: rgba(226,125,110,0.10); color: #C84C3F;">
              <i class="fas fa-trash text-xs"></i>
            </button>`}
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-3 pt-3" style="border-top: 1px solid var(--c-line);">
            ${rolePill(u.role)}
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
        <p>Vous pouvez activer / désactiver indépendamment <strong style="color: var(--c-navy);">six droits</strong> pour chaque employé :</p>
        <ul class="list-disc pl-5 space-y-0.5">
          <li><strong style="color: var(--c-navy);">Procédures</strong> — créer, modifier et supprimer les procédures.</li>
          <li><strong style="color: var(--c-navy);">Informations</strong> — créer et modifier les informations de l'hôtel.</li>
          <li><strong style="color: var(--c-navy);">Salons / chat</strong> — créer, modifier et organiser les conversations.</li>
          <li><strong style="color: var(--c-navy);">Chambres &amp; présents</strong> — gérer les chambres et saisir les clients du jour.</li>
          <li><strong style="color: var(--c-navy);">Restaurant</strong> — planning hebdo, exceptions, réservations, dashboard.</li>
          <li><strong style="color: var(--c-navy);">Paramètres hôtel</strong> — modifier l'identité, contact, séjour, wifi.</li>
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
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Couleur</label>
        <input id="info-cat-color" type="color" value="${cat ? cat.color || '#3B82F6' : '#3B82F6'}"
          class="w-full h-11 input-premium rounded-lg cursor-pointer">
        <p class="text-xs text-navy-400 mt-1">Couleur d'identification de la catégorie.</p>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 rounded-lg text-sm font-medium transition-all" style="background: var(--c-cream-deep); color: var(--c-navy);">Annuler</button>
        <button type="submit" class="btn-premium px-4 py-3 sm:py-2 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: #fff;">${isEdit ? 'Enregistrer' : 'Créer'}</button>
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
    // Le backend renvoie déjà references (array) et answer_card (object) désérialisés
    references: Array.isArray(m.references) ? m.references : [],
    answer_card: m.answer_card || null
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
  const content = (input ? input.value.trim() : '');

  // Audio en attente (si l'utilisateur a enregistré pour cette zone)
  const v = initVoiceState();
  const hasVoiceForThisMode = v && v.active === 'staff' && v.mode === mode && v.blob && !v.recording;
  if (!content && !hasVoiceForThisMode) return;
  if (s.sending) return;
  // Si enregistrement en cours sur cette zone, on stoppe d'abord (l'utilisateur doit valider la preview)
  if (v && v.active === 'staff' && v.mode === mode && v.recording) {
    showToast('Termine l\'enregistrement avant d\'envoyer', 'warning');
    return;
  }

  // Mode max : on a TOUJOURS besoin d'un workflow + d'une conversation active
  // (créée par enterBackWikotWorkflow). Si rien, on bloque.
  if (mode === 'max' && !s.currentConvId) {
    showToast('Sélectionne d\'abord un des 4 boutons (Créer/Modifier procédure/information).', 'error');
    return;
  }

  // Mode standard : si pas de conversation active, on en crée une à la volée
  if (!s.currentConvId) {
    const data = await api('/wikot/conversations', {
      method: 'POST',
      body: JSON.stringify({ mode })
    });
    if (!data) return;
    s.currentConvId = data.id;
  }

  // Affichage optimiste du message utilisateur (avec ref audio si présent)
  const optimisticMsg = { id: 'temp-' + Date.now(), role: 'user', content, references: [] };
  if (hasVoiceForThisMode) {
    optimisticMsg.audio_pending = true;
    optimisticMsg.audio_duration_ms = v.durationMs;
  }
  s.messages.push(optimisticMsg);
  s.sending = true;
  if (input) { input.value = ''; autoResizeTextarea(input); }
  render();
  scrollWikotToBottom(mode);

  // Mode max : on envoie l'état actuel du formulaire pour que l'IA voie ce qu'on voit
  const body = { content };
  if (mode === 'max' && state.backWikotForm) {
    body.form_context = collectBackWikotFormContext();
  }

  // Upload audio si présent
  if (hasVoiceForThisMode) {
    const up = await uploadCurrentVoice('staff');
    if (!up) {
      // Échec upload : on retire l'optimiste et on rend la main
      s.messages.pop();
      s.sending = false;
      render();
      return;
    }
    body.audio_key = up.audio_key;
    body.audio_mime = up.audio_mime;
    body.audio_duration_ms = up.audio_duration_ms;
    body.audio_size_bytes = up.audio_size_bytes;
    // L'audio est maintenant uploadé côté serveur → on peut nettoyer le state local
    discardVoiceRecording();
  }

  const result = await api(`/wikot/conversations/${s.currentConvId}/message`, {
    method: 'POST',
    body: JSON.stringify(body)
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
    references: result.assistant_message.references || [],
    answer_card: result.assistant_message.answer_card || null
  });

  if (result.actions && result.actions.length > 0) {
    s.actions.push(...result.actions);
  }

  // Mode max : appliquer les form_updates renvoyés par l'IA au formulaire visible
  if (mode === 'max' && Array.isArray(result.form_updates) && result.form_updates.length > 0) {
    applyBackWikotFormUpdates(result.form_updates);
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

async function viewWikotReference(ref) {
  if (ref.type === 'procedure') {
    // Procédure : navigation directe vers la page détail
    await viewProcedure(ref.id);
    return;
  }
  if (ref.type === 'info_item') {
    // Info : on doit (1) charger la liste des infos si pas encore en mémoire,
    //              (2) trouver la catégorie de l'item,
    //              (3) ouvrir l'accordéon de cette catégorie,
    //              (4) scroller vers l'item et le surligner.

    // Si les infos ne sont pas chargées, on les récupère
    if (!state.hotelInfoItems || !state.hotelInfoItems.length) {
      try {
        const data = await api('/hotel-info');
        if (data) {
          state.hotelInfoCategories = data.categories || [];
          state.hotelInfoItems = data.items || [];
        }
      } catch (e) { /* on continue, on tentera quand même */ }
    }

    const item = (state.hotelInfoItems || []).find(it => it.id === ref.id);
    const targetCategoryId = item ? item.category_id : null;

    // Aller sur la vue Info, sans recherche active, et avec la bonne catégorie ouverte
    state.currentView = 'info';
    state.hotelInfoSearchQuery = '';
    state.hotelInfoActiveCategory = targetCategoryId;
    render();

    // Après render, on s'assure que l'accordéon est ouvert et on scrolle/surligne
    setTimeout(() => {
      if (targetCategoryId) {
        const content = document.getElementById(`info-cat-content-${targetCategoryId}`);
        const chevron = document.getElementById(`info-cat-chevron-${targetCategoryId}`);
        if (content && content.classList.contains('hidden')) {
          content.classList.remove('hidden');
          if (chevron) {
            chevron.classList.remove('fa-chevron-down');
            chevron.classList.add('fa-chevron-up');
          }
        }
      }
      const el = document.getElementById('info-item-' + ref.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-brand-400', 'shadow-md');
        setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400', 'shadow-md'), 2500);
      } else if (targetCategoryId) {
        // Fallback : si l'item DOM n'est pas trouvé, scroll au moins vers la catégorie
        const catEl = document.getElementById(`info-cat-${targetCategoryId}`);
        if (catEl) catEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 250);
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
  if (msg.role === 'user') {
    const hasAudio = !!msg.audio_key || !!msg.audio_pending;
    const txt = msg.content && msg.content.trim() ? escapeHtml(msg.content) : (hasAudio ? '<span class="italic" style="opacity: 0.7;"><i class="fas fa-microphone mr-1.5"></i>Message vocal</span>' : '');
    const audioBlock = msg.audio_key ? renderVoiceMessageBubble(msg, { isClient: false })
      : (msg.audio_pending ? `<div class="flex items-center gap-2 mt-1.5 pt-1.5 text-xs italic" style="border-top: 1px solid rgba(255,255,255,0.15); opacity: 0.7;"><i class="fas fa-circle-notch fa-spin"></i>Envoi de l'audio (${formatVoiceDuration(msg.audio_duration_ms || 0)})...</div>` : '');
    return `
      <div class="flex justify-end mb-4">
        <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap" style="background: var(--c-navy); color: #fff; box-shadow: 0 1px 2px rgba(10,22,40,0.08);">
          ${txt}
          ${audioBlock}
        </div>
      </div>
    `;
  }
  // Assistant
  const refs = msg.references || [];
  const answerCard = msg.answer_card || null;
  const actionsArr = mode === 'max' ? (state.wikotMaxActions || []) : (state.wikotActions || []);
  const actionsForMsg = actionsArr.filter(a => a.message_id === msg.id);
  const cfg = WIKOT_MODE_CONFIG[mode] || WIKOT_MODE_CONFIG.standard;

  // MODE STANDARD (Wikot) — UNE SEULE carte
  if (mode === 'standard') {
    return `
      <div class="flex justify-start mb-4">
        <div class="flex gap-2 max-w-[95%] sm:max-w-[85%] w-full">
          <div class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs" style="background: var(--c-navy); color: var(--c-gold);">
            <i class="fas ${cfg.icon}"></i>
          </div>
          <div class="flex-1 min-w-0">
            ${renderWikotAnswerCard(answerCard)}
          </div>
        </div>
      </div>
    `;
  }

  // MODE MAX (Back Wikot) — bulle texte + références + actions
  return `
    <div class="flex justify-start mb-4">
      <div class="flex gap-2 max-w-[90%] sm:max-w-[80%]">
        <div class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs" style="background: var(--c-navy); color: var(--c-gold);">
          <i class="fas ${cfg.icon}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style="background: #fff; border: 1px solid var(--c-line); box-shadow: 0 1px 2px rgba(10,22,40,0.04);">
            <div style="color: var(--c-navy);">${formatWikotContent(msg.content || '')}</div>
            ${refs.length > 0 ? `
              <div class="flex flex-wrap gap-2 mt-3 pt-3" style="border-top: 1px solid var(--c-line);">
                ${refs.map(r => `
                  <button onclick='viewWikotReference(${JSON.stringify(r)})' class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all" style="background: rgba(201,169,97,0.10); color: var(--c-gold-deep); border: 1px solid rgba(201,169,97,0.25);" onmouseover="this.style.background='rgba(201,169,97,0.18)'" onmouseout="this.style.background='rgba(201,169,97,0.10)'">
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

// Carte de réponse Wikot (mode standard) : 5 types possibles
//   - procedure        : procédure entière (titre + déclencheur + toutes les étapes)
//   - procedure_step   : UNE étape précise (avec sous-procédure complète si liée)
//   - info_item        : UNE information précise (titre + contenu complet)
//   - info_category    : TOUTES les infos d'une catégorie (ex: "Loisirs et activités")
//   - not_found        : message préfait "aucune information ni procédure ne correspond"
function renderWikotAnswerCard(card) {
  if (!card || card.kind === 'not_found') {
    return `
      <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl px-4 py-5 text-center">
        <i class="fas fa-circle-question text-3xl text-gray-400 mb-2"></i>
        <p class="text-sm font-semibold text-navy-700">Aucune information ni procédure ne correspond à ta demande.</p>
        <p class="text-xs text-navy-500 mt-1.5">Essaie de reformuler ta question, ou contacte un responsable si le sujet n'est pas encore documenté.</p>
      </div>
    `;
  }

  if (card.kind === 'procedure') {
    const steps = Array.isArray(card.steps) ? card.steps : [];
    return `
      <div class="bg-white border-2 border-brand-200 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
        <!-- Header coloré -->
        <div class="px-4 py-2.5 bg-gradient-to-r from-brand-500 to-purple-500 text-white flex items-center gap-2">
          <i class="fas fa-sitemap text-sm"></i>
          <span class="text-xs font-semibold uppercase tracking-wide">Procédure</span>
          ${card.category_name ? `<span class="ml-auto text-[10px] bg-white/20 px-2 py-0.5 rounded-full">${escapeHtml(card.category_name)}</span>` : ''}
        </div>
        <!-- Header procédure -->
        <div class="px-4 py-3 space-y-2 border-b border-gray-100">
          <h3 class="font-bold text-navy-900 text-base leading-tight">${escapeHtml(card.title)}</h3>
          ${card.trigger_event ? `<div class="text-xs text-navy-600 flex items-start gap-1.5"><i class="fas fa-bolt text-amber-500 mt-0.5"></i><span>${escapeHtml(card.trigger_event)}</span></div>` : ''}
          ${card.description ? `<p class="text-sm text-navy-700 whitespace-pre-wrap leading-relaxed">${formatHotelInfoContent(card.description)}</p>` : ''}
        </div>
        <!-- Étapes COMPLÈTES (titre + contenu + sous-procédures dépliées) -->
        ${steps.length > 0 ? `
          <ol class="px-3 sm:px-4 py-3 space-y-2.5">
            ${steps.map(s => renderWikotStep(s)).join('')}
          </ol>
        ` : '<p class="px-4 py-3 text-sm text-navy-400 italic">Aucune étape renseignée.</p>'}
      </div>
    `;
  }

  // Carte d'UNE étape précise dans une procédure (granularité étape)
  // Si l'étape est liée à une sous-procédure : on affiche la sous-procédure entière en bloc principal
  if (card.kind === 'procedure_step' && card.step) {
    const st = card.step;
    const linkedSteps = Array.isArray(st.linked_steps) ? st.linked_steps : [];
    const hasLinked = st.linked_procedure_id && (linkedSteps.length > 0 || st.linked_title);

    // Cas 1 : l'étape pointe vers une sous-procédure → on déploie la sous-procédure entière
    if (hasLinked) {
      return `
        <div class="bg-white border-2 border-brand-200 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          <div class="px-4 py-2.5 bg-gradient-to-r from-brand-500 to-purple-500 text-white flex items-center gap-2">
            <i class="fas fa-diagram-project text-sm"></i>
            <span class="text-xs font-semibold uppercase tracking-wide">Sous-procédure</span>
            ${card.category_name ? `<span class="ml-auto text-[10px] bg-white/20 px-2 py-0.5 rounded-full">${escapeHtml(card.category_name)}</span>` : ''}
          </div>
          <div class="px-4 py-3 space-y-2 border-b border-gray-100">
            <h3 class="font-bold text-navy-900 text-base leading-tight">${escapeHtml(st.linked_title || st.title)}</h3>
            ${st.linked_trigger_event ? `<div class="text-xs text-navy-600 flex items-start gap-1.5"><i class="fas fa-bolt text-amber-500 mt-0.5"></i><span>${escapeHtml(st.linked_trigger_event)}</span></div>` : ''}
            ${st.linked_description ? `<p class="text-sm text-navy-700 whitespace-pre-wrap leading-relaxed">${formatHotelInfoContent(st.linked_description)}</p>` : ''}
            <p class="text-[11px] text-navy-500 italic">Étape ${st.step_number} de la procédure « ${escapeHtml(card.parent_title || '')} »</p>
          </div>
          ${linkedSteps.length > 0 ? `
            <ol class="px-3 sm:px-4 py-3 space-y-2.5">
              ${linkedSteps.map(ls => `
                <li class="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  <div class="flex items-start gap-3">
                    <div class="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 text-white text-xs font-bold flex items-center justify-center">${ls.step_number || ''}</div>
                    <div class="min-w-0 flex-1">
                      <h4 class="font-semibold text-navy-900 text-sm leading-snug">${escapeHtml(ls.title || '')}</h4>
                      ${ls.content ? `<div class="text-xs text-navy-700 mt-1.5 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(ls.content)}</div>` : ''}
                    </div>
                  </div>
                </li>
              `).join('')}
            </ol>
          ` : ''}
        </div>
      `;
    }

    // Cas 2 : étape simple → on affiche juste cette étape, dans son contexte
    return `
      <div class="bg-white border-2 border-brand-200 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
        <div class="px-4 py-2.5 bg-gradient-to-r from-brand-500 to-purple-500 text-white flex items-center gap-2">
          <i class="fas fa-list-check text-sm"></i>
          <span class="text-xs font-semibold uppercase tracking-wide">Étape de procédure</span>
          ${card.category_name ? `<span class="ml-auto text-[10px] bg-white/20 px-2 py-0.5 rounded-full">${escapeHtml(card.category_name)}</span>` : ''}
        </div>
        <div class="px-4 py-3 space-y-1 border-b border-gray-100 bg-gray-50">
          <p class="text-[11px] text-navy-500 uppercase tracking-wide font-semibold">Procédure parente</p>
          <p class="text-sm font-semibold text-navy-800">${escapeHtml(card.parent_title || '')}</p>
          ${card.parent_trigger_event ? `<p class="text-xs text-navy-600"><i class="fas fa-bolt text-amber-500 mr-1"></i>${escapeHtml(card.parent_trigger_event)}</p>` : ''}
        </div>
        <div class="px-3 sm:px-4 py-3">
          <div class="bg-white border-2 border-brand-100 rounded-xl p-3 shadow-sm">
            <div class="flex items-start gap-3">
              <div class="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-purple-500 text-white text-sm font-bold flex items-center justify-center">${st.step_number || ''}</div>
              <div class="min-w-0 flex-1">
                <h4 class="font-bold text-navy-900 text-sm leading-snug">${escapeHtml(st.title || '')}</h4>
                ${st.content ? `<div class="text-sm text-navy-700 mt-1.5 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(st.content)}</div>` : '<p class="text-xs text-navy-400 italic mt-1">Pas de contenu détaillé pour cette étape.</p>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (card.kind === 'info_item') {
    const catColor = card.category_color || '#3B82F6';
    return `
      <div class="bg-white border-2 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden" style="border-color:${catColor}40">
        <!-- Header coloré -->
        <div class="px-4 py-2.5 text-white flex items-center gap-2" style="background:${catColor}">
          <i class="fas ${card.category_icon || 'fa-circle-info'} text-sm"></i>
          <span class="text-xs font-semibold uppercase tracking-wide">Information</span>
          ${card.category_name ? `<span class="ml-auto text-[10px] bg-white/20 px-2 py-0.5 rounded-full">${escapeHtml(card.category_name)}</span>` : ''}
        </div>
        <!-- Body : contenu COMPLET de l'info, autosuffisant -->
        <div class="px-4 py-3 space-y-2">
          <h3 class="font-bold text-navy-900 text-base leading-tight">${escapeHtml(card.title)}</h3>
          ${card.content ? `<div class="text-sm text-navy-700 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(card.content)}</div>` : '<p class="text-sm text-navy-400 italic">Aucun contenu.</p>'}
        </div>
      </div>
    `;
  }

  // Carte de catégorie d'infos : TOUTES les infos du thème, dépliées
  if (card.kind === 'info_category') {
    const catColor = card.color || '#3B82F6';
    const items = Array.isArray(card.items) ? card.items : [];
    return `
      <div class="bg-white border-2 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden" style="border-color:${catColor}40">
        <div class="px-4 py-2.5 text-white flex items-center gap-2" style="background:${catColor}">
          <i class="fas ${card.icon || 'fa-folder-open'} text-sm"></i>
          <span class="text-xs font-semibold uppercase tracking-wide">Catégorie d'informations</span>
          <span class="ml-auto text-[10px] bg-white/20 px-2 py-0.5 rounded-full">${items.length} info${items.length > 1 ? 's' : ''}</span>
        </div>
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="font-bold text-navy-900 text-base leading-tight">${escapeHtml(card.name || '')}</h3>
        </div>
        ${items.length > 0 ? `
          <div class="px-3 sm:px-4 py-3 space-y-2.5">
            ${items.map(it => `
              <div class="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                <h4 class="font-semibold text-navy-900 text-sm leading-snug mb-1.5 flex items-center gap-2">
                  <span class="inline-block w-2 h-2 rounded-full" style="background:${catColor}"></span>
                  ${escapeHtml(it.title || '')}
                </h4>
                ${it.content ? `<div class="text-sm text-navy-700 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(it.content)}</div>` : '<p class="text-xs text-navy-400 italic">Aucun contenu.</p>'}
              </div>
            `).join('')}
          </div>
        ` : '<p class="px-4 py-3 text-sm text-navy-400 italic">Aucune information dans cette catégorie.</p>'}
      </div>
    `;
  }

  // Type inconnu : fallback not_found
  return renderWikotAnswerCard({ kind: 'not_found' });
}

// Helper : rend UNE étape de la answer_card procédure (mode standard Wikot)
// - Titre + contenu en clair
// - Si linked_procedure_id → on affiche aussi les étapes de la sous-procédure dépliées
function renderWikotStep(s) {
  const num = s.step_number || '';
  const linkedSteps = Array.isArray(s.linked_steps) ? s.linked_steps : [];
  const hasLinked = s.linked_procedure_id && (linkedSteps.length > 0 || s.linked_title);
  return `
    <li class="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">${num}</span>
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-navy-900 text-sm leading-snug">${escapeHtml(s.title || '(sans titre)')}</div>
          ${s.content ? `<div class="text-[13px] text-navy-700 mt-1.5 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(s.content)}</div>` : ''}
          ${hasLinked ? `
            <div class="mt-2.5 border-l-2 border-brand-300 pl-3 bg-brand-50/40 rounded-r-lg py-2 pr-2">
              <div class="text-[11px] uppercase tracking-wide font-semibold text-brand-700 flex items-center gap-1.5 mb-1.5">
                <i class="fas fa-diagram-project"></i>
                Sous-procédure : ${escapeHtml(s.linked_title || '')}
              </div>
              ${linkedSteps.length > 0 ? `
                <ol class="space-y-1.5">
                  ${linkedSteps.map(ls => `
                    <li class="flex items-start gap-2">
                      <span class="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-brand-200 text-brand-700 text-[10px] font-bold flex items-center justify-center mt-0.5">${ls.step_number || ''}</span>
                      <div class="min-w-0 flex-1">
                        <div class="font-semibold text-navy-800 text-xs">${escapeHtml(ls.title || '(sans titre)')}</div>
                        ${ls.content ? `<div class="text-[11px] text-navy-600 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">${formatHotelInfoContent(ls.content)}</div>` : ''}
                      </div>
                    </li>
                  `).join('')}
                </ol>
              ` : '<div class="text-[11px] text-navy-400 italic">(aucune étape dans la sous-procédure)</div>'}
            </div>
          ` : ''}
        </div>
      </div>
    </li>
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
    emptyText: "Je connais toutes les procédures et informations de l'hôtel. Pose-moi une question, je cherche dans la base et je te donne le bouton pour aller voir le détail.",
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

// ============================================
// BACK WIKOT — WORKFLOW ATELIER (4 boutons spécialisés)
// ============================================
// Mappe workflow_mode → permissions / cible / form vide
const BACK_WIKOT_WORKFLOWS = {
  create_procedure: {
    label: 'Créer une procédure',
    icon: 'fa-circle-plus',
    color: 'emerald',
    targetKind: 'procedure',
    permissionKey: 'can_edit_procedures',
    needsTarget: false,
    description: 'Rédige une nouvelle procédure pas à pas avec Back Wikot.'
  },
  update_procedure: {
    label: 'Modifier une procédure',
    icon: 'fa-pen-to-square',
    color: 'orange',
    targetKind: 'procedure',
    permissionKey: 'can_edit_procedures',
    needsTarget: true,
    description: 'Choisis une procédure existante puis ajuste-la avec Back Wikot.'
  },
  create_info: {
    label: 'Créer une information',
    icon: 'fa-square-plus',
    color: 'sky',
    targetKind: 'info_item',
    permissionKey: 'can_edit_info',
    needsTarget: false,
    description: 'Rédige une nouvelle fiche information pour ton hôtel.'
  },
  update_info: {
    label: 'Modifier une information',
    icon: 'fa-file-pen',
    color: 'amber',
    targetKind: 'info_item',
    permissionKey: 'can_edit_info',
    needsTarget: true,
    description: 'Choisis une information existante puis ajuste-la avec Back Wikot.'
  }
};

function userCanRunBackWikotWorkflow(workflowMode) {
  const wf = BACK_WIKOT_WORKFLOWS[workflowMode];
  if (!wf) return false;
  if (!state.user) return false;
  if (state.user.role === 'admin' || state.user.role === 'super_admin') return true;
  return state.user[wf.permissionKey] === 1;
}

// Form vide selon le workflow
function emptyBackWikotForm(workflowMode) {
  if (workflowMode === 'create_procedure' || workflowMode === 'update_procedure') {
    return {
      kind: 'procedure',
      id: null,
      title: '',
      trigger_event: '',
      description: '',
      category_id: null,
      steps: []
    };
  }
  if (workflowMode === 'create_info' || workflowMode === 'update_info') {
    return {
      kind: 'info_item',
      id: null,
      title: '',
      content: '',
      category_id: null
    };
  }
  return null;
}

// Snapshot du form pour l'envoyer au backend (l'IA voit ce que voit l'utilisateur)
function collectBackWikotFormContext() {
  const f = state.backWikotForm;
  if (!f) return null;
  return {
    workflow_mode: state.backWikotWorkflowMode,
    target_kind: state.backWikotTargetKind,
    target_id: state.backWikotTargetId,
    form: JSON.parse(JSON.stringify(f))
  };
}

// Applique les patches renvoyés par le tool update_form
// FORMAT BACKEND : tableau d'objets, chaque objet contient les champs modifiés.
// Ex: [ { title: "Effectuer un check-out", trigger_event: "Quand…", steps: [...] } ]
// On merge chaque patch dans state.backWikotForm et on tracke les champs touchés
// pour le feedback visuel (highlight flash 1.5s).
function applyBackWikotFormUpdates(updates) {
  if (!state.backWikotForm) return;
  const f = state.backWikotForm;
  const touchedFields = new Set();

  // Définir les champs autorisés selon le type de form (sécurité côté UI aussi)
  const allowedKeys = f.kind === 'procedure'
    ? ['title', 'trigger_event', 'description', 'category_id', 'steps']
    : ['title', 'content', 'category_id'];

  for (const patch of updates) {
    if (!patch || typeof patch !== 'object') continue;
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.includes(key)) continue;
      const value = patch[key];
      if (key === 'steps' && Array.isArray(value)) {
        f.steps = value.map((s, i) => ({
          step_number: i + 1,
          title: s.title || '',
          content: s.content || '',
          linked_procedure_id: s.linked_procedure_id || null
        }));
        touchedFields.add('steps');
      } else {
        f[key] = value;
        touchedFields.add(key);
      }
    }
  }

  // Tracker les champs récemment modifiés (utilisé par le rendu pour highlight)
  state.backWikotRecentlyTouched = Array.from(touchedFields);
  state.backWikotTouchedAt = Date.now();
  state.backWikotFormDirty = true;

  // Auto-clear du highlight après 2s
  if (state._backWikotTouchedTimer) clearTimeout(state._backWikotTouchedTimer);
  state._backWikotTouchedTimer = setTimeout(() => {
    state.backWikotRecentlyTouched = [];
    render();
  }, 2000);
}

// Démarre un workflow Back Wikot : vérifie permissions + crée une conversation neuve
async function enterBackWikotWorkflow(workflowMode) {
  if (!userCanRunBackWikotWorkflow(workflowMode)) {
    showToast("Tu n'as pas la permission d'utiliser ce workflow.", 'error');
    return;
  }
  const wf = BACK_WIKOT_WORKFLOWS[workflowMode];
  state.backWikotWorkflowMode = workflowMode;
  state.backWikotTargetKind = wf.targetKind;
  state.backWikotTargetId = null;
  state.backWikotForm = null;
  state.backWikotFormDirty = false;
  state.backWikotSelectSearch = '';

  if (wf.needsTarget) {
    // On va d'abord faire choisir la cible (procédure ou info à modifier)
    state.backWikotStep = 'select-target';
    // Précharger la liste appropriée
    if (workflowMode === 'update_procedure') {
      await loadBackWikotProcedures();
    } else if (workflowMode === 'update_info') {
      await loadBackWikotInfo();
    }
    render();
  } else {
    // Création directe : on entre dans l'atelier avec un form vierge
    state.backWikotForm = emptyBackWikotForm(workflowMode);
    await openBackWikotWorkshop();
  }
}

// Charge toutes les procédures + sous-procédures pour la sélection cible
async function loadBackWikotProcedures() {
  const data = await api('/procedures?include_subprocedures=1');
  if (!data) return;
  state.backWikotProceduresCache = data.procedures || [];
}

// Charge toutes les infos pour la sélection cible
async function loadBackWikotInfo() {
  const data = await api('/hotel-info');
  if (!data) return;
  state.backWikotInfoCache = {
    categories: data.categories || [],
    items: data.items || []
  };
}

// L'utilisateur a choisi une procédure à modifier
async function selectBackWikotProcedureTarget(procId) {
  const data = await api(`/procedures/${procId}`);
  if (!data || !data.procedure) return;
  const p = data.procedure;
  const steps = (data.steps || []).map((s, i) => ({
    step_number: s.step_number || (i + 1),
    title: s.title || '',
    content: s.content || '',
    linked_procedure_id: s.linked_procedure_id || null
  }));
  state.backWikotTargetId = procId;
  state.backWikotForm = {
    kind: 'procedure',
    id: procId,
    title: p.title || '',
    trigger_event: p.trigger_event || '',
    description: p.description || '',
    category_id: p.category_id || null,
    steps
  };
  state.backWikotFormDirty = false;
  await openBackWikotWorkshop();
}

// L'utilisateur a choisi une info à modifier
async function selectBackWikotInfoTarget(itemId) {
  const cache = state.backWikotInfoCache;
  if (!cache) await loadBackWikotInfo();
  const items = (state.backWikotInfoCache && state.backWikotInfoCache.items) || [];
  const it = items.find(x => x.id === itemId);
  if (!it) {
    showToast('Information introuvable.', 'error');
    return;
  }
  state.backWikotTargetId = itemId;
  state.backWikotForm = {
    kind: 'info_item',
    id: itemId,
    title: it.title || '',
    content: it.content || '',
    category_id: it.category_id || null
  };
  state.backWikotFormDirty = false;
  await openBackWikotWorkshop();
}

// Crée la conversation Back Wikot avec le contexte workflow + entre dans l'atelier
async function openBackWikotWorkshop() {
  // Création conversation côté backend (avec workflow_mode + target_kind/id si update)
  const body = {
    mode: 'max',
    workflow_mode: state.backWikotWorkflowMode,
    target_kind: state.backWikotTargetKind,
    target_id: state.backWikotTargetId
  };
  const data = await api('/wikot/conversations', { method: 'POST', body: JSON.stringify(body) });
  if (!data) return;
  const s = wikotState('max');
  s.currentConvId = data.id;
  s.messages = [];
  s.actions = [];
  await loadWikotConversations('max');
  state.backWikotStep = 'workshop';
  render();
  setTimeout(() => {
    const input = document.getElementById('wikot-max-input');
    if (input) input.focus();
  }, 120);
}

// Reprendre une conversation depuis l'historique : on récupère son contexte (workflow_mode, target)
async function resumeBackWikotConversation(convId) {
  const data = await api(`/wikot/conversations/${convId}`);
  if (!data) return;
  const conv = data.conversation || {};
  const wfMode = conv.workflow_mode;
  if (!wfMode || !BACK_WIKOT_WORKFLOWS[wfMode]) {
    showToast("Conversation sans workflow valide.", 'error');
    return;
  }
  state.backWikotWorkflowMode = wfMode;
  state.backWikotTargetKind = conv.target_kind || BACK_WIKOT_WORKFLOWS[wfMode].targetKind;
  state.backWikotTargetId = conv.target_id || null;
  state.backWikotFormDirty = false;

  // Reconstituer le form
  if (state.backWikotTargetId && state.backWikotTargetKind === 'procedure') {
    const p = await api(`/procedures/${state.backWikotTargetId}`);
    if (p && p.procedure) {
      const steps = (p.steps || []).map((s, i) => ({
        step_number: s.step_number || (i + 1),
        title: s.title || '',
        content: s.content || '',
        linked_procedure_id: s.linked_procedure_id || null
      }));
      state.backWikotForm = {
        kind: 'procedure', id: state.backWikotTargetId,
        title: p.procedure.title || '', trigger_event: p.procedure.trigger_event || '',
        description: p.procedure.description || '', category_id: p.procedure.category_id || null,
        steps
      };
    }
  } else if (state.backWikotTargetId && state.backWikotTargetKind === 'info_item') {
    if (!state.backWikotInfoCache) await loadBackWikotInfo();
    const it = (state.backWikotInfoCache.items || []).find(x => x.id === state.backWikotTargetId);
    if (it) {
      state.backWikotForm = {
        kind: 'info_item', id: state.backWikotTargetId,
        title: it.title || '', content: it.content || '', category_id: it.category_id || null
      };
    }
  } else {
    state.backWikotForm = emptyBackWikotForm(wfMode);
  }

  // Charger les messages
  const s = wikotState('max');
  s.currentConvId = convId;
  s.messages = (data.messages || []).map(m => ({
    id: m.id, role: m.role, content: m.content,
    references: Array.isArray(m.references) ? m.references : [],
    answer_card: m.answer_card || null
  }));
  s.actions = data.actions || [];
  state.backWikotStep = 'workshop';
  render();
  scrollWikotToBottom('max');
}

// Retour à l'écran d'accueil (4 boutons) : reset l'état atelier
function backToBackWikotHome() {
  state.backWikotStep = 'home';
  state.backWikotWorkflowMode = null;
  state.backWikotTargetKind = null;
  state.backWikotTargetId = null;
  state.backWikotForm = null;
  state.backWikotFormDirty = false;
  state.backWikotSelectSearch = '';
  // On ne ferme pas la conversation côté serveur — historique préservé
  const s = wikotState('max');
  s.currentConvId = null;
  s.messages = [];
  s.actions = [];
  render();
}

// Helpers d'édition manuelle du form (l'utilisateur peut éditer aussi à la main)
function updateBackWikotFormField(field, value) {
  if (!state.backWikotForm) return;
  state.backWikotForm[field] = value;
  state.backWikotFormDirty = true;
}

function addBackWikotStep() {
  if (!state.backWikotForm || state.backWikotForm.kind !== 'procedure') return;
  const steps = state.backWikotForm.steps || [];
  steps.push({ step_number: steps.length + 1, title: '', content: '', linked_procedure_id: null });
  state.backWikotForm.steps = steps;
  state.backWikotFormDirty = true;
  render();
}

function removeBackWikotStep(idx) {
  if (!state.backWikotForm || state.backWikotForm.kind !== 'procedure') return;
  const steps = state.backWikotForm.steps || [];
  steps.splice(idx, 1);
  // Re-numéroter
  state.backWikotForm.steps = steps.map((s, i) => ({ ...s, step_number: i + 1 }));
  state.backWikotFormDirty = true;
  render();
}

function moveBackWikotStep(idx, dir) {
  if (!state.backWikotForm || state.backWikotForm.kind !== 'procedure') return;
  const steps = state.backWikotForm.steps || [];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= steps.length) return;
  [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
  state.backWikotForm.steps = steps.map((s, i) => ({ ...s, step_number: i + 1 }));
  state.backWikotFormDirty = true;
  render();
}

function updateBackWikotStepField(idx, field, value) {
  if (!state.backWikotForm || state.backWikotForm.kind !== 'procedure') return;
  const steps = state.backWikotForm.steps || [];
  if (!steps[idx]) return;
  steps[idx][field] = value;
  state.backWikotFormDirty = true;
  // Pas de render() pour ne pas perdre le focus du textarea
}

// Sauvegarde finale : POST/PUT vers la bonne route selon workflow
async function saveBackWikotForm() {
  if (!state.backWikotForm) return;
  if (state.backWikotSaving) return;
  const f = state.backWikotForm;
  const wf = state.backWikotWorkflowMode;

  // Validations basiques
  if (!f.title || !f.title.trim()) {
    showToast('Le titre est obligatoire.', 'error');
    return;
  }
  if (f.kind === 'procedure') {
    if (!f.trigger_event || !f.trigger_event.trim()) {
      showToast('Le déclencheur (trigger_event) est obligatoire.', 'error');
      return;
    }
    if (!f.steps || f.steps.length === 0) {
      showToast('Ajoute au moins une étape.', 'error');
      return;
    }
  }
  if (f.kind === 'info_item') {
    if (!f.content || !f.content.trim()) {
      showToast('Le contenu de l\'information est obligatoire.', 'error');
      return;
    }
  }

  state.backWikotSaving = true;
  render();

  let result = null;
  try {
    if (wf === 'create_procedure') {
      const payload = {
        title: f.title, trigger_event: f.trigger_event, description: f.description || null,
        category_id: f.category_id || null,
        steps: (f.steps || []).map((s, i) => ({
          step_number: i + 1, title: s.title, content: s.content || null,
          linked_procedure_id: s.linked_procedure_id || null
        }))
      };
      result = await api('/procedures', { method: 'POST', body: JSON.stringify(payload) });
    } else if (wf === 'update_procedure') {
      const payload = {
        title: f.title, trigger_event: f.trigger_event, description: f.description || null,
        category_id: f.category_id || null,
        steps: (f.steps || []).map((s, i) => ({
          step_number: i + 1, title: s.title, content: s.content || null,
          linked_procedure_id: s.linked_procedure_id || null
        }))
      };
      result = await api(`/procedures/${f.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else if (wf === 'create_info') {
      const payload = { title: f.title, content: f.content, category_id: f.category_id || null };
      result = await api('/hotel-info/items', { method: 'POST', body: JSON.stringify(payload) });
    } else if (wf === 'update_info') {
      const payload = { title: f.title, content: f.content, category_id: f.category_id || null };
      result = await api(`/hotel-info/items/${f.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    }
  } finally {
    state.backWikotSaving = false;
  }

  if (!result) {
    render();
    return;
  }

  showToast(wf.startsWith('create_') ? 'Créé avec succès.' : 'Modifié avec succès.', 'success');
  state.backWikotFormDirty = false;
  // Recharger les listes pour refléter la modif
  await loadData();
  // Retour à l'écran d'accueil Back Wikot
  backToBackWikotHome();
}

function renderWikotView(mode) {
  mode = mode || activeWikotMode();

  // Mode max → router vers le workflow atelier (home / select-target / workshop)
  if (mode === 'max') {
    return renderBackWikotView();
  }

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
    <button onclick="quickWikot('${btn.q.replace(/'/g, "\\'")}', '${mode}')" class="text-xs text-left rounded-lg px-3.5 py-2.5 transition-all" style="background: #fff; border: 1px solid var(--c-line-strong); color: var(--c-navy);" onmouseover="this.style.borderColor='var(--c-gold)'; this.style.background='var(--c-cream-deep)';" onmouseout="this.style.borderColor='var(--c-line-strong)'; this.style.background='#fff';">
      <i class="fas fa-question-circle mr-1.5" style="color: var(--c-gold);"></i>${escapeHtml(btn.label)}
    </button>
  `).join('');

  const emptyState = `
    <div class="flex flex-col items-center justify-center h-full p-6 text-center">
      <div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl mb-4" style="background: var(--c-navy); color: var(--c-gold); box-shadow: 0 4px 12px rgba(10,22,40,0.15);">
        <i class="fas ${cfg.icon}"></i>
      </div>
      <p class="section-eyebrow mb-2">Majordome digital</p>
      <h3 class="font-display text-2xl font-semibold mb-2" style="color: var(--c-navy);">${cfg.emptyTitle}</h3>
      <p class="text-sm max-w-md mb-6" style="color: rgba(15,27,40,0.55);">${cfg.emptyText}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md w-full">
        ${quickButtonsHtml}
      </div>
    </div>
  `;

  return `
  <div class="fade-in flex flex-col" style="height: calc(100vh - 8rem); max-height: calc(100vh - 8rem);">
    <!-- Header Wikot/Back Wikot premium -->
    <div class="flex items-center justify-between mb-4 shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <button onclick="toggleWikotSidebar('${mode}')" class="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center transition-all" style="background: #fff; border: 1px solid var(--c-line-strong); color: var(--c-navy);" title="Mes conversations">
          <i class="fas fa-list"></i>
        </button>
        <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy); color: var(--c-gold);">
          <i class="fas ${cfg.icon}"></i>
        </div>
        <div class="min-w-0">
          <h1 class="font-display text-xl sm:text-2xl font-semibold truncate" style="color: var(--c-navy);">${cfg.title}</h1>
          <p class="text-xs truncate uppercase tracking-wider" style="color: var(--c-gold-deep);">${currentConv ? escapeHtml(currentConv.title) : cfg.subtitle}</p>
        </div>
      </div>
      <button onclick="newWikotConversation('${mode}')" class="btn-premium px-4 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2 shrink-0" style="background: var(--c-navy); color: #fff;">
        <i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">Nouvelle</span>
      </button>
    </div>

    <!-- Layout chat avec sidebar conversations -->
    <div class="flex-1 flex gap-4 min-h-0 overflow-hidden">
      <!-- Sidebar conversations premium -->
      <div class="${sidebarVisible ? 'fixed inset-0 z-30 lg:bg-transparent lg:relative lg:inset-auto lg:z-auto' : 'hidden'} lg:block" style="${sidebarVisible ? 'background: rgba(10,22,40,0.45);' : ''}">
        <div class="${sidebarVisible ? 'absolute left-0 top-0 bottom-0 w-72 lg:relative lg:w-64' : 'lg:w-64'} flex flex-col h-full lg:rounded-xl overflow-hidden" style="background: #fff; border: 1px solid var(--c-line);">
          <div class="px-4 py-3 flex items-center justify-between" style="border-bottom: 1px solid var(--c-line); background: linear-gradient(180deg, #fff 0%, var(--c-cream) 100%);">
            <span class="text-xs uppercase tracking-wider font-semibold" style="color: var(--c-gold-deep);">Mes conversations</span>
            <button onclick="toggleWikotSidebar('${mode}')" class="lg:hidden w-7 h-7 rounded flex items-center justify-center" style="color: rgba(15,27,40,0.5);" title="Fermer">
              <i class="fas fa-xmark"></i>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            ${convs.length === 0 ? `
              <div class="p-5 text-center text-xs" style="color: rgba(15,27,40,0.45);">
                Aucune conversation.<br>Cliquez sur « Nouvelle » pour démarrer.
              </div>
            ` : convs.map(c => {
              const isActive = s.currentConvId === c.id;
              return `
              <div onclick="loadWikotConversation(${c.id}, '${mode}'); ${mode === 'max' ? 'state.wikotMaxSidebarOpen' : 'state.wikotSidebarOpen'}=false;" class="px-4 py-3 cursor-pointer transition-all" style="border-bottom: 1px solid var(--c-line); ${isActive ? 'background: rgba(201,169,97,0.10); border-left: 2px solid var(--c-gold);' : ''}" onmouseover="if(!${isActive}) this.style.background='var(--c-cream)';" onmouseout="if(!${isActive}) this.style.background='transparent';">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate" style="color: var(--c-navy);">${escapeHtml(c.title)}</div>
                    <div class="text-[10px] mt-0.5 uppercase tracking-wider" style="color: rgba(15,27,40,0.4);">${new Date(c.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <button onclick="deleteWikotConversation(${c.id}, event, '${mode}')" class="w-6 h-6 rounded flex items-center justify-center shrink-0 transition-all" style="color: rgba(15,27,40,0.3);" onmouseover="this.style.background='rgba(226,125,110,0.12)'; this.style.color='#C84C3F';" onmouseout="this.style.background='transparent'; this.style.color='rgba(15,27,40,0.3)';" title="Archiver">
                    <i class="fas fa-trash text-[10px]"></i>
                  </button>
                </div>
              </div>
            `;}).join('')}
          </div>
        </div>
      </div>

      <!-- Zone chat principale premium -->
      <div class="flex-1 flex flex-col rounded-xl overflow-hidden min-w-0" style="background: #fff; border: 1px solid var(--c-line); box-shadow: 0 2px 4px rgba(10,22,40,0.05), 0 8px 20px rgba(10,22,40,0.04);">
        <div id="${cfg.messagesId}" class="flex-1 overflow-y-auto p-3 sm:p-5" style="background: var(--c-cream);">
          ${messages.length === 0 && !isLoading ? emptyState : ''}
          ${isLoading ? `<div class="flex justify-center items-center h-full text-sm" style="color: rgba(15,27,40,0.5);"><i class="fas fa-spinner fa-spin mr-2" style="color: var(--c-gold);"></i>Chargement…</div>` : ''}
          ${messages.map(m => renderWikotMessage(m, mode)).join('')}
          ${isSending ? `
            <div class="flex justify-start mb-4">
              <div class="flex gap-2">
                <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs" style="background: var(--c-navy); color: var(--c-gold);">
                  <i class="fas ${cfg.icon}"></i>
                </div>
                <div class="rounded-2xl rounded-tl-sm px-4 py-3" style="background: #fff; border: 1px solid var(--c-line); box-shadow: 0 1px 2px rgba(10,22,40,0.04);">
                  <div class="flex gap-1">
                    <div class="w-2 h-2 rounded-full animate-bounce" style="background: var(--c-gold); animation-delay: 0ms"></div>
                    <div class="w-2 h-2 rounded-full animate-bounce" style="background: var(--c-gold); animation-delay: 150ms"></div>
                    <div class="w-2 h-2 rounded-full animate-bounce" style="background: var(--c-gold); animation-delay: 300ms"></div>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Zone de saisie premium -->
        <div class="p-3 sm:p-4 shrink-0" style="background: #fff; border-top: 1px solid var(--c-line);">
          <div class="flex items-end gap-2">
            <textarea id="${cfg.inputId}" rows="1"
              placeholder="${cfg.placeholder}"
              oninput="autoResizeTextarea(this)"
              onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendWikotMessage('${mode}');}"
              ${isSending ? 'disabled' : ''}
              class="input-premium form-input-mobile flex-1 rounded-xl px-3.5 py-2.5 outline-none resize-none max-h-32 text-sm"></textarea>
            ${renderVoiceWidget('staff', mode)}
            <button onclick="sendWikotMessage('${mode}')" ${isSending ? 'disabled' : ''} class="btn-premium w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy); color: var(--c-gold);" title="Envoyer">
              <i class="fas ${isSending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i>
            </button>
          </div>
          <p class="text-[10px] mt-2 text-center uppercase tracking-wider" style="color: rgba(15,27,40,0.4);">${cfg.footer}</p>
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
// BACK WIKOT — VUES (home / select-target / workshop)
// ============================================
function renderBackWikotView() {
  // Lazy-load conversations à la première ouverture
  if (!state._wikotMaxInitialLoad) {
    state._wikotMaxInitialLoad = true;
    loadWikotConversations('max').then(() => render());
  }

  const step = state.backWikotStep || 'home';
  if (step === 'select-target') return renderBackWikotSelectTarget();
  if (step === 'workshop') return renderBackWikotWorkshop();
  return renderBackWikotHome();
}

// --------------------------------------------
// VUE 1 : HOME (4 gros boutons + historique)
// --------------------------------------------
function renderBackWikotHome() {
  const convs = state.wikotMaxConversations || [];
  const visibleConvs = convs.filter(c => c.workflow_mode); // on n'affiche que les conversations attachées à un workflow

  const buttonHtml = (key) => {
    const wf = BACK_WIKOT_WORKFLOWS[key];
    const enabled = userCanRunBackWikotWorkflow(key);
    const colorClasses = {
      emerald: 'from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700',
      orange: 'from-orange-400 to-orange-600 hover:from-orange-500 hover:to-orange-700',
      sky: 'from-sky-400 to-sky-600 hover:from-sky-500 hover:to-sky-700',
      amber: 'from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700'
    }[wf.color] || 'from-gray-400 to-gray-600';
    return `
      <button ${enabled ? `onclick="enterBackWikotWorkflow('${key}')"` : 'disabled'}
        class="${enabled ? `bg-gradient-to-br ${colorClasses} cursor-pointer` : 'bg-gray-200 cursor-not-allowed opacity-60'} text-white rounded-2xl p-5 sm:p-6 shadow-md transition-all text-left flex flex-col gap-3 group">
        <div class="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl shrink-0">
          <i class="fas ${wf.icon}"></i>
        </div>
        <div>
          <div class="text-base sm:text-lg font-bold leading-tight">${escapeHtml(wf.label)}</div>
          <div class="text-xs sm:text-sm text-white/85 mt-1 leading-snug">${escapeHtml(wf.description)}</div>
        </div>
        ${!enabled ? '<div class="text-[11px] text-white/90 italic mt-1"><i class="fas fa-triangle-exclamation mr-1"></i>Permission requise</div>' : ''}
      </button>
    `;
  };

  const historyHtml = visibleConvs.length === 0 ? `
    <div class="text-center py-6 text-xs text-navy-400">
      <i class="fas fa-clock-rotate-left text-2xl text-navy-200 mb-2 block"></i>
      Aucune conversation Back Wikot pour le moment.
    </div>
  ` : visibleConvs.map(c => {
    const wf = BACK_WIKOT_WORKFLOWS[c.workflow_mode];
    const wfLabel = wf ? wf.label : c.workflow_mode;
    const wfIcon = wf ? wf.icon : 'fa-file-pen';
    return `
      <div class="bg-white border border-gray-200 rounded-xl p-3 hover:border-orange-300 hover:shadow-sm transition-all flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
          <i class="fas ${wfIcon}"></i>
        </div>
        <div class="flex-1 min-w-0 cursor-pointer" onclick="resumeBackWikotConversation(${c.id})">
          <div class="text-sm font-semibold text-navy-800 truncate">${escapeHtml(c.title || 'Sans titre')}</div>
          <div class="text-[11px] text-navy-500 truncate">${escapeHtml(wfLabel)} · ${new Date(c.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <button onclick="deleteWikotConversation(${c.id}, event, 'max')" class="w-8 h-8 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 flex items-center justify-center shrink-0" title="Archiver">
          <i class="fas fa-trash text-xs"></i>
        </button>
      </div>
    `;
  }).join('');

  return `
    <div class="fade-in space-y-6">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white shadow-sm">
          <i class="fas fa-pen-ruler text-lg"></i>
        </div>
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-navy-900">Back Wikot</h1>
          <p class="text-xs sm:text-sm text-navy-500">Choisis une action. Back Wikot te guide pour la rédiger.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        ${buttonHtml('create_procedure')}
        ${buttonHtml('update_procedure')}
        ${buttonHtml('create_info')}
        ${buttonHtml('update_info')}
      </div>

      <div class="bg-gray-50 border border-gray-200 rounded-2xl p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-navy-800 flex items-center gap-2">
            <i class="fas fa-clock-rotate-left text-orange-500"></i>Mes dernières sessions
          </h2>
          <span class="text-[11px] text-navy-400">${visibleConvs.length} conversation${visibleConvs.length > 1 ? 's' : ''}</span>
        </div>
        <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
          ${historyHtml}
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------
// VUE 2 : SELECT-TARGET (choix de la cible à modifier)
// --------------------------------------------
function renderBackWikotSelectTarget() {
  const wfMode = state.backWikotWorkflowMode;
  const wf = BACK_WIKOT_WORKFLOWS[wfMode];
  if (!wf) {
    state.backWikotStep = 'home';
    return renderBackWikotHome();
  }

  const search = (state.backWikotSelectSearch || '').toLowerCase().trim();

  let listHtml = '';
  if (wfMode === 'update_procedure') {
    const all = state.backWikotProceduresCache || [];
    if (all.length === 0) {
      listHtml = `<div class="text-center py-12 text-sm text-navy-400"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>`;
    } else {
      // Séparer principales / sous-procédures
      const mains = all.filter(p => !p.is_subprocedure);
      const subs = all.filter(p => p.is_subprocedure);
      // Index : id procédure principale → sous-procédures attachées (via steps.linked_procedure_id)
      // On n'a pas le détail des steps ici, donc on affiche les sous-procédures dans une section dédiée
      // (groupement compact, indenté).
      // Filtre recherche
      const matches = (p) => {
        if (!search) return true;
        return (p.title || '').toLowerCase().includes(search) ||
               (p.trigger_event || '').toLowerCase().includes(search);
      };

      const mainsFiltered = mains.filter(matches);
      const subsFiltered = subs.filter(matches);

      listHtml = `
        <div class="space-y-2">
          ${mainsFiltered.length > 0 ? mainsFiltered.map(p => `
            <div onclick="selectBackWikotProcedureTarget(${p.id})" class="bg-white border border-gray-200 hover:border-orange-300 hover:shadow-sm rounded-xl p-3 cursor-pointer transition-all">
              <div class="flex items-start gap-3">
                <div class="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style="background:${p.category_color || '#7C3AED'}">
                  <i class="fas ${p.category_icon || 'fa-sitemap'} text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-navy-900 text-sm leading-snug">${escapeHtml(p.title)}</div>
                  ${p.trigger_event ? `<div class="text-[11px] text-navy-500 mt-0.5 truncate"><i class="fas fa-bolt text-amber-500 mr-1"></i>${escapeHtml(p.trigger_event)}</div>` : ''}
                  <div class="text-[10px] text-navy-400 mt-1 flex items-center gap-2">
                    <span><i class="fas fa-list-ol mr-0.5"></i>${p.step_count || 0} étape${(p.step_count || 0) > 1 ? 's' : ''}</span>
                    ${p.category_name ? `<span class="px-1.5 py-0.5 bg-gray-100 rounded">${escapeHtml(p.category_name)}</span>` : ''}
                  </div>
                </div>
                <i class="fas fa-chevron-right text-navy-300 text-xs mt-2"></i>
              </div>
            </div>
          `).join('') : (search ? '<div class="text-center text-xs text-navy-400 py-4">Aucune procédure principale correspondante.</div>' : '')}

          ${subsFiltered.length > 0 ? `
            <div class="pt-3 mt-2 border-t border-dashed border-gray-300">
              <div class="text-[11px] uppercase tracking-wide font-semibold text-navy-500 mb-2 flex items-center gap-1.5">
                <i class="fas fa-diagram-project text-purple-500"></i>Sous-procédures
              </div>
              <div class="space-y-1.5 pl-2 border-l-2 border-purple-200">
                ${subsFiltered.map(p => `
                  <div onclick="selectBackWikotProcedureTarget(${p.id})" class="bg-purple-50/40 hover:bg-purple-50 border border-purple-100 rounded-lg p-2 cursor-pointer transition-all">
                    <div class="flex items-center gap-2">
                      <span class="text-[9px] uppercase font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded shrink-0">sous-proc</span>
                      <div class="flex-1 min-w-0">
                        <div class="text-xs font-semibold text-navy-800 truncate">${escapeHtml(p.title)}</div>
                        ${p.trigger_event ? `<div class="text-[10px] text-navy-500 truncate">${escapeHtml(p.trigger_event)}</div>` : ''}
                      </div>
                      <i class="fas fa-chevron-right text-purple-300 text-[10px]"></i>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${mainsFiltered.length === 0 && subsFiltered.length === 0 ? `
            <div class="text-center py-12 text-sm text-navy-400">
              <i class="fas fa-magnifying-glass text-2xl text-navy-200 mb-2 block"></i>
              Aucune procédure ne correspond à ta recherche.
            </div>
          ` : ''}
        </div>
      `;
    }
  } else if (wfMode === 'update_info') {
    const cache = state.backWikotInfoCache;
    if (!cache) {
      listHtml = `<div class="text-center py-12 text-sm text-navy-400"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>`;
    } else {
      const cats = cache.categories || [];
      const items = cache.items || [];
      const matches = (it) => {
        if (!search) return true;
        return (it.title || '').toLowerCase().includes(search) ||
               (it.content || '').toLowerCase().includes(search);
      };
      const itemsFiltered = items.filter(matches);
      // Grouper par catégorie
      const grouped = {};
      for (const it of itemsFiltered) {
        const cid = it.category_id || 'none';
        if (!grouped[cid]) grouped[cid] = [];
        grouped[cid].push(it);
      }
      listHtml = `
        <div class="space-y-3">
          ${cats.map(cat => {
            const arr = grouped[cat.id] || [];
            if (arr.length === 0) return '';
            return `
              <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div class="px-3 py-2 flex items-center gap-2 text-white" style="background:${cat.color || '#3B82F6'}">
                  <i class="fas ${cat.icon || 'fa-circle-info'} text-sm"></i>
                  <span class="text-xs font-semibold">${escapeHtml(cat.name)}</span>
                  <span class="ml-auto text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">${arr.length}</span>
                </div>
                <div class="divide-y divide-gray-100">
                  ${arr.map(it => `
                    <div onclick="selectBackWikotInfoTarget(${it.id})" class="px-3 py-2 hover:bg-amber-50 cursor-pointer flex items-start gap-2">
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-semibold text-navy-800 truncate">${escapeHtml(it.title)}</div>
                        ${it.content ? `<div class="text-[11px] text-navy-500 line-clamp-1">${escapeHtml(it.content.substring(0, 120))}${it.content.length > 120 ? '…' : ''}</div>` : ''}
                      </div>
                      <i class="fas fa-chevron-right text-navy-300 text-xs mt-1"></i>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
          ${(grouped['none'] && grouped['none'].length > 0) ? `
            <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div class="px-3 py-2 flex items-center gap-2 bg-gray-100 text-navy-700">
                <i class="fas fa-folder-minus text-sm"></i>
                <span class="text-xs font-semibold">Sans catégorie</span>
                <span class="ml-auto text-[10px] bg-white/60 px-1.5 py-0.5 rounded-full">${grouped['none'].length}</span>
              </div>
              <div class="divide-y divide-gray-100">
                ${grouped['none'].map(it => `
                  <div onclick="selectBackWikotInfoTarget(${it.id})" class="px-3 py-2 hover:bg-amber-50 cursor-pointer flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-semibold text-navy-800 truncate">${escapeHtml(it.title)}</div>
                    </div>
                    <i class="fas fa-chevron-right text-navy-300 text-xs mt-1"></i>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${itemsFiltered.length === 0 ? `
            <div class="text-center py-12 text-sm text-navy-400">
              <i class="fas fa-magnifying-glass text-2xl text-navy-200 mb-2 block"></i>
              Aucune information ne correspond à ta recherche.
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  return `
    <div class="fade-in space-y-4">
      <div class="flex items-center gap-3">
        <button onclick="backToBackWikotHome()" class="w-9 h-9 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-navy-600 flex items-center justify-center shrink-0">
          <i class="fas fa-arrow-left"></i>
        </button>
        <div class="min-w-0">
          <h1 class="text-lg sm:text-xl font-bold text-navy-900 truncate">${escapeHtml(wf.label)}</h1>
          <p class="text-[11px] sm:text-xs text-navy-500 truncate">Choisis l'élément à modifier.</p>
        </div>
      </div>

      <div class="bg-white border border-gray-200 rounded-xl p-2 flex items-center gap-2">
        <i class="fas fa-magnifying-glass text-navy-300 ml-2"></i>
        <input type="text" value="${escapeHtml(state.backWikotSelectSearch || '')}"
          oninput="state.backWikotSelectSearch = this.value; render(); document.getElementById('back-wikot-select-search').focus();"
          id="back-wikot-select-search"
          placeholder="Rechercher par titre ou déclencheur…"
          class="flex-1 outline-none text-sm bg-transparent" />
        ${state.backWikotSelectSearch ? `<button onclick="state.backWikotSelectSearch=''; render();" class="w-7 h-7 rounded hover:bg-gray-100 text-navy-400"><i class="fas fa-xmark text-xs"></i></button>` : ''}
      </div>

      <div class="max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
        ${listHtml}
      </div>
    </div>
  `;
}

// --------------------------------------------
// VUE 3 : WORKSHOP (formulaire vivant + chat Back Wikot)
// --------------------------------------------
function renderBackWikotWorkshop() {
  const wfMode = state.backWikotWorkflowMode;
  const wf = BACK_WIKOT_WORKFLOWS[wfMode];
  if (!wf || !state.backWikotForm) {
    state.backWikotStep = 'home';
    return renderBackWikotHome();
  }
  const f = state.backWikotForm;
  const s = wikotState('max');
  const messages = s.messages || [];
  const isLoading = s.loading;
  const isSending = s.sending;
  const isSaving = state.backWikotSaving;

  // Sidebar historique : on filtre par workflow_mode pour rester dans le contexte
  const allConvs = state.wikotMaxConversations || [];
  const sameWorkflowConvs = allConvs.filter(c => c.workflow_mode === wfMode);

  const formHtml = f.kind === 'procedure' ? renderBackWikotProcedureForm(f) : renderBackWikotInfoForm(f);

  const cfg = WIKOT_MODE_CONFIG.max;

  return `
    <div class="fade-in flex flex-col" style="height: calc(100vh - 8rem); max-height: calc(100vh - 8rem);">
      <!-- Header workshop -->
      <div class="flex items-center justify-between mb-3 shrink-0 gap-2">
        <div class="flex items-center gap-2 sm:gap-3 min-w-0">
          <button onclick="backToBackWikotHome()" class="w-9 h-9 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-navy-600 flex items-center justify-center shrink-0">
            <i class="fas fa-arrow-left"></i>
          </button>
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white shadow-sm shrink-0">
            <i class="fas ${wf.icon}"></i>
          </div>
          <div class="min-w-0">
            <h1 class="text-base sm:text-lg font-bold text-navy-900 truncate">${escapeHtml(wf.label)}</h1>
            <p class="text-[11px] text-navy-500 truncate">${state.backWikotFormDirty ? '<i class="fas fa-circle text-orange-400 text-[6px] mr-1"></i>Modifications non enregistrées' : 'Atelier de rédaction'}</p>
          </div>
        </div>
        <button onclick="saveBackWikotForm()" ${isSaving ? 'disabled' : ''}
          class="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-gray-300 disabled:to-gray-400 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold shadow-sm inline-flex items-center gap-1.5 shrink-0 transition-all">
          <i class="fas ${isSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}"></i>
          <span class="hidden sm:inline">${isSaving ? 'Enregistrement…' : 'Enregistrer'}</span>
        </button>
      </div>

      <!-- Layout responsive : form (gauche/haut) + chat (droite/bas) -->
      <div class="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-3 min-h-0 overflow-hidden">
        <!-- COLONNE FORMULAIRE -->
        <div class="bg-white border border-gray-200 rounded-xl flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-2.5 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 flex items-center gap-2 shrink-0">
            <i class="fas fa-file-pen text-orange-500"></i>
            <span class="text-sm font-semibold text-navy-800">Formulaire ${f.kind === 'procedure' ? 'procédure' : 'information'}</span>
            <span class="ml-auto text-[10px] text-navy-400 italic hidden sm:inline">L'IA peut éditer ces champs en direct</span>
          </div>
          <div class="flex-1 overflow-y-auto p-4">
            ${formHtml}
          </div>
        </div>

        <!-- COLONNE CHAT BACK WIKOT -->
        <div class="bg-gradient-to-b from-orange-50/40 to-white border border-orange-100 rounded-xl flex flex-col min-h-0 overflow-hidden">
          <div class="px-3 py-2.5 bg-white border-b border-orange-100 flex items-center gap-2 shrink-0">
            <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-xs">
              <i class="fas fa-pen-ruler"></i>
            </div>
            <span class="text-sm font-semibold text-navy-800">Back Wikot</span>
            <button onclick="toggleBackWikotHistorySidebar()" class="ml-auto w-7 h-7 rounded hover:bg-orange-50 text-navy-500" title="Historique">
              <i class="fas fa-clock-rotate-left text-xs"></i>
            </button>
          </div>
          ${state.backWikotHistoryOpen ? `
            <div class="border-b border-orange-100 bg-white max-h-48 overflow-y-auto">
              ${sameWorkflowConvs.length === 0 ? `
                <div class="text-center py-3 text-[11px] text-navy-400 italic">Aucune autre session pour ce workflow.</div>
              ` : sameWorkflowConvs.map(c => `
                <div onclick="resumeBackWikotConversation(${c.id}); state.backWikotHistoryOpen=false;" class="px-3 py-2 border-b border-gray-50 hover:bg-orange-50 cursor-pointer ${s.currentConvId === c.id ? 'bg-orange-50 border-l-2 border-l-orange-400' : ''}">
                  <div class="text-xs font-medium text-navy-800 truncate">${escapeHtml(c.title || 'Sans titre')}</div>
                  <div class="text-[10px] text-navy-400">${new Date(c.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          <div id="wikot-max-messages" class="flex-1 overflow-y-auto p-3">
            ${messages.length === 0 && !isLoading ? `
              <div class="text-center py-6">
                <div class="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-xl mb-3 shadow-md">
                  <i class="fas fa-pen-ruler"></i>
                </div>
                <p class="text-sm font-semibold text-navy-800 mb-1">Décris ton besoin</p>
                <p class="text-[11px] text-navy-500 leading-snug">Back Wikot va remplir le formulaire pour toi. Tu peux ensuite ajuster, demander des modifs, ou enregistrer.</p>
              </div>
            ` : ''}
            ${isLoading ? '<div class="flex justify-center items-center h-full text-navy-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>' : ''}
            ${messages.map(m => renderWikotMessage(m, 'max')).join('')}
            ${isSending ? `
              <div class="flex justify-start mb-4">
                <div class="flex gap-2">
                  <div class="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white text-xs">
                    <i class="fas fa-pen-ruler"></i>
                  </div>
                  <div class="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <div class="flex gap-1">
                      <div class="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style="animation-delay: 0ms"></div>
                      <div class="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style="animation-delay: 150ms"></div>
                      <div class="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style="animation-delay: 300ms"></div>
                    </div>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
          <div class="border-t border-orange-100 bg-white p-2 shrink-0">
            <div class="flex items-end gap-2">
              <textarea id="wikot-max-input" rows="1"
                placeholder="Décris ce que tu veux…"
                oninput="autoResizeTextarea(this)"
                onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendWikotMessage('max');}"
                ${isSending ? 'disabled' : ''}
                class="form-input-mobile flex-1 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-400 resize-none max-h-32 text-sm"></textarea>
              ${renderVoiceWidget('staff', 'max')}
              <button onclick="sendWikotMessage('max')" ${isSending ? 'disabled' : ''}
                class="w-10 h-10 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white flex items-center justify-center shrink-0 transition-colors" title="Envoyer">
                <i class="fas ${isSending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleBackWikotHistorySidebar() {
  state.backWikotHistoryOpen = !state.backWikotHistoryOpen;
  render();
}

// Form procédure : titre, déclencheur, description, catégorie, étapes
// Helper : retourne les classes CSS pour le highlight d'un champ récemment modifié par l'IA
function fieldHighlightClass(fieldName) {
  const touched = state.backWikotRecentlyTouched || [];
  return touched.includes(fieldName) ? 'back-wikot-touched' : '';
}

// Helper : trouve une catégorie par ID dans la liste donnée
function findCatById(cats, id) {
  return (cats || []).find(c => c.id === id);
}

function renderBackWikotProcedureForm(f) {
  const cats = state.categories || [];
  const allProcs = state.backWikotProceduresCache || state.procedures || [];
  const linkable = allProcs.filter(p => p.id !== f.id);

  const stepsHtml = (f.steps || []).map((st, idx) => {
    const linkedProc = st.linked_procedure_id ? linkable.find(p => p.id === st.linked_procedure_id) : null;
    return `
      <div class="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 ${fieldHighlightClass('steps')}">
        <div class="flex items-start gap-2">
          <span class="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">${idx + 1}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-navy-900 leading-snug">${st.title ? escapeHtml(st.title) : '<span class="italic text-navy-300">(titre vide)</span>'}</div>
            ${st.content ? `<div class="text-[13px] text-navy-700 mt-1 whitespace-pre-wrap leading-relaxed">${formatHotelInfoContent(st.content)}</div>` : ''}
            ${linkedProc ? `
              <div class="mt-2 inline-flex items-center gap-1.5 text-[11px] bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">
                <i class="fas fa-link text-[10px]"></i>Sous-procédure liée : ${escapeHtml(linkedProc.title)}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const cat = findCatById(cats, f.category_id);

  return `
    <div class="space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block flex items-center gap-1.5">
          Titre <span class="text-red-500">*</span>
        </label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] ${fieldHighlightClass('title')}">
          ${f.title ? escapeHtml(f.title) : '<span class="italic text-navy-300">(à remplir par Back Wikot)</span>'}
        </div>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Déclencheur <span class="text-red-500">*</span></label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] ${fieldHighlightClass('trigger_event')}">
          ${f.trigger_event ? escapeHtml(f.trigger_event) : '<span class="italic text-navy-300">(à remplir par Back Wikot)</span>'}
        </div>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Description</label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] whitespace-pre-wrap ${fieldHighlightClass('description')}">
          ${f.description ? escapeHtml(f.description) : '<span class="italic text-navy-300">(à remplir par Back Wikot)</span>'}
        </div>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Catégorie</label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('category_id')}">
          ${cat ? `<i class="fas ${cat.icon || 'fa-folder'} mr-1.5" style="color:${cat.color || '#7C3AED'}"></i>${escapeHtml(cat.name)}` : '<span class="italic text-navy-400">Sans catégorie</span>'}
        </div>
      </div>

      <div class="pt-2 border-t border-gray-200">
        <label class="text-xs font-semibold text-navy-700 block mb-2">
          Étapes <span class="text-red-500">*</span> <span class="text-navy-400 font-normal">(${(f.steps || []).length})</span>
        </label>
        <div class="space-y-2">
          ${stepsHtml || '<div class="text-center py-6 text-xs text-navy-400 italic bg-gray-50 rounded-lg border border-dashed border-gray-300">Aucune étape pour le moment. Demande à Back Wikot d\'ajouter ou de modifier les étapes.</div>'}
        </div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 flex items-start gap-2">
        <i class="fas fa-circle-info mt-0.5"></i>
        <div>
          <strong>Formulaire en lecture seule.</strong> Seul Back Wikot peut écrire dedans. Pour modifier un champ, demande-lui dans le chat à droite. Quand tout te convient, clique sur <strong>Enregistrer</strong> en haut.
        </div>
      </div>
    </div>
  `;
}

// Form info : titre, contenu, catégorie
function renderBackWikotInfoForm(f) {
  const cats = state.hotelInfoCategories || [];
  const cat = findCatById(cats, f.category_id);
  return `
    <div class="space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Titre <span class="text-red-500">*</span></label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] ${fieldHighlightClass('title')}">
          ${f.title ? escapeHtml(f.title) : '<span class="italic text-navy-300">(à remplir par Back Wikot)</span>'}
        </div>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Catégorie</label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('category_id')}">
          ${cat ? `<i class="fas ${cat.icon || 'fa-circle-info'} mr-1.5" style="color:${cat.color || '#3B82F6'}"></i>${escapeHtml(cat.name)}` : '<span class="italic text-navy-400">Sans catégorie</span>'}
        </div>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Contenu <span class="text-red-500">*</span></label>
        <div class="w-full px-3 py-3 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[10rem] whitespace-pre-wrap leading-relaxed ${fieldHighlightClass('content')}">
          ${f.content ? formatHotelInfoContent(f.content) : '<span class="italic text-navy-300">(à remplir par Back Wikot)</span>'}
        </div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 flex items-start gap-2">
        <i class="fas fa-circle-info mt-0.5"></i>
        <div>
          <strong>Formulaire en lecture seule.</strong> Seul Back Wikot peut écrire dedans. Pour modifier un champ, demande-lui dans le chat à droite. Quand tout te convient, clique sur <strong>Enregistrer</strong> en haut.
        </div>
      </div>
    </div>
  `;
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
    <div class="${hasSelected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 xl:w-96 overflow-hidden shrink-0" style="background: var(--c-ivory); border-right: 1px solid var(--c-line);">
      <div class="px-4 sm:px-5 py-4 shrink-0 flex items-center justify-between gap-2" style="border-bottom: 1px solid var(--c-line); background: #fff;">
        <div class="min-w-0">
          <p class="section-eyebrow">Espace équipe</p>
          <h2 class="font-display text-lg sm:text-xl font-semibold truncate" style="color: var(--c-navy);">Conversations</h2>
        </div>
        ${canManage ? `
          <button onclick="showCreateChannelModal()" class="btn-premium px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0" style="background: var(--c-navy); color: #fff;">
            <i class="fas fa-plus text-[10px]"></i><span class="hidden sm:inline">Nouveau salon</span><span class="sm:hidden">Salon</span>
          </button>
        ` : ''}
      </div>

      <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        ${groups.length === 0 ? `
          <div class="card-premium empty-state-premium">
            <div class="empty-icon"><i class="fas fa-comments"></i></div>
            <p class="font-display text-base font-semibold" style="color: var(--c-navy);">Aucun salon</p>
            <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Créez votre premier salon d'équipe.</p>
          </div>
        ` : groups.map(g => renderGroupCard(g, canManage)).join('')}
      </div>
    </div>

    <!-- Colonne salon ouvert -->
    <div class="${hasSelected ? 'chat-mobile-fullscreen lg:flex lg:flex-col lg:flex-1 lg:min-w-0' : 'hidden lg:flex flex-col flex-1 min-w-0'}" style="background: #fff;">
      ${hasSelected ? renderChannelView() : `
        <div class="flex-1 flex items-center justify-center p-6 text-center" style="background: var(--c-ivory);">
          <div>
            <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4" style="background: var(--c-navy);">
              <i class="fas fa-comment-dots text-2xl" style="color: var(--c-gold);"></i>
            </div>
            <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Sélectionnez un salon</p>
            <p class="text-sm mt-1" style="color: rgba(15,27,40,0.5);">Choisissez un salon pour commencer à discuter.</p>
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
  <div class="mb-4 card-premium overflow-hidden" data-group-card="${group.id}">
    <div class="px-4 sm:px-5 py-3 flex items-center gap-3" style="background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
      <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--c-navy);">
        <i class="fas ${group.icon || 'fa-folder'}" style="color: var(--c-gold);"></i>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-display font-semibold text-sm sm:text-base truncate" style="color: var(--c-navy);">
          ${escapeHtml(group.name)}
          ${group.is_system ? '<span class="ml-2 text-[9px] uppercase font-bold tracking-wider" style="color: rgba(15,27,40,0.4);">par défaut</span>' : ''}
        </h3>
        <p class="text-xs" style="color: rgba(15,27,40,0.55);">${channels.length} salon${channels.length > 1 ? 's' : ''}<span data-group-unread>${groupUnread > 0 ? ` · <span class="font-semibold" style="color: var(--c-gold-deep);">${groupUnread} non lu${groupUnread > 1 ? 's' : ''}</span>` : ''}</span></p>
      </div>
      ${canManage ? `
        <div class="flex items-center gap-1">
          <button onclick="showCreateChannelModal(${group.id})" title="Ajouter un salon dans ce groupe"
            class="w-8 h-8 rounded-lg transition-colors flex items-center justify-center" style="background: #fff; color: var(--c-gold-deep); border: 1px solid var(--c-line);" onmouseover="this.style.background='var(--c-gold)'; this.style.color='#fff';" onmouseout="this.style.background='#fff'; this.style.color='var(--c-gold-deep)';">
            <i class="fas fa-plus text-xs"></i>
          </button>
          <button onclick="showEditGroupModal(${group.id})" title="Renommer le groupe"
            class="w-8 h-8 rounded-lg transition-colors flex items-center justify-center" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line);" onmouseover="this.style.background='var(--c-cream-deep)'" onmouseout="this.style.background='#fff'">
            <i class="fas fa-pen text-xs"></i>
          </button>
          ${!group.is_system ? `
            <button onclick="deleteGroup(${group.id})" title="Supprimer le groupe"
              class="w-8 h-8 rounded-lg transition-colors flex items-center justify-center" style="background: #fff; color: #C84C3F; border: 1px solid var(--c-line);" onmouseover="this.style.background='rgba(226,125,110,0.10)'" onmouseout="this.style.background='#fff'">
              <i class="fas fa-trash text-xs"></i>
            </button>
          ` : ''}
        </div>
      ` : ''}
    </div>
    <div>
      ${channels.length === 0 ? `
        <div class="px-5 py-4 text-sm italic" style="color: rgba(15,27,40,0.4);">Aucun salon dans ce groupe</div>
      ` : channels.map(ch => renderChannelRow(ch, canManage)).join('')}
    </div>
  </div>`;
}

function renderChannelRow(ch, canManage) {
  const unread = ch.unread_count || 0;
  return `
  <div class="px-4 sm:px-5 py-3 transition-colors flex items-center gap-3 cursor-pointer group"
       style="border-bottom: 1px solid var(--c-line);"
       onmouseover="this.style.background='var(--c-cream-deep)'" onmouseout="this.style.background='transparent'"
       onclick="openChannel(${ch.id})" data-channel-row="${ch.id}">
    <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: var(--c-cream-deep); color: var(--c-navy);">
      <i class="fas ${ch.icon || 'fa-comment'} text-xs"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span data-channel-name class="font-medium text-sm truncate ${unread > 0 ? 'font-bold' : ''}" style="color: var(--c-navy);">${escapeHtml(ch.name)}</span>
        <span data-channel-unread class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${unread > 0 ? '' : 'hidden'}" style="background: var(--c-gold); color: var(--c-navy);">${unread > 0 ? `${unread > 99 ? '99+' : unread} non lu${unread > 1 ? 's' : ''}` : ''}</span>
      </div>
      ${ch.description ? `<p class="text-xs truncate" style="color: rgba(15,27,40,0.45);">${escapeHtml(ch.description)}</p>` : ''}
    </div>
    ${canManage ? `
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onclick="event.stopPropagation(); showEditChannelModal(${ch.id})" title="Modifier"
          class="w-7 h-7 rounded flex items-center justify-center" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line);">
          <i class="fas fa-pen text-[10px]"></i>
        </button>
        <button onclick="event.stopPropagation(); deleteChannel(${ch.id})" title="Supprimer"
          class="w-7 h-7 rounded flex items-center justify-center" style="background: #fff; color: #C84C3F; border: 1px solid var(--c-line);">
          <i class="fas fa-trash text-[10px]"></i>
        </button>
      </div>
    ` : ''}
    <i class="fas fa-chevron-right text-xs ml-1" style="color: rgba(15,27,40,0.3);"></i>
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
  <div class="flex flex-col h-full w-full min-h-0" style="background: #fff;">
    <!-- Header salon -->
    <div class="px-3 sm:px-5 py-3 flex items-center gap-3 shrink-0" style="background: #fff; border-bottom: 1px solid var(--c-line);">
      <button onclick="closeChannel()" class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 lg:hidden" style="background: var(--c-cream-deep); color: var(--c-navy);">
        <i class="fas fa-arrow-left"></i>
      </button>
      <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--c-navy);">
        <i class="fas ${ch.icon || 'fa-comment'}" style="color: var(--c-gold);"></i>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-display font-semibold truncate" style="color: var(--c-navy);">${escapeHtml(ch.name)}</h3>
        ${ch.description ? `<p class="text-xs truncate" style="color: rgba(15,27,40,0.55);">${escapeHtml(ch.description)}</p>` : `<p class="text-xs italic truncate" style="color: rgba(15,27,40,0.4);">${escapeHtml(ch.group_name || '')}</p>`}
      </div>
    </div>

    <!-- Zone messages -->
    <div id="chat-messages-zone" class="chat-messages-scroll px-3 sm:px-5 py-4 space-y-3" style="background: var(--c-ivory);">
      ${messages.length === 0 ? `
        <div class="text-center py-12">
          <div class="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3" style="background: var(--c-navy);">
            <i class="fas fa-comment-dots text-xl" style="color: var(--c-gold);"></i>
          </div>
          <p class="font-display text-base font-semibold" style="color: var(--c-navy);">Aucun message</p>
          <p class="text-xs mt-1" style="color: rgba(15,27,40,0.4);">Soyez le premier à écrire dans ce salon.</p>
        </div>
      ` : messages.map((m, i) => renderMessage(m, messages[i - 1])).join('')}
    </div>

    <!-- Champ d'envoi -->
    <div class="chat-input-bar p-2 sm:p-3" style="background: #fff; border-top: 1px solid var(--c-line);">
      <form onsubmit="event.preventDefault(); sendMessage()" class="flex items-end gap-2">
        <textarea id="chat-input" rows="1" placeholder="Écrivez votre message..."
          class="flex-1 resize-none px-3 sm:px-4 py-2.5 input-premium rounded-xl outline-none text-sm max-h-32"
          onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); sendMessage();}"
          oninput="autoResizeTextarea(this)"></textarea>
        <button type="submit" class="btn-premium w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy); color: var(--c-gold);">
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
  const roleBadge = m.user_role === 'admin' ? '<span class="text-[9px] uppercase font-bold ml-1" style="color: var(--c-gold-deep);">admin</span>'
    : (m.user_role === 'employee' && m.user_can_edit ? '<span class="text-[9px] uppercase font-bold ml-1" style="color: var(--c-gold);">éditeur</span>' : '');

  if (sameAuthor) {
    return `
    <div class="flex gap-3 pl-12 -mx-3 px-3 py-0.5 rounded transition-colors" onmouseover="this.style.background='rgba(255,255,255,0.5)'" onmouseout="this.style.background='transparent'">
      <div class="flex-1 min-w-0">
        <p class="text-sm whitespace-pre-wrap break-words" style="color: rgba(15,27,40,0.85);">${escapeHtml(m.content)}${m.edited_at ? '<span class="text-[10px] ml-1" style="color: rgba(15,27,40,0.3);">(modifié)</span>' : ''}</p>
      </div>
    </div>`;
  }

  return `
  <div class="flex gap-3 -mx-3 px-3 py-1.5 rounded transition-colors" onmouseover="this.style.background='rgba(255,255,255,0.5)'" onmouseout="this.style.background='transparent'">
    <div class="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm shrink-0" style="background: ${isMe ? 'var(--c-gold)' : 'var(--c-navy)'}; color: ${isMe ? 'var(--c-navy)' : 'var(--c-gold)'};">
      ${initials}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="font-display font-semibold text-sm" style="color: var(--c-navy);">${escapeHtml(m.user_name || 'Inconnu')}</span>
        ${roleBadge}
        <span class="text-[11px]" style="color: rgba(15,27,40,0.4);">${time}</span>
      </div>
      <p class="text-sm whitespace-pre-wrap break-words mt-0.5" style="color: rgba(15,27,40,0.85);">${escapeHtml(m.content)}${m.edited_at ? '<span class="text-[10px] ml-1" style="color: rgba(15,27,40,0.3);">(modifié)</span>' : ''}</p>
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
  // Optimisation : pas de poll si l'onglet est en arrière-plan (économie batterie + serveur)
  chatGlobalPollingTimer = setInterval(() => {
    if (document.hidden) return;
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
  // Toutes les 4s, check les nouveaux messages — pause si onglet en arrière-plan
  chatChannelPollingTimer = setInterval(() => {
    if (document.hidden) return;
    pollNewMessages();
  }, 4000);
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
        <select id="ch-group" onchange="refreshChannelSuggestions()" class="w-full px-3 py-2 input-premium rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
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
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Description <span class="text-navy-400 font-normal text-xs">(facultatif)</span></label>
        <textarea id="ch-description" rows="3" maxlength="200" oninput="autoResizeTextarea(this)" placeholder="ex: Discussions liées à cette chambre"
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none"></textarea>
      </div>

      <input type="hidden" id="ch-icon" value="fa-hashtag">

      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 btn-premium-navy text-white rounded-lg text-sm font-semibold shadow">
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
        <select id="ch-group" class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none bg-white">
          ${groups.map(g => `<option value="${g.id}" ${g.id === ch.group_id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Nom du salon</label>
        <input id="ch-name" type="text" required maxlength="60" value="${escapeHtml(ch.name)}"
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-navy-600 mb-1.5">Description</label>
        <textarea id="ch-description" rows="3" maxlength="200" oninput="autoResizeTextarea(this)"
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">${escapeHtml(ch.description || '')}</textarea>
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 btn-premium-navy text-white rounded-lg text-sm font-semibold shadow">Enregistrer</button>
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
          class="form-input-mobile w-full px-3 py-2 input-premium rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent outline-none">
      </div>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-3 sm:py-2 bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-lg text-sm font-medium">Annuler</button>
        <button type="submit" class="px-4 py-3 sm:py-2 btn-premium-navy text-white rounded-lg text-sm font-semibold shadow">Enregistrer</button>
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
  <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 modal-overlay" style="background: rgba(10,22,40,0.55); backdrop-filter: blur(2px);" onclick="if(event.target===this)closeModal()">
    <div class="modal-premium w-full max-w-2xl modal-panel fade-in">
      <div class="modal-header-premium flex items-center justify-between sticky top-0 z-10">
        <h3 class="font-display font-semibold text-base sm:text-lg truncate pr-3" style="color: var(--c-navy);">${escapeHtml(title)}</h3>
        <button onclick="closeModal()" class="w-9 h-9 rounded-lg flex items-center justify-center transition-all shrink-0" style="background: var(--c-cream-deep); color: var(--c-navy);" onmouseover="this.style.background='var(--c-gold)';" onmouseout="this.style.background='var(--c-cream-deep)';">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="p-5 sm:p-7 modal-body" style="background: #fff;">
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
            class="form-input-mobile w-full input-premium rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1"><i class="fas fa-bolt text-brand-400 mr-1"></i>Déclencheur — Qu'est-ce qu'il se passe ? *</label>
          <input id="proc-trigger" type="text" required value="${proc?.trigger_event || ''}" placeholder="Ex: Un client arrive à la réception pour s'enregistrer"
            class="form-input-mobile w-full input-premium rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">
        </div>
        <div>
          <label class="block text-sm font-medium text-navy-600 mb-1">Description / Contexte</label>
          <textarea id="proc-desc" rows="3" oninput="autoResizeTextarea(this)" placeholder="Contexte, objectif, infos importantes à savoir avant de commencer..."
            class="form-input-mobile w-full input-premium rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400">${proc?.description || ''}</textarea>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-navy-600 mb-1">Catégorie</label>
            <select id="proc-category" class="form-input-mobile w-full input-premium rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-400 bg-white">
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
        <button type="submit" class="btn-premium-navy text-white px-6 py-3 sm:py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm">
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
  // Pool des sous-procédures déjà existantes (chargées via include_subprocedures=1)
  // On exclut la procédure actuellement en édition pour éviter la self-référence.
  const availableSubprocs = (state.subprocedures || []).filter(p => !currentEditingProcId || String(p.id) !== String(currentEditingProcId));
  const isLinked = step && step.linked_procedure_id;
  const linkedId = step?.linked_procedure_id || '';
  const linkedTitle = step?.linked_procedure_title || '';

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
    <input type="text" class="step-title form-input-mobile w-full input-premium rounded-lg px-3 py-2.5 text-base mb-3" placeholder="Ex: Vérifier l'identité du client" value="${step?.title || ''}" required>

    <!-- Bloc étape simple -->
    <div class="step-simple-block ${isLinked ? 'hidden' : ''}">
      <label class="block text-xs font-medium text-navy-500 mb-1">Contenu / Instructions</label>
      <textarea class="step-content form-input-mobile w-full input-premium rounded-lg px-3 py-2.5 text-base" rows="5" oninput="autoResizeTextarea(this)" placeholder="Détails complets de l'étape : ce qu'il faut faire, dire, vérifier...&#10;&#10;Astuces : utilisez **gras** pour mettre en valeur, • pour des puces.">${step?.content || ''}</textarea>
      <p class="text-xs text-navy-400 mt-1">Vous pouvez utiliser **gras** et des puces (• ou -)</p>
    </div>

    <!-- Bloc sous-procédure : 2 options -->
    <div class="step-linked-block ${isLinked ? '' : 'hidden'}">
      <p class="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2 mb-3">
        <i class="fas fa-info-circle mr-1"></i>Une sous-procédure n'apparaît <b>pas</b> dans la liste principale des procédures. Elle est seulement accessible via cette étape parent.
      </p>

      <label class="block text-xs font-medium text-purple-600 mb-1">Lier à une sous-procédure existante</label>
      <select class="step-linked-id form-input-mobile w-full border border-purple-200 rounded-lg px-3 py-2.5 text-base bg-white mb-2" onchange="onStepLinkedChange(this)">
        <option value="">— Aucune sélectionnée —</option>
        ${availableSubprocs.map(p => `<option value="${p.id}" ${String(p.id) === String(linkedId) ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
      </select>

      <div class="flex items-center gap-2 my-3">
        <div class="flex-1 h-px bg-purple-200"></div>
        <span class="text-[11px] uppercase font-semibold text-purple-400 tracking-wide">ou</span>
        <div class="flex-1 h-px bg-purple-200"></div>
      </div>

      <button type="button" onclick="openInlineSubprocCreator(this)"
        class="w-full flex items-center justify-center gap-2 bg-white border-2 border-dashed border-purple-300 hover:border-purple-500 hover:bg-purple-50 text-purple-600 hover:text-purple-700 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors">
        <i class="fas fa-plus-circle"></i>Créer une nouvelle sous-procédure ici
      </button>

      <!-- Indicateur visuel quand une sous-proc fraîchement créée a été assignée -->
      <div class="step-linked-info hidden mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
        <i class="fas fa-check-circle mr-1"></i><span class="step-linked-info-text"></span>
      </div>
    </div>
  </div>`;
}

// Quand l'utilisateur sélectionne une sous-proc existante, masquer l'indicateur "fraîchement créée"
function onStepLinkedChange(select) {
  const field = select.closest('.step-field');
  if (!field) return;
  const info = field.querySelector('.step-linked-info');
  if (info) info.classList.add('hidden');
}

// Ouvre un mini-modal pour créer une sous-procédure à la volée, depuis une étape parent
async function openInlineSubprocCreator(btn) {
  const stepField = btn.closest('.step-field');
  if (!stepField) return;
  const parentTitle = (document.getElementById('proc-title')?.value || '').trim() || 'la procédure parent';

  // Mini-form HTML construit dans une modale superposée
  const overlayId = 'subproc-creator-overlay';
  // Évite les doublons
  document.getElementById(overlayId)?.remove();

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.className = 'fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 overflow-y-auto';
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center"><i class="fas fa-diagram-project"></i></div>
        <h3 class="font-bold text-navy-900">Nouvelle sous-procédure</h3>
        <button type="button" onclick="document.getElementById('${overlayId}').remove()" class="ml-auto w-8 h-8 rounded-lg hover:bg-navy-50 text-navy-400"><i class="fas fa-times"></i></button>
      </div>
      <p class="text-xs text-navy-500 mb-4">Cette sous-procédure sera rattachée à <b>${escapeHtml(parentTitle)}</b> et ne s'affichera <b>pas</b> dans la liste principale.</p>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-navy-600 mb-1">Titre *</label>
          <input id="sp-title" type="text" required placeholder="Ex: Vérification d'identité du client" class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-400">
        </div>
        <div>
          <label class="block text-xs font-semibold text-navy-600 mb-1">Déclencheur *</label>
          <input id="sp-trigger" type="text" required placeholder="Ex: Quand on doit vérifier l'identité d'un client à la réception" class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-400">
        </div>
        <div>
          <label class="block text-xs font-semibold text-navy-600 mb-1">Description (optionnel)</label>
          <textarea id="sp-desc" rows="2" oninput="autoResizeTextarea(this)" placeholder="Contexte, objectif..." class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-400"></textarea>
        </div>
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-xs font-semibold text-navy-600">Étapes *</label>
            <button type="button" onclick="addInlineSubprocStep()" class="text-xs text-purple-500 hover:text-purple-700"><i class="fas fa-plus mr-1"></i>Ajouter</button>
          </div>
          <div id="sp-steps" class="space-y-2">
            ${inlineSubprocStepHTML(0)}
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-4 mt-3 border-t border-gray-100">
        <button type="button" onclick="document.getElementById('${overlayId}').remove()" class="px-4 py-2 text-sm text-navy-500 hover:bg-navy-50 rounded-lg">Annuler</button>
        <button type="button" onclick="saveInlineSubproc('${stepField.dataset.stepId}')" class="bg-purple-500 hover:bg-purple-600 text-white px-5 py-2 rounded-lg text-sm font-semibold">
          <i class="fas fa-check mr-1"></i>Créer et lier
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('sp-title')?.focus(), 50);
}

function inlineSubprocStepHTML(idx) {
  return `
    <div class="sp-step-row bg-purple-50/40 rounded-lg p-2 border border-purple-100">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[11px] font-bold text-purple-600">Étape ${idx + 1}</span>
        <button type="button" onclick="this.closest('.sp-step-row').remove()" class="ml-auto text-red-400 hover:text-red-600 w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center"><i class="fas fa-times text-xs"></i></button>
      </div>
      <input type="text" class="sp-step-title w-full border border-purple-200 rounded-md px-2 py-1.5 text-sm mb-1.5" placeholder="Titre de l'étape">
      <textarea class="sp-step-content w-full border border-purple-200 rounded-md px-2 py-1.5 text-sm" rows="2" oninput="autoResizeTextarea(this)" placeholder="Contenu de l'étape"></textarea>
    </div>
  `;
}

function addInlineSubprocStep() {
  const cont = document.getElementById('sp-steps');
  if (!cont) return;
  const idx = cont.querySelectorAll('.sp-step-row').length;
  cont.insertAdjacentHTML('beforeend', inlineSubprocStepHTML(idx));
}

// Crée la sous-procédure en base (POST /api/procedures avec is_subprocedure=1)
// puis l'attache au step parent via le <select>.
async function saveInlineSubproc(parentStepDataId) {
  const title = document.getElementById('sp-title')?.value.trim();
  const trigger = document.getElementById('sp-trigger')?.value.trim();
  const desc = document.getElementById('sp-desc')?.value.trim();
  if (!title || !trigger) {
    showToast('Titre et déclencheur sont requis', 'error');
    return;
  }
  const steps = [];
  document.querySelectorAll('#sp-steps .sp-step-row').forEach((row, i) => {
    const t = row.querySelector('.sp-step-title')?.value.trim();
    if (!t) return;
    steps.push({ step_number: i + 1, title: t, content: row.querySelector('.sp-step-content')?.value.trim() || '', linked_procedure_id: null });
  });
  if (steps.length === 0) {
    showToast('Ajoute au moins une étape', 'error');
    return;
  }

  const result = await api('/procedures', {
    method: 'POST',
    body: JSON.stringify({
      title, trigger_event: trigger, description: desc,
      category_id: null, steps, conditions: [],
      is_subprocedure: true
    })
  });
  if (!result || !result.id) {
    showToast('Erreur lors de la création', 'error');
    return;
  }

  // Met à jour state.subprocedures pour que le nouveau soit dispo dans tous les selects
  state.subprocedures = state.subprocedures || [];
  state.subprocedures.push({ id: result.id, title, is_subprocedure: 1 });

  // Trouver le step parent et y assigner la sous-proc fraîchement créée
  const parentField = document.querySelector(`.step-field[data-step-id="${parentStepDataId}"]`);
  if (parentField) {
    const select = parentField.querySelector('.step-linked-id');
    if (select) {
      // Ajoute l'option si elle n'existe pas
      const exists = Array.from(select.options).some(o => String(o.value) === String(result.id));
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = result.id;
        opt.textContent = title;
        select.appendChild(opt);
      }
      select.value = String(result.id);
    }
    // Indicateur visuel "créée et liée"
    const info = parentField.querySelector('.step-linked-info');
    const infoText = parentField.querySelector('.step-linked-info-text');
    if (info && infoText) {
      infoText.textContent = `Sous-procédure « ${title} » créée et liée à cette étape.`;
      info.classList.remove('hidden');
    }
  }

  // Refléter aussi dans tous les autres selects ouverts (autres étapes)
  document.querySelectorAll('.step-linked-id').forEach(sel => {
    if (!Array.from(sel.options).some(o => String(o.value) === String(result.id))) {
      const opt = document.createElement('option');
      opt.value = result.id;
      opt.textContent = title;
      sel.appendChild(opt);
    }
  });

  document.getElementById('subproc-creator-overlay')?.remove();
  showToast('Sous-procédure créée et liée', 'success');
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
    <input type="text" class="cstep-title form-input-mobile w-full input-premium rounded-lg px-3 py-2.5 text-base mb-2" placeholder="Titre de l'étape" value="${step?.title || ''}">
    <textarea class="cstep-content form-input-mobile w-full input-premium rounded-lg px-3 py-2.5 text-base" rows="3" oninput="autoResizeTextarea(this)" placeholder="Contenu / instructions">${step?.content || step?.description || ''}</textarea>
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
        <select id="sugg-type" required class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="improvement">💡 Amélioration d'une procédure existante</option>
          <option value="new_procedure">➕ Proposition de nouvelle procédure</option>
          <option value="issue">🐛 Signaler un problème</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Titre *</label>
        <input id="sugg-title" type="text" required placeholder="Résumé court de votre suggestion"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Description détaillée *</label>
        <textarea id="sugg-desc" rows="4" required placeholder="Décrivez en détail votre suggestion..."
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"></textarea>
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
        <select id="user-hotel" required class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="">— Sélectionner un hôtel —</option>
          ${state.hotels.map(h => `<option value="${h.id}">${h.name}</option>`).join('')}
        </select>
      </div>` : ''}
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nom complet *</label>
        <input id="user-name" type="text" required placeholder="Prénom Nom"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Email *</label>
        <input id="user-email" type="email" required placeholder="email@hotel.com"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Mot de passe *</label>
        <input id="user-password" type="password" required placeholder="••••••••"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      ${!isSuperAdmin ? `
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Rôle *</label>
        <select id="user-role" class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="employee">Employé</option>
          <option value="admin">Administrateur</option>
        </select>
      </div>` : '<input type="hidden" id="user-role" value="admin">'}
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="btn-premium-navy text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
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
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Adresse</label>
        <input id="hotel-address" type="text" placeholder="Adresse complète"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="btn-premium-navy text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
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
        <input id="tpl-name" type="text" required class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Description</label>
        <textarea id="tpl-desc" rows="2" class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"></textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Catégorie suggérée</label>
        <input id="tpl-category" type="text" placeholder="Ex: Réception" class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
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
        <button type="submit" class="btn-premium-navy text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
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
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Nouveau mot de passe *</label>
        <input id="cp-new" type="password" required placeholder="••••••••" minlength="6"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Confirmer le nouveau mot de passe *</label>
        <input id="cp-confirm" type="password" required placeholder="••••••••" minlength="6"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="btn-premium-navy text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
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

    <div class="card-premium overflow-hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
        ${rooms.length === 0 ? `<div class="col-span-full text-center py-12" style="color: rgba(15,27,40,0.4);">Aucune chambre. Allez dans <strong>Chambres</strong> pour en créer.</div>` : rooms.map(r => {
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

// ============================================
// VIEW: HOTEL SETTINGS — bloc supprimé volontairement.
// Le code client (login_code), capacités & horaires resto sont gérés
// directement depuis la page Restaurant (templates de semaine).
// ============================================

// ============================================
// CLIENT APP — Front Wikot (espace client en chambre)
// ============================================
function renderClientApp() {
  const c = state.client || {};
  const view = state.clientView || 'wikot';
  const tabClass = (active) => active
    ? 'flex-1 py-3.5 text-sm font-semibold transition-all'
    : 'flex-1 py-3.5 text-sm font-medium transition-all';
  const tabStyle = (active) => active
    ? 'color: var(--c-navy); box-shadow: inset 0 -2px 0 var(--c-gold);'
    : 'color: rgba(15,27,40,0.45);';
  return `
  <div class="min-h-screen flex flex-col" style="background: var(--c-cream);">
    <!-- Header premium -->
    <header class="px-4 sm:px-6 py-4 flex items-center justify-between" style="background: #fff; border-bottom: 1px solid var(--c-line); box-shadow: 0 1px 2px rgba(10,22,40,0.04);">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--c-gold);">
          <i class="fas fa-concierge-bell text-sm" style="color: var(--c-navy);"></i>
        </div>
        <div>
          <div class="font-display font-semibold text-base" style="color: var(--c-navy);">Wikot</div>
          <div class="text-[10px] uppercase tracking-[0.18em]" style="color: var(--c-gold-deep);">${escapeHtml(c.hotel_name || '')}</div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right hidden sm:block">
          <div class="text-[10px] uppercase tracking-wider" style="color: rgba(15,27,40,0.45);">Bienvenue</div>
          <div class="font-display font-semibold text-sm" style="color: var(--c-navy);">${escapeHtml(c.guest_name || '')} · Ch. ${escapeHtml(c.room_number || '')}</div>
        </div>
        <button onclick="clientLogout()" class="text-xs px-3 py-1.5 rounded-lg transition-all" style="color: rgba(15,27,40,0.5); border: 1px solid var(--c-line-strong);" onmouseover="this.style.color='#C84C3F'; this.style.borderColor='rgba(226,125,110,0.4)';" onmouseout="this.style.color='rgba(15,27,40,0.5)'; this.style.borderColor='var(--c-line-strong)';">
          <i class="fas fa-sign-out-alt"></i> <span class="hidden sm:inline">Déconnexion</span>
        </button>
      </div>
    </header>

    <!-- Tabs premium -->
    <nav class="flex" style="background: #fff; border-bottom: 1px solid var(--c-line);">
      <button onclick="state.clientView='wikot'; render(); ensureClientWikotLoaded()" class="${tabClass(view==='wikot')}" style="${tabStyle(view==='wikot')}"><i class="fas fa-comments mr-1.5"></i> Wikot</button>
      <button onclick="state.clientView='restaurant'; render(); ensureClientRestaurantLoaded()" class="${tabClass(view==='restaurant')}" style="${tabStyle(view==='restaurant')}"><i class="fas fa-utensils mr-1.5"></i> Restaurant</button>
      <button onclick="state.clientView='info'; render(); ensureClientInfoLoaded()" class="${tabClass(view==='info')}" style="${tabStyle(view==='info')}"><i class="fas fa-circle-info mr-1.5"></i> Infos</button>
    </nav>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full">
      ${view === 'restaurant' ? renderClientRestaurant()
        : view === 'info' ? renderClientInfo()
        : view === 'home' ? renderClientHome()
        : renderClientWikot()}
    </main>
  </div>`;
}

function renderClientHome() {
  const c = state.client || {};
  return `
  <div class="space-y-5 fade-in">
    <!-- Carte de bienvenue façon palace -->
    <div class="card-premium p-7 sm:p-8 relative overflow-hidden">
      <!-- Liseré or en haut -->
      <div class="absolute top-0 left-0 right-0 h-px" style="background: linear-gradient(to right, transparent, var(--c-gold), transparent);"></div>
      <p class="section-eyebrow mb-2.5">L'${escapeHtml(c.hotel_name || 'hôtel')}</p>
      <h2 class="font-display text-2xl sm:text-3xl font-medium leading-tight" style="color: var(--c-navy);">
        Bienvenue, <span style="color: var(--c-gold-deep);">${escapeHtml(c.guest_name || '')}</span>
      </h2>
      <p class="text-sm mt-3" style="color: rgba(15,27,40,0.65);">
        Vous séjournez en chambre <strong style="color: var(--c-navy);">${escapeHtml(c.room_number || '')}</strong>. Notre équipe et notre majordome digital sont à votre disposition.
      </p>
      <div class="mt-5 inline-flex items-center gap-2 text-[11px] uppercase tracking-wider" style="color: rgba(15,27,40,0.45);">
        <i class="fas fa-clock" style="color: var(--c-gold);"></i>
        Session active jusqu'au départ (12h00)
      </div>
    </div>

    <!-- Actions principales -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
      <button onclick="state.clientView='wikot'; render(); ensureClientWikotLoaded()" class="card-premium p-6 text-left group">
        <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: rgba(201,169,97,0.12);">
          <i class="fas fa-comments text-lg" style="color: var(--c-gold-deep);"></i>
        </div>
        <div class="font-display font-semibold text-base" style="color: var(--c-navy);">Discuter avec Wikot</div>
        <div class="text-xs mt-1.5" style="color: rgba(15,27,40,0.55);">Posez vos questions sur l'hôtel.</div>
        <div class="mt-4 text-[11px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5" style="color: var(--c-gold-deep);">
          Démarrer <i class="fas fa-arrow-right text-[10px]"></i>
        </div>
      </button>
      <button onclick="state.clientView='restaurant'; render(); ensureClientRestaurantLoaded()" class="card-premium p-6 text-left group">
        <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: rgba(201,169,97,0.12);">
          <i class="fas fa-utensils text-lg" style="color: var(--c-gold-deep);"></i>
        </div>
        <div class="font-display font-semibold text-base" style="color: var(--c-navy);">Restaurant</div>
        <div class="text-xs mt-1.5" style="color: rgba(15,27,40,0.55);">Réservez petit-déj, déjeuner, dîner.</div>
        <div class="mt-4 text-[11px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5" style="color: var(--c-gold-deep);">
          Réserver <i class="fas fa-arrow-right text-[10px]"></i>
        </div>
      </button>
      <button onclick="state.clientView='info'; render(); ensureClientInfoLoaded()" class="card-premium p-6 text-left group">
        <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: rgba(201,169,97,0.12);">
          <i class="fas fa-circle-info text-lg" style="color: var(--c-gold-deep);"></i>
        </div>
        <div class="font-display font-semibold text-base" style="color: var(--c-navy);">Infos pratiques</div>
        <div class="text-xs mt-1.5" style="color: rgba(15,27,40,0.55);">Horaires, services, équipements.</div>
        <div class="mt-4 text-[11px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5" style="color: var(--c-gold-deep);">
          Découvrir <i class="fas fa-arrow-right text-[10px]"></i>
        </div>
      </button>
    </div>
  </div>`;
}

async function ensureClientWikotLoaded() {
  if (state._clientWikotLoaded) return;
  state._clientWikotLoaded = true;
  const data = await clientApi('/client/wikot/conversations');
  if (data) state.clientWikotConversations = data.conversations || [];
  // Si aucune conversation, en créer une fraîche
  if (state.clientWikotConversations.length === 0) {
    const created = await clientApi('/client/wikot/conversations', { method: 'POST' });
    if (created) {
      state.clientWikotCurrentConvId = created.id;
      state.clientWikotMessages = [];
    }
  } else {
    state.clientWikotCurrentConvId = state.clientWikotConversations[0].id;
    const conv = await clientApi(`/client/wikot/conversations/${state.clientWikotCurrentConvId}`);
    if (conv) state.clientWikotMessages = conv.messages || [];
  }
  render();
}

// ============================================
// FRONT WIKOT — rendu (info-cards + reservation-cards)
// ============================================
function renderClientWikot() {
  const messages = state.clientWikotMessages || [];
  return `
  <div class="card-premium flex flex-col" style="height: calc(100vh - 180px); min-height: 400px;">
    <div class="px-5 py-4 flex items-center justify-between" style="border-bottom: 1px solid var(--c-line);">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--c-navy);">
          <i class="fas fa-robot" style="color: var(--c-gold);"></i>
        </div>
        <div>
          <p class="section-eyebrow">Concierge digital</p>
          <h2 class="font-display font-semibold" style="color: var(--c-navy);">Wikot</h2>
        </div>
      </div>
      <button onclick="newClientWikotConversation()" class="text-xs transition-colors" style="color: rgba(15,27,40,0.55);" onmouseover="this.style.color='var(--c-gold-deep)'" onmouseout="this.style.color='rgba(15,27,40,0.55)'"><i class="fas fa-rotate-right mr-1"></i>Nouvelle</button>
    </div>
    <div id="client-wikot-messages" class="flex-1 overflow-y-auto p-4 space-y-3" style="background: var(--c-ivory);">
      ${messages.length === 0 ? `
        <div class="text-center py-8">
          <div class="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3" style="background: var(--c-navy);">
            <i class="fas fa-comments text-xl" style="color: var(--c-gold);"></i>
          </div>
          <p class="font-display text-base font-semibold" style="color: var(--c-navy);">Bienvenue à bord</p>
          <p class="text-sm mt-1" style="color: rgba(15,27,40,0.55);">Posez-moi une question ou demandez à réserver.</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5 max-w-md mx-auto">
            <button onclick="sendClientWikotMessage('À quelle heure est servi le petit-déjeuner ?')" class="text-left px-3.5 py-2.5 rounded-lg text-xs transition-all" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line-strong);" onmouseover="this.style.borderColor='var(--c-gold)'; this.style.background='var(--c-cream-deep)';" onmouseout="this.style.borderColor='var(--c-line-strong)'; this.style.background='#fff';"><i class="fas fa-coffee mr-1.5" style="color: var(--c-gold);"></i>Heure du petit-déjeuner ?</button>
            <button onclick="sendClientWikotMessage('Je voudrais réserver une table pour le dîner')" class="text-left px-3.5 py-2.5 rounded-lg text-xs transition-all" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line-strong);" onmouseover="this.style.borderColor='var(--c-gold)'; this.style.background='var(--c-cream-deep)';" onmouseout="this.style.borderColor='var(--c-line-strong)'; this.style.background='#fff';"><i class="fas fa-utensils mr-1.5" style="color: var(--c-gold);"></i>Réserver une table ce soir</button>
            <button onclick="sendClientWikotMessage('Quel est le code wifi ?')" class="text-left px-3.5 py-2.5 rounded-lg text-xs transition-all" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line-strong);" onmouseover="this.style.borderColor='var(--c-gold)'; this.style.background='var(--c-cream-deep)';" onmouseout="this.style.borderColor='var(--c-line-strong)'; this.style.background='#fff';"><i class="fas fa-wifi mr-1.5" style="color: var(--c-gold);"></i>Code wifi ?</button>
            <button onclick="sendClientWikotMessage('Réserver le petit-déjeuner')" class="text-left px-3.5 py-2.5 rounded-lg text-xs transition-all" style="background: #fff; color: var(--c-navy); border: 1px solid var(--c-line-strong);" onmouseover="this.style.borderColor='var(--c-gold)'; this.style.background='var(--c-cream-deep)';" onmouseout="this.style.borderColor='var(--c-line-strong)'; this.style.background='#fff';"><i class="fas fa-mug-hot mr-1.5" style="color: var(--c-gold);"></i>Réserver le petit-déjeuner</button>
          </div>
        </div>` : messages.map(m => renderFrontWikotMessage(m)).join('')}
      ${state.clientWikotSending ? '<div class="flex justify-start"><div class="rounded-2xl px-4 py-2 text-sm" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.55);"><i class="fas fa-circle-notch fa-spin mr-1"></i> Wikot réfléchit...</div></div>' : ''}
    </div>
    <div class="p-3 flex gap-2 items-center" style="border-top: 1px solid var(--c-line); background: #fff;">
      <input id="client_wikot_input" type="text" placeholder="Posez votre question..."
        onkeydown="if(event.key==='Enter'){sendClientWikotMessage(this.value);this.value='';}"
        class="flex-1 input-premium px-4 py-2 rounded-full text-sm form-input-mobile">
      ${renderVoiceWidget('client', 'client-wikot')}
      <button onclick="const i=document.getElementById('client_wikot_input'); sendClientWikotMessage(i.value); i.value='';"
        class="btn-premium w-10 h-10 rounded-full flex items-center justify-center" style="background: var(--c-navy); color: var(--c-gold);"><i class="fas fa-paper-plane"></i></button>
    </div>
  </div>`;
}

// Rendu d'un message Front Wikot (user simple OU assistant avec carte structurée)
function renderFrontWikotMessage(m) {
  if (m.role === 'user') {
    const hasAudio = !!m.audio_key || !!m.audio_pending;
    const txt = m.content && m.content.trim() ? escapeHtml(m.content) : (hasAudio ? '<span class="italic" style="opacity: 0.75;"><i class="fas fa-microphone mr-1.5"></i>Message vocal</span>' : '');
    const audioBlock = m.audio_key ? renderVoiceMessageBubble(m, { isClient: true })
      : (m.audio_pending ? `<div class="flex items-center gap-2 mt-1.5 pt-1.5 text-xs italic" style="border-top: 1px solid rgba(255,255,255,0.15); opacity: 0.75;"><i class="fas fa-circle-notch fa-spin"></i>Envoi (${formatVoiceDuration(m.audio_duration_ms || 0)})...</div>` : '');
    return `
      <div class="flex justify-end">
        <div class="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap" style="background: var(--c-navy); color: var(--c-gold);">${txt}${audioBlock}</div>
      </div>`;
  }
  // Assistant : on lit references_json pour afficher la carte
  let ref = null;
  try { ref = m.references_json ? (typeof m.references_json === 'string' ? JSON.parse(m.references_json) : m.references_json) : null; } catch {}

  if (ref?.kind === 'info_card' && ref.item) {
    const it = ref.item;
    return `
      <div class="flex justify-start">
        <div class="max-w-[90%] card-premium overflow-hidden" style="border-left: 3px solid var(--c-gold);">
          <div class="px-4 py-2.5 flex items-center gap-2" style="background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
            <i class="fas fa-circle-info" style="color: var(--c-gold-deep);"></i>
            <div class="section-eyebrow">${escapeHtml(it.category || 'Info')}</div>
          </div>
          <div class="px-4 py-3">
            <h4 class="font-display font-semibold mb-1.5" style="color: var(--c-navy);">${escapeHtml(it.title || '')}</h4>
            <div class="text-sm whitespace-pre-wrap" style="color: rgba(15,27,40,0.75);">${escapeHtml(it.content || '')}</div>
          </div>
        </div>
      </div>`;
  }

  if (ref?.kind === 'reservation_card') {
    const icons = {
      breakfast: 'fa-mug-hot',
      lunch: 'fa-utensils',
      dinner: 'fa-wine-glass'
    };
    const icon = icons[ref.meal_type] || icons.dinner;
    return `
      <div class="flex justify-start">
        <div class="max-w-[90%] card-premium overflow-hidden" style="border-left: 3px solid var(--c-gold);">
          <div class="px-4 py-2.5 flex items-center gap-2" style="background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
            <i class="fas ${icon}" style="color: var(--c-gold-deep);"></i>
            <div class="section-eyebrow">Réservation restaurant</div>
          </div>
          <div class="px-4 py-3">
            <h4 class="font-display font-semibold mb-1" style="color: var(--c-navy);">Réserver : ${escapeHtml(ref.meal_label || ref.meal_type)}</h4>
            <p class="text-xs mb-3" style="color: rgba(15,27,40,0.55);">Choisissez la date, l'heure et le nombre de couverts.</p>
            <button onclick="openClientReservationFromWikot('${ref.meal_type}')"
              class="w-full btn-premium py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-navy); color: var(--c-gold);">
              <i class="fas fa-calendar-plus mr-1"></i> Réserver maintenant
            </button>
          </div>
        </div>
      </div>`;
  }

  if (ref?.kind === 'fallback') {
    return `
      <div class="flex justify-start">
        <div class="max-w-[80%] bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-2 text-sm text-yellow-900">
          <i class="fas fa-info-circle mr-1"></i>${escapeHtml(ref.message || '')}
        </div>
      </div>`;
  }

  // Compat ancien format (texte libre legacy)
  return `
    <div class="flex justify-start">
      <div class="max-w-[80%] bg-gray-100 text-navy-800 rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap">${escapeHtml(m.content || '')}</div>
    </div>`;
}

// Action depuis carte Wikot → bascule sur l'onglet Restaurant en pré-sélectionnant le repas
function openClientReservationFromWikot(mealType) {
  state.clientView = 'restaurant';
  state.clientPrefilledMeal = mealType;
  ensureClientRestaurantLoaded();
  render();
}

async function sendClientWikotMessage(text) {
  text = (text || '').trim();
  const v = initVoiceState();
  const hasVoice = v && v.active === 'client' && v.mode === 'client-wikot' && v.blob && !v.recording;
  if (!text && !hasVoice) return;
  if (v && v.active === 'client' && v.mode === 'client-wikot' && v.recording) {
    showToast('Termine l\'enregistrement avant d\'envoyer', 'warning');
    return;
  }
  if (!state.clientWikotCurrentConvId) {
    const created = await clientApi('/client/wikot/conversations', { method: 'POST' });
    if (!created) return;
    state.clientWikotCurrentConvId = created.id;
  }
  // Ajout immédiat du message user pour feedback instantané
  const optimistic = { id: 'tmp_' + Date.now(), role: 'user', content: text };
  if (hasVoice) { optimistic.audio_pending = true; optimistic.audio_duration_ms = v.durationMs; }
  state.clientWikotMessages.push(optimistic);
  state.clientWikotSending = true;
  render();
  setTimeout(() => { const el = document.getElementById('client-wikot-messages'); if (el) el.scrollTop = el.scrollHeight; }, 50);

  const body = { content: text };
  if (hasVoice) {
    const up = await uploadCurrentVoice('client');
    if (!up) {
      state.clientWikotMessages.pop();
      state.clientWikotSending = false;
      render();
      return;
    }
    body.audio_key = up.audio_key;
    body.audio_mime = up.audio_mime;
    body.audio_duration_ms = up.audio_duration_ms;
    body.audio_size_bytes = up.audio_size_bytes;
    discardVoiceRecording();
  }

  const data = await clientApi(`/client/wikot/conversations/${state.clientWikotCurrentConvId}/message`, {
    method: 'POST', body: JSON.stringify(body)
  });
  state.clientWikotSending = false;
  if (data && data.assistant_message) {
    // Met à jour l'optimiste avec l'audio_key réel pour relire le vocal
    if (hasVoice && data.user_message_id) {
      const last = state.clientWikotMessages[state.clientWikotMessages.length - 1];
      if (last && last.role === 'user') {
        last.id = data.user_message_id;
        last.audio_key = body.audio_key;
        last.audio_mime = body.audio_mime;
        last.audio_duration_ms = body.audio_duration_ms;
        delete last.audio_pending;
      }
    }
    state.clientWikotMessages.push(data.assistant_message);
  }
  render();
  setTimeout(() => { const el = document.getElementById('client-wikot-messages'); if (el) el.scrollTop = el.scrollHeight; }, 50);
}

async function newClientWikotConversation() {
  const created = await clientApi('/client/wikot/conversations', { method: 'POST' });
  if (created) {
    state.clientWikotCurrentConvId = created.id;
    state.clientWikotMessages = [];
    render();
  }
}

async function ensureClientRestaurantLoaded() {
  if (state._clientRestoLoaded) return;
  state._clientRestoLoaded = true;
  const today = new Date().toISOString().slice(0, 10);
  state.clientRestaurantDate = today;
  await loadClientRestaurant();
}

async function loadClientRestaurant() {
  const date = state.clientRestaurantDate || new Date().toISOString().slice(0, 10);
  const [avail, mine] = await Promise.all([
    clientApi(`/client/restaurant/availability?date=${date}`),
    clientApi('/client/restaurant/reservations')
  ]);
  if (avail) state.clientRestaurantAvailability = avail;
  if (mine) state.clientRestaurantReservations = mine.reservations || [];
  render();
  // Si on arrive depuis Front Wikot avec un repas pré-sélectionné → ouvre direct le modal
  if (state.clientPrefilledMeal && avail) {
    const m = state.clientPrefilledMeal;
    state.clientPrefilledMeal = null;
    const mealLabels = { breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', dinner: 'Dîner' };
    const a = avail[m] || {};
    if (a.is_open && a.slots_left > 0) {
      setTimeout(() => showClientReservationModal(m, mealLabels[m] || m), 200);
    } else {
      showToast(a.is_open ? 'Service complet pour cette date' : 'Service fermé à cette date', 'warning');
    }
  }
}

function renderClientRestaurant() {
  const avail = state.clientRestaurantAvailability;
  const reservations = state.clientRestaurantReservations || [];
  const date = state.clientRestaurantDate || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const mealLabels = { breakfast: { label: 'Petit-déjeuner', icon: '☕' }, lunch: { label: 'Déjeuner', icon: '🍽️' }, dinner: { label: 'Dîner', icon: '🍷' } };

  return `
  <div class="space-y-4">
    <div class="card-premium p-5">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--c-navy);">
          <i class="fas fa-utensils" style="color: var(--c-gold);"></i>
        </div>
        <div>
          <p class="section-eyebrow">Service en salle</p>
          <h2 class="font-display font-semibold" style="color: var(--c-navy);">Réserver une table</h2>
        </div>
      </div>
      <label class="block text-[10px] uppercase tracking-wider mb-1.5" style="color: rgba(15,27,40,0.5);">Choisir une date</label>
      <input type="date" value="${date}" min="${today}" onchange="state.clientRestaurantDate=this.value; loadClientRestaurant()" class="w-full input-premium px-3 py-2 rounded-lg form-input-mobile">
    </div>
    ${!avail ? '<div class="text-center" style="color: rgba(15,27,40,0.4);">Chargement...</div>' : `
    <div class="space-y-3">
      ${['breakfast', 'lunch', 'dinner'].map(m => {
        const a = avail[m] || {};
        const config = mealLabels[m];
        const closed = !a.is_open;
        const full = a.slots_left <= 0;
        return `
        <div class="card-premium p-5 ${closed ? 'opacity-60' : ''}">
          <div class="flex items-center justify-between mb-2">
            <div>
              <div class="font-display font-semibold" style="color: var(--c-navy);">${config.icon} ${config.label}</div>
              <div class="text-xs mt-0.5" style="color: rgba(15,27,40,0.5);">${a.open_time && a.close_time ? `${a.open_time} – ${a.close_time}` : ''}</div>
            </div>
            ${closed ? '<span class="text-[10px] uppercase tracking-wider px-2 py-1 rounded" style="background: var(--c-cream-deep); color: rgba(15,27,40,0.5);">Fermé</span>'
              : full ? '<span class="text-[10px] uppercase tracking-wider px-2 py-1 rounded" style="background: rgba(226,125,110,0.12); color: #C84C3F;">Complet</span>'
              : `<span class="text-[10px] uppercase tracking-wider px-2 py-1 rounded font-semibold" style="background: rgba(201,169,97,0.15); color: var(--c-gold-deep);">${a.slots_left} place(s)</span>`}
          </div>
          ${!closed && !full ? `<button onclick="showClientReservationModal('${m}', '${config.label}')" class="w-full btn-premium py-2.5 rounded-lg text-sm font-semibold mt-2" style="background: var(--c-navy); color: var(--c-gold);"><i class="fas fa-calendar-check mr-1"></i>Réserver</button>` : ''}
        </div>`;
      }).join('')}
    </div>`}

    <div class="card-premium p-5">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: var(--c-navy);">
          <i class="fas fa-bookmark" style="color: var(--c-gold);"></i>
        </div>
        <div>
          <p class="section-eyebrow">Vos réservations</p>
          <h3 class="font-display font-semibold" style="color: var(--c-navy);">Mes réservations</h3>
        </div>
      </div>
      ${reservations.length === 0 ? '<div class="text-sm italic" style="color: rgba(15,27,40,0.4);">Aucune réservation pour le moment.</div>' : `
        <div class="space-y-2">
          ${reservations.map(r => {
            const config = mealLabels[r.meal_type] || { label: r.meal_type, icon: '🍴' };
            return `
            <div class="rounded-lg p-3 flex items-center justify-between" style="background: var(--c-cream-deep); border: 1px solid var(--c-line);">
              <div>
                <div class="font-display font-semibold text-sm" style="color: var(--c-navy);">${config.icon} ${config.label} · ${r.reservation_date}</div>
                <div class="text-xs mt-0.5" style="color: rgba(15,27,40,0.55);">${r.time_slot ? r.time_slot + ' · ' : ''}${r.guest_count} pers.${r.notes ? ' · ' + escapeHtml(r.notes) : ''}</div>
              </div>
              <button onclick="cancelClientReservation(${r.id})" class="text-xs transition-colors" style="color: #C84C3F;"><i class="fas fa-times"></i> Annuler</button>
            </div>`;
          }).join('')}
        </div>`}
    </div>
  </div>`;
}

function showClientReservationModal(mealType, mealLabel) {
  const date = state.clientRestaurantDate || new Date().toISOString().slice(0, 10);
  const html = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onclick="if(event.target===this) closeClientModal()">
    <div class="modal-panel bg-white w-full sm:max-w-md">
      <div class="modal-header bg-brand-400 text-white px-5 py-3"><h3 class="font-semibold">${mealLabel} · ${date}</h3></div>
      <div class="modal-body p-5 space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div><label class="block text-xs mb-1">Heure souhaitée</label><input id="client_resa_time" type="time" class="w-full px-2 py-2 border rounded form-input-mobile"></div>
          <div><label class="block text-xs mb-1">Personnes</label><input id="client_resa_count" type="number" min="1" max="10" value="2" class="w-full px-2 py-2 border rounded form-input-mobile"></div>
        </div>
        <div><label class="block text-xs mb-1">Demandes spéciales (optionnel)</label><textarea id="client_resa_notes" rows="2" class="w-full px-2 py-2 border rounded form-input-mobile" placeholder="Allergies, table à proximité de la fenêtre..."></textarea></div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="closeClientModal()" class="px-3 py-2 text-sm text-gray-600 rounded hover:bg-gray-100">Annuler</button>
          <button onclick="confirmClientReservation('${mealType}')" class="px-3 py-2 text-sm btn-premium-navy text-white rounded font-semibold">Confirmer</button>
        </div>
      </div>
    </div>
  </div>`;
  // Crée un container client si pas déjà présent
  let mc = document.getElementById('client-modal-container');
  if (!mc) { mc = document.createElement('div'); mc.id = 'client-modal-container'; document.body.appendChild(mc); }
  mc.innerHTML = html;
}

function closeClientModal() {
  const mc = document.getElementById('client-modal-container');
  if (mc) mc.innerHTML = '';
}

async function confirmClientReservation(mealType) {
  const body = {
    reservation_date: state.clientRestaurantDate,
    meal_type: mealType,
    time_slot: document.getElementById('client_resa_time').value || null,
    guest_count: parseInt(document.getElementById('client_resa_count').value) || 1,
    notes: document.getElementById('client_resa_notes').value || null
  };
  const data = await clientApi('/client/restaurant/reservations', { method: 'POST', body: JSON.stringify(body) });
  if (data) {
    showToast('Réservation confirmée !', 'success');
    closeClientModal();
    await loadClientRestaurant();
  }
}

async function cancelClientReservation(id) {
  if (!confirm('Annuler cette réservation ?')) return;
  const data = await clientApi(`/client/restaurant/reservations/${id}`, { method: 'DELETE' });
  if (data) { showToast('Réservation annulée', 'success'); await loadClientRestaurant(); }
}

async function ensureClientInfoLoaded() {
  if (state._clientInfoLoaded) return;
  state._clientInfoLoaded = true;
  const data = await clientApi('/client/hotel-info');
  if (data) {
    state.clientHotelInfoCategories = data.categories || [];
    state.clientHotelInfoItems = data.items || [];
  }
  render();
}

function renderClientInfo() {
  const cats = state.clientHotelInfoCategories || [];
  const items = state.clientHotelInfoItems || [];
  if (cats.length === 0 && items.length === 0) {
    return `<div class="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400"><i class="fas fa-info-circle text-3xl mb-2"></i><p class="text-sm">Aucune information n'a encore été publiée par l'hôtel.</p></div>`;
  }
  // Group items par catégorie
  const grouped = {};
  for (const item of items) {
    const k = item.category_id || 0;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(item);
  }
  return `
  <div class="space-y-3">
    ${cats.map(cat => {
      const catItems = grouped[cat.id] || [];
      if (catItems.length === 0) return '';
      return `
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-gray-100 flex items-center gap-2" style="background: ${cat.color || '#3B82F6'}10;">
          <i class="fas ${cat.icon || 'fa-circle-info'}" style="color: ${cat.color || '#3B82F6'}"></i>
          <h3 class="font-semibold text-navy-800">${escapeHtml(cat.name)}</h3>
        </div>
        <div class="divide-y divide-gray-100">
          ${catItems.map(item => `
            <div class="p-4">
              <div class="font-semibold text-sm text-navy-800 mb-1">${escapeHtml(item.title)}</div>
              <div class="text-sm text-gray-600 whitespace-pre-wrap">${escapeHtml(item.content || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('')}
    ${grouped[0] && grouped[0].length > 0 ? `
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-gray-100"><h3 class="font-semibold text-navy-800">Autres informations</h3></div>
        <div class="divide-y divide-gray-100">
          ${grouped[0].map(item => `<div class="p-4"><div class="font-semibold text-sm mb-1">${escapeHtml(item.title)}</div><div class="text-sm text-gray-600 whitespace-pre-wrap">${escapeHtml(item.content || '')}</div></div>`).join('')}
        </div>
      </div>` : ''}
  </div>`;
}

// ============================================
// Helper escapeHtml — au cas où il n'existe pas déjà
// ============================================
if (typeof window.escapeHtml === 'undefined') {
  window.escapeHtml = function(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
  };
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  if (state.token && state.user) {
    state.currentHotelId = state.user.hotel_id;
    // Dashboard réservé au super admin. Admin et employé → procédures par défaut.
    if (state.user.role !== 'super_admin' && state.currentView === 'dashboard') {
      state.currentView = 'procedures';
    }
    // Sync immédiat du profil au démarrage pour récupérer les éventuels
    // changements de droits effectués pendant que l'onglet était fermé
    await syncUserProfile();
    await loadData();
    ensureChatGlobalPolling();
    ensureProfilePolling();
  }
  // Ancrer l'historique sur la vue de départ (sans push, pour éviter une entrée
  // vide qui ferait quitter le site au premier "retour")
  replaceHistory(state.currentView || 'procedures');
  render();
}

init();
