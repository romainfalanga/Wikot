// ============================================
// WIKOT MODULE — 06-wikot
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

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

// STATELESS : on ne charge plus de liste de conversations.
// loadWikotConversations devient un no-op (gardé pour compat avec d'éventuels appels résiduels).
async function loadWikotConversations(mode) { /* stateless */ }
async function loadWikotConversation() { /* stateless — pas d'historique à recharger */ }

// "Nouvelle conversation" = on crée une conv côté serveur (juste un conteneur)
// et on remet à zéro l'état local. Plus de re-fetch de liste.
async function newWikotConversation(mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  const data = await api('/wikot/conversations', {
    method: 'POST',
    body: JSON.stringify({ mode })
  });
  if (!data) return;
  s.currentConvId = data.id;
  s.messages = [];
  s.actions = [];
  render();
  setTimeout(() => {
    const input = document.getElementById(mode === 'max' ? 'wikot-max-input' : 'wikot-input');
    if (input) input.focus();
  }, 100);
}

// Reset éphémère du chat (bouton "Effacer") — pas de DELETE serveur, juste on oublie le state local.
function resetWikotChat(mode) {
  mode = mode || activeWikotMode();
  const s = wikotState(mode);
  s.currentConvId = null;
  s.messages = [];
  s.actions = [];
  render();
}

// Compat : on garde une stub qui fait juste un reset local (au cas où un onclick résiduel l'appelle).
async function deleteWikotConversation(convId, ev, mode) {
  if (ev) ev.stopPropagation();
  resetWikotChat(mode);
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

  // Wikot peut renvoyer plusieurs blocs ; on stocke answer_cards (array) + answer_card (rétro-compat)
  const cardsFromServer = Array.isArray(result.assistant_message.answer_cards) && result.assistant_message.answer_cards.length > 0
    ? result.assistant_message.answer_cards
    : (result.assistant_message.answer_card ? [result.assistant_message.answer_card] : []);
  s.messages.push({
    id: result.assistant_message.id,
    role: 'assistant',
    content: result.assistant_message.content,
    references: result.assistant_message.references || [],
    answer_cards: cardsFromServer,
    answer_card: cardsFromServer[0] || null
  });

  if (result.actions && result.actions.length > 0) {
    s.actions.push(...result.actions);
  }

  // Mode max : appliquer les form_updates renvoyés par l'IA au formulaire visible
  if (mode === 'max' && Array.isArray(result.form_updates) && result.form_updates.length > 0) {
    applyBackWikotFormUpdates(result.form_updates);
  }

  // STATELESS : pas de re-fetch de liste de conversations.
  render();
  // UX messagerie : on positionne le dernier message user EN HAUT du viewport
  // pour que l'utilisateur voie sa question + la réponse Wikot juste en dessous,
  // au lieu d'être collé tout en bas du conteneur.
  scrollWikotToLastUserMessage(mode);

  // Mode max : Back Wikot peut décider de revenir au menu root pour changer de domaine.
  // Si le backend renvoie return_to_root, on relaie le message au routeur orchestrateur.
  if (mode === 'max' && result && result.return_to_root && result.return_to_root.forwarded_message) {
    handleBackWikotReturnToRoot(result.return_to_root);
  }
}

// ============================================
// BACK WIKOT ROOT — Conversation directe avec l'orchestrateur (écran d'accueil)
// ============================================
// L'utilisateur écrit directement à Back Wikot depuis l'écran d'accueil.
// Le backend /api/wikot/router décide :
//   - action='respond' → on affiche la réponse texte
//   - action='enter_workflow' → on entre dans le sous-workflow + on auto-envoie l'opening_message
async function sendBackWikotRootMessage(forwardedText) {
  // Si pas de texte forwardé (utilisation directe depuis input), on lit l'input.
  let content = '';
  if (typeof forwardedText === 'string' && forwardedText.trim()) {
    content = forwardedText.trim();
  } else {
    const input = document.getElementById('back-wikot-root-input');
    if (!input) return;
    content = (input.value || '').trim();
    if (!content) return;
    input.value = '';
    autoResizeTextarea(input);
  }
  if (state.backWikotRootSending) return;

  // Init
  if (!Array.isArray(state.backWikotRootMessages)) state.backWikotRootMessages = [];
  state.backWikotRootMessages.push({ role: 'user', content, ts: Date.now() });
  state.backWikotRootSending = true;
  render();
  scrollBackWikotRootToBottom();

  let data;
  try {
    data = await api('/wikot/router', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
  } catch (e) {
    data = null;
  }

  state.backWikotRootSending = false;

  if (!data) {
    state.backWikotRootMessages.push({
      role: 'assistant',
      content: "Désolé, je rencontre un souci pour répondre. Réessaye dans un instant ?",
      ts: Date.now()
    });
    render();
    scrollBackWikotRootToBottom();
    return;
  }

  // Action 1 : réponse directe
  if (data.action === 'respond') {
    state.backWikotRootMessages.push({
      role: 'assistant',
      content: data.reply_text || '…',
      ts: Date.now()
    });
    render();
    scrollBackWikotRootToBottom();
    return;
  }

  // Action 2 : entrer dans un sous-workflow
  if (data.action === 'enter_workflow' && data.workflow) {
    // Garder une trace dans la conv root (transparent pour l'utilisateur)
    state.backWikotRootMessages.push({
      role: 'assistant',
      content: data.opening_message || `J'ouvre l'atelier pour faire ça.`,
      ts: Date.now(),
      _enteredWorkflow: data.workflow
    });
    render();
    // Message original à transmettre au sous-agent (utilise le forwarded_message si fourni,
    // sinon le contenu utilisateur original — c'est lui qui contient l'intention détaillée).
    const pending = (data.forwarded_message && String(data.forwarded_message).trim()) || content;
    state.backWikotPendingMessage = pending;
    // On entre dans le workflow → page hub (select-target) avec la liste à choisir
    await enterBackWikotWorkflow(data.workflow);
    return;
  }

  // Cas non géré : fallback
  state.backWikotRootMessages.push({
    role: 'assistant',
    content: "Je n'ai pas bien compris, peux-tu reformuler ?",
    ts: Date.now()
  });
  render();
  scrollBackWikotRootToBottom();
}

// Quand un sous-agent (max) appelle return_to_root, on revient au home + on relance le routeur.
async function handleBackWikotReturnToRoot(payload) {
  // 1) Retour au home Back Wikot
  state.backWikotStep = 'home';
  state.backWikotWorkflowMode = null;
  state.backWikotTargetKind = null;
  state.backWikotTargetId = null;
  state.backWikotForm = null;
  state.backWikotFormDirty = false;
  // Reset chat max (sous-agent fermé)
  state.wikotMaxCurrentConvId = null;
  state.wikotMaxMessages = [];
  state.wikotMaxActions = [];

  // 2) On ajoute une bulle système discrète dans la conv root pour expliquer
  if (!Array.isArray(state.backWikotRootMessages)) state.backWikotRootMessages = [];
  if (payload.reason) {
    state.backWikotRootMessages.push({
      role: 'assistant',
      content: `Je change de domaine pour mieux te répondre.`,
      ts: Date.now(),
      _system: true
    });
  }
  render();

  // 3) On rejoue le routeur avec le message forwardé
  await sendBackWikotRootMessage(payload.forwarded_message);
}

function scrollBackWikotRootToBottom() {
  setTimeout(() => {
    const zone = document.getElementById('back-wikot-root-messages');
    if (zone) zone.scrollTop = zone.scrollHeight;
  }, 50);
}

// Reset de la conversation root (bouton "Effacer")
function resetBackWikotRootChat() {
  state.backWikotRootMessages = [];
  state.backWikotRootSending = false;
  render();
}

// Capture Enter pour envoyer (Shift+Enter = nouvelle ligne)
function handleBackWikotRootInputKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendBackWikotRootMessage();
  }
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

