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
  staff: [],
  shifts: [],       // shifts in current range/view
  liveShifts: [],   // open shifts (ended_at = null)
  planning: [],
  range: { start: null, end: null, kind: 'this-month' },
  staffFilter: 'all', // 'all' or staff_id
  staffSearch: '',
  staffStatusFilter: 'all', // 'all' | 'active' | 'inactive'
  planningWeekStart: null,
  editing: { shift: null, staffRow: null, planSlot: null },
  managerName: localStorage.getItem('tornet.managerName') || '',
};

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
  const ok = sessionStorage.getItem('tornet.authed') === '1';
  if (ok) enterApp();
  else $('#auth-input').focus();
}

function tryLogin() {
  const input = $('#auth-input').value.trim();
  if (input === MANAGER_CODE) {
    sessionStorage.setItem('tornet.authed', '1');
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
  sessionStorage.removeItem('tornet.authed');
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
    .subscribe();
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadStaff() {
  const { data, error } = await sb.from('staff').select('*').order('display_order');
  if (error) { console.error(error); toast('Chargement staff impossible', 'error'); return; }
  state.staff = data || [];
  renderStaffFilter();
}

async function loadLiveShifts() {
  const { data, error } = await sb
    .from('shifts')
    .select('*')
    .is('ended_at', null)
    .order('started_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.liveShifts = data || [];
}

async function loadShiftsForRange() {
  if (!state.range.start) computeRange(state.range.kind);
  const { data, error } = await sb
    .from('shifts')
    .select('*')
    .gte('business_date', state.range.start)
    .lte('business_date', state.range.end)
    .order('business_date', { ascending: false })
    .order('started_at', { ascending: false });
  if (error) { console.error(error); toast('Chargement shifts impossible', 'error'); return; }
  state.shifts = data || [];
}

async function loadPlanning(weekStartISO, weekEndISO) {
  const { data, error } = await sb
    .from('planning')
    .select('*')
    .gte('business_date', weekStartISO)
    .lte('business_date', weekEndISO);
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
    sb.from('planning').select('*')
      .gte('business_date', state.range.start).lte('business_date', state.range.end),
    sb.from('validations').select('id, shift_ids')
      .gte('range_start', state.range.start).lte('range_start', state.range.end),
  ]);
  const rangePlanning = planRes.data || [];
  const validatedShiftIds = new Set();
  (valRes.data || []).forEach(v => (v.shift_ids || []).forEach(id => validatedShiftIds.add(id)));

  // Apply staff filter
  let shifts = state.shifts;
  if (state.staffFilter !== 'all') {
    shifts = shifts.filter(s => s.staff_id === state.staffFilter);
  }

  // Group by staff
  const byStaff = new Map();
  shifts.forEach(s => {
    if (!byStaff.has(s.staff_id)) byStaff.set(s.staff_id, { staff: state.staff.find(x => x.id === s.staff_id), shifts: [], totalNet: 0 });
    const m = computeShiftMinutes(s);
    const entry = byStaff.get(s.staff_id);
    entry.shifts.push({ ...s, _net: m.net, _pause: m.pause, _total: m.total });
    entry.totalNet += m.net;
  });

  // Sort by display order
  const groups = Array.from(byStaff.values()).sort((a, b) =>
    (a.staff?.display_order ?? 999) - (b.staff?.display_order ?? 999));

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
        .reduce((sum, p) => sum + creneauMinutes(p), 0);

      // Compute estimated hours for the range based on contract
      const days_in_range = daysBetween(state.range.start, state.range.end) + 1;
      const weeks_in_range = days_in_range / 7;
      const expectedH = (g.staff.contract_h || 35) * weeks_in_range;
      const expectedMin = expectedH * 60;
      const diff = g.totalNet - expectedMin;

      let warn = '';
      if (Math.abs(diff) > 60) {
        warn = `<div class="summary-warn">${diff > 0 ? '+' : ''}${fmtDuration(diff)} vs contrat (${expectedH.toFixed(1)}h)</div>`;
      }

      card.innerHTML = `
        <div class="summary-name">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.staff.color};"></span>
          ${escapeHTML(g.staff.name)}
        </div>
        <div class="summary-total">${fmtDuration(g.totalNet)}</div>
        <div class="summary-planned">planifié · ${plannedMin > 0 ? fmtDuration(plannedMin) : '—'}</div>
        <div class="summary-detail">
          ${g.shifts.length} services · ${days} jours · ${fmtDuration(avg)}/jour moyen
        </div>
        ${warn}
      `;
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
    wrap.innerHTML = `
      <div class="detail-staff-head">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.staff.color};"></span>
        <span class="detail-staff-name">${escapeHTML(g.staff.name)}</span>
        <span class="detail-staff-total">${fmtDuration(g.totalNet)}</span>
        <span class="detail-toggle">›</span>
      </div>
      <div class="detail-shifts"></div>
    `;
    const shiftsWrap = wrap.querySelector('.detail-shifts');
    g.shifts.forEach(s => {
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
    wrap.querySelector('.detail-staff-head').addEventListener('click', () => {
      wrap.classList.toggle('open');
    });
    detail.appendChild(wrap);
  });
}

// Duration of a planning créneau in minutes (handles overnight slots).
function creneauMinutes(p) {
  const toMin = t => { const [h, m] = (t || '0:0').split(':'); return (+h) * 60 + (+m); };
  let s = toMin(p.starts_at), e = toMin(p.ends_at);
  if (p.ends_next_day || e < s) e += 1440;
  return Math.max(0, e - s);
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
    });
    if (error) { console.error(error); toast('Validation impossible', 'error'); return; }
    toast('Jour validé ✓');
  }
  renderHours();
}

