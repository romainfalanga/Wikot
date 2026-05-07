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

