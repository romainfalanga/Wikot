// ============================================
// ============================================
// VIEW: TASKS — "Tâches" v3 (découplage tâche/personne + vue semaine compacte + copy-week)
// ============================================
//
// Architecture :
//   - 1 modal unifié de création (ponctuelle / récurrente avec onglets daily/weekly/monthly)
//   - Vue jour (par défaut) ou vue semaine (toggle)
//   - Filtre "Mes tâches uniquement" (chip toggle)
//   - Cartes enrichies : priorité (badge), durée, heure, catégorie (icône), avatars assignés
//   - Section "Modèles récurrents" dépliable en bas de page
//   - Badge sidebar avec compteur de tâches en attente
//
// État :
//   state.tasksDate            : 'YYYY-MM-DD' jour courant (vue jour)
//   state.tasksWeekStart       : 'YYYY-MM-DD' lundi de la semaine (vue semaine)
//   state.tasksViewMode        : 'day' | 'week'
//   state.tasksFilterMine      : bool — filtre "Mes tâches"
//   state.tasksData            : payload GET /api/tasks
//   state.tasksWeekData        : payload GET /api/tasks/week
//   state.tasksTemplatesOpen   : bool — section modèles dépliée
//   state.tasksTemplates       : cache templates (chargés à la demande)

const TASK_DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const TASK_DAY_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const TASK_PRIORITY_CONFIG = {
  normal: { label: 'Normal', color: 'rgba(15,27,40,0.55)', bg: 'transparent', icon: '' },
  high:   { label: 'Important', color: '#B86A1F', bg: 'rgba(184,106,31,0.10)', icon: 'fa-circle-exclamation' },
  urgent: { label: 'Urgent', color: '#C84C3F', bg: 'rgba(200,76,63,0.10)', icon: 'fa-bolt' }
};

const TASK_CATEGORY_CONFIG = {
  reception:   { label: 'Réception', icon: 'fa-bell-concierge', color: '#3B82F6' },
  menage:      { label: 'Ménage', icon: 'fa-broom', color: '#8B5CF6' },
  restaurant:  { label: 'Restaurant', icon: 'fa-utensils', color: '#EAB308' },
  maintenance: { label: 'Maintenance', icon: 'fa-screwdriver-wrench', color: '#10B981' },
  autre:       { label: 'Autre', icon: 'fa-circle-dot', color: 'rgba(15,27,40,0.55)' }
};