function daysBetween(startISO, endISO) {
  const a = new Date(startISO), b = new Date(endISO);
  return Math.round((b - a) / 86400000);
}

// ── SHIFT MODAL ──────────────────────────────────────────────────────────────
function openShiftModal(shift) {
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
    sel.value = state.staff[0]?.id || '';
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
    });
    res = await sb.from('shifts').update(payload).eq('id', state.editing.shift.id).select().single();
  } else {
    res = await sb.from('shifts').insert(payload).select().single();
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
    $('#staff-active').checked = staff.active;
    $('#staff-delete').classList.remove('hidden');
  } else {
    $('.modal-title', $('#staff-modal')).textContent = 'Nouveau membre';
    $('#staff-name').value = '';
    $('#staff-pin').value = '';
    $('#staff-contract').value = 35;
    $('#staff-color').value = '#5a8a6b';
    $('#staff-rate').value = '';
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
  const active = $('#staff-active').checked;

  if (!name) { toast('Nom requis', 'error'); return; }
  if (!/^[0-9]{4}$/.test(pin)) { toast('PIN à 4 chiffres requis', 'error'); return; }

  const payload = { name, pin, contract_h: contract, color, hourly_rate: rate, active };

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
  html += '</tr></thead><tbody>';

  state.staff.filter(s => s.active).forEach(staff => {
    html += `<tr><td class="staff-col">${escapeHTML(staff.name)}</td>`;
    days.forEach(d => {
      const iso = isoFromDate(d);
      const cellSlots = state.planning
        .filter(p => p.staff_id === staff.id && p.business_date === iso)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const offSlot = cellSlots.find(isOffSlot);
      html += `<td data-staff="${staff.id}" data-date="${iso}">`;
      if (offSlot) {
        html += `<div class="plan-off-chip" data-plan="${offSlot.id}">Repos</div>`;
      } else {
        cellSlots.forEach(slot => {
          html += `<div class="plan-slot" style="border-left-color:${staff.color}" data-plan="${slot.id}">
            <div class="plan-time">${slot.starts_at.slice(0,5)}–${slot.ends_at.slice(0,5)}</div>
            ${slot.role_label ? `<div class="plan-role">${escapeHTML(slot.role_label)}</div>` : ''}
          </div>`;
        });
        html += `<div class="cell-actions">
          <button class="plan-add" type="button">+ créneau</button>
          <button class="plan-off" type="button">Repos</button>
        </div>`;
      }
      html += '</td>';
    });
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
      if (e.target.closest('.plan-off') || e.target.closest('.plan-off-chip')) {
        toggleDayOff(td.dataset.staff, td.dataset.date);
        return;
      }
      if (td.querySelector('.plan-off-chip')) return;
      openPlanModal(null, td.dataset.staff, td.dataset.date);
    });
  });
}

// An "off"/rest day is stored as a planning row with equal start and end times.
function isOffSlot(p) {
  return p.starts_at === p.ends_at;
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
  $('#plan-delete').classList.toggle('hidden', !slot);
  $('#plan-modal').classList.remove('hidden');
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
    updated_at: new Date().toISOString(),
  };

  let res;
  if (slot.id) {
    res = await sb.from('planning').update(payload).eq('id', slot.id);
  } else {
    res = await sb.from('planning').insert(payload);
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

async function toggleDayOff(staffId, dateISO) {
  const cellSlots = state.planning.filter(
    p => p.staff_id === staffId && p.business_date === dateISO
  );
  const offSlot = cellSlots.find(isOffSlot);

  if (offSlot) {
    const { error } = await sb.from('planning').delete().eq('id', offSlot.id);
    if (error) { console.error(error); toast('Impossible', 'error'); return; }
    toast('Repos retiré');
    await renderPlanning();
    return;
  }

  const creneaux = cellSlots.filter(p => !isOffSlot(p));
  if (creneaux.length &&
      !confirm('Marquer repos ? Les créneaux du jour seront supprimés.')) return;

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
    role_label: 'OFF',
    note: null,
    updated_at: new Date().toISOString(),
  });
  if (error) { console.error(error); toast('Impossible', 'error'); return; }
  toast('Repos marqué');
  await renderPlanning();
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
  }));
  const { error: insErr } = await sb.from('planning').insert(newRows);
  if (insErr) { toast('Insertion partielle', 'error'); console.error(insErr); }
  else toast(`${newRows.length} créneaux copiés`);
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
