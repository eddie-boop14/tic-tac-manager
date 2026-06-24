// ════════════════════════════════════════════════════════════════════════════
// TORNET POINTAGE — Admin dashboard
// ════════════════════════════════════════════════════════════════════════════
// © 2026 bleu-canard éditions · Edmaster & Claudius
// ════════════════════════════════════════════════════════════════════════════

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://vyptkpvgdfbyvsdqnywx.supabase.co';      // ← TO FILL
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5cHRrcHZnZGZieXZzZHFueXd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDAzODcsImV4cCI6MjA5NDg3NjM4N30.p0DEH-QOC4U-CL0eOU8UaXkWzTUfFI0CzMbdaW9AbX8'; // ← TO FILL
const MANAGER_CODE  = 'tic-tac-tornet';             // ← CHANGE THIS BEFORE DEPLOY

// ── INIT ─────────────────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  activeTab: 'today',
  site: localStorage.getItem('ttq.site') || 'all',  // 'all' | 'chez-nous' | 'tornet'
  staff: [],
  shifts: [],       // shifts in current range/view
  liveShifts: [],   // open shifts (ended_at = null)
  planning: [],
  range: { start: null, end: null, kind: 'this-month' },
  staffFilter: 'all', // 'all' or staff_id
  staffSearch: '',
  staffStatusFilter: 'all', // 'all' | 'active' | 'inactive'
  hoursPole: 'all',      // 'all' | 'cuisine' | 'salle' | 'snack' — Heures pôle filter
  hoursSort: 'az',       // 'az' | 'order' — Heures list sort
  planningWeekStart: null,
  planningPole: 'all',   // 'all' | 'cuisine' | 'salle' | 'snack' — planning row filter
  editing: { shift: null, staffRow: null, planSlot: null, leave: null, sick: null },
  managerName: localStorage.getItem('ttq.managerName') || '',
  signoffs: [],
  sickLeaves: [],   // CM (arrêt maladie) date-ranges overlapping the selected Heures period
  pendingSignoffs: [],   // all-time pending sign-offs (disputes + awaiting signature), site-scoped
  _pendingModalKind: 'demands',
};

// ── SITE FILTER HELPER ─────────────────────────────────────────────────────
// Wraps a Supabase query builder with an etablissement filter when the
// active site is not 'all'. Centralizes the multi-tenant scoping so we
// don't sprinkle .eq() calls everywhere.
function bySite(query) {
  if (state.site === 'all') return query;
  return query.eq('etablissement', state.site);
}

// When inserting/updating, default etablissement based on context.
// Returns the etablissement to write: explicit choice > active site filter > 'tornet'.
function defaultEtab(explicit) {
  if (explicit && explicit !== 'all') return explicit;
  if (state.site !== 'all') return state.site;
  return 'tornet';
}

