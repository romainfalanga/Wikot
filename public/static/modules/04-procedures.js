// ============================================
// WIKOT MODULE — 04-procedures
// Partie du frontend découpé (scope global partagé avec les autres modules)
// ============================================

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
    can_edit_clients: 'gérer les chambres et les Codes Wikot',
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
    { key: 'can_edit_clients',     label: 'Chambres & Codes Wikot', icon: 'fa-door-closed' },
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

