// ============================================
// WIKOT MODULE — 09-client-init
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

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
  // STATELESS : pas d'historique. On crée une conversation fraîche à chaque session.
  const created = await clientApi('/client/wikot/conversations', { method: 'POST' });
  if (created) {
    state.clientWikotCurrentConvId = created.id;
    state.clientWikotMessages = [];
    state.clientWikotConversations = [];
  }
  render();
}

// ============================================
// FRONT WIKOT — rendu (info-cards + reservation-cards)
// ============================================
function renderClientWikot() {
  const messages = state.clientWikotMessages || [];
  return `
  <div class="card-premium flex flex-col" style="height: calc(100vh - 170px); min-height: 400px;">
    <!-- Header compact mobile, version étoffée desktop -->
    <div class="px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between shrink-0" style="border-bottom: 1px solid var(--c-line);">
      <div class="flex items-center gap-2.5 sm:gap-3">
        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy);">
          <i class="fas fa-robot text-sm" style="color: var(--c-gold);"></i>
        </div>
        <div>
          <p class="section-eyebrow hidden sm:block">Concierge digital</p>
          <h2 class="font-display font-semibold text-sm sm:text-base" style="color: var(--c-navy);">Wikot</h2>
        </div>
      </div>
      <button onclick="newClientWikotConversation()" class="text-xs px-3 py-1.5 rounded-lg transition-all" style="color: rgba(15,27,40,0.6); background: var(--c-cream-deep); border: 1px solid var(--c-line);" onmouseover="this.style.color='var(--c-gold-deep)'; this.style.borderColor='var(--c-gold)';" onmouseout="this.style.color='rgba(15,27,40,0.6)'; this.style.borderColor='var(--c-line)';"><i class="fas fa-rotate-right mr-1"></i><span class="hidden sm:inline">Nouvelle</span></button>
    </div>
    <div id="client-wikot-messages" class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 sm:space-y-3" style="background: var(--c-ivory); -webkit-overflow-scrolling: touch;">
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

  // Texte de réponse en HAUT (au-dessus de la carte) — bulle compacte, design cohérent palace
  const replyText = (m.content || '').trim();
  const replyBubble = replyText
    ? `<div class="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed" style="background: #fff; border: 1px solid var(--c-line); color: var(--c-navy); box-shadow: 0 1px 2px rgba(10,22,40,0.04);">${escapeHtml(replyText)}</div>`
    : '';

  if (ref?.kind === 'info_card' && ref.item) {
    const it = ref.item;
    return `
      <div class="flex justify-start">
        <div class="max-w-[90%] w-full space-y-2">
          ${replyBubble}
          <div class="card-premium overflow-hidden" style="border-left: 3px solid var(--c-gold);">
            <div class="px-4 py-2.5 flex items-center gap-2" style="background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
              <i class="fas fa-circle-info" style="color: var(--c-gold-deep);"></i>
              <div class="section-eyebrow">${escapeHtml(it.category || 'Info')}</div>
            </div>
            <div class="px-4 py-3">
              <h4 class="font-display font-semibold mb-1.5" style="color: var(--c-navy);">${escapeHtml(it.title || '')}</h4>
              <div class="text-sm whitespace-pre-wrap" style="color: rgba(15,27,40,0.75);">${escapeHtml(it.content || '')}</div>
            </div>
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
        <div class="max-w-[90%] w-full space-y-2">
          ${replyBubble}
          <div class="card-premium overflow-hidden" style="border-left: 3px solid var(--c-gold);">
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
        </div>
      </div>`;
  }

  if (ref?.kind === 'fallback') {
    return `
      <div class="flex justify-start">
        <div class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm" style="background: rgba(201,169,97,0.10); border: 1px solid rgba(201,169,97,0.25); color: var(--c-navy);">
          <i class="fas fa-info-circle mr-1.5" style="color: var(--c-gold-deep);"></i>${escapeHtml(ref.message || '')}
        </div>
      </div>`;
  }

  // Compat ancien format (texte libre legacy) — réponse simple sans carte structurée
  return `
    <div class="flex justify-start">
      <div class="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed" style="background: #fff; border: 1px solid var(--c-line); color: var(--c-navy); box-shadow: 0 1px 2px rgba(10,22,40,0.04);">${escapeHtml(m.content || '')}</div>
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