// Apply site selection: persist, set body attribute, swap brand UI,
// update theme-color meta. The CSS does the rest via [data-site].
function applySite(site) {
  state.site = site;
  localStorage.setItem('ttq.site', site);
  document.body.setAttribute('data-site', site);

  // Update chip active state
  $$('.site-chip').forEach(c => c.classList.toggle('active', c.dataset.site === site));

  // Brand swap
  const brandEl = $('#brand-name');
  if (brandEl) {
    brandEl.textContent =
      site === 'chez-nous' ? 'Chez Nous à la Plage' :
      site === 'tornet'    ? 'Chalet du Tornet'     :
      'Tic-Tac-Quack';
  }

  // theme-color meta for status bar. Tornet uses the neutral default (same as Tous).
  const themeColor =
    site === 'chez-nous' ? '#0a1628' :
    '#1d2733';
  const meta = $('#meta-theme-color');
  if (meta) meta.setAttribute('content', themeColor);
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtTime(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

function fmtDateShort(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  return `${days[dt.getDay()]} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
}

function fmtDateFull(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const days = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  return `${days[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

function fmtDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return '—';
  const sign = minutes < 0 ? '-' : '';
  minutes = Math.abs(minutes);
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${sign}${m}min`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h${String(m).padStart(2,'0')}`;
}

function fmtDecimalHours(minutes) {
  if (minutes == null || isNaN(minutes)) return '—';
  return (minutes / 60).toFixed(2).replace('.', ',') + 'h';
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function mondayOf(d) {
  const dt = new Date(d);
  const dow = dt.getDay() || 7; // sunday=7
  if (dow !== 1) dt.setDate(dt.getDate() - (dow - 1));
  dt.setHours(0,0,0,0);
  return dt;
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function toast(msg, type = 'info', ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

// ── SHIFT MATH ───────────────────────────────────────────────────────────────
function computeShiftMinutes(shift, now = new Date()) {
  const start = new Date(shift.started_at);
  const end   = shift.ended_at ? new Date(shift.ended_at) : now;
  const totalMin = Math.max(0, Math.round((end - start) / 60000));

  let pauseMin = 0;
  const pauses = Array.isArray(shift.pauses) ? shift.pauses : [];
  for (const p of pauses) {
    if (!p.start) continue;
    const pStart = new Date(p.start);
    const pEnd = p.end ? new Date(p.end) : now;
    pauseMin += Math.max(0, Math.round((pEnd - pStart) / 60000));
  }

  return {
    total: totalMin,
    pause: pauseMin,
    net: Math.max(0, totalMin - pauseMin),
  };
}

function shiftState(shift) {
  if (!shift) return 'off';
  if (shift.ended_at) return 'off';
  const pauses = Array.isArray(shift.pauses) ? shift.pauses : [];
  const lastPause = pauses[pauses.length - 1];
  if (lastPause && !lastPause.end) return 'pause';
  return 'service';
}

// ── AUTH ─────────────────────────────────────────────────────────────────────
function checkAuth() {
  const ok = sessionStorage.getItem('ttq.authed') === '1';
  if (ok) enterApp();
  else $('#auth-input').focus();
}

function tryLogin() {
  const input = $('#auth-input').value.trim();
  if (input === MANAGER_CODE) {
    sessionStorage.setItem('ttq.authed', '1');
    enterApp();
  } else {
    $('#auth-hint').textContent = 'Code incorrect';
    $('#auth-input').value = '';
  }
}

async function enterApp() {
  $('#auth-gate').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await boot();
}

function logout() {
  if (!confirm('Déconnexion ?')) return;
  sessionStorage.removeItem('ttq.authed');
  location.reload();
}

// ── BOOT ─────────────────────────────────────────────────────────────────────
async function boot() {
  wire();
  startClockTicker();
  await loadStaff();
  await loadLiveShifts();
  await loadShiftsForRange();
  showTab('today');

  // Realtime — refresh on any shift event
  sb.channel('mgr-shifts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, async () => {
      await loadLiveShifts();
      if (state.activeTab === 'today') renderToday();
      if (state.activeTab === 'hours') {
        await loadShiftsForRange();
        renderHours();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_signoffs' }, async () => {
      if (state.activeTab === 'hours') { await loadSignoffsForRange(); renderHours(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sick_leaves' }, async () => {
      if (state.activeTab === 'hours') { await loadSickLeavesForRange(); renderHours(); }
    })
    .subscribe();
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadStaff() {
  const { data, error } = await bySite(sb.from('staff').select('*')).order('display_order');
  if (error) { console.error(error); toast('Chargement staff impossible', 'error'); return; }
  state.staff = data || [];
  renderStaffFilter();
}

async function loadLiveShifts() {
  const { data, error } = await bySite(sb
    .from('shifts')
    .select('*')
    .is('ended_at', null))
    .order('started_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.liveShifts = data || [];
}

async function loadShiftsForRange() {
  if (!state.range.start) computeRange(state.range.kind);
  const { data, error } = await bySite(sb
    .from('shifts')
    .select('*')
    .gte('business_date', state.range.start)
    .lte('business_date', state.range.end))
    .order('business_date', { ascending: false })
    .order('started_at', { ascending: false });
  if (error) { console.error(error); toast('Chargement shifts impossible', 'error'); return; }
  state.shifts = data || [];
}

async function loadSignoffsForRange() {
  const { data, error } = await bySite(sb
    .from('staff_signoffs')
    .select('*')
    .gte('week_start', state.range.start)
    .lte('week_end', state.range.end));
  if (error) { console.error(error); return; }
  state.signoffs = data || [];
}

// CM (arrêt maladie) ranges that OVERLAP the selected period. A range [s,e]
// overlaps [start,end] iff s <= range.end AND e >= range.start — so a range
// starting before the period (or ending after it) is still picked up.
async function loadSickLeavesForRange() {
  const { data, error } = await bySite(sb
    .from('sick_leaves')
    .select('*')
    .lte('start_date', state.range.end)
    .gte('end_date', state.range.start));
  if (error) { console.error(error); return; }
  state.sickLeaves = data || [];
}

// All-time pending sign-offs (independent of the period selector), site-scoped:
// either awaiting the employee's signature, or signed with a dispute to resolve.
async function loadPendingSignoffs() {
  const { data, error } = await bySite(sb
    .from('staff_signoffs')
    .select('*')
    .or('employee_signed_at.is.null,has_dispute.eq.true'))
    .order('week_start', { ascending: false });
  if (error) { console.error(error); return; }
  state.pendingSignoffs = data || [];
}

// Split helpers for the two pending buckets.
function pendingDemands() {
  return state.pendingSignoffs.filter(so => so.has_dispute);
}
function pendingSignature() {
  return state.pendingSignoffs.filter(so => !so.employee_signed_at && !so.has_dispute);
}

async function loadPlanning(weekStartISO, weekEndISO) {
  const { data, error } = await bySite(sb
    .from('planning')
    .select('*')
    .gte('business_date', weekStartISO)
    .lte('business_date', weekEndISO));
  if (error) { console.error(error); return; }
  state.planning = data || [];
}

// ── RANGE COMPUTATION ────────────────────────────────────────────────────────
function computeRange(kind) {
  const now = new Date();
  let start, end;

  if (kind === 'this-week') {
    start = mondayOf(now);
    end = addDays(start, 6);
  } else if (kind === 'last-week') {
    start = addDays(mondayOf(now), -7);
    end = addDays(start, 6);
  } else if (kind === 'this-month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (kind === 'last-month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  } else {
    return; // custom is handled separately
  }

  state.range = {
    start: isoFromDate(start),
    end: isoFromDate(end),
    kind,
  };
}

// ── TAB SWITCH ───────────────────────────────────────────────────────────────
function showTab(tab) {
  state.activeTab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.panel').forEach(p => p.classList.toggle('hidden', p.id !== `panel-${tab}`));

  if (tab === 'today') renderToday();
  if (tab === 'hours') renderHours();
  if (tab === 'planning') openPlanning();
  if (tab === 'staff') renderStaffList();
}

// ── TODAY VIEW ───────────────────────────────────────────────────────────────
function renderToday() {
  $('#today-date').textContent = fmtDateFull(new Date());

  // Live grid
  const grid = $('#live-grid');
  grid.innerHTML = '';

  const live = state.liveShifts;
  if (live.length === 0) {
    grid.innerHTML = '<div class="empty">personne en service</div>';
  } else {
    live.forEach(s => {
      const st = shiftState(s);
      const m = computeShiftMinutes(s);
      const staff = state.staff.find(x => x.id === s.staff_id) || {};
      const detail = st === 'service'
        ? `en service depuis ${fmtTime(s.started_at)} · ${fmtDuration(m.net)}`
        : st === 'pause'
        ? `en pause · ${fmtDuration(m.net)} travaillées`
        : `terminé · ${fmtDuration(m.net)}`;
      const chip = document.createElement('div');
      chip.className = `live-chip ${st === 'service' ? 'on-service' : st === 'pause' ? 'on-pause' : ''}`;
      chip.innerHTML = `
        <span class="live-dot" style="${st === 'off' ? `background:${staff.color || '#5a8a6b'}` : ''}"></span>
        <div class="live-info">
          <div class="live-name">${escapeHTML(s.staff_name)}${s.meals_count > 0 ? ` <span class="meal-flag" title="${s.meals_count} repas pris">${s.meals_count} repas</span>` : ''}</div>
          <div class="live-detail">${detail}</div>
        </div>
      `;
      chip.addEventListener('click', () => openShiftModal(s));
      grid.appendChild(chip);
    });
  }

  // Today's shifts table (all shifts with business_date = today)
  const today = todayISO();
  const todayShifts = state.shifts.filter(s => s.business_date === today);
  const tbody = $('#today-rows');
  tbody.innerHTML = '';

  if (todayShifts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">aucun pointage aujourd\'hui</td></tr>';
  } else {
    todayShifts.forEach(s => {
      const m = computeShiftMinutes(s);
      const st = shiftState(s);
      const staff = state.staff.find(x => x.id === s.staff_id) || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="name-cell">
            <span class="name-dot" style="background:${staff.color || '#5a8a6b'}"></span>
            ${escapeHTML(s.staff_name)}${s.meals_count > 0 ? ` <span class="meal-flag" title="${s.meals_count} repas pris">${s.meals_count} repas</span>` : ''}
          </div>
        </td>
        <td class="mono">${fmtTime(s.started_at)}</td>
        <td class="mono">${s.ended_at ? fmtTime(s.ended_at) : `<span class="row-status open">en cours</span>`}</td>
        <td class="mono">${fmtDuration(m.pause)}</td>
        <td class="mono"><strong>${fmtDuration(m.net)}</strong></td>
        <td><button class="row-edit-btn" data-shift="${s.id}">éditer</button></td>
      `;
      tr.querySelector('.row-edit-btn').addEventListener('click', () => openShiftModal(s));
      tbody.appendChild(tr);
    });
  }
}

// ── HOURS VIEW ───────────────────────────────────────────────────────────────
function renderStaffFilter() {
  const wrap = $('#staff-filter');
  // Keep "Tous" chip, append staff
  const allChip = wrap.querySelector('[data-staff="all"]');
  wrap.innerHTML = '';
  wrap.appendChild(allChip);
  state.staff.filter(s => s.active).forEach(s => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.staffFilter === s.id ? ' active' : '');
    chip.dataset.staff = s.id;
    chip.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px;vertical-align:middle;"></span>${escapeHTML(s.name)}`;
    chip.addEventListener('click', () => {
      state.staffFilter = s.id;
      $$('#staff-filter .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderHours();
    });
    wrap.appendChild(chip);
  });
}

async function renderHours() {
  computeRange(state.range.kind);
  await loadShiftsForRange();

  // Planned hours + per-day validations for the range
  const [planRes, valRes] = await Promise.all([
    bySite(sb.from('planning').select('*')
      .gte('business_date', state.range.start).lte('business_date', state.range.end)),
    bySite(sb.from('validations').select('id, shift_ids')
      .gte('range_start', state.range.start).lte('range_start', state.range.end)),
  ]);
  const rangePlanning = planRes.data || [];
  const validatedShiftIds = new Set();
  (valRes.data || []).forEach(v => (v.shift_ids || []).forEach(id => validatedShiftIds.add(id)));
  await loadSignoffsForRange();
  await loadSickLeavesForRange();
  await loadPendingSignoffs();
  renderPendingBar();

  // Apply staff filter
  let shifts = state.shifts;
  if (state.staffFilter !== 'all') {
    shifts = shifts.filter(s => s.staff_id === state.staffFilter);
  }

  // Group by staff
  const byStaff = new Map();
  const ensureGroup = (staffId) => {
    if (!byStaff.has(staffId)) {
      byStaff.set(staffId, { staff: state.staff.find(x => x.id === staffId), shifts: [], totalNet: 0, leave: [] });
    }
    return byStaff.get(staffId);
  };
  shifts.forEach(s => {
    const m = computeShiftMinutes(s);
    const entry = ensureGroup(s.staff_id);
    entry.shifts.push({ ...s, _net: m.net, _pause: m.pause, _total: m.total });
    entry.totalNet += m.net;
  });

  // Fold in CP/CM leave days (shared with the planning tab). Staff with only
  // leave and no worked shifts still appear.
  let leaveList = rangePlanning.filter(isLeaveSlot);
  if (state.staffFilter !== 'all') leaveList = leaveList.filter(p => p.staff_id === state.staffFilter);
  leaveList.forEach(p => ensureGroup(p.staff_id).leave.push(p));

  // Staff with a CM (arrêt maladie) range but no worked shifts / CP still appear.
  state.sickLeaves.forEach(sl => {
    if (state.staffFilter !== 'all' && sl.staff_id !== state.staffFilter) return;
    ensureGroup(sl.staff_id);
  });

  // Per-group sums. CP credits paid hours. CM (arrêt maladie) is a separate
  // date-range, reported as a count of scheduled working days — never paid hours.
  byStaff.forEach(g => {
    g.cpMin = g.leave.filter(p => offSlotInfo(p).type === 'CP').reduce((s, p) => s + leaveMinutes(p), 0);
    g.paidTotal = g.totalNet + g.cpMin;
    g.leave.sort((a, b) => a.business_date.localeCompare(b.business_date));
    g.cmRanges = state.sickLeaves
      .filter(sl => sl.staff_id === g.staff?.id)
      .map(sl => ({ ...sl, _days: sickLeaveWorkingDays(rangePlanning, sl.staff_id, sl.start_date, sl.end_date) }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    g.cmDays = g.cmRanges.reduce((s, r) => s + r._days, 0);
  });

  // Pôle filter (cuisine / salle / snack) — staff with no pôle drop out of a specific filter.
  let groupList = Array.from(byStaff.values());
  if (state.hoursPole !== 'all') {
    groupList = groupList.filter(g => g.staff?.pole === state.hoursPole);
  }

  // Sort: A‑Z by name, or by display order.
  const groups = groupList.sort((a, b) => {
    if (state.hoursSort === 'az') {
      return (a.staff?.name || '').localeCompare(b.staff?.name || '', 'fr');
    }
    return (a.staff?.display_order ?? 999) - (b.staff?.display_order ?? 999);
  });

  // Per-staff count of open correction requests (all-time, site-scoped).
  const disputeCountByStaff = new Map();
  pendingDemands().forEach(so => {
    disputeCountByStaff.set(so.staff_id, (disputeCountByStaff.get(so.staff_id) || 0) + 1);
  });

  // Summary cards
  const summary = $('#hours-summary');
  summary.innerHTML = '';
  if (groups.length === 0) {
    summary.innerHTML = '<div class="empty">aucune heure dans cette période</div>';
  } else {
    groups.forEach(g => {
      if (!g.staff) return;
      const card = document.createElement('div');
      card.className = 'summary-card';
      const days = new Set(g.shifts.map(s => s.business_date)).size;
      const avg = days > 0 ? g.totalNet / days : 0;

      // Planned minutes from the planning grid for this staff in the range
      const plannedMin = rangePlanning
        .filter(p => p.staff_id === g.staff.id && !isOffSlot(p))
        .reduce((sum, p) => sum + creneauNetMinutes(p), 0);

      // Compute estimated hours for the range based on contract
      const days_in_range = daysBetween(state.range.start, state.range.end) + 1;
      const weeks_in_range = days_in_range / 7;
      const expectedH = (g.staff.contract_h || 35) * weeks_in_range;
      const expectedMin = expectedH * 60;
      const diff = g.paidTotal - expectedMin;

      let warn = '';
      if (Math.abs(diff) > 60) {
        warn = `<div class="summary-warn">${diff > 0 ? '+' : ''}${fmtDuration(diff)} vs contrat (${expectedH.toFixed(1)}h)</div>`;
      }

      const leaveLine = (g.cpMin > 0 || g.cmDays > 0)
        ? `<div class="summary-leave">travaillé ${fmtDuration(g.totalNet)}${g.cpMin > 0 ? ` · <span class="lv cp">CP ${fmtDuration(g.cpMin)}</span>` : ''}${g.cmDays > 0 ? ` · <span class="lv cm">CM ${g.cmDays} j</span>` : ''}</div>`
        : '';

      const disputeN = disputeCountByStaff.get(g.staff.id) || 0;
      card.innerHTML = `
        <div class="summary-name">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.staff.color};"></span>
          ${escapeHTML(g.staff.name)}
          ${disputeN > 0 ? `<span class="pending-bubble" title="${disputeN} demande${disputeN > 1 ? 's' : ''} à traiter">${disputeN}</span>` : ''}
        </div>
        <div class="summary-total">${fmtDuration(g.paidTotal)}</div>
        ${leaveLine}
        <div class="summary-planned">planifié · ${plannedMin > 0 ? fmtDuration(plannedMin) : '—'}</div>
        <div class="summary-detail">
          ${g.shifts.length} services · ${days} jours · ${fmtDuration(avg)}/jour moyen
        </div>
        ${warn}
        <button class="summary-add" type="button">＋ Ajouter un service</button>
      `;
      card.querySelector('.summary-add').addEventListener('click', () => {
        openShiftModal(null, { staffId: g.staff.id });
      });
      summary.appendChild(card);
    });
  }

  // Detail table
  const detail = $('#hours-detail');
  detail.innerHTML = '';
  groups.forEach(g => {
    if (!g.staff) return;
    const wrap = document.createElement('div');
    wrap.className = 'detail-staff';
    const pendingAll = g.shifts.filter(s => !validatedShiftIds.has(s.id));
    wrap.innerHTML = `
      <div class="detail-staff-head">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.staff.color};"></span>
        <span class="detail-staff-name">${escapeHTML(g.staff.name)}</span>
        ${(disputeCountByStaff.get(g.staff.id) || 0) > 0 ? `<span class="pending-bubble" title="${disputeCountByStaff.get(g.staff.id)} demande(s) à traiter">${disputeCountByStaff.get(g.staff.id)}</span>` : ''}
        ${state.site === 'all' ? `<span class="etab-badge etab-${g.staff.etablissement}">${g.staff.etablissement === 'chez-nous' ? 'Chez Nous' : 'Tornet'}</span>` : ''}
        <span class="detail-staff-total">${fmtDuration(g.paidTotal)}${g.cpMin > 0 ? `<span class="lv cp"> (dont CP ${fmtDuration(g.cpMin)})</span>` : ''}</span>
        ${pendingAll.length > 0 ? `<button class="bulk-validate all" type="button">Tout valider (${pendingAll.length})</button>` : ''}
        <span class="detail-toggle">›</span>
      </div>
      <div class="detail-shifts"></div>
    `;
    if (pendingAll.length > 0) {
      wrap.querySelector('.bulk-validate.all').addEventListener('click', (e) => {
        e.stopPropagation();
        validateMany(pendingAll);
      });
    }
    const shiftsWrap = wrap.querySelector('.detail-shifts');

    // ── Congés payés (CP) — add / modify / remove on specific days ──
    const leaveSection = document.createElement('div');
    leaveSection.className = 'leave-section';
    const leaveRows = g.leave.map(p => {
      const info = offSlotInfo(p);
      return `<div class="leave-entry ${info.cls}" data-plan="${p.id}">
        <span class="leave-tag">${info.label}</span>
        <span class="leave-date">${fmtDateShort(new Date(p.business_date))}</span>
        <span class="leave-hours">${fmtDuration(leaveMinutes(p))}</span>
        <button class="leave-edit" type="button" title="Modifier">modifier</button>
        <button class="leave-del" type="button" title="Supprimer">✕</button>
      </div>`;
    }).join('');
    leaveSection.innerHTML = `
      <div class="leave-head">
        <span class="leave-head-label">Congés payés</span>
        <button class="leave-add" type="button">＋ CP</button>
      </div>
      <div class="leave-list">${leaveRows || '<span class="leave-empty">aucun congé payé sur la période</span>'}</div>
    `;
    leaveSection.querySelector('.leave-add').addEventListener('click', (e) => {
      e.stopPropagation();
      openLeaveModal(g.staff.id, null, null);
    });
    leaveSection.querySelectorAll('.leave-entry').forEach(row => {
      const slot = g.leave.find(p => p.id === row.dataset.plan);
      row.querySelector('.leave-edit').addEventListener('click', (e) => { e.stopPropagation(); openLeaveModal(g.staff.id, slot.business_date, slot); });
      row.querySelector('.leave-del').addEventListener('click', (e) => { e.stopPropagation(); removeLeave(slot.id); });
    });
    shiftsWrap.appendChild(leaveSection);

    // ── Arrêts maladie (CM) — date ranges, counted in scheduled working days ──
    const cmSection = document.createElement('div');
    cmSection.className = 'leave-section';
    const cmRows = (g.cmRanges || []).map(r => `
      <div class="leave-entry cm" data-cm="${r.id}">
        <span class="leave-tag">CM</span>
        <span class="leave-date">du ${fmtDateShort(new Date(r.start_date))} au ${fmtDateShort(new Date(r.end_date))}</span>
        <span class="leave-hours">${r._days} j</span>
        <button class="leave-edit" type="button" title="Modifier">modifier</button>
        <button class="leave-del" type="button" title="Supprimer">✕</button>
      </div>`).join('');
    cmSection.innerHTML = `
      <div class="leave-head">
        <span class="leave-head-label">Arrêts maladie</span>
        <button class="cm-add" type="button">＋ Arrêt maladie</button>
      </div>
      <div class="leave-list">${cmRows || '<span class="leave-empty">aucun arrêt sur la période</span>'}</div>
    `;
    cmSection.querySelector('.cm-add').addEventListener('click', (e) => {
      e.stopPropagation();
      openSickModal(g.staff.id, null);
    });
    cmSection.querySelectorAll('.leave-entry').forEach(row => {
      const sl = g.cmRanges.find(r => r.id === row.dataset.cm);
      row.querySelector('.leave-edit').addEventListener('click', (e) => { e.stopPropagation(); openSickModal(g.staff.id, sl); });
      row.querySelector('.leave-del').addEventListener('click', (e) => { e.stopPropagation(); removeSickLeave(sl.id); });
    });
    shiftsWrap.appendChild(cmSection);

    const weeks = new Map();
    const weekOrder = [];
    g.shifts.forEach(s => {
      const ws = weekStartISO(s.business_date);
      if (!weeks.has(ws)) { weeks.set(ws, []); weekOrder.push(ws); }
      weeks.get(ws).push(s);
    });

    weekOrder.forEach(ws => {
      const weekShifts = weeks.get(ws);
      const weekPending = weekShifts.filter(s => !validatedShiftIds.has(s.id));
      const weekHeader = document.createElement('div');
      weekHeader.className = 'detail-week';

      const signoff = state.signoffs.find(
        so => so.staff_id === g.staff.id && so.week_start === ws
      );
      let signoffHTML = '';
      if (signoff) {
        if (signoff.employee_signed_at) {
          const when = new Date(signoff.employee_signed_at).toLocaleDateString('fr-FR');
          if (signoff.has_dispute) {
            signoffHTML = `<span class="signoff-badge dispute">Correction demandée par ${escapeHTML(signoff.employee_name || '—')} · ${when}</span>
              <span class="signoff-dispute-note">${escapeHTML(signoff.dispute_note || '')}</span>
              <button class="btn-signoff resend" type="button" data-staff="${g.staff.id}" data-week="${ws}">Corriger et renvoyer</button>`;
          } else {
            signoffHTML = `<span class="signoff-badge signed">Signé par ${escapeHTML(signoff.employee_name || '—')} · ${when}</span>`;
          }
        } else {
          signoffHTML = `<span class="signoff-badge pending">En attente de signature</span>
            <button class="btn-signoff resend" type="button" data-staff="${g.staff.id}" data-week="${ws}">Renvoyer</button>`;
        }
      } else if (weekPending.length === 0) {
        signoffHTML = `<button class="btn-signoff send" type="button" data-staff="${g.staff.id}" data-week="${ws}">Envoyer pour signature</button>`;
      }

      weekHeader.innerHTML = `
        <span class="detail-week-label">${weekRangeLabel(ws)}</span>
        ${weekPending.length > 0 ? `<button class="bulk-validate week" type="button">Valider la semaine (${weekPending.length})</button>` : ''}
        ${signoffHTML}
      `;
      if (weekPending.length > 0) {
        weekHeader.querySelector('.bulk-validate.week').addEventListener('click', () => {
          validateMany(weekPending);
        });
      }
      shiftsWrap.appendChild(weekHeader);
      const sendBtn = weekHeader.querySelector('.btn-signoff.send, .btn-signoff.resend');
      if (sendBtn) {
        sendBtn.addEventListener('click', () => {
          sendForSignature(sendBtn.dataset.staff, sendBtn.dataset.week, weekShifts);
        });
      }

      weekShifts.forEach(s => {
        const row = document.createElement('div');
        const isValidated = validatedShiftIds.has(s.id);
        row.className = 'detail-shift' + (isValidated ? ' validated' : '');
        row.innerHTML = `
          <span class="shift-date">${fmtDateShort(new Date(s.business_date))}</span>
          <span class="mono">${fmtTime(s.started_at)}</span>
          <span class="mono">${s.ended_at ? fmtTime(s.ended_at) : '— en cours'}</span>
          <span class="mono">${s._pause > 0 ? 'p ' + fmtDuration(s._pause) : ''}</span>
          <span class="shift-net">${fmtDuration(s._net)}</span>
          <span class="shift-src">${s.meals_count > 0 ? `<span class="meal-flag" title="${s.meals_count} repas pris">${s.meals_count} repas</span> ` : ''}${s.source === 'manager_edit' ? '✎ édité' : s.source === 'manager_create' ? '＋ créé' : ''}</span>
          <button class="shift-validate${isValidated ? ' on' : ''}" type="button">${isValidated ? '✓ validé' : 'valider'}</button>
        `;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.shift-validate')) return;
          openShiftModal(s);
        });
        row.querySelector('.shift-validate').addEventListener('click', (e) => {
          e.stopPropagation();
          toggleShiftValidation(s);
        });
        shiftsWrap.appendChild(row);
      });
    });

    wrap.querySelector('.detail-staff-head').addEventListener('click', () => {
      wrap.classList.toggle('open');
    });
    detail.appendChild(wrap);
  });
}

// ── PENDING (demandes + à signer) ────────────────────────────────────────────
function renderPendingBar() {
  const demands = pendingDemands().length;
  const toSign = pendingSignature().length;

  const dBubble = $('#pending-demands-bubble');
  const dPill = $('#pending-demands');
  if (dBubble && dPill) {
    dBubble.textContent = demands;
    dPill.classList.toggle('has', demands > 0);
    dPill.classList.toggle('muted', demands === 0);
  }
  const sCount = $('#pending-signature-count');
  const sPill = $('#pending-signature');
  if (sCount && sPill) {
    sCount.textContent = toSign;
    sPill.classList.toggle('muted', toSign === 0);
  }
}

function openPendingModal(kind) {
  state._pendingModalKind = kind;
  $$('.pending-tab').forEach(t => t.classList.toggle('active', t.dataset.pending === kind));
  $('#pending-modal-title').textContent =
    kind === 'demands' ? 'Demandes à traiter' : 'En attente de signature';
  renderPendingList();
  $('#pending-modal').classList.remove('hidden');
}

function renderPendingList() {
  const kind = state._pendingModalKind;
  const list = $('#pending-list');
  const items = kind === 'demands' ? pendingDemands() : pendingSignature();

  if (items.length === 0) {
    list.innerHTML = `<div class="empty">${kind === 'demands' ? 'aucune demande à traiter' : 'rien en attente de signature'}</div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach(so => {
    const staff = state.staff.find(s => s.id === so.staff_id);
    const name = staff?.name || so.employee_name || '—';
    const row = document.createElement('div');
    row.className = 'pending-item' + (kind === 'demands' ? ' dispute' : '');
    const meta = kind === 'demands'
      ? `<div class="pending-item-note">${escapeHTML(so.dispute_note || 'Correction demandée, sans note')}</div>`
      : `<div class="pending-item-sub">envoyé le ${so.sent_at ? new Date(so.sent_at).toLocaleDateString('fr-FR') : '—'}</div>`;
    row.innerHTML = `
      <div class="pending-item-main">
        <div class="pending-item-name">
          ${escapeHTML(name)}
          ${state.site === 'all' && staff ? `<span class="etab-badge etab-${staff.etablissement}">${staff.etablissement === 'chez-nous' ? 'Chez Nous' : 'Tornet'}</span>` : ''}
        </div>
        <div class="pending-item-week">${weekRangeLabel(so.week_start)}</div>
        ${meta}
      </div>
      <button class="btn-mini pending-open" type="button">Ouvrir →</button>
    `;
    row.querySelector('.pending-open').addEventListener('click', () => jumpToSignoff(so));
    list.appendChild(row);
  });
}

// Jump the Heures view to a specific staff member + the week of a sign-off,
// so the manager can act on it inline with the live shifts.
function jumpToSignoff(so) {
  closeModal('#pending-modal');
  state.staffFilter = so.staff_id;
  state.hoursPole = 'all';
  state.range = { start: so.week_start, end: so.week_end, kind: 'custom' };
  // Sync the controls UI.
  $$('#hours-pole-filter .pole-btn').forEach(b => b.classList.toggle('active', b.dataset.pole === 'all'));
  $$('.range-chips .chip').forEach(c => c.classList.remove('active'));
  renderHours().then(() => {
    const wrap = $('#hours-detail .detail-staff');
    if (wrap) wrap.classList.add('open');
  });
}

// Duration of a planning créneau in minutes (handles overnight slots).
function creneauMinutes(p) {
  const toMin = t => { const [h, m] = (t || '0:0').split(':'); return (+h) * 60 + (+m); };
  let s = toMin(p.starts_at), e = toMin(p.ends_at);
  if (p.ends_next_day || e < s) e += 1440;
  return Math.max(0, e - s);
}

function creneauNetMinutes(p) {
  return Math.max(0, creneauMinutes(p) - (p.pause_minutes || 0));
}

async function toggleShiftValidation(shift) {
  const { data: existing, error: qErr } = await sb
    .from('validations').select('id').contains('shift_ids', [shift.id]);
  if (qErr) { console.error(qErr); toast('Impossible', 'error'); return; }

  if (existing && existing.length) {
    const { error } = await sb.from('validations').delete().in('id', existing.map(v => v.id));
    if (error) { console.error(error); toast('Impossible', 'error'); return; }
    toast('Validation retirée');
  } else {
    const net = computeShiftMinutes(shift).net || 0;
    const { error } = await sb.from('validations').insert({
      staff_id: shift.staff_id,
      range_start: shift.business_date,
      range_end: shift.business_date,
      scope: 'custom',
      total_minutes: net,
      shift_ids: [shift.id],
      validated_by: state.managerName || 'manager',
      note: null,
      etablissement: shift.etablissement || defaultEtab(),
    });
    if (error) { console.error(error); toast('Validation impossible', 'error'); return; }
    toast('Jour validé ✓');
  }
  renderHours();
}

async function sendForSignature(staffId, weekISO, shifts) {
  if (!shifts.length) { toast('Aucun service à envoyer', 'error'); return; }
  const weekEnd = isoFromDate(addDays(new Date(weekISO), 6));
  const { error } = await sb
    .from('staff_signoffs')
    .upsert({
      staff_id: staffId,
      week_start: weekISO,
      week_end: weekEnd,
      shift_ids: shifts.map(s => s.id),
      sent_by: state.managerName || 'manager',
      sent_at: new Date().toISOString(),
      employee_signed_at: null,
      employee_name: null,
      has_dispute: false,
      dispute_note: null,
      etablissement: (state.staff.find(x => x.id === staffId)?.etablissement) || defaultEtab(),
    }, { onConflict: 'staff_id,week_start' });
  if (error) { console.error(error); toast('Envoi impossible', 'error'); return; }
  toast('Envoyé pour signature');
  await loadSignoffsForRange();
  renderHours();
}

async function validateMany(shifts) {
  if (!shifts.length) return;
  const rows = shifts.map(s => ({
    staff_id: s.staff_id,
    range_start: s.business_date,
    range_end: s.business_date,
    scope: 'custom',
    total_minutes: computeShiftMinutes(s).net || 0,
    shift_ids: [s.id],
    validated_by: state.managerName || 'manager',
    note: null,
    etablissement: s.etablissement || defaultEtab(),
  }));
  const { error } = await sb.from('validations').insert(rows);
  if (error) { console.error(error); toast('Validation impossible', 'error'); return; }
  toast(`${shifts.length} service${shifts.length > 1 ? 's' : ''} validé${shifts.length > 1 ? 's' : ''} ✓`);
  renderHours();
}

function weekStartISO(dateISO) {
  const d = new Date(dateISO + 'T00:00:00');
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - dow + 1);
  return d.toISOString().slice(0, 10);
}

function weekRangeLabel(weekISO) {
  const start = new Date(weekISO + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `Semaine du ${fmtDateShort(start)} au ${fmtDateShort(end)}`;
}

function daysBetween(startISO, endISO) {
  const a = new Date(startISO), b = new Date(endISO);
  return Math.round((b - a) / 86400000);
}

// ── SHIFT MODAL ──────────────────────────────────────────────────────────────
function openShiftModal(shift, opts = {}) {
  state.editing.shift = shift ? { ...shift } : null;

  // Fill staff select
  const sel = $('#shift-staff');
  sel.innerHTML = '';
  state.staff.filter(s => s.active).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });

  if (shift) {
    sel.value = shift.staff_id;
    $('#shift-date').value = shift.business_date;
    $('#shift-start').value = shift.started_at ? new Date(shift.started_at).toTimeString().slice(0,5) : '';
    $('#shift-end').value = shift.ended_at ? new Date(shift.ended_at).toTimeString().slice(0,5) : '';
    const m = computeShiftMinutes(shift);
    $('#shift-pause').value = m.pause;
    $('#shift-note').value = '';
    $('#shift-delete').classList.remove('hidden');
    setMealPicker(shift.meals_count || 0);
    updateShiftTotals();
  } else {
    sel.value = opts.staffId || state.staff[0]?.id || '';
    $('#shift-date').value = todayISO();
    $('#shift-start').value = '';
    $('#shift-end').value = '';
    $('#shift-pause').value = 0;
    $('#shift-note').value = '';
    $('#shift-delete').classList.add('hidden');
    setMealPicker(0);
    $('#shift-totals').textContent = '—';
  }

  ['#shift-start', '#shift-end', '#shift-pause'].forEach(s => {
    $(s).oninput = updateShiftTotals;
  });

  $('#shift-modal').classList.remove('hidden');
}

function setMealPicker(count) {
  const picker = $('#shift-meal');
  picker.dataset.meals = String(count);
  picker.querySelectorAll('.meal-opt').forEach(btn => {
    const v = Number(btn.dataset.meals);
    btn.classList.toggle('active', v === count);
    btn.onclick = () => setMealPicker(v);
  });
}

function updateShiftTotals() {
  const date = $('#shift-date').value;
  const startStr = $('#shift-start').value;
  const endStr = $('#shift-end').value;
  const pauseMin = parseInt($('#shift-pause').value) || 0;

  if (!date || !startStr || !endStr) {
    $('#shift-totals').textContent = 'remplis début et fin pour voir le total';
    return;
  }

  const start = new Date(`${date}T${startStr}:00`);
  let end = new Date(`${date}T${endStr}:00`);
  if (end <= start) {
    // Cross-midnight: add 1 day to end
    end = new Date(end.getTime() + 86400000);
  }
  const totalMin = Math.round((end - start) / 60000);
  const netMin = Math.max(0, totalMin - pauseMin);
  $('#shift-totals').textContent =
    `Total: ${fmtDuration(totalMin)} · Pause: ${fmtDuration(pauseMin)} · Net: ${fmtDuration(netMin)}`;
}

async function saveShift() {
  const staffId = $('#shift-staff').value;
  const date = $('#shift-date').value;
  const startStr = $('#shift-start').value;
  const endStr = $('#shift-end').value;
  const pauseMin = parseInt($('#shift-pause').value) || 0;
  const note = $('#shift-note').value.trim();

  if (!staffId || !date || !startStr) {
    toast('Staff, date et début sont requis', 'error');
    return;
  }

  const staff = state.staff.find(s => s.id === staffId);
  const startedAt = new Date(`${date}T${startStr}:00`);
  let endedAt = null;
  let pauses = [];

  if (endStr) {
    endedAt = new Date(`${date}T${endStr}:00`);
    if (endedAt <= startedAt) {
      endedAt = new Date(endedAt.getTime() + 86400000);
    }
    if (pauseMin > 0) {
      // Synthesize a single pause segment in the middle
      const midMs = startedAt.getTime() + Math.floor((endedAt - startedAt) / 2) - (pauseMin * 30000); // center the pause
      const pStart = new Date(midMs).toISOString();
      const pEnd = new Date(midMs + pauseMin * 60000).toISOString();
      pauses = [{ start: pStart, end: pEnd }];
    }
  }

  const total = endedAt ? Math.round((endedAt - startedAt) / 60000) : null;
  const net = total != null ? Math.max(0, total - pauseMin) : null;

  const payload = {
    staff_id: staffId,
    staff_name: staff.name,
    business_date: date,
    started_at: startedAt.toISOString(),
    ended_at: endedAt ? endedAt.toISOString() : null,
    pauses,
    total_minutes: total,
    pause_minutes: pauseMin,
    net_minutes: net,
    source: state.editing.shift ? 'manager_edit' : 'manager_create',
    note: note || null,
    meals_count: parseInt($('#shift-meal').dataset.meals, 10) || 0,
    updated_at: new Date().toISOString(),
  };

  let res;
  if (state.editing.shift) {
    // Audit
    await sb.from('shift_edits').insert({
      shift_id: state.editing.shift.id,
      edited_by: state.managerName || 'manager',
      before_json: state.editing.shift,
      after_json: payload,
      reason: note || null,
      etablissement: state.editing.shift.etablissement || defaultEtab(),
    });
    res = await sb.from('shifts').update(payload).eq('id', state.editing.shift.id).select().single();
  } else {
    res = await sb.from('shifts').insert({ ...payload, etablissement: defaultEtab() }).select().single();
  }

  if (res.error) { console.error(res.error); toast('Sauvegarde impossible', 'error'); return; }

  toast('Service enregistré');
  closeModal('#shift-modal');
  await loadLiveShifts();
  await loadShiftsForRange();
  if (state.activeTab === 'today') renderToday();
  if (state.activeTab === 'hours') renderHours();
}

async function deleteShift() {
  if (!state.editing.shift) return;
  if (!confirm(`Supprimer ce service de ${state.editing.shift.staff_name} ?`)) return;
  const { error } = await sb.from('shifts').delete().eq('id', state.editing.shift.id);
  if (error) { toast('Suppression impossible', 'error'); return; }
  toast('Supprimé');
  closeModal('#shift-modal');
  await loadLiveShifts();
  await loadShiftsForRange();
  if (state.activeTab === 'today') renderToday();
  if (state.activeTab === 'hours') renderHours();
}

// ── STAFF LIST ───────────────────────────────────────────────────────────────
function renderStaffList() {
  const list = $('#staff-list');
  list.innerHTML = '';

  if (state.staff.length === 0) {
    list.innerHTML = '<div class="empty">aucun membre. ajoute-en un.</div>';
    return;
  }

  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const q = norm(state.staffSearch.trim());

  const sorted = state.staff
    .filter(s => {
      if (state.staffStatusFilter === 'active' && !s.active) return false;
      if (state.staffStatusFilter === 'inactive' && s.active) return false;
      if (q && !norm(s.name).includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      // Active first, then newest (highest display_order) first; inactive sink to bottom.
      if (!!a.active !== !!b.active) return a.active ? -1 : 1;
      const ord = (b.display_order ?? 0) - (a.display_order ?? 0);
      if (ord !== 0) return ord;
      return a.name.localeCompare(b.name);
    });

  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty">aucun résultat</div>';
    return;
  }

  sorted.forEach(s => {
    const card = document.createElement('div');
    card.className = 'staff-card' + (s.active ? '' : ' inactive');
    card.innerHTML = `
      <div class="staff-color" style="background:${s.color}"></div>
      <div class="staff-card-info">
        <div class="staff-card-name">${escapeHTML(s.name)}</div>
        <div class="staff-card-meta">${s.contract_h ?? 35}h/sem · ${s.active ? 'actif' : 'inactif'}</div>
      </div>
      <div class="staff-card-pin">${escapeHTML(s.pin)}</div>
    `;
    card.addEventListener('click', () => openStaffModal(s));
    list.appendChild(card);
  });
}

function openStaffModal(staff) {
  state.editing.staffRow = staff;
  if (staff) {
    $('.modal-title', $('#staff-modal')).textContent = 'Modifier · ' + staff.name;
    $('#staff-name').value = staff.name;
    $('#staff-pin').value = staff.pin;
    $('#staff-contract').value = staff.contract_h ?? 35;
    $('#staff-color').value = staff.color || '#5a8a6b';
    $('#staff-rate').value = staff.hourly_rate ?? '';
    $('#staff-etab').value = staff.etablissement || defaultEtab();
    $('#staff-pole').value = staff.pole || '';
    $('#staff-active').checked = staff.active;
    $('#staff-delete').classList.remove('hidden');
  } else {
    $('.modal-title', $('#staff-modal')).textContent = 'Nouveau membre';
    $('#staff-name').value = '';
    $('#staff-pin').value = '';
    $('#staff-contract').value = 35;
    $('#staff-color').value = '#5a8a6b';
    $('#staff-rate').value = '';
    $('#staff-etab').value = defaultEtab();
    $('#staff-pole').value = '';
    $('#staff-active').checked = true;
    $('#staff-delete').classList.add('hidden');
  }
  $('#staff-modal').classList.remove('hidden');
}

async function saveStaff() {
  const name = $('#staff-name').value.trim();
  const pin = $('#staff-pin').value.trim();
  const contract = parseFloat($('#staff-contract').value) || 35;
  const color = $('#staff-color').value;
  const rate = parseFloat($('#staff-rate').value) || null;
  const etablissement = $('#staff-etab').value;
  const pole = $('#staff-pole').value || null;
  const active = $('#staff-active').checked;

  if (!name) { toast('Nom requis', 'error'); return; }
  if (!/^[0-9]{4}$/.test(pin)) { toast('PIN à 4 chiffres requis', 'error'); return; }

  const payload = { name, pin, contract_h: contract, color, hourly_rate: rate, active, etablissement, pole };

  let res;
  if (state.editing.staffRow) {
    res = await sb.from('staff').update(payload).eq('id', state.editing.staffRow.id).select().single();
  } else {
    res = await sb.from('staff').insert({ ...payload, display_order: (state.staff.length + 1) * 10 }).select().single();
  }

  if (res.error) {
    if (res.error.message?.includes('duplicate')) toast('Ce PIN est déjà utilisé', 'error');
    else { console.error(res.error); toast('Sauvegarde impossible', 'error'); }
    return;
  }
  toast('Enregistré');
  closeModal('#staff-modal');
  await loadStaff();
  renderStaffList();
  renderStaffFilter();
}

async function deleteStaff() {
  if (!state.editing.staffRow) return;
  if (!confirm(`Désactiver ${state.editing.staffRow.name} ? (les services passés sont conservés)`)) return;
  const { error } = await sb.from('staff').update({ active: false, archived_at: new Date().toISOString() }).eq('id', state.editing.staffRow.id);
  if (error) { toast('Impossible', 'error'); return; }
  toast('Désactivé');
  closeModal('#staff-modal');
  await loadStaff();
  renderStaffList();
  renderStaffFilter();
}

// ── PLANNING ─────────────────────────────────────────────────────────────────
async function openPlanning() {
  if (!state.planningWeekStart) {
    state.planningWeekStart = isoFromDate(mondayOf(new Date()));
  }
  await renderPlanning();
}

async function renderPlanning() {
  const weekStart = new Date(state.planningWeekStart);
  const weekEnd = addDays(weekStart, 6);
  const weekEndISO = isoFromDate(weekEnd);

  $('#planning-week-label').textContent =
    `Semaine du ${weekStart.getDate()} ${monthShort(weekStart)} → ${weekEnd.getDate()} ${monthShort(weekEnd)}`;

  // Print-only legal header: which restaurant + which pole + which week
  const siteLabel = state.site === 'chez-nous' ? 'Chez Nous à la Plage'
    : state.site === 'tornet' ? 'Chalet du Tornet'
    : 'Tous établissements';
  const poleLabel = state.planningPole === 'all' ? 'Tous pôles'
    : state.planningPole.charAt(0).toUpperCase() + state.planningPole.slice(1);
  const ph = $('#plan-print-head');
  if (ph) ph.textContent = `${siteLabel} · ${poleLabel} · Semaine du ${weekStart.getDate()} ${monthShort(weekStart)} → ${weekEnd.getDate()} ${monthShort(weekEnd)}`;

  await loadPlanning(state.planningWeekStart, weekEndISO);

  // Build the grid
  const grid = $('#planning-grid');
  const todayIso = todayISO();
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));

  let html = '<thead><tr><th class="staff-col">Staff</th>';
  days.forEach(d => {
    const iso = isoFromDate(d);
    const isToday = iso === todayIso;
    html += `<th class="${isToday ? 'today' : ''}">${fmtDateShort(d)}</th>`;
  });
  html += '<th class="plan-week-col">Semaine</th>';
  html += '</tr></thead><tbody>';

  state.staff
    .filter(s => s.active && (state.planningPole === 'all' || s.pole === state.planningPole))
    .forEach(staff => {
    let weekMin = 0;
    html += `<tr><td class="staff-col">${escapeHTML(staff.name)}</td>`;
    days.forEach(d => {
      const iso = isoFromDate(d);
      const cellSlots = state.planning
        .filter(p => p.staff_id === staff.id && p.business_date === iso)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const offSlot = cellSlots.find(isOffSlot);
      html += `<td data-staff="${staff.id}" data-date="${iso}">`;
      if (offSlot) {
        const info = offSlotInfo(offSlot);
        const hrs = info.type !== 'OFF' && leaveMinutes(offSlot) > 0 ? ` · ${fmtDuration(leaveMinutes(offSlot))}` : '';
        html += `<div class="plan-off-chip ${info.cls}" data-plan="${offSlot.id}">${info.label}${hrs}</div>`;
      } else {
        let cellMin = 0;
        cellSlots.forEach(slot => {
          cellMin += creneauNetMinutes(slot);
          html += `<div class="plan-slot" style="border-left-color:${staff.color}" data-plan="${slot.id}">
            <div class="plan-time">${slot.starts_at.slice(0,5)}–${slot.ends_at.slice(0,5)}</div>
            ${slot.role_label ? `<div class="plan-role">${escapeHTML(slot.role_label)}</div>` : ''}
            ${slot.pause_minutes > 0 ? `<div class="plan-pause">pause ${slot.pause_minutes}</div>` : ''}
          </div>`;
        });
        weekMin += cellMin;
        if (cellMin > 0) {
          html += `<div class="plan-cell-total">${fmtDuration(cellMin)}</div>`;
        }
        html += `<div class="cell-actions">
          <button class="plan-add" type="button">+ créneau</button>
          <button class="plan-off" type="button">Repos</button>
          <button class="plan-cp" type="button">CP</button>
        </div>`;
      }
      html += '</td>';
    });
    html += `<td class="plan-week-total">
      ${weekMin > 0 ? fmtDuration(weekMin) : '—'}
      <button class="btn-copy-staff" type="button" data-staff-id="${staff.id}" data-staff-name="${escapeHTML(staff.name)}" title="Copier vers semaine suivante">→</button>
    </td>`;
    html += '</tr>';
  });
  html += '</tbody>';
  grid.innerHTML = html;

  // Wire cell clicks
  $$('tbody td', grid).forEach(td => {
    td.addEventListener('click', (e) => {
      const planSlot = e.target.closest('.plan-slot');
      if (planSlot) {
        const slot = state.planning.find(p => p.id === planSlot.dataset.plan);
        if (slot) openPlanModal(slot, td.dataset.staff, td.dataset.date);
        return;
      }
      if (e.target.closest('.plan-off-chip')) {
        clearDayMarker(td.dataset.staff, td.dataset.date);
        return;
      }
      if (e.target.closest('.plan-off')) { setDayMarker(td.dataset.staff, td.dataset.date, 'OFF'); return; }
      if (e.target.closest('.plan-cp'))  { setDayMarker(td.dataset.staff, td.dataset.date, 'CP');  return; }
      if (td.querySelector('.plan-off-chip')) return;
      openPlanModal(null, td.dataset.staff, td.dataset.date);
    });
  });

  // Wire per-staff copy buttons
  $$('.btn-copy-staff', grid).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyStaffWeekForward(btn.dataset.staffId, btn.dataset.staffName);
    });
  });
}

// An "off"/leave day is stored as a planning row with equal start and end times.
// The kind (Repos / CP / CM) lives in role_label.
function isOffSlot(p) {
  return p.starts_at === p.ends_at;
}

// Display info for a zero-duration day marker, derived from role_label.
function offSlotInfo(p) {
  const t = (p.role_label || 'OFF').toUpperCase();
  if (t === 'CP') return { type: 'CP', label: 'CP', cls: 'cp' };
  if (t === 'CM') return { type: 'CM', label: 'CM', cls: 'cm' };
  return { type: 'OFF', label: 'Repos', cls: 'off' };
}

function dayMarkerLabel(type) {
  return type === 'CP' ? 'Congé payé' : type === 'CM' ? 'Congé maladie' : 'Repos';
}

// A "leave" slot is a CP day marker (congé payé). It carries its credited
// minutes in pause_minutes (reused — a zero-duration slot has no real pause), so
// the paid hours per leave day are adjustable. Shared with the planning tab.
// CM (arrêt maladie) is no longer a per-day planning marker — it lives in the
// sick_leaves table as a date-range — so it is intentionally excluded here.
function isLeaveSlot(p) {
  return isOffSlot(p) && (p.role_label || '').toUpperCase() === 'CP';
}
function leaveMinutes(p) {
  return p.pause_minutes || 0;
}
// Default credited minutes for a new leave day, from the staff's weekly contract
// spread over a 5-day week (e.g. 35h → 7h, 39h → 7h48).
function defaultLeaveMinutes(staffId) {
  const s = state.staff.find(x => x.id === staffId);
  return Math.round(((s?.contract_h || 35) / 5) * 60);
}

// Number of CM (arrêt maladie) days for a date-range = distinct dates on which
// the staff had a REAL planned créneau (not a Repos/CP/OFF marker), within
// [startISO,endISO] ∩ the selected period. `planningRows` must be the period
// planning set (already clipped to state.range), so repos/week-ends — which have
// no créneau — naturally count as 0. Dates are 'YYYY-MM-DD' so string compare is safe.
function sickLeaveWorkingDays(planningRows, staffId, startISO, endISO) {
  const lo = startISO > state.range.start ? startISO : state.range.start;
  const hi = endISO   < state.range.end   ? endISO   : state.range.end;
  if (lo > hi) return 0;
  const days = new Set();
  for (const p of planningRows) {
    if (p.staff_id !== staffId || isOffSlot(p)) continue;
    if (p.business_date < lo || p.business_date > hi) continue;
    days.add(p.business_date);
  }
  return days.size;
}

function monthShort(d) {
  const months = ['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];
  return months[d.getMonth()];
}

function openPlanModal(slot, staffId, dateISO) {
  state.editing.planSlot = slot || { staff_id: staffId, business_date: dateISO };
  const staff = state.staff.find(s => s.id === staffId);
  $('#plan-context').textContent = `${staff?.name || '—'} · ${fmtDateFull(new Date(dateISO))}`;
  $('#plan-start').value = slot ? slot.starts_at.slice(0,5) : '';
  $('#plan-end').value = slot ? slot.ends_at.slice(0,5) : '';
  $('#plan-role').value = slot?.role_label || '';
  $('#plan-note').value = slot?.note || '';
  setPausePicker(slot?.pause_minutes || 0);
  $('#plan-delete').classList.toggle('hidden', !slot);
  $('#plan-modal').classList.remove('hidden');
}

function setPausePicker(minutes) {
  const picker = $('#plan-pause');
  picker.dataset.pause = String(minutes);
  picker.querySelectorAll('.meal-opt').forEach(btn => {
    const v = Number(btn.dataset.pause);
    btn.classList.toggle('active', v === minutes);
    btn.onclick = () => setPausePicker(v);
  });
}

async function savePlan() {
  const slot = state.editing.planSlot;
  const startStr = $('#plan-start').value;
  const endStr = $('#plan-end').value;
  if (!startStr || !endStr) { toast('Début et fin requis', 'error'); return; }
  if (startStr === endStr) { toast('Début et fin doivent différer', 'error'); return; }

  const payload = {
    staff_id: slot.staff_id,
    business_date: slot.business_date,
    starts_at: startStr + ':00',
    ends_at: endStr + ':00',
    ends_next_day: endStr < startStr, // simple cross-midnight detection
    role_label: $('#plan-role').value.trim() || null,
    note: $('#plan-note').value.trim() || null,
    pause_minutes: parseInt($('#plan-pause').dataset.pause, 10) || 0,
    updated_at: new Date().toISOString(),
  };

  let res;
  if (slot.id) {
    res = await sb.from('planning').update(payload).eq('id', slot.id);
  } else {
    res = await sb.from('planning').insert({ ...payload, etablissement: defaultEtab() });
  }
  if (res.error) { console.error(res.error); toast('Sauvegarde impossible', 'error'); return; }
  toast('Créneau enregistré');
  closeModal('#plan-modal');
  await renderPlanning();
}

async function deletePlan() {
  const slot = state.editing.planSlot;
  if (!slot?.id) return;
  if (!confirm('Supprimer ce créneau ?')) return;
  const { error } = await sb.from('planning').delete().eq('id', slot.id);
  if (error) { toast('Impossible', 'error'); return; }
  toast('Supprimé');
  closeModal('#plan-modal');
  await renderPlanning();
}

// Set (or toggle/switch) a whole-day marker — Repos / CP / CM — on a cell.
// Clicking the same type again clears it; a different type switches it.
async function setDayMarker(staffId, dateISO, type) {
  const label = dayMarkerLabel(type);
  const cellSlots = state.planning.filter(
    p => p.staff_id === staffId && p.business_date === dateISO
  );
  const offSlot = cellSlots.find(isOffSlot);

  if (offSlot) {
    if (offSlotInfo(offSlot).type === type) {
      const { error } = await sb.from('planning').delete().eq('id', offSlot.id);
      if (error) { console.error(error); toast('Impossible', 'error'); return; }
      toast(`${label} retiré`);
    } else {
      // Switching kind: Repos has no credited hours; CP/CM keep existing minutes
      // or get the default daily amount when coming from Repos.
      const newPause = type === 'OFF' ? 0 : (offSlot.pause_minutes || defaultLeaveMinutes(staffId));
      const { error } = await sb.from('planning')
        .update({ role_label: type, pause_minutes: newPause, updated_at: new Date().toISOString() })
        .eq('id', offSlot.id);
      if (error) { console.error(error); toast('Impossible', 'error'); return; }
      toast(`${label} marqué`);
    }
    await renderPlanning();
    return;
  }

  const creneaux = cellSlots.filter(p => !isOffSlot(p));
  if (creneaux.length &&
      !confirm(`Marquer ${label} ? Les créneaux du jour seront supprimés.`)) return;

  if (creneaux.length) {
    const { error } = await sb.from('planning').delete().in('id', creneaux.map(p => p.id));
    if (error) { console.error(error); toast('Impossible', 'error'); return; }
  }

  const { error } = await sb.from('planning').insert({
    staff_id: staffId,
    business_date: dateISO,
    starts_at: '00:00:00',
    ends_at: '00:00:00',
    ends_next_day: false,
    role_label: type,
    pause_minutes: type === 'OFF' ? 0 : defaultLeaveMinutes(staffId),
    note: null,
    updated_at: new Date().toISOString(),
    etablissement: defaultEtab(),
  });
  if (error) { console.error(error); toast('Impossible', 'error'); return; }
  toast(`${label} marqué`);
  await renderPlanning();
}

// Clicking an existing day-marker chip clears it.
async function clearDayMarker(staffId, dateISO) {
  const offSlot = state.planning.find(
    p => p.staff_id === staffId && p.business_date === dateISO && isOffSlot(p)
  );
  if (!offSlot) return;
  const label = dayMarkerLabel(offSlotInfo(offSlot).type);
  const { error } = await sb.from('planning').delete().eq('id', offSlot.id);
  if (error) { console.error(error); toast('Impossible', 'error'); return; }
  toast(`${label} retiré`);
  await renderPlanning();
}

// ── LEAVE MODAL (congé payé / CP from the Heures tab) ─────────────────────────
function openLeaveModal(staffId, dateISO, existing) {
  const staff = state.staff.find(s => s.id === staffId);
  state.editing.leave = { staffId, planId: existing?.id || null };
  $('#leave-context').textContent = staff ? staff.name : '—';
  $('#leave-date').value = dateISO || todayISO();
  const mins = existing ? leaveMinutes(existing) : defaultLeaveMinutes(staffId);
  $('#leave-hours').value = (mins / 60).toFixed(2).replace(/\.?0+$/, '');
  $('#leave-delete').classList.toggle('hidden', !existing);
  $('#leave-modal').classList.remove('hidden');
}

async function saveLeave() {
  const ed = state.editing.leave;
  if (!ed) return;
  const date = $('#leave-date').value;
  const type = 'CP';
  const hours = parseFloat($('#leave-hours').value);
  if (!date) { toast('Date requise', 'error'); return; }
  if (isNaN(hours) || hours < 0) { toast('Heures invalides', 'error'); return; }
  const minutes = Math.round(hours * 60);
  const staff = state.staff.find(s => s.id === ed.staffId);

  const payload = {
    business_date: date,
    starts_at: '00:00:00',
    ends_at: '00:00:00',
    ends_next_day: false,
    role_label: type,
    pause_minutes: minutes,
    note: null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (ed.planId) {
    ({ error } = await sb.from('planning').update(payload).eq('id', ed.planId));
  } else {
    // Avoid a duplicate leave/off slot on the same day — update it if present.
    const { data: existing } = await sb.from('planning')
      .select('id, starts_at, ends_at')
      .eq('staff_id', ed.staffId).eq('business_date', date);
    const off = (existing || []).find(p => p.starts_at === p.ends_at);
    if (off) {
      ({ error } = await sb.from('planning').update(payload).eq('id', off.id));
    } else {
      ({ error } = await sb.from('planning').insert({
        ...payload, staff_id: ed.staffId,
        etablissement: staff?.etablissement || defaultEtab(),
      }));
    }
  }
  if (error) { console.error(error); toast('Enregistrement impossible', 'error'); return; }
  toast('Congé enregistré');
  closeModal('#leave-modal');
  await renderHours();
}

async function deleteLeave() {
  const ed = state.editing.leave;
  if (!ed?.planId) { closeModal('#leave-modal'); return; }
  const { error } = await sb.from('planning').delete().eq('id', ed.planId);
  if (error) { console.error(error); toast('Suppression impossible', 'error'); return; }
  toast('Congé supprimé');
  closeModal('#leave-modal');
  await renderHours();
}

async function removeLeave(planId) {
  const { error } = await sb.from('planning').delete().eq('id', planId);
  if (error) { console.error(error); toast('Suppression impossible', 'error'); return; }
  toast('Congé supprimé');
  await renderHours();
}

// ── ARRÊT MALADIE MODAL (CM date-ranges, sick_leaves table) ───────────────────
function openSickModal(staffId, existing) {
  const staff = state.staff.find(s => s.id === staffId);
  state.editing.sick = { staffId, id: existing?.id || null };
  $('#sick-context').textContent = staff ? staff.name : '—';
  $('#sick-start').value = existing?.start_date || todayISO();
  $('#sick-end').value = existing?.end_date || todayISO();
  $('#sick-note').value = existing?.note || '';
  $('#sick-delete').classList.toggle('hidden', !existing);
  $('#sick-modal').classList.remove('hidden');
}

async function saveSickLeave() {
  const ed = state.editing.sick;
  if (!ed) return;
  const start = $('#sick-start').value;
  const end = $('#sick-end').value;
  if (!start || !end) { toast('Dates requises', 'error'); return; }
  if (end < start) { toast('La date de fin précède le début', 'error'); return; }
  const staff = state.staff.find(s => s.id === ed.staffId);
  const payload = {
    start_date: start,
    end_date: end,
    note: $('#sick-note').value.trim() || null,
  };
  let error;
  if (ed.id) {
    ({ error } = await sb.from('sick_leaves').update(payload).eq('id', ed.id));
  } else {
    ({ error } = await sb.from('sick_leaves').insert({
      ...payload, staff_id: ed.staffId,
      etablissement: staff?.etablissement || defaultEtab(),
    }));
  }
  if (error) { console.error(error); toast('Enregistrement impossible', 'error'); return; }
  toast('Arrêt maladie enregistré');
  closeModal('#sick-modal');
  await renderHours();
}

async function deleteSickLeave() {
  const ed = state.editing.sick;
  if (!ed?.id) { closeModal('#sick-modal'); return; }
  const { error } = await sb.from('sick_leaves').delete().eq('id', ed.id);
  if (error) { console.error(error); toast('Suppression impossible', 'error'); return; }
  toast('Arrêt supprimé');
  closeModal('#sick-modal');
  await renderHours();
}

async function removeSickLeave(id) {
  if (!confirm('Supprimer cet arrêt maladie ?')) return;
  const { error } = await sb.from('sick_leaves').delete().eq('id', id);
  if (error) { console.error(error); toast('Suppression impossible', 'error'); return; }
  toast('Arrêt supprimé');
  await renderHours();
}

async function copyPrevWeek() {
  if (!confirm('Copier la semaine précédente sur cette semaine ?\n(les créneaux existants seront conservés)')) return;
  const prevStart = isoFromDate(addDays(new Date(state.planningWeekStart), -7));
  const prevEnd = isoFromDate(addDays(new Date(state.planningWeekStart), -1));
  const { data, error } = await sb.from('planning').select('*').gte('business_date', prevStart).lte('business_date', prevEnd);
  if (error) { toast('Lecture impossible', 'error'); return; }
  if (!data || data.length === 0) { toast('Pas de planning la semaine précédente'); return; }

  const newRows = data.map(p => ({
    staff_id: p.staff_id,
    business_date: isoFromDate(addDays(new Date(p.business_date), 7)),
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    ends_next_day: p.ends_next_day,
    role_label: p.role_label,
    note: p.note,
    etablissement: p.etablissement || defaultEtab(),
  }));
  const { error: insErr } = await sb.from('planning').insert(newRows);
  if (insErr) { toast('Insertion partielle', 'error'); console.error(insErr); }
  else toast(`${newRows.length} créneaux copiés`);
  await renderPlanning();
}

async function copyStaffWeekForward(staffId, staffName) {
  const curStart = state.planningWeekStart;
  const curEnd   = isoFromDate(addDays(new Date(curStart), 6));
  const nextStart = isoFromDate(addDays(new Date(curStart), 7));
  const nextEnd   = isoFromDate(addDays(new Date(curStart), 13));

  // Load current week slots for this staff
  const { data, error } = await sb
    .from('planning')
    .select('*')
    .eq('staff_id', staffId)
    .gte('business_date', curStart)
    .lte('business_date', curEnd);

  if (error) { toast('Lecture impossible', 'error'); return; }
  if (!data || data.length === 0) { toast(`Aucun créneau cette semaine pour ${staffName}`); return; }

  // Check if next week already has shifts for this staff
  const { data: existing } = await sb
    .from('planning')
    .select('id')
    .eq('staff_id', staffId)
    .gte('business_date', nextStart)
    .lte('business_date', nextEnd);

  const hasExisting = existing && existing.length > 0;

  let replace = false;
  if (hasExisting) {
    const choice = confirm(
      `Copier ${staffName} → semaine suivante\n\nDes créneaux existent déjà.\n\nOK = Remplacer\nAnnuler = Ajouter`
    );
    // OK = true = replace, Cancel = false = add
    replace = choice;
    // If they hit cancel on the add option we need a third state — so we use a second confirm
    if (!choice) {
      const confirmAdd = confirm(`Ajouter les créneaux par-dessus pour ${staffName} ?`);
      if (!confirmAdd) return; // user backed out entirely
    }
  }

  if (replace) {
    const { error: delErr } = await sb
      .from('planning')
      .delete()
      .eq('staff_id', staffId)
      .gte('business_date', nextStart)
      .lte('business_date', nextEnd);
    if (delErr) { toast('Suppression impossible', 'error'); console.error(delErr); return; }
  }

  const newRows = data.map(p => ({
    staff_id: p.staff_id,
    business_date: isoFromDate(addDays(new Date(p.business_date), 7)),
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    ends_next_day: p.ends_next_day,
    role_label: p.role_label,
    pause_minutes: p.pause_minutes,
    note: p.note,
    etablissement: p.etablissement || defaultEtab(),
  }));

  const { error: insErr } = await sb.from('planning').insert(newRows);
  if (insErr) { toast('Insertion impossible', 'error'); console.error(insErr); return; }

  toast(`${staffName} · ${newRows.length} créneaux copiés →`);
  await renderPlanning();
}

// ── VALIDATION ───────────────────────────────────────────────────────────────
// ── PRINT & EXPORT ───────────────────────────────────────────────────────────
function printToday() {
  window.print();
}

function printHours() {
  // Open detail sections so they print
  $$('.detail-staff').forEach(d => d.classList.add('open'));
  window.print();
}

function exportCSV() {
  computeRange(state.range.kind);
  const filtered = state.staffFilter !== 'all' ? state.shifts.filter(s => s.staff_id === state.staffFilter) : state.shifts;
  const rows = [
    ['Staff', 'Date', 'Début', 'Fin', 'Total (min)', 'Pause (min)', 'Net (min)', 'Net (h)', 'Source', 'Note']
  ];
  filtered.forEach(s => {
    const m = computeShiftMinutes(s);
    rows.push([
      s.staff_name,
      s.business_date,
      fmtTime(s.started_at),
      s.ended_at ? fmtTime(s.ended_at) : '',
      m.total,
      m.pause,
      m.net,
      (m.net/60).toFixed(2).replace('.', ','),
      s.source,
      (s.note || '').replace(/[\n\r;]/g, ' '),
    ]);
  });
  const csv = rows.map(r => r.map(c => {
    const v = String(c ?? '');
    return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tornet-heures-${state.range.start}_${state.range.end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('CSV téléchargé');
}

function printPlanning() {
  window.print();
}

// ── MODAL HELPERS ────────────────────────────────────────────────────────────
function closeModal(sel) {
  $(sel).classList.add('hidden');
}

// ── LIVE CLOCK ───────────────────────────────────────────────────────────────
function startClockTicker() {
  const tick = () => {
    const now = new Date();
    $('#live-clock').textContent = `${fmtDateShort(now)} ${fmtTime(now)}:${String(now.getSeconds()).padStart(2,'0')}`;
    // Refresh today view live counters
    if (state.activeTab === 'today' && state.liveShifts.length > 0) {
      $$('.live-chip').forEach(chip => {
        // Just trigger a soft re-render by replacing the detail
        // (keeping it simple — full re-render on next data change)
      });
    }
  };
  tick();
  setInterval(tick, 1000);
  // Refresh "today" view every 30s for live durations
  setInterval(() => {
    if (state.activeTab === 'today') renderToday();
  }, 30000);
}

// ── WIRING ───────────────────────────────────────────────────────────────────
function wire() {
  // Auth
  $('#btn-logout').addEventListener('click', logout);

  // Site chips — multi-tenant scoping
  applySite(state.site);   // restore from localStorage on first load
  $$('.site-chip').forEach(c => c.addEventListener('click', async () => {
    if (c.dataset.site === state.site) return;
    applySite(c.dataset.site);
    // Reload everything for the new scope
    await loadStaff();
    await loadLiveShifts();
    await loadShiftsForRange();
    showTab(state.activeTab);
  }));

  // Tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // Today
  $('#print-today').addEventListener('click', printToday);

  // Hours
  $$('.range-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      $$('.range-chips .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      const kind = c.dataset.range;
      if (kind === 'custom') {
        $('#custom-range').classList.remove('hidden');
        // Init with current range
        $('#range-start').value = state.range.start;
        $('#range-end').value = state.range.end;
      } else {
        $('#custom-range').classList.add('hidden');
        state.range.kind = kind;
        renderHours();
      }
    });
  });

  $('#apply-range').addEventListener('click', () => {
    const start = $('#range-start').value;
    const end = $('#range-end').value;
    if (!start || !end) { toast('Sélectionne les deux dates', 'error'); return; }
    state.range = { start, end, kind: 'custom' };
    renderHours();
  });

  $('#staff-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-staff="all"]');
    if (chip) {
      state.staffFilter = 'all';
      $$('#staff-filter .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderHours();
    }
  });

  $('#hours-print').addEventListener('click', printHours);
  $('#hours-csv').addEventListener('click', exportCSV);

  // Heures — pôle filter
  $$('#hours-pole-filter .pole-btn').forEach(btn => btn.addEventListener('click', () => {
    state.hoursPole = btn.dataset.pole;
    $$('#hours-pole-filter .pole-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderHours();
  }));
  // Heures — A‑Z / default sort
  $$('#hours-sort .pole-btn').forEach(btn => btn.addEventListener('click', () => {
    state.hoursSort = btn.dataset.sort;
    $$('#hours-sort .pole-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderHours();
  }));
  // Pending pills → modal
  $('#pending-demands').addEventListener('click', () => openPendingModal('demands'));
  $('#pending-signature').addEventListener('click', () => openPendingModal('signature'));
  $$('.pending-tab').forEach(t => t.addEventListener('click', () => openPendingModal(t.dataset.pending)));

  // Leave (CP) modal
  $('#leave-save').addEventListener('click', saveLeave);
  $('#leave-delete').addEventListener('click', deleteLeave);

  // Arrêt maladie (CM) modal
  $('#sick-save').addEventListener('click', saveSickLeave);
  $('#sick-delete').addEventListener('click', deleteSickLeave);

  // Planning
  $('#plan-prev').addEventListener('click', () => {
    state.planningWeekStart = isoFromDate(addDays(new Date(state.planningWeekStart), -7));
    renderPlanning();
  });
  $('#plan-next').addEventListener('click', () => {
    state.planningWeekStart = isoFromDate(addDays(new Date(state.planningWeekStart), 7));
    renderPlanning();
  });
  $('#plan-today').addEventListener('click', () => {
    state.planningWeekStart = isoFromDate(mondayOf(new Date()));
    renderPlanning();
  });
  $('#plan-copy-prev').addEventListener('click', copyPrevWeek);
  $('#plan-print').addEventListener('click', printPlanning);
  $$('#plan-pole-filter .pole-btn').forEach(btn => btn.addEventListener('click', () => {
    state.planningPole = btn.dataset.pole;
    $$('#plan-pole-filter .pole-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderPlanning();
  }));
  $('#plan-save').addEventListener('click', savePlan);
  $('#plan-delete').addEventListener('click', deletePlan);

  // Staff
  $('#add-staff').addEventListener('click', () => openStaffModal(null));
  $('#staff-save').addEventListener('click', saveStaff);
  $('#staff-delete').addEventListener('click', deleteStaff);
  $('#staff-search').addEventListener('input', (e) => {
    state.staffSearch = e.target.value;
    renderStaffList();
  });
  $('.staff-status-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $$('.staff-status-filter .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.staffStatusFilter = btn.dataset.staffStatus;
    renderStaffList();
  });

  // Shift modal
  $('#shift-save').addEventListener('click', saveShift);
  $('#shift-delete').addEventListener('click', deleteShift);

  // Modal closers
  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(`#${el.dataset.close}-modal`));
  });

  // ESC closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal').forEach(m => m.classList.add('hidden'));
  });
}

// ── ENTRY ────────────────────────────────────────────────────────────────────
$('#auth-btn').addEventListener('click', tryLogin);
$('#auth-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
checkAuth();
