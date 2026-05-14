// ============================================================
// COMPOSANT GLOBAL : SELECTEUR DATE / HEURE PREMIUM (wkDtp)
// ============================================================
// Utilise dans :
//   - Modale "Ecrire au feutre" (note VELEDA) -> date + heure
//   - Modale creation tache PONCTUELLE -> date + heure
//   - Modale creation tache RECURRENTE -> heure seule
//
// Principe :
//   - Date : <input type="date"> stylise (calendrier natif OS, fiable mobile)
//   - Heure : 2 <select> cote a cote (heures 00-23 / minutes par 5)
//   - Minutes par paliers de 5 (00,05,10,...,55) -> seulement 12 options
//   - Aucun popup custom : les natifs OS sont les meilleurs ergonomiquement
//   - Design carte ivoire premium coherent avec le reste de l'app
//
// API :
//   window.wkDtp.renderDateTime({ id, valueDate, valueTime, minDate, required })
//   window.wkDtp.renderDate({ id, value, min, required })
//   window.wkDtp.renderTime({ id, value, required })
//   window.wkDtp.getDateTimeISO(idPrefix) -> string ISO ou null
//   window.wkDtp.getDateValue(id) -> 'YYYY-MM-DD' ou ''
//   window.wkDtp.getTimeValue(id) -> 'HH:MM' ou ''
// ============================================================

(function () {
  // Genere une liste d'options "HH" de 00 a 23
  function hourOptions(selected) {
    let out = '';
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0');
      const sel = (selected === hh) ? 'selected' : '';
      out += `<option value="${hh}" ${sel}>${hh}</option>`;
    }
    return out;
  }

  // Genere une liste d'options "MM" par paliers de 5
  function minuteOptions(selected) {
    let out = '';
    for (let m = 0; m < 60; m += 5) {
      const mm = String(m).padStart(2, '0');
      const sel = (selected === mm) ? 'selected' : '';
      out += `<option value="${mm}" ${sel}>${mm}</option>`;
    }
    return out;
  }

  // Arrondit "HH:MM" au palier de 5 minutes le plus proche
  function snapTo5(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return { hh: '', mm: '' };
    const m = timeStr.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return { hh: '', mm: '' };
    let h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    let mn = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    // arrondi au multiple de 5 le plus proche
    mn = Math.round(mn / 5) * 5;
    if (mn === 60) { mn = 0; h = (h + 1) % 24; }
    return { hh: String(h).padStart(2, '0'), mm: String(mn).padStart(2, '0') };
  }

  // === Composant DATE + HEURE ===========================
  // params :
  //   id        : prefixe utilise pour les sous-elements
  //                  -> #{id}_date, #{id}_hour, #{id}_minute
  //   valueDate : 'YYYY-MM-DD'   (optionnel)
  //   valueTime : 'HH:MM'        (optionnel, sera arrondi a 5min)
  //   minDate   : 'YYYY-MM-DD'   (optionnel)
  //   required  : bool
  //   onChange  : nom fct globale appelee a chaque changement (recoit string ISO ou '')
  function renderDateTime(params) {
    const p = params || {};
    const id = p.id || 'wkdtp';
    const minAttr = p.minDate ? `min="${p.minDate}"` : '';
    const req = p.required ? 'required' : '';
    const t = snapTo5(p.valueTime || '');
    const onCh = p.onChange ? `oninput="window.wkDtp._fireChange('${id}', '${p.onChange}')"` : '';

    return `
      <div class="wkdtp-block" data-wkdtp-id="${id}">
        <div class="wkdtp-row">
          <div class="wkdtp-field wkdtp-field--date">
            <label class="wkdtp-mini-label">
              <i class="fas fa-calendar-day"></i> Jour
            </label>
            <input
              type="date"
              id="${id}_date"
              class="wkdtp-input wkdtp-input--date"
              value="${p.valueDate || ''}"
              ${minAttr}
              ${req}
              ${onCh}
            />
          </div>
          <div class="wkdtp-field wkdtp-field--time">
            <label class="wkdtp-mini-label">
              <i class="fas fa-clock"></i> Heure
            </label>
            <div class="wkdtp-time-row">
              <select id="${id}_hour" class="wkdtp-select wkdtp-select--hour" ${onCh}>
                ${hourOptions(t.hh || '12')}
              </select>
              <span class="wkdtp-time-sep">:</span>
              <select id="${id}_minute" class="wkdtp-select wkdtp-select--minute" ${onCh}>
                ${minuteOptions(t.mm || '00')}
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // === Composant DATE SEULE =============================
  function renderDate(params) {
    const p = params || {};
    const id = p.id || 'wkdtp_date';
    const minAttr = p.min ? `min="${p.min}"` : '';
    const req = p.required ? 'required' : '';
    return `
      <div class="wkdtp-block wkdtp-block--single">
        <div class="wkdtp-field wkdtp-field--date">
          <label class="wkdtp-mini-label">
            <i class="fas fa-calendar-day"></i> Jour
          </label>
          <input
            type="date"
            id="${id}"
            class="wkdtp-input wkdtp-input--date"
            value="${p.value || ''}"
            ${minAttr}
            ${req}
          />
        </div>
      </div>
    `;
  }

  // === Composant HEURE SEULE ============================
  // Pour tache recurrente : pas de date, juste heure suggeree
  function renderTime(params) {
    const p = params || {};
    const id = p.id || 'wkdtp_time';
    const t = snapTo5(p.value || '');
    return `
      <div class="wkdtp-block wkdtp-block--single">
        <div class="wkdtp-field wkdtp-field--time">
          <label class="wkdtp-mini-label">
            <i class="fas fa-clock"></i> Heure suggeree
          </label>
          <div class="wkdtp-time-row">
            <select id="${id}_hour" class="wkdtp-select wkdtp-select--hour">
              <option value="" ${!t.hh ? 'selected' : ''}>—</option>
              ${hourOptions(t.hh)}
            </select>
            <span class="wkdtp-time-sep">:</span>
            <select id="${id}_minute" class="wkdtp-select wkdtp-select--minute">
              ${minuteOptions(t.mm || '00')}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  // === LECTURE des valeurs =============================
  function getDateValue(id) {
    const el = document.getElementById(id + '_date') || document.getElementById(id);
    return el ? (el.value || '') : '';
  }
  function getTimeValue(id) {
    const h = document.getElementById(id + '_hour');
    const m = document.getElementById(id + '_minute');
    if (!h || !m) return '';
    const hh = h.value;
    const mm = m.value;
    if (!hh) return '';
    return `${hh}:${mm || '00'}`;
  }
  // Renvoie une string ISO "YYYY-MM-DDTHH:MM" prete pour new Date()
  function getDateTimeLocal(idPrefix) {
    const d = getDateValue(idPrefix);
    const t = getTimeValue(idPrefix);
    if (!d) return '';
    return `${d}T${t || '00:00'}`;
  }
  function getDateTimeISO(idPrefix) {
    const local = getDateTimeLocal(idPrefix);
    if (!local) return '';
    const dt = new Date(local);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString();
  }

  // Notification interne quand un sous-element change
  function _fireChange(id, cbName) {
    try {
      if (cbName && typeof window[cbName] === 'function') {
        const local = getDateTimeLocal(id);
        window[cbName](local, id);
      }
    } catch (e) { /* silencieux */ }
  }

  window.wkDtp = {
    renderDateTime,
    renderDate,
    renderTime,
    getDateValue,
    getTimeValue,
    getDateTimeLocal,
    getDateTimeISO,
    _fireChange,
    _snapTo5: snapTo5
  };
})();