// Scroll "messagerie" : place le dernier message utilisateur en HAUT du viewport.
// L'utilisateur voit ainsi sa question + la réponse Wikot juste en dessous,
// comme dans une vraie application de messagerie (au lieu d'être collé tout en bas).
function scrollWikotToLastUserMessage(mode) {
  mode = mode || activeWikotMode();
  const containerId = mode === 'max' ? 'wikot-max-messages' : 'wikot-messages';
  const s = wikotState(mode);
  // Trouver le dernier message user
  const messages = (s && s.messages) || [];
  let lastUserId = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserId = messages[i].id; break; }
  }
  if (!lastUserId) {
    scrollWikotToBottom(mode);
    return;
  }
  setTimeout(() => {
    const container = document.getElementById(containerId);
    const target = document.getElementById('wikot-msg-' + lastUserId);
    if (!container || !target) {
      // Fallback : si on n'a pas trouvé le message dans le DOM, on scrolle au bas
      if (container) container.scrollTop = container.scrollHeight;
      return;
    }
    // Position relative du message dans le conteneur scrollable
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offsetWithinContainer = (targetRect.top - containerRect.top) + container.scrollTop;
    // On place le message à ~12px du haut du conteneur (petit padding visuel)
    const desiredScrollTop = Math.max(0, offsetWithinContainer - 12);
    container.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
  }, 60);
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
    // id DOM sur la bulle user pour permettre le scroll-to-top après la réponse Wikot
    return `
      <div id="wikot-msg-${escapeHtml(String(msg.id))}" class="flex justify-end mb-4">
        <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap" style="background: var(--c-navy); color: #fff; box-shadow: 0 1px 2px rgba(10,22,40,0.08);">
          ${txt}
          ${audioBlock}
        </div>
      </div>
    `;
  }
  // Assistant
  const refs = msg.references || [];
  // Multi-blocs : on supporte answer_cards (nouveau) avec fallback answer_card (rétro-compat)
  const answerCards = Array.isArray(msg.answer_cards) && msg.answer_cards.length > 0
    ? msg.answer_cards
    : (msg.answer_card ? [msg.answer_card] : []);
  const actionsArr = mode === 'max' ? (state.wikotMaxActions || []) : (state.wikotActions || []);
  const actionsForMsg = actionsArr.filter(a => a.message_id === msg.id);
  const cfg = WIKOT_MODE_CONFIG[mode] || WIKOT_MODE_CONFIG.standard;

  // MODE STANDARD (Wikot) — bulle texte courte (reply_text) + 0..N cartes
  // Garanties anti-bulle-vide :
  //   1. Si reply_text + cartes utiles → on affiche les deux
  //   2. Si reply_text seul → on affiche le texte
  //   3. Si cartes utiles seules → on affiche les cartes (rare, fallback de transition)
  //   4. Si RIEN → on affiche un message par défaut pour ne jamais avoir de bulle vide
  if (mode === 'standard') {
    const replyText = (msg.content || '').trim();
    // Cartes "visibles" : on filtre les none (texte fait le job) tout en gardant tout le reste
    const visibleCards = answerCards.filter(c => c && c.kind && c.kind !== 'none');
    const hasReply = replyText.length > 0;
    const hasVisibleCards = visibleCards.length > 0;

    // Construction du contenu visible
    let bubbleHtml = '';
    if (hasReply) {
      bubbleHtml = `
        <div class="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed" style="background: #fff; border: 1px solid var(--c-line); box-shadow: 0 1px 2px rgba(10,22,40,0.04); color: var(--c-navy);">
          ${formatWikotContent(replyText)}
        </div>
      `;
    } else if (!hasVisibleCards) {
      // Filet ultime côté front : aucune donnée → on affiche un message lisible
      bubbleHtml = `
        <div class="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed" style="background: #fff; border: 1px solid var(--c-line); box-shadow: 0 1px 2px rgba(10,22,40,0.04); color: var(--c-navy);">
          Je n'ai pas trouvé de réponse précise. Peux-tu reformuler ta question ?
        </div>
      `;
    }

    const cardsHtml = hasVisibleCards
      ? visibleCards.map(c => renderWikotAnswerCard(c)).join('')
      : '';

    return `
      <div class="flex justify-start mb-4">
        <div class="flex gap-2 max-w-[95%] sm:max-w-[85%] w-full">
          <div class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs" style="background: var(--c-navy); color: var(--c-gold);">
            <i class="fas ${cfg.icon}"></i>
          </div>
          <div class="flex-1 min-w-0 space-y-2">
            ${bubbleHtml}
            ${cardsHtml}
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
    // Bloc 4 : not_found typé. Si le serveur a fourni title/subtitle, on les utilise (carte spécifique
    // au type de bloc disparu : message supprimé, tâche introuvable, etc.). Sinon, fallback générique.
    const title = (card && card.title) || "Aucune information ni procédure ne correspond à ta demande.";
    const subtitle = (card && card.subtitle) || "Essaie de reformuler ta question, ou contacte un responsable si le sujet n'est pas encore documenté.";
    const icon = (card && card.requested_type === 'chat_message') ? 'fa-comment-slash'
               : (card && card.requested_type === 'task') ? 'fa-square-xmark'
               : (card && (card.requested_type === 'procedure' || card.requested_type === 'procedure_step')) ? 'fa-sitemap'
               : (card && (card.requested_type === 'info_item' || card.requested_type === 'info_category')) ? 'fa-circle-info'
               : 'fa-circle-question';
    return `
      <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl px-4 py-5 text-center">
        <i class="fas ${icon} text-3xl text-gray-400 mb-2"></i>
        <p class="text-sm font-semibold text-navy-700">${escapeHtml(title)}</p>
        <p class="text-xs text-navy-500 mt-1.5">${escapeHtml(subtitle)}</p>
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

  // Carte d'UN message de chat : on cite tel quel (Wikot ne reformule pas)
  if (card.kind === 'chat_message') {
    const groupColor = card.group_color || '#4F46E5';
    const authorInitial = (card.author_name || '?').trim().charAt(0).toUpperCase();
    // Formatage date message (best-effort, fallback brut)
    let when = card.created_at || '';
    try {
      const d = new Date(card.created_at);
      if (!isNaN(d.getTime())) {
        const today = new Date(); today.setHours(0,0,0,0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const dDay = new Date(d); dDay.setHours(0,0,0,0);
        const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (dDay.getTime() === today.getTime()) when = `Aujourd'hui à ${hm}`;
        else if (dDay.getTime() === yesterday.getTime()) when = `Hier à ${hm}`;
        else when = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ` à ${hm}`;
      }
    } catch (_) {}
    return `
      <div class="bg-white border-2 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden" style="border-color:${groupColor}40">
        <div class="px-4 py-2.5 text-white flex items-center gap-2" style="background:${groupColor}">
          <i class="fas fa-comment-dots text-sm"></i>
          <span class="text-xs font-semibold uppercase tracking-wide">Message</span>
          <span class="ml-auto text-[10px] bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <i class="fas ${card.group_icon || 'fa-comments'} text-[9px]"></i>
            ${escapeHtml(card.group_name || '')} · #${escapeHtml(card.channel_name || '')}
          </span>
        </div>
        <div class="px-4 py-3">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-9 h-9 rounded-full text-white text-sm font-bold flex items-center justify-center" style="background:${groupColor}">${escapeHtml(authorInitial)}</div>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-semibold text-navy-900 text-sm">${escapeHtml(card.author_name || 'Auteur inconnu')}</span>
                <span class="text-[11px] text-navy-500">${escapeHtml(when || '')}</span>
              </div>
              <div class="text-sm text-navy-700 mt-1 whitespace-pre-wrap break-words leading-relaxed">${formatWikotContent(card.content || '')}</div>
            </div>
          </div>
          <button onclick="openWikotChatMessage(${card.channel_id}, ${card.id})" class="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style="background:${groupColor}15;color:${groupColor}">
            <i class="fas fa-arrow-up-right-from-square"></i>
            Voir dans la conversation
          </button>
        </div>
      </div>
    `;
  }

  // Carte d'UNE tâche (template récurrent ou instance ponctuelle)
  if (card.kind === 'task') {
    const isTemplate = card.task_kind === 'template';
    const priorityColor = { urgent: '#DC2626', high: '#F59E0B', normal: '#3B82F6', low: '#6B7280' }[card.priority] || '#3B82F6';
    const statusBadge = (() => {
      if (isTemplate) return `<span class="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">Récurrente</span>`;
      if (card.status === 'done') return `<span class="text-[10px] bg-green-500 px-2 py-0.5 rounded-full"><i class="fas fa-check mr-1"></i>Faite</span>`;
      return `<span class="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">À faire</span>`;
    })();
    const assignees = Array.isArray(card.assignees) ? card.assignees : [];
    const dateLine = !isTemplate && card.task_date
      ? `<div class="text-xs text-navy-600 flex items-center gap-1.5"><i class="fas fa-calendar text-amber-500"></i><span>${escapeHtml(card.task_date)}${card.suggested_time ? ` · ${escapeHtml(card.suggested_time)}` : ''}</span></div>`
      : (card.suggested_time ? `<div class="text-xs text-navy-600 flex items-center gap-1.5"><i class="fas fa-clock text-amber-500"></i><span>${escapeHtml(card.suggested_time)}</span></div>` : '');
    return `
      <div class="bg-white border-2 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden" style="border-color:${priorityColor}40">
        <div class="px-4 py-2.5 text-white flex items-center gap-2" style="background:${priorityColor}">
          <i class="fas ${isTemplate ? 'fa-repeat' : 'fa-list-check'} text-sm"></i>
          <span class="text-xs font-semibold uppercase tracking-wide">Tâche</span>
          ${statusBadge}
        </div>
        <div class="px-4 py-3 space-y-2">
          <h3 class="font-bold text-navy-900 text-base leading-tight">${escapeHtml(card.title || '')}</h3>
          ${dateLine}
          ${card.description ? `<div class="text-sm text-navy-700 whitespace-pre-wrap break-words leading-relaxed">${formatWikotContent(card.description)}</div>` : ''}
          ${assignees.length > 0 ? `
            <div class="flex items-center gap-2 flex-wrap pt-1">
              <span class="text-[11px] text-navy-500 uppercase tracking-wide font-semibold">Attribuée à</span>
              ${assignees.map(a => `<span class="text-xs px-2 py-0.5 rounded-full" style="background:${priorityColor}15;color:${priorityColor}"><i class="fas fa-user mr-1"></i>${escapeHtml(a.name || '')}</span>`).join('')}
            </div>
          ` : (!isTemplate ? `<p class="text-[11px] text-navy-400 italic">Tâche non attribuée</p>` : '')}
        </div>
      </div>
    `;
  }

  // Cas "none" : rien à afficher (par exemple "bonjour" ou demande hors-sujet) → on n'affiche RIEN
  if (card.kind === 'none') {
    return '';
  }

  // Type inconnu : fallback not_found
  return renderWikotAnswerCard({ kind: 'not_found' });
}

// Ouvrir un message de chat depuis une carte Wikot : navigation directe + scroll/highlight
async function openWikotChatMessage(channelId, messageId) {
  try {
    // Aller dans la vue chat (si on n'y est pas déjà)
    if (state.currentView !== 'chat') {
      state.currentView = 'chat';
    }
    if (typeof openChannel === 'function') {
      await openChannel(channelId);
    } else {
      state.selectedChannelId = channelId;
      render();
    }
    setTimeout(() => {
      const el = document.getElementById('chat-msg-' + messageId)
        || document.querySelector(`[data-message-id="${messageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-brand-400', 'shadow-md');
        setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400', 'shadow-md'), 2500);
      }
    }, 400);
  } catch (e) {
    console.warn('openWikotChatMessage', e);
  }
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
    emptyText: "Je connais toutes les procédures, informations, conversations et tâches de l'hôtel. Pose-moi une question — je cherche dans les quatre univers et je te renvoie directement la ou les cartes qui répondent.",
    quickButtons: [
      { label: 'Comment faire un check-in ?', q: 'Comment je fais un check-in ?' },
      { label: 'Horaires de la piscine ?', q: 'Quelles sont les horaires de la piscine ?' },
      { label: 'Ma prochaine tâche ?', q: 'Quelle est ma prochaine tâche à réaliser ?' },
      { label: 'Dernier message qui m\'est destiné ?', q: 'Quel est le dernier message qui m\'a été destiné ?' }
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
// REFONTE : 4 workflows unifiés "Gérer X". Chacun ouvre une page hub (select-target)
// avec un bouton "+ Créer" en haut + la liste des éléments existants (clic = éditer).
// Le workshop reçoit un subMode 'create' ou 'update' qui adapte le titre + le save.
const BACK_WIKOT_WORKFLOWS = {
  gerer_procedures: {
    label: 'Gérer les procédures',
    icon: 'fa-sitemap',
    color: 'orange',
    targetKind: 'procedure',
    permissionKey: 'can_edit_procedures',
    description: 'Crée, modifie ou supprime tes procédures avec Back Wikot.',
    createLabel: 'Créer une procédure'
  },
  gerer_infos: {
    label: 'Gérer les informations',
    icon: 'fa-circle-info',
    color: 'amber',
    targetKind: 'info_item',
    permissionKey: 'can_edit_info',
    description: "Crée, modifie ou supprime tes fiches d'information.",
    createLabel: 'Créer une information'
  },
  gerer_conversations: {
    label: 'Gérer les conversations',
    icon: 'fa-comments',
    color: 'sky',
    targetKind: 'chat_tree',
    permissionKey: null,
    description: "Crée, renomme, déplace ou supprime tes groupes et salons avec Back Wikot.",
    createLabel: 'Créer un groupe ou un salon'
  },
  gerer_taches: {
    label: 'Gérer les tâches',
    icon: 'fa-list-check',
    color: 'emerald',
    targetKind: 'task',
    permissionKey: null,
    description: "Crée, modifie ou supprime tâches récurrentes et tâches du jour.",
    createLabel: 'Créer une tâche'
  }
};

function userCanRunBackWikotWorkflow(workflowMode) {
  const wf = BACK_WIKOT_WORKFLOWS[workflowMode];
  if (!wf) return false;
  if (!state.user) return false;
  // Workflow réservé strictement à l'admin de l'hôtel (ex: Codes Wikot)
  if (wf.permissionKey === 'admin_only') {
    return state.user.role === 'admin' || state.user.role === 'super_admin';
  }
  // Admin / super_admin : accès à tous les workflows non restreints
  if (state.user.role === 'admin' || state.user.role === 'super_admin') return true;
  // Workflow ouvert à tous (pas de permission spécifique requise)
  if (!wf.permissionKey) return true;
  // Sinon : on vérifie le flag de permission précis
  return state.user[wf.permissionKey] === 1;
}

// Form vide selon le workflow (utilisé pour le mode "Créer" — formulaire vierge)
function emptyBackWikotForm(workflowMode) {
  if (workflowMode === 'gerer_procedures') {
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
  if (workflowMode === 'gerer_infos') {
    return {
      kind: 'info_item',
      id: null,
      title: '',
      content: '',
      category_id: null
    };
  }
  if (workflowMode === 'gerer_conversations') {
    // Arborescence : groupes + salons. Back Wikot mute live (pas de batch).
    return {
      kind: 'chat_tree',
      groups: [],          // [{ id, name, icon, is_system, channels: [{id,name,description,icon,group_id}] }]
      lastAction: null     // { type, label, ts } pour feedback visuel
    };
  }
  if (workflowMode === 'gerer_taches') {
    return {
      kind: 'task',
      id: null,
      task_kind: 'template', // 'template' | 'instance'
      mode: 'oneoff',         // 'oneoff' | 'recurring'
      title: '',
      description: '',
      category: '',
      priority: 'normal',     // 'low' | 'normal' | 'high'
      recurrence_type: null,  // 'daily' | 'weekly' | 'monthly'
      recurrence_days: 0,     // bitmap (1=Lun, 2=Mar, 4=Mer, 8=Jeu, 16=Ven, 32=Sam, 64=Dim)
      monthly_day: null,      // 1..31
      suggested_time: '',     // 'HH:MM'
      duration_min: null,
      active_from: null,      // 'YYYY-MM-DD'
      active_to: null,        // 'YYYY-MM-DD'
      assignee_ids: []
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
// On merge chaque patch dans state.backWikotForm et on tracke les champs touchés
// pour le feedback visuel (highlight flash 1.5s).
function applyBackWikotFormUpdates(updates) {
  if (!state.backWikotForm) return;
  const f = state.backWikotForm;
  const touchedFields = new Set();

  // Définir les champs autorisés selon le type de form (sécurité côté UI aussi)
  let allowedKeys;
  if (f.kind === 'procedure') {
    allowedKeys = ['title', 'trigger_event', 'description', 'category_id', 'steps'];
  } else if (f.kind === 'info_item') {
    allowedKeys = ['title', 'content', 'category_id'];
  } else if (f.kind === 'chat_tree') {
    allowedKeys = ['groups', 'lastAction'];
  } else if (f.kind === 'task') {
    allowedKeys = ['id','task_kind','mode','title','description','category','priority',
                   'recurrence_type','recurrence_days','monthly_day','suggested_time',
                   'duration_min','active_from','active_to','assignee_ids'];
  } else {
    allowedKeys = [];
  }

  for (const patch of updates) {
    if (!patch || typeof patch !== 'object') continue;
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.includes(key)) continue;
      const value = patch[key];
      if (f.kind === 'procedure' && key === 'steps' && Array.isArray(value)) {
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

// Démarre un workflow Back Wikot : vérifie permissions + précharge la liste pour la page hub.
// REFONTE : TOUS les workflows passent par select-target (= page hub avec bouton "+ Créer" + liste).
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
  state.backWikotSubMode = null; // 'create' | 'update' — défini quand on entre dans le workshop

  state.backWikotStep = 'select-target';
  if (workflowMode === 'gerer_procedures') {
    await loadBackWikotProcedures();
  } else if (workflowMode === 'gerer_infos') {
    await loadBackWikotInfo();
  } else if (workflowMode === 'gerer_conversations') {
    await loadBackWikotChatTreeForHub();
  } else if (workflowMode === 'gerer_taches') {
    await loadBackWikotTasksForHub();
  }
  render();
}

// Démarre le mode "Créer" depuis la page hub : form vierge → workshop direct.
async function startBackWikotCreate() {
  const wfMode = state.backWikotWorkflowMode;
  if (!wfMode) return;
  state.backWikotSubMode = 'create';
  state.backWikotForm = emptyBackWikotForm(wfMode);
  state.backWikotTargetId = null;
  state.backWikotFormDirty = false;
  // Cas conversations : on précharge l'arborescence dans le form
  if (wfMode === 'gerer_conversations') {
    await preloadBackWikotChatTree();
  }
  await openBackWikotWorkshop();
}

// Préchargement de l'arborescence chat dans le formState
async function preloadBackWikotChatTree() {
  const data = await api('/chat/groups');
  if (!data || !state.backWikotForm) return;
  state.backWikotForm.groups = (data.groups || []).map(g => ({
    id: g.id,
    name: g.name,
    icon: g.icon || 'fa-folder',
    is_system: g.is_system === 1 || g.is_system === true,
    channels: (g.channels || []).map(c => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      icon: c.icon || 'fa-comment',
      group_id: g.id
    }))
  }));
}

// (suppressed) openBackWikotChatOnly — remplacé par le pattern workshop unifié.

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
  state.backWikotSubMode = 'update';
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
  state.backWikotSubMode = 'update';
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

// L'utilisateur a choisi une tâche à modifier (template ou instance)
async function selectBackWikotTaskTarget(taskKind, taskId) {
  // taskKind = 'template' | 'instance'
  if (!taskId || (taskKind !== 'template' && taskKind !== 'instance')) return;
  state.backWikotTargetId = taskId;
  state.backWikotSubMode = 'update';

  // Charger le détail de la tâche
  let task = null;
  if (taskKind === 'template') {
    const cache = state.backWikotTasksCache || { templates: [], instances: [] };
    task = (cache.templates || []).find(t => t.id === taskId);
  } else {
    const cache = state.backWikotTasksCache || { templates: [], instances: [] };
    task = (cache.instances || []).find(t => t.id === taskId);
  }
  if (!task) {
    showToast('Tâche introuvable.', 'error');
    return;
  }

  state.backWikotForm = {
    kind: 'task',
    id: taskId,
    task_kind: taskKind,
    mode: taskKind === 'template' ? 'recurring' : 'oneoff',
    title: task.title || '',
    description: task.description || '',
    category: task.category || '',
    priority: task.priority || 'normal',
    recurrence_type: taskKind === 'template' ? (task.recurrence_type || null) : null,
    recurrence_days: taskKind === 'template' ? (task.recurrence_days || 0) : 0,
    monthly_day: taskKind === 'template' ? (task.monthly_day || null) : null,
    suggested_time: task.suggested_time || '',
    duration_min: task.duration_min || null,
    active_from: taskKind === 'template' ? (task.active_from || null) : null,
    active_to: taskKind === 'template' ? (task.active_to || null) : null,
    task_date: taskKind === 'instance' ? (task.task_date || null) : null,
    assignee_ids: Array.isArray(task.assignee_ids) ? task.assignee_ids : []
  };
  state.backWikotFormDirty = false;
  await openBackWikotWorkshop();
}

// L'utilisateur a cliqué sur "Ouvrir l'atelier conversations" depuis la page hub
async function openBackWikotConversationsWorkshop() {
  state.backWikotSubMode = 'update'; // mutations live, on est en mode "gestion"
  state.backWikotForm = emptyBackWikotForm('gerer_conversations');
  await preloadBackWikotChatTree();
  await openBackWikotWorkshop();
}

// Loader hub pour conversations : remplit state.backWikotChatTreeCache pour l'aperçu lecture seule
async function loadBackWikotChatTreeForHub() {
  const data = await api('/chat/groups');
  if (!data) return;
  state.backWikotChatTreeCache = (data.groups || []).map(g => ({
    id: g.id,
    name: g.name,
    icon: g.icon || 'fa-folder',
    is_system: g.is_system === 1 || g.is_system === true,
    channels: (g.channels || []).map(c => ({
      id: c.id, name: c.name,
      description: c.description || '', icon: c.icon || 'fa-comment',
      group_id: g.id
    }))
  }));
}

// Loader hub pour tâches : récupère templates + instances du jour pour la page de sélection
async function loadBackWikotTasksForHub() {
  const today = new Date().toISOString().slice(0, 10);
  const [tplData, todayData] = await Promise.all([
    api('/tasks/templates'),
    api(`/tasks?date=${today}`)
  ]);
  state.backWikotTasksCache = {
    templates: (tplData && tplData.templates) || [],
    instances: (todayData && todayData.instances) || [],
    assignments: (todayData && todayData.assignments) || [],
    staff: (todayData && todayData.staff) || [],
    today
  };
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
  // STATELESS : pas de re-fetch d'historique
  state.backWikotStep = 'workshop';
  render();
  setTimeout(() => {
    const input = document.getElementById('wikot-max-input');
    if (input) input.focus();
  }, 120);

  // Si l'orchestrateur (router) a déposé un message en attente, on l'auto-envoie
  // au sous-agent pour démarrer la conversation avec l'intention de l'utilisateur.
  if (state.backWikotPendingMessage) {
    const pendingMsg = state.backWikotPendingMessage;
    state.backWikotPendingMessage = null;
    setTimeout(() => {
      const input = document.getElementById('wikot-max-input');
      if (input) {
        input.value = pendingMsg;
        sendWikotMessage('max');
      }
    }, 180);
  }
}

// Reprendre une conversation depuis l'historique : on récupère son contexte (workflow_mode, target)
async function resumeBackWikotConversation(convId) {
  const data = await api(`/wikot/conversations/${convId}`);
  if (!data) return;
  const conv = data.conversation || {};
  let wfMode = conv.workflow_mode;
  // Backward-compat : remap des anciens noms de workflow (refonte 7→4)
  const LEGACY_WORKFLOW_REMAP = {
    create_procedure: 'gerer_procedures',
    update_procedure: 'gerer_procedures',
    create_info: 'gerer_infos',
    update_info: 'gerer_infos',
    chercher_conversations: 'gerer_conversations'
  };
  if (wfMode && LEGACY_WORKFLOW_REMAP[wfMode]) {
    wfMode = LEGACY_WORKFLOW_REMAP[wfMode];
  }
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

// Sauvegarde finale : route par kind du formulaire
async function saveBackWikotForm() {
  if (!state.backWikotForm) return;
  if (state.backWikotSaving) return;
  const f = state.backWikotForm;
  const isUpdate = !!f.id;

  // ====== Procédures ======
  if (f.kind === 'procedure') {
    if (!f.title || !f.title.trim()) {
      showToast('Le titre est obligatoire.', 'error');
      return;
    }
    if (!f.trigger_event || !f.trigger_event.trim()) {
      showToast('Le déclencheur (trigger_event) est obligatoire.', 'error');
      return;
    }
    if (!f.steps || f.steps.length === 0) {
      showToast('Ajoute au moins une étape.', 'error');
      return;
    }

    state.backWikotSaving = true;
    render();

    let result = null;
    try {
      const payload = {
        title: f.title, trigger_event: f.trigger_event, description: f.description || null,
        category_id: f.category_id || null,
        steps: (f.steps || []).map((s, i) => ({
          step_number: i + 1, title: s.title, content: s.content || null,
          linked_procedure_id: s.linked_procedure_id || null
        }))
      };
      if (isUpdate) {
        result = await api(`/procedures/${f.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        result = await api('/procedures', { method: 'POST', body: JSON.stringify(payload) });
      }
    } finally {
      state.backWikotSaving = false;
    }

    if (!result) { render(); return; }
    showToast(isUpdate ? 'Procédure modifiée.' : 'Procédure créée.', 'success');
    state.backWikotFormDirty = false;
    await loadData();
    backToBackWikotHome();
    return;
  }

  // ====== Informations ======
  if (f.kind === 'info_item') {
    if (!f.title || !f.title.trim()) {
      showToast('Le titre est obligatoire.', 'error');
      return;
    }
    if (!f.content || !f.content.trim()) {
      showToast('Le contenu de l\'information est obligatoire.', 'error');
      return;
    }

    state.backWikotSaving = true;
    render();

    let result = null;
    try {
      const payload = { title: f.title, content: f.content, category_id: f.category_id || null };
      if (isUpdate) {
        result = await api(`/hotel-info/items/${f.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        result = await api('/hotel-info/items', { method: 'POST', body: JSON.stringify(payload) });
      }
    } finally {
      state.backWikotSaving = false;
    }

    if (!result) { render(); return; }
    showToast(isUpdate ? 'Information modifiée.' : 'Information créée.', 'success');
    state.backWikotFormDirty = false;
    await loadData();
    backToBackWikotHome();
    return;
  }

  // ====== Conversations (gérer) — mutations déjà faites en live, on refresh + ferme ======
  if (f.kind === 'chat_tree') {
    state.backWikotSaving = true; render();
    try {
      // Recharger l'arborescence dans state.chatGroups pour la page Discussion
      const data = await api('/chat/groups');
      if (data) state.chatGroups = data.groups || [];
    } finally {
      state.backWikotSaving = false;
    }
    showToast('Salons et channels à jour.', 'success');
    state.backWikotFormDirty = false;
    backToBackWikotHome();
    return;
  }

  // ====== Tâches — POST/PUT selon présence d'id et task_kind ======
  if (f.kind === 'task') {
    if (!f.title || !f.title.trim()) {
      showToast('Le titre est obligatoire.', 'error');
      return;
    }
    if (f.mode === 'recurring' && !f.recurrence_type) {
      showToast('Choisis un type de récurrence (quotidienne / hebdo / mensuelle).', 'error');
      return;
    }

    state.backWikotSaving = true;
    render();

    let result = null;
    try {
      const isInstance = f.task_kind === 'instance';
      const baseUrl = isInstance ? '/tasks/instances' : '/tasks/templates';
      const payload = {
        title: f.title,
        description: f.description || null,
        category: f.category || null,
        priority: f.priority || 'normal',
        mode: f.mode || 'oneoff',
        recurrence_type: f.mode === 'recurring' ? (f.recurrence_type || null) : null,
        recurrence_days: f.mode === 'recurring' ? (f.recurrence_days || 0) : 0,
        monthly_day: f.mode === 'recurring' && f.recurrence_type === 'monthly' ? (f.monthly_day || null) : null,
        suggested_time: f.suggested_time || null,
        duration_min: f.duration_min || null,
        active_from: f.mode === 'recurring' ? (f.active_from || null) : null,
        active_to: f.mode === 'recurring' ? (f.active_to || null) : null,
        assignee_ids: Array.isArray(f.assignee_ids) ? f.assignee_ids : []
      };

      if (f.id) {
        result = await api(`${baseUrl}/${f.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        result = await api(baseUrl, { method: 'POST', body: JSON.stringify(payload) });
      }
    } finally {
      state.backWikotSaving = false;
    }

    if (!result) { render(); return; }
    showToast(f.id ? 'Tâche modifiée.' : 'Tâche créée.', 'success');
    state.backWikotFormDirty = false;
    backToBackWikotHome();
    return;
  }

  // Kind inconnu
  showToast('Type de formulaire inconnu.', 'error');
}

function renderWikotView(mode) {
  mode = mode || activeWikotMode();

  // Mode max → router vers le workflow atelier (home / select-target / workshop)
  if (mode === 'max') {
    return renderBackWikotView();
  }

  const cfg = WIKOT_MODE_CONFIG[mode];
  const s = wikotState(mode);

  // STATELESS : pas d'historique des conversations.
  // Chaque session est éphémère ; on initialise simplement les messages en mémoire.
  if (!s.messages) s.messages = [];
  if (!s.actions) s.actions = [];

  const messages = s.messages || [];
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
  <div class="fade-in flex flex-col" style="height: calc(100vh - 7rem); max-height: calc(100vh - 7rem);">
    <!-- Header Wikot premium DESKTOP UNIQUEMENT (le titre est déjà dans la barre mobile globale) -->
    <div class="hidden lg:flex items-center justify-between mb-4 shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy); color: var(--c-gold);">
          <i class="fas ${cfg.icon}"></i>
        </div>
        <div class="min-w-0">
          <h1 class="font-display text-xl sm:text-2xl font-semibold truncate" style="color: var(--c-navy);">${cfg.title}</h1>
          <p class="text-xs truncate uppercase tracking-wider" style="color: var(--c-gold-deep);">${cfg.subtitle}</p>
        </div>
      </div>
    </div>

    <!-- Layout chat sans sidebar (stateless) -->
    <div class="flex-1 flex gap-4 min-h-0 overflow-hidden">
      <!-- Zone chat principale premium -->
      <div class="flex-1 flex flex-col rounded-xl overflow-hidden min-w-0" style="background: #fff; border: 1px solid var(--c-line); box-shadow: 0 2px 4px rgba(10,22,40,0.05), 0 8px 20px rgba(10,22,40,0.04);">
        <div id="${cfg.messagesId}" class="flex-1 overflow-y-auto p-3 sm:p-5" style="background: var(--c-cream);">
          ${messages.length === 0 ? emptyState : ''}
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
  // STATELESS : pas de chargement d'historique. Chaque session est éphémère.
  const step = state.backWikotStep || 'home';
  if (step === 'select-target') return renderBackWikotSelectTarget();
  if (step === 'workshop') return renderBackWikotWorkshop();
  return renderBackWikotHome();
}

// --------------------------------------------
// VUE 1 : HOME (4 boutons unifiés "Gérer X")
// --------------------------------------------
function renderBackWikotHome() {
  const buttonHtml = (key) => {
    const wf = BACK_WIKOT_WORKFLOWS[key];
    if (!wf) return '';
    const enabled = userCanRunBackWikotWorkflow(key);
    let iconBg, iconColor, tagColor;
    if (!enabled) {
      iconBg = 'var(--c-cream-deep)';
      iconColor = 'rgba(15,27,40,0.3)';
      tagColor = 'rgba(15,27,40,0.4)';
    } else {
      iconBg = 'var(--c-navy)'; iconColor = 'var(--c-gold)'; tagColor = 'rgba(15,27,40,0.55)';
    }

    return `
      <button ${enabled ? `onclick="enterBackWikotWorkflow('${key}')"` : 'disabled'}
        class="card-premium ${enabled ? 'cursor-pointer group' : 'cursor-not-allowed opacity-55'} text-left p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4 transition-all"
        ${enabled ? `onmouseover="this.style.borderColor='var(--c-gold)'; this.style.transform='translateY(-1px)';" onmouseout="this.style.borderColor=''; this.style.transform='';"` : ''}>
        <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors" style="background: ${iconBg}; color: ${iconColor};">
          <i class="fas ${wf.icon} text-base sm:text-lg"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] uppercase tracking-[0.16em] font-semibold mb-0.5" style="color: ${tagColor};">Gérer</div>
          <div class="font-display text-sm sm:text-base font-semibold leading-tight" style="color: var(--c-navy);">${escapeHtml(wf.label)}</div>
          <div class="text-xs mt-1 leading-snug" style="color: rgba(15,27,40,0.55);">${escapeHtml(wf.description)}</div>
          ${!enabled ? '<div class="text-[11px] italic mt-1.5" style="color: #C84C3F;"><i class="fas fa-triangle-exclamation mr-1"></i>Permission requise</div>' : ''}
        </div>
        ${enabled ? `<i class="fas fa-arrow-right text-xs mt-2 shrink-0 transition-transform group-hover:translate-x-0.5" style="color: var(--c-gold-deep);"></i>` : ''}
      </button>
    `;
  };

  // L'utilisateur peut-il parler directement à Back Wikot ?
  // (au moins un workflow accessible = il peut utiliser l'orchestrateur)
  const canChat = userCanUseWikotMax();

  // Rendu de la zone conversation root (orchestrateur)
  const rootMessages = Array.isArray(state.backWikotRootMessages) ? state.backWikotRootMessages : [];
  const isSending = state.backWikotRootSending === true;
  const chatZoneHtml = !canChat ? '' : `
    <div class="card-premium overflow-hidden flex flex-col" style="min-height: 320px;">
      <!-- Header conv root -->
      <div class="px-3.5 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2.5 border-b" style="background: var(--c-navy); border-color: rgba(255,255,255,0.08);">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: rgba(212,175,55,0.18); color: var(--c-gold);">
          <i class="fas fa-comments text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[10px] uppercase tracking-[0.16em] font-semibold" style="color: rgba(255,255,255,0.55);">Discute directement</div>
          <div class="text-sm font-semibold" style="color: #fff;">Demande à Back Wikot</div>
        </div>
        ${rootMessages.length > 0 ? `
          <button onclick="resetBackWikotRootChat()" class="text-[11px] px-2 py-1 rounded-md hover:bg-white/10 transition-colors" style="color: rgba(255,255,255,0.7);" title="Effacer la conversation">
            <i class="fas fa-eraser"></i>
          </button>
        ` : ''}
      </div>

      <!-- Zone messages -->
      <div id="back-wikot-root-messages" class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5" style="background: var(--c-cream); max-height: 380px; min-height: 200px;">
        ${rootMessages.length === 0 ? `
          <div class="text-center py-6 sm:py-8">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style="background: rgba(212,175,55,0.15); color: var(--c-gold-deep);">
              <i class="fas fa-wand-magic-sparkles"></i>
            </div>
            <p class="text-xs sm:text-sm font-medium mb-1" style="color: var(--c-navy);">Dis-moi ce que tu veux faire</p>
            <p class="text-[11px] sm:text-xs leading-relaxed max-w-xs mx-auto" style="color: rgba(15,27,40,0.5);">
              "Crée une procédure pour l'arrivée VIP", "Modifie le wifi de la chambre 12", "Ajoute une tâche pour demain matin"…
            </p>
          </div>
        ` : rootMessages.map(m => {
          if (m._system) {
            return `<div class="text-center text-[10px] uppercase tracking-wide italic py-1" style="color: rgba(15,27,40,0.4);">
              <i class="fas fa-arrow-rotate-right mr-1"></i>${escapeHtml(m.content)}
            </div>`;
          }
          if (m.role === 'user') {
            return `<div class="flex justify-end">
              <div class="max-w-[85%] sm:max-w-[75%] px-3 py-2 rounded-2xl rounded-tr-sm text-sm leading-relaxed" style="background: var(--c-navy); color: #fff;">
                ${escapeHtml(m.content)}
              </div>
            </div>`;
          }
          return `<div class="flex justify-start gap-2 items-end">
            <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style="background: var(--c-gold); color: var(--c-navy);">
              <i class="fas fa-sparkles text-[10px]"></i>
            </div>
            <div class="max-w-[85%] sm:max-w-[75%] px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed border" style="background: #fff; color: var(--c-navy); border-color: rgba(15,27,40,0.08);">
              ${escapeHtml(m.content)}
            </div>
          </div>`;
        }).join('')}
        ${isSending ? `
          <div class="flex justify-start gap-2 items-end">
            <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style="background: var(--c-gold); color: var(--c-navy);">
              <i class="fas fa-sparkles text-[10px]"></i>
            </div>
            <div class="px-3 py-2 rounded-2xl rounded-tl-sm border" style="background: #fff; border-color: rgba(15,27,40,0.08);">
              <span class="inline-flex gap-1 items-center" style="color: rgba(15,27,40,0.5);">
                <span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background: var(--c-gold-deep);"></span>
                <span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background: var(--c-gold-deep); animation-delay: 0.15s;"></span>
                <span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background: var(--c-gold-deep); animation-delay: 0.3s;"></span>
              </span>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Composer -->
      <div class="border-t p-2.5 sm:p-3 flex gap-2 items-end" style="background: #fff; border-color: rgba(15,27,40,0.08);">
        <textarea
          id="back-wikot-root-input"
          rows="1"
          ${isSending ? 'disabled' : ''}
          oninput="autoResizeTextarea(this)"
          onkeydown="handleBackWikotRootInputKey(event)"
          placeholder="Écris ta demande à Back Wikot…"
          class="flex-1 resize-none px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 transition-all"
          style="border-color: rgba(15,27,40,0.12); background: var(--c-cream); color: var(--c-navy); max-height: 120px;"
        ></textarea>
        <button
          onclick="sendBackWikotRootMessage()"
          ${isSending ? 'disabled' : ''}
          class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${isSending ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 cursor-pointer'}"
          style="background: var(--c-navy); color: var(--c-gold);"
          title="Envoyer (Entrée)">
          <i class="fas ${isSending ? 'fa-spinner fa-spin' : 'fa-paper-plane'} text-xs"></i>
        </button>
      </div>
    </div>
  `;

  return `
    <div class="fade-in space-y-5 sm:space-y-6">
      <!-- Header premium -->
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0" style="background: var(--c-navy); color: var(--c-gold);">
          <i class="fas fa-pen-ruler text-base sm:text-lg"></i>
        </div>
        <div class="min-w-0">
          <p class="section-eyebrow">Atelier de rédaction et pilotage</p>
          <h1 class="font-display text-xl sm:text-2xl font-semibold" style="color: var(--c-navy);">Back Wikot</h1>
        </div>
      </div>

      <p class="text-sm" style="color: rgba(15,27,40,0.6);">
        ${canChat
          ? "Parle directement à Back Wikot ou choisis un atelier ci-dessous. Il s'occupe de t'amener au bon endroit."
          : "Choisis ce que tu veux gérer. Back Wikot t'aide à créer ou modifier les éléments puis tu enregistres."}
      </p>

      <!-- Layout responsive :
           - Mobile (<lg)   : conv en premier (plus naturel pour parler), puis les 4 boutons
           - Desktop (>=lg) : 4 boutons à gauche (col-span 7), conv à droite (col-span 5) sticky
      -->
      ${canChat ? `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
          <!-- Conv root : ordre 1 sur mobile, ordre 2 (droite) sur desktop -->
          <div class="order-1 lg:order-2 lg:col-span-5">
            ${chatZoneHtml}
          </div>
          <!-- Grille 4 boutons : ordre 2 sur mobile, ordre 1 (gauche) sur desktop -->
          <div class="order-2 lg:order-1 lg:col-span-7">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              ${buttonHtml('gerer_procedures')}
              ${buttonHtml('gerer_infos')}
              ${buttonHtml('gerer_conversations')}
              ${buttonHtml('gerer_taches')}
            </div>
          </div>
        </div>
      ` : `
        <!-- Pas de permission max → on garde la grille classique pleine largeur -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${buttonHtml('gerer_procedures')}
          ${buttonHtml('gerer_infos')}
          ${buttonHtml('gerer_conversations')}
          ${buttonHtml('gerer_taches')}
        </div>
      `}
    </div>
  `;
}

// --------------------------------------------
// VUE 2 : PAGE HUB (Gérer les X) — bouton "+ Créer" + liste des éléments existants
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
  let searchPlaceholder = 'Rechercher…';
  let showSearch = true;

  // ====== PROCÉDURES ======
  if (wfMode === 'gerer_procedures') {
    searchPlaceholder = 'Rechercher par titre ou déclencheur…';
    const all = state.backWikotProceduresCache || [];
    if (all.length === 0 && !search) {
      listHtml = `<div class="text-center py-12 text-sm text-navy-400"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>`;
    } else {
      const mains = all.filter(p => !p.is_subprocedure);
      const subs = all.filter(p => p.is_subprocedure);
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
          ${all.length === 0 && !search ? '' : (mainsFiltered.length === 0 && subsFiltered.length === 0 ? `
            <div class="text-center py-10 text-sm text-navy-400">
              <i class="fas fa-magnifying-glass text-2xl text-navy-200 mb-2 block"></i>
              ${search ? 'Aucune procédure ne correspond à ta recherche.' : 'Aucune procédure pour le moment.'}
            </div>
          ` : '')}
        </div>
      `;
    }
  }

  // ====== INFORMATIONS ======
  else if (wfMode === 'gerer_infos') {
    searchPlaceholder = 'Rechercher par titre ou contenu…';
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
            <div class="text-center py-10 text-sm text-navy-400">
              <i class="fas fa-magnifying-glass text-2xl text-navy-200 mb-2 block"></i>
              ${search ? 'Aucune information ne correspond à ta recherche.' : 'Aucune information pour le moment.'}
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  // ====== CONVERSATIONS ======
  else if (wfMode === 'gerer_conversations') {
    showSearch = false; // pas pertinent pour l'arborescence
    const tree = state.backWikotChatTreeCache;
    if (!tree) {
      listHtml = `<div class="text-center py-12 text-sm text-navy-400"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>`;
    } else {
      const totalChannels = tree.reduce((s, g) => s + (g.channels || []).length, 0);
      listHtml = `
        <div class="space-y-3">
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-navy-600">
              <i class="fas fa-sitemap text-sm"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-semibold text-navy-800">${tree.length} groupe${tree.length > 1 ? 's' : ''} · ${totalChannels} salon${totalChannels > 1 ? 's' : ''}</div>
              <div class="text-[11px] text-navy-500">Aperçu de l'arborescence actuelle.</div>
            </div>
            <button onclick="openBackWikotConversationsWorkshop()" class="text-xs px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold inline-flex items-center gap-1.5 shrink-0">
              <i class="fas fa-pen-ruler"></i><span class="hidden sm:inline">Ouvrir l'atelier</span>
            </button>
          </div>
          ${tree.length === 0 ? `
            <div class="text-center py-10 text-sm text-navy-400">
              <i class="fas fa-comments text-2xl text-navy-200 mb-2 block"></i>
              Aucun groupe pour le moment. Crées-en un avec Back Wikot.
            </div>
          ` : tree.map(g => `
            <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div class="px-3 py-2 flex items-center gap-2" style="background: var(--c-cream-deep, #f5f1eb); border-bottom: 1px solid #e5e7eb;">
                <i class="fas ${g.icon || 'fa-folder'} text-sm" style="color: #b8924d;"></i>
                <span class="text-sm font-semibold text-navy-900">${escapeHtml(g.name)}</span>
                ${g.is_system ? '<span class="text-[9px] uppercase font-bold tracking-wider ml-1 text-navy-400">par défaut</span>' : ''}
                <span class="ml-auto text-[10px] text-navy-400">${(g.channels || []).length} salon${(g.channels || []).length > 1 ? 's' : ''}</span>
              </div>
              <div class="divide-y divide-gray-100">
                ${(g.channels || []).length === 0 ? `
                  <div class="px-3 py-2 text-[11px] italic text-navy-400">Aucun salon dans ce groupe.</div>
                ` : (g.channels || []).map(c => `
                  <div class="px-3 py-1.5 flex items-center gap-2 text-xs">
                    <i class="fas ${c.icon || 'fa-comment'} text-[11px] text-navy-400"></i>
                    <span class="font-medium text-navy-800 truncate">${escapeHtml(c.name)}</span>
                    ${c.description ? `<span class="text-navy-400 truncate">— ${escapeHtml(c.description)}</span>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  // ====== TÂCHES ======
  else if (wfMode === 'gerer_taches') {
    searchPlaceholder = 'Rechercher par titre ou catégorie…';
    const cache = state.backWikotTasksCache;
    if (!cache) {
      listHtml = `<div class="text-center py-12 text-sm text-navy-400"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>`;
    } else {
      const matches = (t) => {
        if (!search) return true;
        return (t.title || '').toLowerCase().includes(search) ||
               (t.category || '').toLowerCase().includes(search);
      };
      const tplFiltered = (cache.templates || []).filter(matches);
      const instFiltered = (cache.instances || []).filter(matches);
      const dayLabels = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
      const recurrenceLabel = (t) => {
        if (t.recurrence_type === 'daily') return 'Quotidienne';
        if (t.recurrence_type === 'weekly') {
          const days = [];
          for (let i = 0; i < 7; i++) if ((t.recurrence_days || 0) & (1 << i)) days.push(dayLabels[i]);
          return days.length === 7 ? 'Tous les jours' : (days.join(', ') || 'Hebdo');
        }
        if (t.recurrence_type === 'monthly') return `Mensuelle (jour ${t.monthly_day || '?'})`;
        return 'Récurrente';
      };
      listHtml = `
        <div class="space-y-3">
          ${tplFiltered.length > 0 ? `
            <div>
              <div class="text-[11px] uppercase tracking-wide font-semibold text-navy-500 mb-2 flex items-center gap-1.5">
                <i class="fas fa-rotate text-blue-500"></i>Modèles récurrents · ${tplFiltered.length}
              </div>
              <div class="space-y-2">
                ${tplFiltered.map(t => `
                  <div onclick="selectBackWikotTaskTarget('template', ${t.id})" class="bg-white border border-gray-200 hover:border-emerald-300 hover:shadow-sm rounded-xl p-3 cursor-pointer transition-all">
                    <div class="flex items-start gap-3">
                      <div class="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <i class="fas fa-clipboard-list text-sm"></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="font-semibold text-navy-900 text-sm leading-snug">${escapeHtml(t.title)}</div>
                        <div class="text-[11px] text-navy-500 mt-0.5 truncate">
                          <i class="fas fa-rotate mr-1 text-blue-500"></i>${escapeHtml(recurrenceLabel(t))}
                          ${t.suggested_time ? ` · <i class="fas fa-clock mr-0.5"></i>${escapeHtml(t.suggested_time)}` : ''}
                          ${t.priority && t.priority !== 'normal' ? ` · <span class="text-rose-600 font-semibold">${t.priority === 'urgent' ? 'URGENT' : 'Haute'}</span>` : ''}
                        </div>
                        ${t.is_active === 0 ? '<div class="text-[10px] italic text-navy-400 mt-0.5">Désactivée</div>' : ''}
                      </div>
                      <i class="fas fa-chevron-right text-navy-300 text-xs mt-2"></i>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${instFiltered.length > 0 ? `
            <div class="${tplFiltered.length > 0 ? 'pt-3 mt-2 border-t border-dashed border-gray-300' : ''}">
              <div class="text-[11px] uppercase tracking-wide font-semibold text-navy-500 mb-2 flex items-center gap-1.5">
                <i class="fas fa-calendar-day text-amber-500"></i>Tâches du jour · ${instFiltered.length}
              </div>
              <div class="space-y-2">
                ${instFiltered.map(i => `
                  <div onclick="selectBackWikotTaskTarget('instance', ${i.id})" class="bg-white border border-gray-200 hover:border-amber-300 hover:shadow-sm rounded-xl p-3 cursor-pointer transition-all">
                    <div class="flex items-start gap-3">
                      <div class="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <i class="fas fa-bullseye text-sm"></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="font-semibold text-navy-900 text-sm leading-snug">${escapeHtml(i.title)}</div>
                        <div class="text-[11px] text-navy-500 mt-0.5 truncate">
                          ${i.task_date ? `<i class="fas fa-calendar mr-1"></i>${escapeHtml(i.task_date)}` : ''}
                          ${i.suggested_time ? ` · <i class="fas fa-clock mr-0.5"></i>${escapeHtml(i.suggested_time)}` : ''}
                          ${i.status === 'completed' ? ' · <span class="text-emerald-600 font-semibold">Terminée</span>' : ''}
                        </div>
                      </div>
                      <i class="fas fa-chevron-right text-navy-300 text-xs mt-2"></i>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${tplFiltered.length === 0 && instFiltered.length === 0 ? `
            <div class="text-center py-10 text-sm text-navy-400">
              <i class="fas fa-list-check text-2xl text-navy-200 mb-2 block"></i>
              ${search ? 'Aucune tâche ne correspond à ta recherche.' : 'Aucune tâche pour le moment.'}
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  // ====== Header + bouton Créer + recherche ======
  const createBtnHtml = `
    <button onclick="startBackWikotCreate()"
      class="w-full text-left bg-gradient-to-r from-orange-50 to-amber-50 hover:from-orange-100 hover:to-amber-100 border-2 border-dashed border-orange-300 hover:border-orange-400 rounded-xl p-3 transition-all group">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-orange-500 group-hover:bg-orange-600 text-white flex items-center justify-center shrink-0 transition-colors">
          <i class="fas fa-circle-plus text-base"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-navy-900 text-sm">${escapeHtml(wf.createLabel || 'Créer un nouvel élément')}</div>
          <div class="text-[11px] text-navy-500 truncate">Démarre un nouvel atelier avec Back Wikot.</div>
        </div>
        <i class="fas fa-arrow-right text-orange-500 text-sm shrink-0 group-hover:translate-x-0.5 transition-transform"></i>
      </div>
    </button>
  `;

  return `
    <div class="fade-in space-y-4">
      <div class="flex items-center gap-3">
        <button onclick="backToBackWikotHome()" class="w-9 h-9 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-navy-600 flex items-center justify-center shrink-0">
          <i class="fas fa-arrow-left"></i>
        </button>
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white shadow-sm shrink-0">
          <i class="fas ${wf.icon}"></i>
        </div>
        <div class="min-w-0">
          <h1 class="text-lg sm:text-xl font-bold text-navy-900 truncate">${escapeHtml(wf.label)}</h1>
          <p class="text-[11px] sm:text-xs text-navy-500 truncate">Crée un nouvel élément ou clique sur un existant pour l'éditer.</p>
        </div>
      </div>

      ${createBtnHtml}

      ${showSearch ? `
        <div class="bg-white border border-gray-200 rounded-xl p-2 flex items-center gap-2">
          <i class="fas fa-magnifying-glass text-navy-300 ml-2"></i>
          <input type="text" value="${escapeHtml(state.backWikotSelectSearch || '')}"
            oninput="state.backWikotSelectSearch = this.value; render(); document.getElementById('back-wikot-select-search').focus();"
            id="back-wikot-select-search"
            placeholder="${escapeHtml(searchPlaceholder)}"
            class="flex-1 outline-none text-sm bg-transparent" />
          ${state.backWikotSelectSearch ? `<button onclick="state.backWikotSelectSearch=''; render();" class="w-7 h-7 rounded hover:bg-gray-100 text-navy-400"><i class="fas fa-xmark text-xs"></i></button>` : ''}
        </div>
      ` : ''}

      <div class="max-h-[calc(100vh-22rem)] overflow-y-auto pr-1">
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

  // Titre dynamique selon le sub-mode (create vs update)
  const subMode = state.backWikotSubMode || (state.backWikotTargetId ? 'update' : 'create');
  let workshopTitle = wf.label;
  if (wfMode === 'gerer_procedures') workshopTitle = subMode === 'create' ? 'Créer une procédure' : 'Modifier une procédure';
  else if (wfMode === 'gerer_infos') workshopTitle = subMode === 'create' ? 'Créer une information' : 'Modifier une information';
  else if (wfMode === 'gerer_taches') workshopTitle = subMode === 'create' ? 'Créer une tâche' : 'Modifier une tâche';
  else if (wfMode === 'gerer_conversations') workshopTitle = 'Atelier conversations';

  // STATELESS : plus de sidebar historique des conversations.

  let formHtml;
  let formTitle;
  if (f.kind === 'procedure') {
    formHtml = renderBackWikotProcedureForm(f);
    formTitle = 'Formulaire procédure';
  } else if (f.kind === 'info_item') {
    formHtml = renderBackWikotInfoForm(f);
    formTitle = 'Formulaire information';
  } else if (f.kind === 'chat_tree') {
    formHtml = renderBackWikotChatTreeForm(f);
    formTitle = 'Salons & channels';
  } else if (f.kind === 'task') {
    formHtml = renderBackWikotTaskForm(f);
    formTitle = 'Formulaire tâche';
  } else {
    formHtml = '<div class="text-center text-navy-400 py-8">Type de formulaire inconnu.</div>';
    formTitle = 'Formulaire';
  }

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
            <h1 class="text-base sm:text-lg font-bold text-navy-900 truncate">${escapeHtml(workshopTitle)}</h1>
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
            <span class="text-sm font-semibold text-navy-800">${escapeHtml(formTitle)}</span>
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
          </div>
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

// STATELESS : plus d'historique. Stub conservé au cas où un onclick résiduel l'appelle.
function toggleBackWikotHistorySidebar() { /* no-op */ }

// (suppressed) renderBackWikotChatOnly — remplacé par le pattern workshop unifié
// avec form left + chat right. Les 4 nouveaux modes ont leur propre render*Form ci-dessous.

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
// FORM : Conversations (gérer) — arborescence groupes + salons
// Mutations LIVE (chaque tool call déclenche un POST/PUT/DELETE immédiat).
// ============================================
function renderBackWikotChatTreeForm(f) {
  const groups = f.groups || [];
  const totalChannels = groups.reduce((s, g) => s + (g.channels || []).length, 0);
  const last = f.lastAction;

  return `
    <div class="space-y-4 ${fieldHighlightClass('groups')}">
      <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-navy-600">
          <i class="fas fa-sitemap text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold text-navy-800">${groups.length} groupe${groups.length > 1 ? 's' : ''} · ${totalChannels} salon${totalChannels > 1 ? 's' : ''}</div>
          <div class="text-[11px] text-navy-500">Back Wikot peut créer, renommer, déplacer ou supprimer.</div>
        </div>
      </div>

      ${last ? `
        <div class="text-[11px] px-2.5 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-1.5">
          <i class="fas fa-check-circle"></i>${escapeHtml(last.label || '')}
        </div>
      ` : ''}

      ${groups.length === 0 ? `
        <div class="text-center py-8 text-xs text-navy-400 italic bg-gray-50 rounded-lg border border-dashed border-gray-300">
          Aucun groupe. Demande à Back Wikot de créer ton premier groupe et tes salons.
        </div>
      ` : groups.map(g => `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div class="px-3 py-2 flex items-center gap-2" style="background: var(--c-cream-deep); border-bottom: 1px solid var(--c-line);">
            <i class="fas ${g.icon || 'fa-folder'} text-sm" style="color: var(--c-gold-deep);"></i>
            <span class="text-sm font-semibold" style="color: var(--c-navy);">${escapeHtml(g.name)}</span>
            ${g.is_system ? '<span class="text-[9px] uppercase font-bold tracking-wider ml-1" style="color: rgba(15,27,40,0.4);">par défaut</span>' : ''}
            <span class="ml-auto text-[10px] text-navy-400">${(g.channels || []).length} salon${(g.channels || []).length > 1 ? 's' : ''}</span>
          </div>
          <div class="divide-y divide-gray-100">
            ${(g.channels || []).length === 0 ? `
              <div class="px-3 py-2 text-[11px] italic text-navy-400">Aucun salon dans ce groupe.</div>
            ` : (g.channels || []).map(c => `
              <div class="px-3 py-1.5 flex items-center gap-2 text-xs">
                <i class="fas ${c.icon || 'fa-comment'} text-[11px] text-navy-400"></i>
                <span class="font-medium text-navy-800 truncate">${escapeHtml(c.name)}</span>
                ${c.description ? `<span class="text-navy-400 truncate">— ${escapeHtml(c.description)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 flex items-start gap-2">
        <i class="fas fa-circle-info mt-0.5"></i>
        <div>
          <strong>Mutations live.</strong> Chaque action de Back Wikot s'applique immédiatement. Le bouton <strong>Enregistrer</strong> ferme le workshop et rafraîchit la page Discussion.
        </div>
      </div>
    </div>
  `;
}

// ============================================
// FORM : Conversations (chercher) — résultats de recherche
// ============================================
function renderBackWikotChatSearchForm(f) {
  const results = f.results || [];
  return `
    <div class="space-y-3 ${fieldHighlightClass('results')}">
      <div class="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div class="text-[10px] uppercase tracking-wider font-semibold text-navy-500 mb-1">Requête</div>
        <div class="text-sm text-navy-800 ${fieldHighlightClass('query')}">${f.query ? escapeHtml(f.query) : '<span class="italic text-navy-300">(à formuler par Back Wikot)</span>'}</div>
        ${f.lastSearchedAt ? `<div class="text-[10px] text-navy-400 mt-1.5">${results.length} résultat${results.length > 1 ? 's' : ''}${f.total > results.length ? ` · ${f.total} au total` : ''} · recherche effectuée</div>` : ''}
      </div>

      ${results.length === 0 ? `
        <div class="text-center py-10 text-xs text-navy-400 italic bg-gray-50 rounded-lg border border-dashed border-gray-300">
          ${f.lastSearchedAt ? 'Aucun message ne correspond.' : 'Décris ce que tu cherches dans le chat à droite.'}
        </div>
      ` : `
        <div class="space-y-2">
          ${results.map(r => `
            <div onclick="openChannel(${r.channel_id})" class="bg-white border border-gray-200 hover:border-amber-300 hover:shadow-sm rounded-xl p-3 cursor-pointer transition-all">
              <div class="flex items-start gap-2 mb-1">
                <div class="text-[10px] uppercase tracking-wider font-semibold text-navy-500 truncate flex-1">
                  <i class="fas fa-folder text-[9px] mr-1"></i>${escapeHtml(r.group_name || '')}
                  <i class="fas fa-chevron-right text-[8px] mx-1 text-navy-300"></i>
                  <i class="fas fa-comment text-[9px] mr-1"></i>${escapeHtml(r.channel_name || '')}
                </div>
                <div class="text-[10px] text-navy-400 shrink-0">${typeof formatChatTime === 'function' ? formatChatTime(r.created_at) : ''}</div>
              </div>
              <div class="text-[11px] font-semibold text-navy-700 mb-1">${escapeHtml(r.author || '')}</div>
              <div class="text-[12px] text-navy-700 line-clamp-3 leading-relaxed">${escapeHtml((r.content || '').slice(0, 280))}${(r.content || '').length > 280 ? '…' : ''}</div>
            </div>
          `).join('')}
        </div>
      `}

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 flex items-start gap-2">
        <i class="fas fa-circle-info mt-0.5"></i>
        <div>
          <strong>Recherche pilotée par Back Wikot.</strong> Décris ce que tu cherches dans le chat. Clique sur un résultat pour ouvrir le salon. <strong>Enregistrer</strong> ferme simplement le workshop.
        </div>
      </div>
    </div>
  `;
}

// ============================================
// FORM : Tâches — formulaire complet (template ou instance)
// ============================================
function renderBackWikotTaskForm(f) {
  const employees = state.employees || [];
  const assigneeNames = (f.assignee_ids || []).map(id => {
    const u = employees.find(e => e.id === id);
    return u ? (u.name || u.email || `#${id}`) : `#${id}`;
  });
  const dayLabels = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  const dayBitmap = f.recurrence_days || 0;

  const priorityLabel = { low: 'Basse', normal: 'Normale', high: 'Haute' }[f.priority || 'normal'];
  const priorityColor = { low: 'text-navy-500', normal: 'text-navy-700', high: 'text-rose-600 font-bold' }[f.priority || 'normal'];

  return `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-xs font-semibold text-navy-700 mb-1 block">Type</label>
          <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('task_kind')}">
            ${f.task_kind === 'instance' ? '<i class="fas fa-bullseye mr-1.5 text-orange-500"></i>Tâche ponctuelle' : '<i class="fas fa-clipboard-list mr-1.5 text-emerald-500"></i>Modèle de tâche'}
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-navy-700 mb-1 block">Mode</label>
          <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('mode')}">
            ${f.mode === 'recurring' ? '<i class="fas fa-rotate mr-1.5 text-blue-500"></i>Récurrente' : '<i class="fas fa-calendar-day mr-1.5 text-amber-500"></i>Ponctuelle'}
          </div>
        </div>
      </div>

      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Titre <span class="text-red-500">*</span></label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] ${fieldHighlightClass('title')}">
          ${f.title ? escapeHtml(f.title) : '<span class="italic text-navy-300">(à remplir par Back Wikot)</span>'}
        </div>
      </div>

      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Description</label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] whitespace-pre-wrap ${fieldHighlightClass('description')}">
          ${f.description ? escapeHtml(f.description) : '<span class="italic text-navy-300">(facultatif)</span>'}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-xs font-semibold text-navy-700 mb-1 block">Catégorie</label>
          <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('category')}">
            ${f.category ? escapeHtml(f.category) : '<span class="italic text-navy-400">—</span>'}
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-navy-700 mb-1 block">Priorité</label>
          <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 ${priorityColor} ${fieldHighlightClass('priority')}">
            ${priorityLabel}
          </div>
        </div>
      </div>

      ${f.mode === 'recurring' ? `
        <div class="bg-blue-50/40 border border-blue-100 rounded-xl p-3 space-y-3">
          <div class="text-[10px] uppercase tracking-wider font-semibold text-blue-700">Récurrence</div>
          <div>
            <label class="text-xs font-semibold text-navy-700 mb-1 block">Type</label>
            <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-navy-800 ${fieldHighlightClass('recurrence_type')}">
              ${f.recurrence_type === 'daily' ? 'Quotidienne' : f.recurrence_type === 'weekly' ? 'Hebdomadaire' : f.recurrence_type === 'monthly' ? 'Mensuelle' : '<span class="italic text-navy-300">(non défini)</span>'}
            </div>
          </div>
          ${f.recurrence_type === 'weekly' ? `
            <div>
              <label class="text-xs font-semibold text-navy-700 mb-1 block">Jours</label>
              <div class="flex flex-wrap gap-1 ${fieldHighlightClass('recurrence_days')}">
                ${dayLabels.map((d, i) => `
                  <span class="text-[10px] px-2 py-0.5 rounded-full ${(dayBitmap & (1 << i)) ? 'bg-blue-500 text-white font-semibold' : 'bg-gray-100 text-gray-400'}">${d}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${f.recurrence_type === 'monthly' ? `
            <div>
              <label class="text-xs font-semibold text-navy-700 mb-1 block">Jour du mois</label>
              <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-navy-800 ${fieldHighlightClass('monthly_day')}">${f.monthly_day || '<span class="italic text-navy-300">(non défini)</span>'}</div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-xs font-semibold text-navy-700 mb-1 block">Heure suggérée</label>
          <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('suggested_time')}">
            ${f.suggested_time ? `<i class="fas fa-clock mr-1 text-navy-400"></i>${escapeHtml(f.suggested_time)}` : '<span class="italic text-navy-400">—</span>'}
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold text-navy-700 mb-1 block">Durée (min)</label>
          <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('duration_min')}">
            ${f.duration_min ? `${f.duration_min} min` : '<span class="italic text-navy-400">—</span>'}
          </div>
        </div>
      </div>

      ${f.mode === 'recurring' ? `
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs font-semibold text-navy-700 mb-1 block">Active du</label>
            <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('active_from')}">${f.active_from || '<span class="italic text-navy-400">—</span>'}</div>
          </div>
          <div>
            <label class="text-xs font-semibold text-navy-700 mb-1 block">Active jusqu'au</label>
            <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 ${fieldHighlightClass('active_to')}">${f.active_to || '<span class="italic text-navy-400">—</span>'}</div>
          </div>
        </div>
      ` : ''}

      <div>
        <label class="text-xs font-semibold text-navy-700 mb-1 block">Assignés</label>
        <div class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-navy-800 min-h-[2.5rem] ${fieldHighlightClass('assignee_ids')}">
          ${assigneeNames.length === 0 ? '<span class="italic text-navy-400">Aucun assigné (= tous les employés)</span>' : assigneeNames.map(n => `<span class="inline-block bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[11px] mr-1 mb-1"><i class="fas fa-user mr-1"></i>${escapeHtml(n)}</span>`).join('')}
        </div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-800 flex items-start gap-2">
        <i class="fas fa-circle-info mt-0.5"></i>
        <div>
          <strong>Formulaire en lecture seule.</strong> Demande à Back Wikot dans le chat à droite. Clique <strong>Enregistrer</strong> pour persister.
        </div>
      </div>
    </div>
  `;
}

