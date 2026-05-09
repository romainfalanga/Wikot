// ============================================
// WIKOT MODULE — 07-chat-modals
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

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
// Rôles métier (différents du rôle système). Synchronisé avec backend ALLOWED_JOB_ROLES.
const JOB_ROLES = [
  { v: '',             label: '— Non défini —',  icon: 'fa-circle-question' },
  { v: 'reception',    label: 'Réception',        icon: 'fa-bell-concierge' },
  { v: 'serveur',      label: 'Serveur',          icon: 'fa-utensils' },
  { v: 'cuisinier',    label: 'Cuisinier',        icon: 'fa-kitchen-set' },
  { v: 'housekeeping', label: 'Housekeeping',     icon: 'fa-broom' },
  { v: 'maintenance',  label: 'Maintenance',      icon: 'fa-wrench' },
  { v: 'manager',      label: 'Manager',          icon: 'fa-user-tie' },
  { v: 'autre',        label: 'Autre',            icon: 'fa-user-gear' }
];
function jobRoleLabel(v) {
  if (!v) return null;
  const j = JOB_ROLES.find(j => j.v === v);
  return j ? j.label : null;
}
function jobRoleIcon(v) {
  if (!v) return 'fa-circle-question';
  const j = JOB_ROLES.find(j => j.v === v);
  return j ? j.icon : 'fa-circle-question';
}

// Modal unifiée création / édition utilisateur
// userId === null  → création (avec mot de passe)
// userId === number → édition (sans mot de passe, on peut juste modifier nom/email/rôle/job_role)
function showUserForm(userId = null) {
  const isSuperAdmin = state.user.role === 'super_admin';
  const isEditing = userId !== null;
  const target = isEditing ? (state.users || []).find(u => u.id === userId) : null;
  if (isEditing && !target) { showToast('Utilisateur introuvable', 'error'); return; }

  // Admin ne peut pas modifier un super_admin
  if (isEditing && state.user.role === 'admin' && target.role === 'super_admin') {
    showToast('Non autorisé', 'error'); return;
  }

  const currentJobRole = isEditing ? (target.job_role || '') : '';
  const currentRole    = isEditing ? target.role : (isSuperAdmin ? 'admin' : 'employee');
  const isSelf = isEditing && Number(target.id) === Number(state.user.id);

  const jobRoleSelect = `
    <div>
      <label class="block text-sm font-medium text-navy-600 mb-1">
        <i class="fas fa-id-badge mr-1 text-navy-400"></i>Rôle métier
      </label>
      <select id="user-job-role" class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
        ${JOB_ROLES.map(j => `<option value="${j.v}" ${j.v === currentJobRole ? 'selected' : ''}>${j.label}</option>`).join('')}
      </select>
      <p class="text-[11px] text-navy-400 mt-1">Permet de filtrer & assigner les tâches selon le poste.</p>
    </div>`;

  const content = `
  <form onsubmit="event.preventDefault(); ${isEditing ? `submitUserEdit(${userId})` : 'createUser()'}">
    <div class="space-y-4">
      ${isSuperAdmin && !isEditing ? `
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
        <input id="user-name" type="text" required placeholder="Prénom Nom" value="${isEditing ? (target.name || '').replace(/"/g, '&quot;') : ''}"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Email *</label>
        <input id="user-email" type="email" required placeholder="email@hotel.com" value="${isEditing ? (target.email || '') : ''}"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
        <p class="text-[11px] text-navy-400 mt-1">L'email est insensible à la casse — pas besoin de respecter les majuscules à la connexion.</p>
      </div>
      ${!isEditing ? `
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Mot de passe *</label>
        <input id="user-password" type="password" required placeholder="•••••••• (8 caractères min.)" minlength="8"
          class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
      </div>` : ''}
      ${(!isSuperAdmin || isEditing) ? `
      <div>
        <label class="block text-sm font-medium text-navy-600 mb-1">Rôle système *</label>
        <select id="user-role" ${isSelf ? 'disabled' : ''} class="w-full input-premium rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400">
          <option value="employee" ${currentRole === 'employee' ? 'selected' : ''}>Employé</option>
          <option value="admin"    ${currentRole === 'admin' ? 'selected' : ''}>Administrateur</option>
          ${isSuperAdmin ? `<option value="super_admin" ${currentRole === 'super_admin' ? 'selected' : ''}>Super Admin</option>` : ''}
        </select>
        ${isSelf ? '<p class="text-[11px] text-amber-600 mt-1"><i class="fas fa-lock mr-1"></i>Impossible de modifier votre propre rôle.</p>' : ''}
      </div>` : '<input type="hidden" id="user-role" value="admin">'}
      ${jobRoleSelect}
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-navy-500">Annuler</button>
        <button type="submit" class="btn-premium-navy text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          <i class="fas ${isEditing ? 'fa-floppy-disk' : 'fa-user-plus'} mr-1.5"></i>${isEditing ? 'Enregistrer' : 'Créer le compte'}
        </button>
      </div>
    </div>
  </form>`;
  const title = isEditing
    ? `Modifier ${target.name || 'l\'utilisateur'}`
    : (isSuperAdmin ? 'Nouvel administrateur d\'hôtel' : 'Nouvel utilisateur');
  showModal(title, content);
}

async function createUser() {
  const data = {
    hotel_id: document.getElementById('user-hotel')?.value,
    name: document.getElementById('user-name').value.trim(),
    email: document.getElementById('user-email').value.trim(),
    password: document.getElementById('user-password').value,
    role: document.getElementById('user-role').value,
    job_role: document.getElementById('user-job-role')?.value || null
  };
  const result = await api('/users', { method: 'POST', body: JSON.stringify(data) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Utilisateur créé', 'success');
  }
}

async function submitUserEdit(userId) {
  const payload = {
    name: document.getElementById('user-name').value.trim(),
    email: document.getElementById('user-email').value.trim(),
    job_role: document.getElementById('user-job-role')?.value || null
  };
  const roleEl = document.getElementById('user-role');
  if (roleEl && !roleEl.disabled) payload.role = roleEl.value;

  const result = await api(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (result) {
    closeModal();
    await loadData();
    render();
    showToast('Utilisateur mis à jour', 'success');
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