// ===== Helpers de date =====
function todayIsoStr() { return new Date().toISOString().slice(0, 10); }
function shiftDate(isoStr, days) {
  const d = new Date(isoStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatDateLong(isoStr) {
  return new Date(isoStr + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatDateShort(isoStr) {
  return new Date(isoStr + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
}
// Lundi de la semaine contenant la date
function mondayOf(isoStr) {
  const d = new Date(isoStr + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=dim..6=sam
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ===== Helpers de récurrence =====
function recurrenceToString(tpl) {
  const type = tpl.recurrence_type || 'weekly';
  if (type === 'daily') return 'Tous les jours';
  if (type === 'monthly') {
    const md = tpl.monthly_day;
    if (md === -1) return 'Le dernier jour du mois';
    return `Le ${md} de chaque mois`;
  }
  // weekly
  const bits = tpl.recurrence_days | 0;
  if (bits === 127) return 'Tous les jours';
  if (bits === 31) return 'Du lundi au vendredi';
  if (bits === 96) return 'Week-end (sam-dim)';
  const days = [];
  for (let i = 0; i < 7; i++) if ((bits >> i) & 1) days.push(TASK_DAY_FULL[i].slice(0, 3));
  return days.length === 0 ? 'Jamais' : days.join(', ');
}

function formatDuration(min) {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

// ===== Chargement données =====
async function loadTasksForDate(dateStr) {
  state.tasksLoading = true;
  const data = await api(`/tasks?date=${dateStr}`);
  state.tasksLoading = false;
  if (data) {
    state.tasksData = data;
    state.tasksDate = dateStr;
  }
}

async function loadTasksForWeek(startStr) {
  state.tasksLoading = true;
  const data = await api(`/tasks/week?start=${startStr}`);
  state.tasksLoading = false;
  if (data) {
    state.tasksWeekData = data;
    state.tasksWeekStart = startStr;
  }
}

async function loadTaskTemplates() {
  const r = await api('/tasks/templates');
  if (r) state.tasksTemplates = r.templates || [];
}

// ===== Rendu principal =====
function renderTasksView() {
  if (!state.tasksDate) state.tasksDate = todayIsoStr();
  if (!state.tasksViewMode) state.tasksViewMode = 'day';
  if (state.tasksFilterMine === undefined) state.tasksFilterMine = false;

  const isWeek = state.tasksViewMode === 'week';

  // Vue semaine : on s'assure d'avoir un lundi de référence
  if (isWeek) {
    if (!state.tasksWeekStart) state.tasksWeekStart = mondayOf(state.tasksDate || todayIsoStr());
    if (!state.tasksWeekData || state.tasksWeekData.start !== state.tasksWeekStart) {
      if (!state.tasksLoading) loadTasksForWeek(state.tasksWeekStart).then(render);
      return tasksLoadingPlaceholder();
    }
  } else {
    if (!state.tasksData || state.tasksData.date !== state.tasksDate) {
      if (!state.tasksLoading) loadTasksForDate(state.tasksDate).then(render);
      return tasksLoadingPlaceholder();
    }
  }

  return `
    <div class="fade-in">
      ${renderTasksHeader()}
      ${isWeek ? renderTasksWeekView() : renderTasksDayView()}
      ${renderTaskTemplatesSection()}
    </div>`;
}

function tasksLoadingPlaceholder() {
  return `<div class="text-center py-12" style="color: rgba(15,27,40,0.55);">
    <i class="fas fa-spinner fa-spin text-2xl mb-2" style="color: var(--c-gold);"></i>
    <p>Chargement des tâches...</p>
  </div>`;
}

// ===== Header (titre + nav date + toggles + actions) =====
function renderTasksHeader() {
  const isWeek = state.tasksViewMode === 'week';
  const data = isWeek ? state.tasksWeekData : state.tasksData;
  const me = (data && data.me) || {};
  const canCreate = !!me.can_create_tasks || userCanCreateTasks();
  const today = todayIsoStr();
  const dateStr = state.tasksDate || today;
  const weekStart = state.tasksWeekStart || mondayOf(today);

  // Compteurs : mes tâches en attente + tâches non attribuées (sur la vue active)
  let myPendingCount = 0;
  let unassignedCount = 0;
  if (data) {
    const myId = state.user.id;
    const assignsByInst = {};
    for (const a of (data.assignments || [])) {
      (assignsByInst[a.task_instance_id] = assignsByInst[a.task_instance_id] || []).push(a);
    }
    for (const inst of (data.instances || [])) {
      const list = assignsByInst[inst.id] || [];
      const mine = list.find(a => a.user_id === myId);
      if (mine && mine.status === 'pending') myPendingCount++;
      if (list.length === 0) unassignedCount++;
    }
  }

  const subtitle = isWeek
    ? `Du ${formatDateShort(weekStart)} au ${formatDateShort(shiftDate(weekStart, 6))}`
    : `${formatDateLong(dateStr)}${dateStr === today ? " · aujourd'hui" : dateStr < today ? ' · passé' : ''}`;

  return `
    <div class="flex flex-col gap-4 mb-5">
      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p class="section-eyebrow mb-2">Tâches</p>
          <h2 class="section-title-premium text-2xl sm:text-3xl">Tâches</h2>
          <p class="text-sm mt-1.5 capitalize" style="color: rgba(15,27,40,0.55);">${subtitle}</p>
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          <!-- Toggle Jour / Semaine -->
          <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--c-line);">
            <button onclick="setTasksViewMode('day')" class="px-3 py-2 text-xs font-semibold" style="background: ${!isWeek ? 'var(--c-navy)' : '#fff'}; color: ${!isWeek ? '#fff' : 'var(--c-navy)'};"><i class="fas fa-calendar-day mr-1"></i>Jour</button>
            <button onclick="setTasksViewMode('week')" class="px-3 py-2 text-xs font-semibold" style="background: ${isWeek ? 'var(--c-navy)' : '#fff'}; color: ${isWeek ? '#fff' : 'var(--c-navy)'};"><i class="fas fa-calendar-week mr-1"></i>Semaine</button>
          </div>
          <!-- Filtre Mes tâches -->
          <button onclick="toggleTasksFilterMine()" class="px-3 py-2 rounded-lg text-xs font-semibold transition-all" style="background: ${state.tasksFilterMine ? 'var(--c-gold)' : 'var(--c-cream-deep)'}; color: ${state.tasksFilterMine ? '#fff' : 'var(--c-navy)'}; border: 1px solid ${state.tasksFilterMine ? 'var(--c-gold-deep)' : 'var(--c-line)'};">
            <i class="fas ${state.tasksFilterMine ? 'fa-user-check' : 'fa-user'} mr-1"></i>Mes tâches${myPendingCount > 0 ? ` <span class="ml-1 px-1.5 py-0.5 text-[10px] rounded-full" style="background: ${state.tasksFilterMine ? 'rgba(255,255,255,0.25)' : 'var(--c-gold)'}; color: #fff;">${myPendingCount}</span>` : ''}
          </button>
          ${canCreate ? `<button onclick="showTaskCreateModal('${dateStr}')" class="px-3 py-2 rounded-lg text-xs font-semibold btn-premium-navy text-white"><i class="fas fa-plus mr-1"></i>Nouvelle tâche</button>` : ''}
        </div>
      </div>

      <!-- Navigation date / semaine + actions -->
      <div class="flex items-center gap-2 flex-wrap">
        ${isWeek ? `
          <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--c-line);">
            <button onclick="navigateTaskWeek(-1)" class="px-3 py-2 text-sm" style="background: #fff; color: var(--c-navy); border-right: 1px solid var(--c-line);" title="Semaine précédente"><i class="fas fa-chevron-left"></i></button>
            <button onclick="navigateTaskWeek(0)" class="px-3 py-2 text-xs font-semibold" style="background: #fff; color: var(--c-navy); border-right: 1px solid var(--c-line);">Cette semaine</button>
            <button onclick="navigateTaskWeek(1)" class="px-3 py-2 text-sm" style="background: #fff; color: var(--c-navy);" title="Semaine suivante"><i class="fas fa-chevron-right"></i></button>
          </div>
          ${(me.can_assign_tasks || userCanAssignTasks()) ? `
            <button onclick="copyPreviousWeekAssignments()" class="px-3 py-2 rounded-lg text-xs font-semibold transition-all" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);" title="Copier les attributions de la semaine précédente"><i class="fas fa-copy mr-1.5"></i>Copier semaine N-1</button>
          ` : ''}
          ${unassignedCount > 0 ? `
            <span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style="background: rgba(184,106,31,0.10); color: #B86A1F; border: 1px solid rgba(184,106,31,0.30);"><i class="fas fa-circle-question"></i>${unassignedCount} non attribuée${unassignedCount > 1 ? 's' : ''}</span>
          ` : ''}
        ` : `
          <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--c-line);">
            <button onclick="navigateTaskDate(-1)" class="px-3 py-2 text-sm" style="background: #fff; color: var(--c-navy); border-right: 1px solid var(--c-line);" title="Jour précédent"><i class="fas fa-chevron-left"></i></button>
            <input type="date" value="${dateStr}" onchange="state.tasksDate=this.value; loadTasksForDate(this.value).then(render);" class="px-3 py-2 text-sm font-mono" style="background: #fff; color: var(--c-navy); border: none;" />
            <button onclick="navigateTaskDate(1)" class="px-3 py-2 text-sm" style="background: #fff; color: var(--c-navy); border-left: 1px solid var(--c-line);" title="Jour suivant"><i class="fas fa-chevron-right"></i></button>
          </div>
          ${dateStr !== today ? `<button onclick="state.tasksDate='${today}'; loadTasksForDate('${today}').then(render);" class="px-3 py-2 rounded-lg text-xs font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);"><i class="fas fa-calendar-day mr-1"></i>Aujourd'hui</button>` : ''}
          ${unassignedCount > 0 ? `
            <span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style="background: rgba(184,106,31,0.10); color: #B86A1F; border: 1px solid rgba(184,106,31,0.30);"><i class="fas fa-circle-question"></i>${unassignedCount} non attribuée${unassignedCount > 1 ? 's' : ''}</span>
          ` : ''}
        `}
      </div>
    </div>`;
}

// ===== Vue jour =====
function renderTasksDayView() {
  const data = state.tasksData;
  const myId = state.user.id;
  const me = data.me || {};
  const canCreate = !!me.can_create_tasks || userCanCreateTasks();
  const canAssign = !!me.can_assign_tasks || userCanAssignTasks();

  const assignsByInst = {};
  for (const a of (data.assignments || [])) {
    (assignsByInst[a.task_instance_id] = assignsByInst[a.task_instance_id] || []).push(a);
  }

  // Tri / regroupement
  const myPending = [], myDone = [], unassigned = [], others = [];
  for (const inst of (data.instances || [])) {
    const list = assignsByInst[inst.id] || [];
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

  const hasAny = (data.instances || []).length > 0;
  if (!hasAny) {
    return `
      <div class="card-premium p-10 text-center">
        <i class="fas fa-list-check text-4xl mb-3" style="color: var(--c-line-strong);"></i>
        <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucune tâche pour ce jour</p>
        <p class="text-sm mt-1" style="color: rgba(15,27,40,0.55);">${canCreate ? "Créez une tâche ponctuelle ou un modèle récurrent." : "Aucune tâche n'a encore été planifiée."}</p>
      </div>`;
  }

  const opts = { data, canCreate, canAssign };
  const showOnlyMine = state.tasksFilterMine;

  if (showOnlyMine) {
    if (myPending.length === 0 && myDone.length === 0) {
      return `<div class="card-premium p-10 text-center">
        <i class="fas fa-user-check text-4xl mb-3" style="color: var(--c-line-strong);"></i>
        <p class="font-display text-lg font-semibold" style="color: var(--c-navy);">Aucune tâche pour vous ce jour</p>
        <p class="text-sm mt-1" style="color: rgba(15,27,40,0.55);">Désactivez le filtre pour voir toutes les tâches de l'équipe.</p>
      </div>`;
    }
    return `
      ${myPending.length > 0 ? renderTaskSection('À faire', myPending, { ...opts, highlight: true }, myId) : ''}
      ${myDone.length > 0 ? renderTaskSection('Terminées', myDone, { ...opts, highlight: true, faded: true }, myId) : ''}
    `;
  }

  return `
    ${myPending.length > 0 ? renderTaskSection('Mes tâches', myPending, { ...opts, highlight: true }, myId) : ''}
    ${myDone.length > 0 ? renderTaskSection('Mes tâches terminées', myDone, { ...opts, highlight: true, faded: true }, myId) : ''}
    ${unassigned.length > 0 ? renderTaskSection('Tâches non attribuées', unassigned, { ...opts, free: true }, myId) : ''}
    ${others.length > 0 ? renderTaskSection("Tâches de l'équipe", others, opts, myId) : ''}
  `;
}

function renderTaskSection(title, entries, opts, myId) {
  return `
    <div class="mb-6">
      <h3 class="font-display text-sm font-semibold uppercase tracking-wider mb-3" style="color: ${opts.highlight ? 'var(--c-gold-deep)' : 'rgba(15,27,40,0.5)'};">
        ${title} <span class="text-xs ml-1" style="color: rgba(15,27,40,0.4);">(${entries.length})</span>
      </h3>
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

  const prio = TASK_PRIORITY_CONFIG[inst.priority || 'normal'];
  const cat = inst.category ? TASK_CATEGORY_CONFIG[inst.category] : null;

  const assigneeChips = assignments.length === 0
    ? '<span class="text-xs italic" style="color: rgba(15,27,40,0.4);">Personne</span>'
    : assignments.map(a => `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${a.user_id === myId ? 'font-semibold' : ''}" style="${a.user_id === myId ? 'background: var(--c-gold); color: #fff;' : 'background: var(--c-cream-deep); color: var(--c-navy);'}">${a.status === 'done' ? '<i class="fas fa-check text-[9px]"></i>' : ''}${escapeHtml(a.user_name || '?')}</span>`).join(' ');

  const cardStyle = isMine
    ? `background: linear-gradient(180deg, rgba(201,169,97,0.10) 0%, #fff 60%); border: 1px solid var(--c-gold); box-shadow: 0 1px 0 rgba(201,169,97,0.20);`
    : opts.faded ? `background: var(--c-cream-deep); opacity: 0.75;`
    : `background: #fff; border: 1px solid var(--c-line);`;

  // Bordure gauche colorée selon priorité
  const priorityBorder = inst.priority && inst.priority !== 'normal'
    ? `border-left: 4px solid ${prio.color};`
    : '';

  return `
    <div class="card-premium p-3.5 transition-all" style="${cardStyle} ${priorityBorder}">
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
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-display font-semibold text-sm leading-tight ${isDone ? 'line-through opacity-60' : ''}" style="color: var(--c-navy);">${escapeHtml(inst.title)}</p>
                ${inst.priority && inst.priority !== 'normal' ? `<span class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold" style="background: ${prio.bg}; color: ${prio.color};"><i class="fas ${prio.icon} text-[9px]"></i>${prio.label}</span>` : ''}
              </div>
              ${inst.description ? `<p class="text-xs mt-1" style="color: rgba(15,27,40,0.6);">${escapeHtml(inst.description)}</p>` : ''}
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]" style="color: rgba(15,27,40,0.55);">
                ${inst.suggested_time ? `<span><i class="fas fa-clock mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(inst.suggested_time)}</span>` : ''}
                ${inst.duration_min ? `<span><i class="fas fa-hourglass-half mr-1" style="color: var(--c-gold-deep);"></i>${formatDuration(inst.duration_min)}</span>` : ''}
                ${cat ? `<span><i class="fas ${cat.icon} mr-1" style="color: ${cat.color};"></i>${cat.label}</span>` : ''}
                ${inst.template_id ? `<span class="italic"><i class="fas fa-rotate mr-1"></i>récurrente</span>` : ''}
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-1">${assigneeChips}</div>
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

// ===== Vue semaine (matrice 7 colonnes — densité compacte, pleine largeur) =====
function renderTasksWeekView() {
  const data = state.tasksWeekData;
  const myId = state.user.id;
  const dates = data.dates || [];
  const today = todayIsoStr();
  const me = data.me || {};
  const canAssign = !!me.can_assign_tasks || userCanAssignTasks();

  // Indexe instances par date
  const byDate = {};
  for (const d of dates) byDate[d] = [];
  for (const inst of (data.instances || [])) {
    if (byDate[inst.task_date]) byDate[inst.task_date].push(inst);
  }
  // Indexe assignments par instance
  const assignsByInst = {};
  for (const a of (data.assignments || [])) {
    (assignsByInst[a.task_instance_id] = assignsByInst[a.task_instance_id] || []).push(a);
  }

  // Filtre "Mes tâches" : ne garde que les instances où je suis assigné
  const filterMine = state.tasksFilterMine;
  const filterFn = inst => {
    if (!filterMine) return true;
    const list = assignsByInst[inst.id] || [];
    return list.some(a => a.user_id === myId);
  };

  // Légende explicative discrète au-dessus de la grille
  const legend = `
    <div class="hidden md:flex flex-wrap items-center gap-3 mb-2 text-[10px]" style="color: rgba(15,27,40,0.55);">
      <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm" style="background: rgba(184,106,31,0.15); border: 1px dashed #B86A1F;"></span>Non attribuée</span>
      <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm" style="background: #fff; border: 1px solid var(--c-line);"></span>Attribuée à l'équipe</span>
      <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm" style="background: rgba(201,169,97,0.20); border: 1px solid var(--c-gold);"></span>Attribuée à moi</span>
      <span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm" style="background: var(--c-cream-deep);"></span>Terminée</span>
      ${canAssign ? `<span class="ml-auto italic">Astuce : clic sur une carte pour attribuer rapidement.</span>` : ''}
    </div>`;

  return `
    ${legend}
    <!-- Desktop / tablette : grille 7 colonnes pleine largeur, sticky header -->
    <div class="hidden md:block mb-6 -mx-3 lg:-mx-6 px-3 lg:px-6">
      <div class="grid gap-1.5" style="grid-template-columns: repeat(7, minmax(0, 1fr));">
        ${dates.map(d => renderWeekDayColumn(d, byDate[d].filter(filterFn), assignsByInst, myId, d === today, canAssign)).join('')}
      </div>
    </div>
    <!-- Mobile : empilement vertical -->
    <div class="md:hidden space-y-3 mb-6">
      ${dates.map(d => renderWeekDayMobile(d, byDate[d].filter(filterFn), assignsByInst, myId, d === today, canAssign)).join('')}
    </div>`;
}

function renderWeekDayColumn(dateStr, instances, assignsByInst, myId, isToday, canAssign) {
  const dayLabel = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short' });
  const dayNum = new Date(dateStr + 'T12:00:00Z').getUTCDate();
  const dayMonth = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'short' });
  const headerStyle = isToday
    ? 'background: var(--c-navy); color: #fff;'
    : 'background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);';

  // Compteur de non attribuées dans cette colonne
  const nUnassigned = instances.filter(i => (assignsByInst[i.id] || []).length === 0).length;

  return `
    <div class="flex flex-col" style="min-height: 380px;">
      <button onclick="setTasksViewMode('day'); state.tasksDate='${dateStr}'; loadTasksForDate('${dateStr}').then(render);" class="rounded-t-lg px-1.5 py-2 text-center transition-all hover:opacity-90 sticky top-0 z-10" style="${headerStyle}">
        <p class="text-[9px] uppercase tracking-wider opacity-80 leading-none">${dayLabel}</p>
        <p class="font-display font-bold text-lg leading-none mt-0.5">${dayNum}</p>
        <p class="text-[9px] opacity-70 leading-none mt-0.5">${dayMonth}</p>
        ${nUnassigned > 0 ? `<p class="text-[9px] mt-1 px-1.5 py-0.5 rounded inline-block" style="background: ${isToday ? 'rgba(255,255,255,0.20)' : 'rgba(184,106,31,0.15)'}; color: ${isToday ? '#fff' : '#B86A1F'};">${nUnassigned} libre${nUnassigned > 1 ? 's' : ''}</p>` : ''}
      </button>
      <div class="flex-1 p-1 space-y-1 rounded-b-lg" style="background: #fff; border: 1px solid var(--c-line); border-top: none;">
        ${instances.length === 0 ? `<p class="text-[10px] italic text-center py-3" style="color: rgba(15,27,40,0.30);">—</p>` : instances.map(inst => renderWeekTaskMini(inst, assignsByInst[inst.id] || [], myId, canAssign)).join('')}
      </div>
    </div>`;
}

function renderWeekDayMobile(dateStr, instances, assignsByInst, myId, isToday, canAssign) {
  const headerStyle = isToday
    ? 'background: var(--c-navy); color: #fff;'
    : 'background: var(--c-cream-deep); color: var(--c-navy);';
  const nUnassigned = instances.filter(i => (assignsByInst[i.id] || []).length === 0).length;
  return `
    <div class="card-premium overflow-hidden" style="border: 1px solid var(--c-line);">
      <button onclick="setTasksViewMode('day'); state.tasksDate='${dateStr}'; loadTasksForDate('${dateStr}').then(render);" class="w-full px-3 py-2 text-left flex items-center justify-between" style="${headerStyle}">
        <span class="font-display font-semibold text-sm capitalize">${formatDateLong(dateStr)}</span>
        <span class="flex items-center gap-2">
          ${nUnassigned > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded" style="background: ${isToday ? 'rgba(255,255,255,0.20)' : 'rgba(184,106,31,0.15)'}; color: ${isToday ? '#fff' : '#B86A1F'};">${nUnassigned} libre${nUnassigned > 1 ? 's' : ''}</span>` : ''}
          <span class="text-xs">${instances.length}</span>
        </span>
      </button>
      ${instances.length > 0 ? `<div class="p-2 space-y-1.5" style="background: #fff;">
        ${instances.map(inst => renderWeekTaskMini(inst, assignsByInst[inst.id] || [], myId, canAssign)).join('')}
      </div>` : ''}
    </div>`;
}

// Carte mini en vue semaine — densité compacte, indicateur clair non-assignée
// Clic sur la carte = attribution rapide (si droit), sinon ouvre le jour
function renderWeekTaskMini(inst, assignments, myId, canAssign) {
  const mine = assignments.find(a => a.user_id === myId);
  const isMine = !!mine;
  const isDone = mine && mine.status === 'done';
  const allDone = inst.status === 'done';
  const isUnassigned = assignments.length === 0;
  const prio = TASK_PRIORITY_CONFIG[inst.priority || 'normal'];
  const cat = inst.category ? TASK_CATEGORY_CONFIG[inst.category] : null;

  // Style selon statut d'attribution
  let bg, border, extra = '';
  if (isUnassigned) {
    bg = 'rgba(184,106,31,0.06)';
    border = '#B86A1F';
    extra = 'border-style: dashed;';
  } else if (isMine) {
    bg = 'rgba(201,169,97,0.12)';
    border = 'var(--c-gold)';
  } else if (allDone) {
    bg = 'var(--c-cream-deep)';
    border = 'var(--c-line)';
  } else {
    bg = '#fff';
    border = 'var(--c-line)';
  }
  const leftBar = inst.priority && inst.priority !== 'normal' ? `box-shadow: inset 3px 0 0 ${prio.color};` : '';

  // Action principale au clic : attribuer si non assignée et droit, sinon aller au jour
  const clickAction = (isUnassigned && canAssign)
    ? `event.stopPropagation(); showTaskAssignModal(${inst.id})`
    : `setTasksViewMode('day'); state.tasksDate='${inst.task_date}'; loadTasksForDate('${inst.task_date}').then(render);`;

  return `
    <div onclick="${clickAction}" class="px-1.5 py-1 rounded cursor-pointer transition-all hover:shadow-sm" style="background: ${bg}; border: 1px solid ${border}; ${extra} ${leftBar}" title="${escapeHtml(inst.title)}${isUnassigned ? ' — Cliquez pour attribuer' : ''}">
      <div class="flex items-center gap-1 mb-0.5">
        ${isUnassigned ? `<i class="fas fa-circle-question text-[9px]" style="color: #B86A1F;" title="Non attribuée"></i>` : ''}
        ${cat ? `<i class="fas ${cat.icon} text-[9px]" style="color: ${cat.color};"></i>` : ''}
        ${inst.suggested_time ? `<span class="text-[9px] font-mono" style="color: var(--c-gold-deep);">${escapeHtml(inst.suggested_time.slice(0, 5))}</span>` : ''}
        ${inst.priority === 'urgent' ? `<i class="fas fa-bolt text-[8px] ml-auto" style="color: ${prio.color};"></i>` : (inst.priority === 'high' ? `<i class="fas fa-circle-exclamation text-[8px] ml-auto" style="color: ${prio.color};"></i>` : '')}
      </div>
      <p class="text-[10.5px] font-semibold leading-tight ${isDone ? 'line-through opacity-60' : ''}" style="color: var(--c-navy); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(inst.title)}</p>
      ${isUnassigned ? `
        <p class="text-[9px] mt-0.5 italic" style="color: #B86A1F;">À attribuer</p>
      ` : `
        <p class="text-[9px] mt-0.5" style="color: rgba(15,27,40,0.55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${assignments.slice(0, 2).map(a => escapeHtml((a.user_name || '?').split(' ')[0])).join(', ')}${assignments.length > 2 ? ` +${assignments.length - 2}` : ''}</p>
      `}
    </div>`;
}

// ===== Section Modèles récurrents (dépliable) =====
function renderTaskTemplatesSection() {
  const isWeek = state.tasksViewMode === 'week';
  const data = isWeek ? state.tasksWeekData : state.tasksData;
  const me = (data && data.me) || {};
  const canCreate = !!me.can_create_tasks || userCanCreateTasks();
  if (!canCreate) return '';
  const open = !!state.tasksTemplatesOpen;
  const templates = state.tasksTemplates || [];

  return `
    <div class="card-premium" style="background: #fff; border: 1px solid var(--c-line);">
      <button onclick="toggleTaskTemplatesSection()" class="w-full px-4 py-3 flex items-center justify-between transition-all">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background: var(--c-cream-deep); color: var(--c-gold-deep);">
            <i class="fas fa-rotate"></i>
          </div>
          <div class="text-left">
            <p class="font-display font-semibold text-sm" style="color: var(--c-navy);">Modèles récurrents</p>
            <p class="text-[11px]" style="color: rgba(15,27,40,0.55);">${open ? `${templates.length} modèle${templates.length > 1 ? 's' : ''}` : 'Gérer les tâches qui se répètent automatiquement'}</p>
          </div>
        </div>
        <i class="fas ${open ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs" style="color: rgba(15,27,40,0.5);"></i>
      </button>
      ${open ? `
        <div class="px-4 pb-4 pt-1" style="border-top: 1px solid var(--c-line);">
          <div class="flex justify-end mt-3 mb-3">
            <button onclick="showTaskCreateModal(null, true)" class="px-3 py-2 rounded-lg text-xs font-semibold btn-premium-navy text-white"><i class="fas fa-plus mr-1"></i>Nouveau modèle</button>
          </div>
          ${templates.length === 0 ? `
            <div class="text-center py-6" style="color: rgba(15,27,40,0.5);">
              <i class="fas fa-rotate text-3xl mb-2" style="color: var(--c-line-strong);"></i>
              <p class="text-sm">Aucun modèle récurrent.</p>
              <p class="text-xs mt-1">Créez-en un pour automatiser les tâches qui reviennent.</p>
            </div>
          ` : `
            <div class="space-y-2">
              ${templates.map(t => renderTemplateRow(t)).join('')}
            </div>
          `}
        </div>
      ` : ''}
    </div>`;
}

function renderTemplateRow(t) {
  const prio = TASK_PRIORITY_CONFIG[t.priority || 'normal'];
  const cat = t.category ? TASK_CATEGORY_CONFIG[t.category] : null;
  return `
    <div class="card-premium p-3 ${t.is_active ? '' : 'opacity-60'}" style="background: ${t.is_active ? '#fff' : 'var(--c-cream-deep)'}; border: 1px solid var(--c-line);">
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-display font-semibold text-sm" style="color: var(--c-navy);">${escapeHtml(t.title)}</p>
            ${t.priority && t.priority !== 'normal' ? `<span class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold" style="background: ${prio.bg}; color: ${prio.color};"><i class="fas ${prio.icon} text-[9px]"></i>${prio.label}</span>` : ''}
            ${!t.is_active ? '<span class="text-[10px] italic px-1.5 py-0.5 rounded" style="background: rgba(200,76,63,0.10); color: #C84C3F;">désactivé</span>' : ''}
          </div>
          ${t.description ? `<p class="text-xs mt-0.5" style="color: rgba(15,27,40,0.6);">${escapeHtml(t.description)}</p>` : ''}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]" style="color: rgba(15,27,40,0.55);">
            <span><i class="fas fa-rotate mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(recurrenceToString(t))}</span>
            ${t.suggested_time ? `<span><i class="fas fa-clock mr-1" style="color: var(--c-gold-deep);"></i>${escapeHtml(t.suggested_time)}</span>` : ''}
            ${t.duration_min ? `<span><i class="fas fa-hourglass-half mr-1" style="color: var(--c-gold-deep);"></i>${formatDuration(t.duration_min)}</span>` : ''}
            ${cat ? `<span><i class="fas ${cat.icon} mr-1" style="color: ${cat.color};"></i>${cat.label}</span>` : ''}
          </div>
          <div class="mt-1.5">
            <span class="text-[10px] italic" style="color: rgba(15,27,40,0.45);"><i class="fas fa-user-tag mr-1"></i>Attribution jour par jour, dans la vue jour ou semaine</span>
          </div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button onclick="toggleTemplateActive(${t.id}, ${t.is_active ? 0 : 1})" class="w-7 h-7 rounded flex items-center justify-center" style="background: var(--c-cream-deep); color: var(--c-navy);" title="${t.is_active ? 'Désactiver' : 'Réactiver'}"><i class="fas ${t.is_active ? 'fa-pause' : 'fa-play'} text-[11px]"></i></button>
          <button onclick="showTaskCreateModal(null, true, ${t.id})" class="w-7 h-7 rounded flex items-center justify-center" style="background: var(--c-cream-deep); color: var(--c-navy);" title="Modifier"><i class="fas fa-pen text-[11px]"></i></button>
          <button onclick="deleteTaskTemplate(${t.id})" class="w-7 h-7 rounded flex items-center justify-center" style="background: rgba(200,76,63,0.10); color: #C84C3F;" title="Supprimer"><i class="fas fa-trash text-[11px]"></i></button>
        </div>
      </div>
    </div>`;
}

// ===== Actions de toggles =====
function setTasksViewMode(mode) {
  state.tasksViewMode = mode;
  if (mode === 'week' && !state.tasksWeekStart) {
    state.tasksWeekStart = mondayOf(state.tasksDate || todayIsoStr());
  }
  render();
  if (mode === 'week' && (!state.tasksWeekData || state.tasksWeekData.start !== state.tasksWeekStart)) {
    loadTasksForWeek(state.tasksWeekStart).then(render);
  }
}

function toggleTasksFilterMine() {
  state.tasksFilterMine = !state.tasksFilterMine;
  render();
}

async function toggleTaskTemplatesSection() {
  state.tasksTemplatesOpen = !state.tasksTemplatesOpen;
  if (state.tasksTemplatesOpen && !state.tasksTemplates) {
    await loadTaskTemplates();
  }
  render();
}

function navigateTaskDate(deltaDays) {
  const next = shiftDate(state.tasksDate || todayIsoStr(), deltaDays);
  state.tasksDate = next;
  loadTasksForDate(next).then(render);
}

function navigateTaskWeek(direction) {
  // direction: -1 prev, 0 current, +1 next
  let nextStart;
  if (direction === 0) nextStart = mondayOf(todayIsoStr());
  else nextStart = shiftDate(state.tasksWeekStart || mondayOf(todayIsoStr()), direction * 7);
  state.tasksWeekStart = nextStart;
  loadTasksForWeek(nextStart).then(render);
}

// ===== Copie d'assignations depuis la semaine précédente =====
// Pour faire le planning hebdo en quelques clics : récupère les assignations
// de la semaine N-1 et les applique à la semaine courante (matching par template ou par titre).
async function copyPreviousWeekAssignments() {
  const currentStart = state.tasksWeekStart || mondayOf(todayIsoStr());
  const previousStart = shiftDate(currentStart, -7);
  const fromLabel = `${formatDateShort(previousStart)} → ${formatDateShort(shiftDate(previousStart, 6))}`;
  const toLabel = `${formatDateShort(currentStart)} → ${formatDateShort(shiftDate(currentStart, 6))}`;
  if (!confirm(`Copier les attributions de la semaine précédente (${fromLabel}) vers cette semaine (${toLabel}) ?\n\nLes assignations existantes ne seront pas écrasées : seules les nouvelles seront ajoutées.`)) return;

  const res = await api('/tasks/copy-week', {
    method: 'POST',
    body: JSON.stringify({ from: previousStart, to: currentStart })
  });
  if (res) {
    if (res.copied > 0) {
      showToast(`${res.copied} attribution${res.copied > 1 ? 's' : ''} copiée${res.copied > 1 ? 's' : ''} depuis la semaine précédente`, 'success');
    } else {
      showToast(res.message || 'Aucune attribution à copier (semaine précédente vide ou déjà tout copié)', 'info');
    }
    await loadTasksForWeek(currentStart);
    refreshTaskBadge();
    render();
  }
}

// ===== Actions tâche =====
async function completeTask(instanceId) {
  const res = await api(`/tasks/instances/${instanceId}/complete`, { method: 'POST', body: JSON.stringify({}) });
  if (res) {
    showToast('Tâche validée', 'success');
    if (state.tasksViewMode === 'week') await loadTasksForWeek(state.tasksWeekStart);
    else await loadTasksForDate(state.tasksDate);
    refreshTaskBadge();
    render();
  }
}

async function uncompleteTask(instanceId) {
  const res = await api(`/tasks/instances/${instanceId}/uncomplete`, { method: 'POST', body: JSON.stringify({}) });
  if (res) {
    if (state.tasksViewMode === 'week') await loadTasksForWeek(state.tasksWeekStart);
    else await loadTasksForDate(state.tasksDate);
    refreshTaskBadge();
    render();
  }
}

async function deleteTaskInstance(instanceId) {
  if (!confirm('Supprimer définitivement cette tâche ?')) return;
  const res = await api(`/tasks/instances/${instanceId}`, { method: 'DELETE' });
  if (res) {
    showToast('Tâche supprimée', 'success');
    if (state.tasksViewMode === 'week') await loadTasksForWeek(state.tasksWeekStart);
    else await loadTasksForDate(state.tasksDate);
    render();
  }
}

async function toggleTemplateActive(templateId, newActive) {
  const res = await api(`/tasks/templates/${templateId}`, { method: 'PUT', body: JSON.stringify({ is_active: newActive }) });
  if (res) {
    showToast(newActive ? 'Modèle réactivé' : 'Modèle désactivé', 'success');
    await loadTaskTemplates();
    render();
  }
}

async function deleteTaskTemplate(templateId) {
  if (!confirm('Supprimer ce modèle récurrent ? Les tâches déjà générées resteront en place.')) return;
  const res = await api(`/tasks/templates/${templateId}`, { method: 'DELETE' });
  if (res) {
    showToast('Modèle supprimé', 'success');
    await loadTaskTemplates();
    render();
  }
}

// ===== Modal unifié de création (ponctuelle ou récurrente) =====
// Args :
//   - dateStr : date pré-remplie pour ponctuelle (ignoré si recurring=true)
//   - recurring : true → mode récurrent (template)
//   - templateId : si fourni → édition d'un template existant
//   - instanceId : si fourni → édition d'une instance existante (ponctuelle)
function showTaskCreateModal(dateStr, recurring = false, templateId = null, instanceId = null) {
  const isEditTemplate = !!templateId;
  const isEditInstance = !!instanceId;
  let item = {};
  if (isEditTemplate) {
    item = (state.tasksTemplates || []).find(t => t.id === templateId) || {};
    recurring = true;
  } else if (isEditInstance) {
    const data = state.tasksData;
    item = (data?.instances || []).find(i => i.id === instanceId) || {};
    recurring = false;
  }

  const initialMode = recurring ? 'recurring' : 'oneoff';
  const title = isEditTemplate ? 'Modifier le modèle récurrent'
              : isEditInstance ? 'Modifier la tâche'
              : 'Nouvelle tâche';

  const data = state.tasksData || state.tasksWeekData || {};
  const staff = data.staff || [];
  // L'attribution est INSTANCE-LEVEL UNIQUEMENT (jamais sur le modèle).
  // → Le modèle ne propose AUCUN champ d'attribution.
  // → L'instance (ponctuelle ou édition) peut être attribuée pour CE jour seulement.
  let preAssigned = [];
  if (isEditInstance) {
    const myAssigns = (data.assignments || []).filter(a => a.task_instance_id === instanceId);
    preAssigned = myAssigns.map(a => a.user_id);
  }
  // Affichage du bloc d'attribution : seulement si on n'édite PAS un modèle récurrent
  const showAssignBlock = !isEditTemplate;

  showModal(title, `
    <form onsubmit="event.preventDefault(); submitTaskCreateModal(${templateId || 'null'}, ${instanceId || 'null'})">

      <!-- Switch ponctuelle / récurrente (caché en édition) -->
      ${(!isEditTemplate && !isEditInstance) ? `
        <div class="inline-flex rounded-lg overflow-hidden mb-4 w-full" style="border: 1px solid var(--c-line);">
          <button type="button" onclick="setTaskFormMode('oneoff')" id="tcm_btn_oneoff" class="flex-1 px-3 py-2 text-xs font-semibold transition-all" style="background: ${initialMode === 'oneoff' ? 'var(--c-navy)' : '#fff'}; color: ${initialMode === 'oneoff' ? '#fff' : 'var(--c-navy)'};"><i class="fas fa-calendar-day mr-1"></i>Ponctuelle</button>
          <button type="button" onclick="setTaskFormMode('recurring')" id="tcm_btn_recurring" class="flex-1 px-3 py-2 text-xs font-semibold transition-all" style="background: ${initialMode === 'recurring' ? 'var(--c-navy)' : '#fff'}; color: ${initialMode === 'recurring' ? '#fff' : 'var(--c-navy)'};"><i class="fas fa-rotate mr-1"></i>Récurrente</button>
        </div>
      ` : ''}
      <input type="hidden" id="tcm_mode" value="${initialMode}" />

      <!-- Titre -->
      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Titre <span style="color: #C84C3F;">*</span></label>
      <input id="tcm_title" type="text" required maxlength="200" value="${escapeHtml(item.title || '')}" autofocus class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3" placeholder="Ex : Vérifier la machine à café" />

      <!-- Description -->
      <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Description (optionnel)</label>
      <textarea id="tcm_description" rows="2" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3" placeholder="Détails...">${escapeHtml(item.description || '')}</textarea>

      <!-- Section Date (ponctuelle) -->
      <div id="tcm_section_oneoff" style="display: ${initialMode === 'oneoff' ? 'block' : 'none'};">
        <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Date <span style="color: #C84C3F;">*</span></label>
        ${window.wkDtp ? window.wkDtp.renderDate({
          id: 'tcm_date',
          value: item.task_date || dateStr || todayIsoStr(),
          required: true
        }) : `<input id="tcm_date" type="date" value="${escapeHtml(item.task_date || dateStr || todayIsoStr())}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm mb-3" />`}
      </div>

      <!-- Section Récurrence (récurrente) -->
      <div id="tcm_section_recurring" style="display: ${initialMode === 'recurring' ? 'block' : 'none'};">
        ${renderRecurrenceSelector(item)}
      </div>

      <!-- Heure suggérée + Durée -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          ${window.wkDtp ? window.wkDtp.renderTime({
            id: 'tcm_time',
            value: item.suggested_time || ''
          }) : `
            <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Heure suggérée</label>
            <input id="tcm_time" type="time" value="${escapeHtml(item.suggested_time || '')}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" />
          `}
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Durée estimée (min)</label>
          <input id="tcm_duration" type="number" min="1" max="1439" value="${item.duration_min || ''}" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm" placeholder="Ex : 15" />
        </div>
      </div>

      <!-- Catégorie + Priorité -->
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Catégorie</label>
          <select id="tcm_category" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm">
            <option value="">— Aucune —</option>
            ${Object.entries(TASK_CATEGORY_CONFIG).map(([k, v]) => `<option value="${k}" ${(item.category || '') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Priorité</label>
          <select id="tcm_priority" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm">
            ${Object.entries(TASK_PRIORITY_CONFIG).map(([k, v]) => `<option value="${k}" ${(item.priority || 'normal') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Bloc d'attribution : UNIQUEMENT pour les instances (jour précis), JAMAIS pour les modèles -->
      ${(showAssignBlock && staff.length > 0) ? `
        <div id="tcm_assign_block" style="display: ${initialMode === 'oneoff' ? 'block' : 'none'};">
          <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">
            Attribuer à <span class="font-normal" style="color: rgba(15,27,40,0.5);">(optionnel — pour ce jour uniquement)</span>
          </label>
          <div class="grid grid-cols-2 gap-1.5 mb-3 max-h-40 overflow-y-auto p-2 rounded-lg" style="background: var(--c-cream-deep); border: 1px solid var(--c-line);">
            ${staff.map(u => {
              const checked = preAssigned.includes(u.id);
              return `<label class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs" style="background: ${checked ? 'var(--c-gold)' : '#fff'}; color: ${checked ? '#fff' : 'var(--c-navy)'};">
                <input type="checkbox" ${checked ? 'checked' : ''} data-tcm-user-id="${u.id}" class="w-3.5 h-3.5" style="accent-color: var(--c-gold-deep);" onchange="this.closest('label').style.background = this.checked ? 'var(--c-gold)' : '#fff'; this.closest('label').style.color = this.checked ? '#fff' : 'var(--c-navy)';" />
                <span class="truncate">${escapeHtml(u.name)}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Note explicative quand on crée/édite un modèle récurrent -->
      ${(initialMode === 'recurring' && !isEditTemplate) || isEditTemplate ? `
        <div id="tcm_recurring_info" class="mb-3 p-3 rounded-lg" style="display: ${initialMode === 'recurring' ? 'block' : 'none'}; background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.20);">
          <p class="text-[11px]" style="color: rgba(15,27,40,0.75);"><i class="fas fa-circle-info mr-1.5" style="color: #3B82F6;"></i><strong>Modèle récurrent :</strong> chaque jour concerné, une tâche libre sera générée. Tu attribueras à une personne <strong>jour par jour</strong>, depuis la vue jour ou semaine. Une attribution sur un jour n'affecte aucun autre jour.</p>
        </div>
      ` : ''}

      <!-- Toggle actif (édition de template uniquement) -->
      ${isEditTemplate ? `
        <label class="flex items-center gap-2 mb-4 cursor-pointer">
          <input id="tcm_active" type="checkbox" ${item.is_active ? 'checked' : ''} class="w-4 h-4 rounded" style="accent-color: var(--c-gold-deep);" />
          <span class="text-sm" style="color: var(--c-navy);">Modèle actif (génère les tâches)</span>
        </label>
      ` : ''}

      <div class="flex gap-2">
        <button type="button" onclick="closeModal()" class="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Annuler</button>
        <button type="submit" class="flex-1 btn-premium-navy text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><i class="fas fa-check mr-1.5"></i>${(isEditTemplate || isEditInstance) ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </form>
  `);
}

// Sélecteur de récurrence : 3 onglets (Quotidien / Hebdo / Mensuel)
function renderRecurrenceSelector(item) {
  const type = item.recurrence_type || 'weekly';
  const recDays = item.recurrence_days != null ? item.recurrence_days : 127;
  const monthlyDay = item.monthly_day || 1;

  return `
    <label class="block text-xs font-semibold mb-1.5" style="color: var(--c-navy);">Récurrence <span style="color: #C84C3F;">*</span></label>
    <div class="inline-flex rounded-lg overflow-hidden mb-3 w-full" style="border: 1px solid var(--c-line);">
      <button type="button" onclick="setRecurrenceType('daily')" id="tcm_rt_daily" class="flex-1 px-2 py-2 text-xs font-semibold transition-all" style="background: ${type === 'daily' ? 'var(--c-gold)' : '#fff'}; color: ${type === 'daily' ? '#fff' : 'var(--c-navy)'};">Quotidien</button>
      <button type="button" onclick="setRecurrenceType('weekly')" id="tcm_rt_weekly" class="flex-1 px-2 py-2 text-xs font-semibold transition-all" style="background: ${type === 'weekly' ? 'var(--c-gold)' : '#fff'}; color: ${type === 'weekly' ? '#fff' : 'var(--c-navy)'}; border-left: 1px solid var(--c-line); border-right: 1px solid var(--c-line);">Hebdomadaire</button>
      <button type="button" onclick="setRecurrenceType('monthly')" id="tcm_rt_monthly" class="flex-1 px-2 py-2 text-xs font-semibold transition-all" style="background: ${type === 'monthly' ? 'var(--c-gold)' : '#fff'}; color: ${type === 'monthly' ? '#fff' : 'var(--c-navy)'};">Mensuel</button>
    </div>
    <input type="hidden" id="tcm_recurrence_type" value="${type}" />

    <!-- Bloc Daily : info -->
    <div id="tcm_rec_daily" style="display: ${type === 'daily' ? 'block' : 'none'};" class="px-3 py-2.5 rounded-lg mb-3" style="background: var(--c-cream-deep); border: 1px solid var(--c-line);">
      <p class="text-xs" style="color: rgba(15,27,40,0.7);"><i class="fas fa-circle-info mr-1.5" style="color: var(--c-gold-deep);"></i>La tâche sera générée automatiquement <strong>chaque jour</strong>.</p>
    </div>

    <!-- Bloc Weekly : chips L-D + raccourcis -->
    <div id="tcm_rec_weekly" style="display: ${type === 'weekly' ? 'block' : 'none'};">
      <div class="flex gap-1 mb-2 justify-center" id="tcm_days">
        ${TASK_DAY_LABELS.map((label, i) => {
          const checked = (recDays >> i) & 1;
          return `<button type="button" data-day="${i}" onclick="toggleTaskDay(${i})" class="w-10 h-10 rounded-lg text-sm font-semibold transition-all" style="background: ${checked ? 'var(--c-gold)' : 'var(--c-cream-deep)'}; color: ${checked ? '#fff' : 'var(--c-navy)'}; border: 1px solid ${checked ? 'var(--c-gold-deep)' : 'var(--c-line)'};">${label}</button>`;
        }).join('')}
      </div>
      <input type="hidden" id="tcm_recurrence_days" value="${recDays}" />
      <div class="flex flex-wrap gap-1.5 mb-3 justify-center">
        <button type="button" onclick="setRecurrenceDays(31)" class="text-[11px] px-2 py-1 rounded" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Lun-Ven</button>
        <button type="button" onclick="setRecurrenceDays(96)" class="text-[11px] px-2 py-1 rounded" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Week-end</button>
        <button type="button" onclick="setRecurrenceDays(127)" class="text-[11px] px-2 py-1 rounded" style="background: var(--c-cream-deep); color: var(--c-navy); border: 1px solid var(--c-line);">Tous</button>
      </div>
    </div>

    <!-- Bloc Monthly : sélecteur jour du mois -->
    <div id="tcm_rec_monthly" style="display: ${type === 'monthly' ? 'block' : 'none'};">
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-[11px] mb-1" style="color: rgba(15,27,40,0.6);">Jour du mois</label>
          <select id="tcm_monthly_day" class="w-full px-3 py-2.5 input-premium rounded-lg text-sm">
            ${Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${d}" ${monthlyDay === d ? 'selected' : ''}>Le ${d}</option>`).join('')}
            <option value="-1" ${monthlyDay === -1 ? 'selected' : ''}>Le dernier jour du mois</option>
          </select>
        </div>
        <div class="flex items-end">
          <p class="text-[11px]" style="color: rgba(15,27,40,0.55);"><i class="fas fa-circle-info mr-1" style="color: var(--c-gold-deep);"></i>Si le mois n'a pas ce jour, la tâche est ignorée pour ce mois-là.</p>
        </div>
      </div>
    </div>

    <!-- Période de validité (optionnelle) -->
    <details class="mb-3">
      <summary class="text-[11px] cursor-pointer mb-1.5" style="color: rgba(15,27,40,0.55);"><i class="fas fa-calendar-range mr-1"></i>Période de validité (optionnel)</summary>
      <div class="grid grid-cols-2 gap-2 mt-2">
        <div>
          <label class="block text-[11px] mb-1" style="color: rgba(15,27,40,0.6);">Actif depuis</label>
          <input id="tcm_active_from" type="date" value="${escapeHtml(item.active_from || '')}" class="w-full px-2.5 py-2 input-premium rounded-lg text-xs" />
        </div>
        <div>
          <label class="block text-[11px] mb-1" style="color: rgba(15,27,40,0.6);">Actif jusqu'au</label>
          <input id="tcm_active_to" type="date" value="${escapeHtml(item.active_to || '')}" class="w-full px-2.5 py-2 input-premium rounded-lg text-xs" />
        </div>
      </div>
    </details>
  `;
}

// Sélection de mode (ponctuelle ↔ récurrente)
function setTaskFormMode(mode) {
  document.getElementById('tcm_mode').value = mode;
  const btnOne = document.getElementById('tcm_btn_oneoff');
  const btnRec = document.getElementById('tcm_btn_recurring');
  if (btnOne) {
    btnOne.style.background = mode === 'oneoff' ? 'var(--c-navy)' : '#fff';
    btnOne.style.color = mode === 'oneoff' ? '#fff' : 'var(--c-navy)';
  }
  if (btnRec) {
    btnRec.style.background = mode === 'recurring' ? 'var(--c-navy)' : '#fff';
    btnRec.style.color = mode === 'recurring' ? '#fff' : 'var(--c-navy)';
  }
  document.getElementById('tcm_section_oneoff').style.display = mode === 'oneoff' ? 'block' : 'none';
  document.getElementById('tcm_section_recurring').style.display = mode === 'recurring' ? 'block' : 'none';
  // Le bloc d'attribution est INSTANCE-LEVEL : visible uniquement en mode ponctuel.
  // En mode récurrent, l'attribution se fait jour par jour via la modal "Attribuer".
  const assignBlock = document.getElementById('tcm_assign_block');
  if (assignBlock) assignBlock.style.display = mode === 'oneoff' ? 'block' : 'none';
  // Note explicative : visible en mode récurrent uniquement
  const recInfo = document.getElementById('tcm_recurring_info');
  if (recInfo) recInfo.style.display = mode === 'recurring' ? 'block' : 'none';
}

function setRecurrenceType(type) {
  document.getElementById('tcm_recurrence_type').value = type;
  ['daily', 'weekly', 'monthly'].forEach(t => {
    const btn = document.getElementById(`tcm_rt_${t}`);
    const block = document.getElementById(`tcm_rec_${t}`);
    if (btn) {
      btn.style.background = t === type ? 'var(--c-gold)' : '#fff';
      btn.style.color = t === type ? '#fff' : 'var(--c-navy)';
    }
    if (block) block.style.display = t === type ? 'block' : 'none';
  });
}

function toggleTaskDay(dayIdx) {
  const input = document.getElementById('tcm_recurrence_days');
  let bits = parseInt(input.value) || 0;
  bits ^= (1 << dayIdx);
  input.value = bits;
  refreshTaskDayButtons(bits);
}

function setRecurrenceDays(bits) {
  document.getElementById('tcm_recurrence_days').value = bits;
  refreshTaskDayButtons(bits);
}

function refreshTaskDayButtons(bits) {
  const btns = document.querySelectorAll('#tcm_days button');
  btns.forEach((b, i) => {
    const checked = (bits >> i) & 1;
    b.style.background = checked ? 'var(--c-gold)' : 'var(--c-cream-deep)';
    b.style.color = checked ? '#fff' : 'var(--c-navy)';
    b.style.borderColor = checked ? 'var(--c-gold-deep)' : 'var(--c-line)';
  });
}

async function submitTaskCreateModal(templateId, instanceId) {
  const mode = document.getElementById('tcm_mode').value;
  const title = document.getElementById('tcm_title').value.trim();
  if (!title) { showToast('Titre requis', 'error'); return; }

  // Champs communs
  const description = document.getElementById('tcm_description').value.trim() || null;
  // V16 : lit le nouveau composant wkDtp si dispo, fallback sur l'ancien input
  let suggested_time = null;
  if (window.wkDtp && document.getElementById('tcm_time_hour')) {
    suggested_time = window.wkDtp.getTimeValue('tcm_time') || null;
  } else {
    const tEl = document.getElementById('tcm_time');
    suggested_time = (tEl && tEl.value) ? tEl.value : null;
  }
  const durationVal = parseInt(document.getElementById('tcm_duration').value);
  const duration_min = (Number.isFinite(durationVal) && durationVal > 0) ? durationVal : null;
  const category = document.getElementById('tcm_category').value || null;
  const priority = document.getElementById('tcm_priority').value || 'normal';

  // Pré-assignation
  const assigneeIds = [];
  document.querySelectorAll('input[data-tcm-user-id]').forEach(c => {
    if (c.checked) assigneeIds.push(parseInt(c.dataset.tcmUserId));
  });

  let url, method, body;
  if (mode === 'recurring') {
    const recurrence_type = document.getElementById('tcm_recurrence_type').value;
    let recurrence_days = parseInt(document.getElementById('tcm_recurrence_days').value) || 127;
    let monthly_day = null;
    if (recurrence_type === 'monthly') {
      monthly_day = parseInt(document.getElementById('tcm_monthly_day').value);
    }
    if (recurrence_type === 'weekly' && recurrence_days === 0) {
      showToast('Sélectionne au moins un jour de la semaine', 'error');
      return;
    }
    const active_from = document.getElementById('tcm_active_from')?.value || null;
    const active_to = document.getElementById('tcm_active_to')?.value || null;
    // Modèle récurrent : QUOI / QUAND / OÙ uniquement.
    // PAS d'attribution ici — chaque jour génère une instance LIBRE,
    // attribuée jour par jour via la modal "Attribuer".
    body = {
      title, description,
      recurrence_type, recurrence_days, monthly_day,
      suggested_time, duration_min, category, priority,
      active_from, active_to
    };
    if (templateId) {
      const activeEl = document.getElementById('tcm_active');
      if (activeEl) body.is_active = activeEl.checked ? 1 : 0;
      url = `/tasks/templates/${templateId}`;
      method = 'PUT';
    } else {
      url = '/tasks/templates';
      method = 'POST';
    }
  } else {
    // V16 : lit le nouveau composant wkDtp si dispo, fallback sur l'ancien input
    let task_date = '';
    if (window.wkDtp && document.getElementById('tcm_date_date')) {
      task_date = window.wkDtp.getDateValue('tcm_date');
    } else {
      const dEl = document.getElementById('tcm_date');
      task_date = dEl ? dEl.value : '';
    }
    body = {
      title, description, task_date,
      suggested_time, duration_min, category, priority,
      assignee_ids: assigneeIds
    };
    if (instanceId) {
      url = `/tasks/instances/${instanceId}`;
      method = 'PUT';
    } else {
      url = '/tasks/instances';
      method = 'POST';
    }
  }

  const res = await api(url, { method, body: JSON.stringify(body) });
  if (res) {
    const isEdit = !!templateId || !!instanceId;
    showToast(isEdit ? 'Enregistré' : (mode === 'recurring' ? 'Modèle créé' : 'Tâche créée'), 'success');
    closeModal();
    // Si tâche ponctuelle créée pour une autre date que la courante, on saute dessus
    if (mode === 'oneoff' && body.task_date && body.task_date !== state.tasksDate) {
      state.tasksDate = body.task_date;
      state.tasksViewMode = 'day';
    }
    if (state.tasksViewMode === 'week') await loadTasksForWeek(state.tasksWeekStart);
    else await loadTasksForDate(state.tasksDate);
    if (mode === 'recurring' || templateId) await loadTaskTemplates();
    refreshTaskBadge();
    render();
  }
}

// ===== Modal d'attribution rapide (sur instance existante) =====
function showTaskAssignModal(instanceId) {
  const data = state.tasksData || state.tasksWeekData;
  const inst = (data?.instances || []).find(i => i.id === instanceId);
  if (!inst) return;
  const staff = data.staff || [];
  const currentlyAssigned = new Set((data.assignments || []).filter(a => a.task_instance_id === instanceId).map(a => a.user_id));
  showModal(`Attribuer : ${inst.title}`, `
    <p class="text-xs mb-4" style="color: rgba(15,27,40,0.55);">Cochez les personnes à qui attribuer cette tâche.</p>
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
    if (state.tasksViewMode === 'week') await loadTasksForWeek(state.tasksWeekStart);
    else await loadTasksForDate(state.tasksDate);
    refreshTaskBadge();
    render();
  }
}

// Backward compat : ancien helper showTaskInstanceForm utilisé ailleurs
function showTaskInstanceForm(instanceId, dateStr) {
  showTaskCreateModal(dateStr, false, null, instanceId);
}

// ===== Badge sidebar (compteur de mes tâches en attente) =====
async function refreshTaskBadge() {
  try {
    const r = await api('/tasks/my-pending-count');
    if (r) {
      state.myTasksPendingCount = r.count || 0;
      // Re-render uniquement si vue active autre que tasks (sinon flash)
      if (state.currentView !== 'tasks') render();
    }
  } catch (e) { /* silencieux */ }
}
