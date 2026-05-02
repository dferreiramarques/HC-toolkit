// ─── STATE ────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('cicf_token');
let currentUser = JSON.parse(localStorage.getItem('cicf_user') || 'null');
let currentSection = 'dashboard';
let projects = [];
let allUsers = [];
let tsMonth, tsYear;
let mapMonth, mapYear;

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  tsMonth = now.getMonth() + 1;
  tsYear  = now.getFullYear();
  mapMonth = now.getMonth() + 1;
  mapYear  = now.getFullYear();

  if (token && currentUser) {
    startApp();
  }
  // Enter on login fields
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });
});

// ─── API ──────────────────────────────────────────────────────────────────────
const api = async (method, path, body = null) => {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const data = await api('POST', '/api/auth/login', { email, password });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('cicf_token', token);
    localStorage.setItem('cicf_user', JSON.stringify(currentUser));
    startApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('cicf_token');
  localStorage.removeItem('cicf_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-password').value = '';
}

async function startApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'grid';

  // Sidebar user
  const avatar = document.getElementById('sidebar-avatar');
  avatar.textContent = currentUser.name.charAt(0).toUpperCase();
  document.getElementById('sidebar-name').textContent = currentUser.name.split(' ')[0];
  document.getElementById('sidebar-role').textContent = currentUser.role === 'admin' ? 'Administrador' : 'Colaborador';

  // Admin nav
  if (currentUser.role === 'admin') {
    document.getElementById('admin-divider').style.display = 'block';
    document.getElementById('nav-approvals').style.display = 'flex';
    document.getElementById('nav-admin').style.display = 'flex';
  }

  // Load shared data
  try {
    projects = await api('GET', '/api/projects');
    if (currentUser.role === 'admin') {
      allUsers = await api('GET', '/api/users');
    }
  } catch (e) { console.error(e); }

  // Update pending badge
  if (currentUser.role === 'admin') updatePendingBadge();

  goto('dashboard');
}

async function updatePendingBadge() {
  try {
    const pending = await api('GET', '/api/pending');
    const badge = document.getElementById('pending-badge');
    if (pending.length > 0) {
      badge.textContent = pending.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) { /* silent */ }
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
function goto(section) {
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById(`section-${section}`);
  if (el) el.style.display = 'block';

  const nav = document.querySelector(`[data-section="${section}"]`);
  if (nav) nav.classList.add('active');

  currentSection = section;

  const loaders = {
    dashboard: loadDashboard,
    vacations: loadVacations,
    teammap: loadTeamMap,
    purchases: loadPurchases,
    schedules: loadSchedules,
    timesheet: loadTimesheet,
    approvals: loadPending,
    history: loadHistory,
    admin: loadAdmin
  };
  if (loaders[section]) loaders[section]();
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent =
    now.toLocaleDateString('pt-PT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  try {
    const [vacations, purchases] = await Promise.all([
      api('GET', '/api/vacations'),
      api('GET', '/api/purchases')
    ]);

    const myPending   = vacations.filter(v => v.status === 'pending');
    const myApproved  = vacations.filter(v => v.status === 'approved');
    const purPending  = purchases.filter(p => p.status === 'pending');

    // Get hours this month
    let hoursThisMonth = 0;
    try {
      const ts = await api('GET', `/api/timesheets?month=${now.getMonth()+1}&year=${now.getFullYear()}`);
      hoursThisMonth = ts.reduce((sum, t) => sum + parseFloat(t.hours), 0);
    } catch(e) {}

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${myApproved.length}</div><div class="stat-label">Férias Aprovadas</div></div>
      <div class="stat-card"><div class="stat-value">${myPending.length}</div><div class="stat-label">Pedidos Pendentes</div></div>
      <div class="stat-card"><div class="stat-value">${purPending.length}</div><div class="stat-label">Compras Pendentes</div></div>
      <div class="stat-card"><div class="stat-value">${hoursThisMonth.toFixed(1)}h</div><div class="stat-label">Horas este mês</div></div>
    `;

    // Pending vacations
    const vacEl = document.getElementById('dash-vacations');
    const pendingVac = vacations.filter(v => v.status === 'pending');
    vacEl.innerHTML = pendingVac.length === 0
      ? '<div class="empty-state"><span class="empty-icon">◫</span>Sem pedidos pendentes</div>'
      : pendingVac.map(v => `
          <div class="schedule-day">
            <span class="text-muted">${v.user_name || currentUser.name}</span>
            <span>${fmtDate(v.start_date)} → ${fmtDate(v.end_date)}</span>
            <span class="status status-pending">pendente</span>
          </div>
        `).join('');

    // Pending purchases
    const purEl = document.getElementById('dash-purchases');
    const pendingPur = purchases.filter(p => p.status === 'pending');
    purEl.innerHTML = pendingPur.length === 0
      ? '<div class="empty-state"><span class="empty-icon">◈</span>Sem pedidos pendentes</div>'
      : pendingPur.map(p => `
          <div class="schedule-day">
            <span class="text-muted">${p.user_name || currentUser.name}</span>
            <span>${p.description.substring(0, 30)}${p.description.length > 30 ? '…' : ''}</span>
            <span class="status status-pending">pendente</span>
          </div>
        `).join('');

  } catch (e) { showToast(e.message, 'error'); }
}

// ─── VACATIONS ────────────────────────────────────────────────────────────────
async function loadVacations() {
  try {
    const vacations = await api('GET', '/api/vacations');
    const el = document.getElementById('vacations-list');
    if (vacations.length === 0) {
      el.innerHTML = `<div class="card"><div class="empty-state"><span class="empty-icon">◫</span>Sem pedidos de férias.<br>Clica em "Novo Pedido" para submeter.</div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${currentUser.role === 'admin' ? '<th>Colaborador</th>' : ''}
              <th>Início</th><th>Fim</th><th>Dias</th><th>Notas</th><th>Estado</th><th></th>
            </tr></thead>
            <tbody>
              ${vacations.map(v => {
                const days = Math.ceil((new Date(v.end_date) - new Date(v.start_date)) / 86400000) + 1;
                return `<tr>
                  ${currentUser.role === 'admin' ? `<td class="fw-600">${v.user_name}</td>` : ''}
                  <td>${fmtDate(v.start_date)}</td>
                  <td>${fmtDate(v.end_date)}</td>
                  <td class="text-accent">${days}d</td>
                  <td class="text-muted">${v.notes || '—'}</td>
                  <td><span class="status status-${v.status}">${statusPT(v.status)}</span></td>
                  <td class="td-actions">
                    ${v.status === 'pending' || currentUser.role === 'admin'
                      ? `<button class="btn btn-danger" onclick="deleteVacation(${v.id}, '${(v.user_name||'').replace(/'/g,'')}', '${v.status}')">${currentUser.role === 'admin' ? '✕ Apagar' : 'Cancelar'}</button>`
                      : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitVacation() {
  const btn = document.querySelector('#modal-vacation .btn-primary');
  const start = document.getElementById('vac-start').value;
  const end   = document.getElementById('vac-end').value;
  const notes = document.getElementById('vac-notes').value;
  if (!start || !end) return showModalError('modal-vacation', 'Preenche as datas de início e fim.');
  if (new Date(end) < new Date(start)) return showModalError('modal-vacation', 'A data de fim não pode ser anterior ao início.');
  btn.textContent = 'A submeter...';
  btn.disabled = true;
  try {
    await api('POST', '/api/vacations', { start_date: start, end_date: end, notes });
    closeModal();
    showToast('Pedido submetido — email enviado para aprovação ✓', 'success');
    loadVacations();
    updatePendingBadge();
  } catch (e) {
    showModalError('modal-vacation', e.message || 'Erro ao submeter. Verifica a ligação.');
  } finally {
    btn.textContent = 'Submeter Pedido';
    btn.disabled = false;
  }
}

async function deleteVacation(id, userName, status) {
  const isAdmin = currentUser.role === 'admin';
  const msg = isAdmin && userName
    ? `Apagar o pedido de férias de ${userName}? ${status === 'approved' ? '(já aprovado!)' : ''} O colaborador será notificado.`
    : 'Cancelar este pedido de férias?';
  if (!confirm(msg)) return;
  try {
    await api('DELETE', `/api/vacations/${id}`);
    showToast('Pedido apagado ✓', 'success');
    loadVacations();
    if (currentUser.role === 'admin') updatePendingBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── TEAM MAP ─────────────────────────────────────────────────────────────────
function changeMapMonth(delta) {
  mapMonth += delta;
  if (mapMonth > 12) { mapMonth = 1; mapYear++; }
  if (mapMonth < 1)  { mapMonth = 12; mapYear--; }
  loadTeamMap();
}

async function loadTeamMap() {
  const label = document.getElementById('map-month-label');
  label.textContent = `${monthPT(mapMonth)} ${mapYear}`;

  try {
    const [teamVacations, users] = await Promise.all([
      api('GET', '/api/vacations/team'),
      api('GET', '/api/users')
    ]);

    const daysInMonth = new Date(mapYear, mapMonth, 0).getDate();
    const today = new Date();
    const container = document.getElementById('team-map-container');

    // Build day headers
    let headers = '<div style="width:140px"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(mapYear, mapMonth - 1, d);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isToday = date.toDateString() === today.toDateString();
      headers += `<div class="map-header-day ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}">${d}</div>`;
    }

    // Build rows per user
    let rows = '';
    for (const user of users) {
      const userVacs = teamVacations.filter(v => v.user_id === user.id);

      // Build map of day -> status
      const dayStatus = {};
      for (const v of userVacs) {
        const start = new Date(v.start_date);
        const end   = new Date(v.end_date);
        for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
          if (cur.getMonth() + 1 === mapMonth && cur.getFullYear() === mapYear) {
            dayStatus[cur.getDate()] = v.status;
          }
        }
      }

      let cells = `<div class="map-name" title="${user.name}">${user.name.split(' ')[0]}</div>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(mapYear, mapMonth - 1, d);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const st = dayStatus[d];
        cells += `<div class="map-cell ${st ? `vacation-${st}` : ''} ${isWeekend ? 'weekend' : ''}"></div>`;
      }
      rows += `<div class="map-row" style="--days:${daysInMonth}">${cells}</div>`;
    }

    container.innerHTML = `
      <div class="team-map">
        <div class="map-header-row" style="--days:${daysInMonth};display:grid;grid-template-columns:140px repeat(${daysInMonth},1fr)">
          ${headers}
        </div>
        ${rows}
      </div>
    `;
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── PURCHASES ────────────────────────────────────────────────────────────────
async function loadPurchases() {
  try {
    const purchases = await api('GET', '/api/purchases');
    const el = document.getElementById('purchases-list');
    if (purchases.length === 0) {
      el.innerHTML = `<div class="card"><div class="empty-state"><span class="empty-icon">◈</span>Sem pedidos de compra.</div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${currentUser.role === 'admin' ? '<th>Solicitante</th>' : ''}
              <th>Descrição</th><th>Valor</th><th>Fornecedor</th><th>Justificação</th><th>Estado</th><th></th>
            </tr></thead>
            <tbody>
              ${purchases.map(p => `<tr>
                ${currentUser.role === 'admin' ? `<td class="fw-600">${p.user_name}</td>` : ''}
                <td class="fw-600">${p.description}</td>
                <td class="text-accent">${p.amount ? `€${parseFloat(p.amount).toFixed(2)}` : '—'}</td>
                <td class="text-muted">${p.supplier || '—'}</td>
                <td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.justification || '—'}</td>
                <td><span class="status status-${p.status}">${statusPT(p.status)}</span></td>
                <td class="td-actions">
                  <button class="btn btn-danger" onclick="deletePurchase(${p.id})">Remover</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitPurchase() {
  try {
    const desc    = document.getElementById('pur-desc').value.trim();
    const amount  = document.getElementById('pur-amount').value;
    const supplier = document.getElementById('pur-supplier').value.trim();
    const justif  = document.getElementById('pur-justif').value.trim();
    if (!desc || !justif) return showToast('Descrição e justificação obrigatórias', 'error');
    await api('POST', '/api/purchases', { description: desc, amount, supplier, justification: justif });
    closeModal();
    showToast('Pedido de compra submetido ✓', 'success');
    loadPurchases();
    updatePendingBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deletePurchase(id) {
  if (!confirm('Remover este pedido?')) return;
  try {
    await api('DELETE', `/api/purchases/${id}`);
    showToast('Pedido removido', 'success');
    loadPurchases();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── SCHEDULES ────────────────────────────────────────────────────────────────
async function loadSchedules() {
  try {
    const schedule = await api('GET', '/api/schedules');
    const days = [
      { key: 'monday',    label: 'Segunda-feira' },
      { key: 'tuesday',   label: 'Terça-feira' },
      { key: 'wednesday', label: 'Quarta-feira' },
      { key: 'thursday',  label: 'Quinta-feira' },
      { key: 'friday',    label: 'Sexta-feira' }
    ];

    const schedContent = document.getElementById('schedule-content');
    if (!schedule) {
      schedContent.innerHTML = '<div class="empty-state"><span class="empty-icon">◷</span>Sem horário definido.<br>Solicita uma alteração ou contacta o admin.</div>';
    } else {
      schedContent.innerHTML = days.map(d => {
        const start = schedule[`${d.key}_start`];
        const end   = schedule[`${d.key}_end`];
        return `<div class="schedule-day">
          <span class="schedule-day-name">${d.label}</span>
          <span class="schedule-hours">${start && end ? `${start.substring(0,5)} – ${end.substring(0,5)}` : '<span class="text-muted">—</span>'}</span>
        </div>`;
      }).join('');
    }

    // Pre-fill schedule change form
    buildScheduleForm('schedule-form-grid', schedule);

    // Change requests
    const changes = await api('GET', '/api/schedules/change-requests');
    const changesEl = document.getElementById('schedule-changes-list');
    if (changes.length === 0) {
      changesEl.innerHTML = '<div class="empty-state"><span class="empty-icon">◎</span>Sem pedidos.</div>';
    } else {
      changesEl.innerHTML = changes.map(c => `
        <div class="schedule-day">
          ${currentUser.role === 'admin' ? `<span class="text-muted">${c.user_name}</span>` : ''}
          <span class="text-muted">${c.effective_from ? fmtDate(c.effective_from) : 'N/D'}</span>
          <span>${c.reason || '—'}</span>
          <span class="status status-${c.status}">${statusPT(c.status)}</span>
        </div>
      `).join('');
    }
  } catch (e) { showToast(e.message, 'error'); }
}

function buildScheduleForm(containerId, prefill = null) {
  const days = [
    { key: 'monday',    label: 'Seg' },
    { key: 'tuesday',   label: 'Ter' },
    { key: 'wednesday', label: 'Qua' },
    { key: 'thursday',  label: 'Qui' },
    { key: 'friday',    label: 'Sex' }
  ];
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="schedule-form-row" style="font-size:11px;color:var(--muted);font-weight:500;text-transform:uppercase;letter-spacing:.06em">
      <span>Dia</span><span>Entrada</span><span>Saída</span>
    </div>
    ${days.map(d => `
      <div class="schedule-form-row">
        <label>${d.label}</label>
        <input type="time" id="sf-${containerId}-${d.key}-start" value="${prefill?.[`${d.key}_start`]?.substring(0,5) || '09:00'}">
        <input type="time" id="sf-${containerId}-${d.key}-end"   value="${prefill?.[`${d.key}_end`]?.substring(0,5)   || '18:00'}">
      </div>
    `).join('')}
  `;
}

async function submitScheduleChange() {
  try {
    const days = ['monday','tuesday','wednesday','thursday','friday'];
    const new_schedule = {};
    for (const d of days) {
      new_schedule[`${d}_start`] = document.getElementById(`sf-schedule-form-grid-${d}-start`)?.value || null;
      new_schedule[`${d}_end`]   = document.getElementById(`sf-schedule-form-grid-${d}-end`)?.value || null;
    }
    const reason = document.getElementById('sch-reason').value;
    const effective_from = document.getElementById('sch-effective').value;
    await api('POST', '/api/schedules/change-request', { new_schedule, reason, effective_from });
    closeModal();
    showToast('Pedido de alteração submetido ✓', 'success');
    loadSchedules();
    updatePendingBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── TIMESHEET ────────────────────────────────────────────────────────────────
function changeTSMonth(delta) {
  tsMonth += delta;
  if (tsMonth > 12) { tsMonth = 1; tsYear++; }
  if (tsMonth < 1)  { tsMonth = 12; tsYear--; }
  loadTimesheet();
}

async function loadTimesheet() {
  document.getElementById('ts-month-label').textContent = `${monthPT(tsMonth)} ${tsYear}`;

  // Admin user selector
  const userSelect = document.getElementById('ts-user-select');
  if (currentUser.role === 'admin' && allUsers.length > 0) {
    userSelect.style.display = 'block';
    if (userSelect.children.length === 0) {
      userSelect.innerHTML = allUsers.map(u =>
        `<option value="${u.id}" ${u.id === currentUser.id ? 'selected' : ''}>${u.name}</option>`
      ).join('');
    }
  }

  const userId = currentUser.role === 'admin' ? userSelect.value : currentUser.id;
  const userParam = currentUser.role === 'admin' ? `&userId=${userId}` : '';

  try {
    const entries = await api('GET', `/api/timesheets?month=${tsMonth}&year=${tsYear}${userParam}`);
    const totalHours = entries.reduce((sum, e) => sum + parseFloat(e.hours), 0);

    // By project
    const byProject = {};
    for (const e of entries) {
      const key = e.project_code || e.project_name;
      byProject[key] = (byProject[key] || 0) + parseFloat(e.hours);
    }

    document.getElementById('ts-summary').innerHTML = `
      <div class="ts-summary">
        <div class="ts-summary-item">Total: <strong>${totalHours.toFixed(2)}h</strong></div>
        <div class="ts-summary-item">Entradas: <strong>${entries.length}</strong></div>
        <div class="ts-by-project">
          ${Object.entries(byProject).map(([k, h]) =>
            `<div class="project-chip"><span class="project-chip-code">${k}</span><span class="project-chip-hours">${h.toFixed(2)}h</span></div>`
          ).join('')}
        </div>
      </div>
    `;

    const el = document.getElementById('timesheet-list');
    if (entries.length === 0) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">◳</span>Sem registos neste mês.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Data</th><th>Projeto</th><th>Tarefa</th><th>Campo Custom</th><th>Horas</th><th>Notas</th><th></th>
          </tr></thead>
          <tbody>
            ${entries.map(e => `<tr>
              <td class="text-muted">${fmtDate(e.date)}</td>
              <td><span class="project-chip" style="font-size:11px">
                <span class="project-chip-code">${e.project_code}</span>
                <span style="color:var(--text)">${e.project_name}</span>
              </span></td>
              <td class="fw-600">${e.task_name}</td>
              <td class="text-muted">${e.custom_field || '—'}</td>
              <td class="text-accent fw-600">${parseFloat(e.hours).toFixed(2)}h</td>
              <td class="text-muted">${e.notes || '—'}</td>
              <td class="td-actions">
                <button class="btn btn-ghost" onclick="editTimesheet(${e.id})">Editar</button>
                <button class="btn btn-danger" onclick="deleteTimesheet(${e.id})">✕</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitTimesheet() {
  try {
    const id = document.getElementById('ts-edit-id').value;
    const body = {
      date:         document.getElementById('ts-date').value,
      project_id:   document.getElementById('ts-project').value,
      task_name:    document.getElementById('ts-task').value.trim(),
      custom_field: document.getElementById('ts-custom').value.trim(),
      hours:        document.getElementById('ts-hours').value,
      notes:        document.getElementById('ts-notes').value.trim()
    };
    if (!body.date || !body.project_id || !body.task_name || !body.hours) {
      return showToast('Preenche os campos obrigatórios', 'error');
    }
    if (id) {
      await api('PUT', `/api/timesheets/${id}`, body);
      showToast('Registo atualizado ✓', 'success');
    } else {
      await api('POST', '/api/timesheets', body);
      showToast('Horas registadas ✓', 'success');
    }
    closeModal();
    loadTimesheet();
  } catch (e) { showToast(e.message, 'error'); }
}

async function editTimesheet(id) {
  // Fetch current entries to find the row
  const userId = currentUser.role === 'admin'
    ? document.getElementById('ts-user-select').value
    : currentUser.id;
  const userParam = currentUser.role === 'admin' ? `&userId=${userId}` : '';
  const entries = await api('GET', `/api/timesheets?month=${tsMonth}&year=${tsYear}${userParam}`);
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  showModal('modal-timesheet');
  document.getElementById('ts-modal-title').textContent = 'Editar Registo';
  document.getElementById('ts-edit-id').value = id;
  document.getElementById('ts-date').value = entry.date.split('T')[0];
  document.getElementById('ts-project').value = entry.project_id;
  document.getElementById('ts-task').value = entry.task_name;
  document.getElementById('ts-custom').value = entry.custom_field || '';
  document.getElementById('ts-hours').value = entry.hours;
  document.getElementById('ts-notes').value = entry.notes || '';
}

async function deleteTimesheet(id) {
  if (!confirm('Eliminar este registo?')) return;
  try {
    await api('DELETE', `/api/timesheets/${id}`);
    showToast('Registo eliminado', 'success');
    loadTimesheet();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── APPROVALS (admin) ────────────────────────────────────────────────────────
const actionLabel = {
  vacation_cancelled: '📅 Férias canceladas',
  purchase_cancelled: '🛒 Compra cancelada',
  schedule_changed:   '🕐 Horário alterado',
};

async function loadHistory() {
  try {
    const logs = await api('GET', '/api/history');
    const el = document.getElementById('history-list');
    if (logs.length === 0) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">◴</span>Sem atividade registada.</div>';
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Ação</th><th>Detalhe</th><th>Por</th></tr></thead>
      <tbody>
        ${logs.map(l => {
          const d = l.detail || {};
          let detail = '';
          if (l.action === 'vacation_cancelled') {
            detail = d.start_date ? fmtDate(d.start_date) + ' → ' + fmtDate(d.end_date) : '—';
            if (d.status_was === 'approved') detail += ' <span class="text-danger">(estava aprovado)</span>';
          }
          return `<tr>
            <td class="text-muted">${fmtDate(l.created_at)}</td>
            <td>${actionLabel[l.action] || l.action}</td>
            <td>${detail || '—'}</td>
            <td class="text-muted">${l.actor_name || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  } catch (e) { showToast(e.message, 'error'); }
}

async function cleanupDuplicates() {
  if (!confirm('Remover todos os pedidos de férias duplicados pendentes? Mantém apenas 1 por período.')) return;
  try {
    const r = await api('DELETE', '/api/admin/vacations/duplicates');
    showToast(`${r.deleted} pedidos duplicados removidos ✓`, 'success');
    loadPending();
    updatePendingBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadPending() {
  try {
    const pending = await api('GET', '/api/pending');
    const el = document.getElementById('approvals-list');

    if (pending.length === 0) {
      el.innerHTML = `<div class="card"><div class="empty-state"><span class="empty-icon">◎</span>Sem aprovações pendentes. 🎉</div></div>`;
      document.getElementById('pending-badge').style.display = 'none';
      return;
    }

    // Show cleanup button if there are duplicates
    const vacMap = {};
    let hasDups = false;
    for (const p of pending) {
      if (p.type === 'vacation') {
        const key = p.user_id + '_' + p.start_date + '_' + p.end_date;
        vacMap[key] = (vacMap[key] || 0) + 1;
        if (vacMap[key] > 1) hasDups = true;
      }
    }

    const typeIcon = { vacation: '📅', purchase: '🛒', schedule: '🕐' };
    const typeLabel = { vacation: 'Férias', purchase: 'Compra', schedule: 'Horário' };

    el.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Tipo</th><th>Colaborador</th><th>Detalhe</th><th>Data</th><th>Estado</th></tr></thead>
      <tbody>
        ${pending.map(p => {
          let detail = '';
          if (p.type === 'vacation') detail = `${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}`;
          if (p.type === 'purchase') detail = `${p.description}${p.amount ? ` — €${parseFloat(p.amount).toFixed(2)}` : ''}`;
          if (p.type === 'schedule') detail = p.reason || 'Alteração de horário';
          return `<tr>
            <td>${typeIcon[p.type]} ${typeLabel[p.type]}</td>
            <td class="fw-600">${p.user_name}</td>
            <td>${detail}</td>
            <td class="text-muted">${fmtDate(p.created_at)}</td>
            <td><span class="status status-pending">pendente</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <p style="color:var(--muted);font-size:12px">ℹ Aprova/rejeita pelos links no email, ou aguarda que o responsável o faça.</p>
      ${hasDups ? `<button class="btn btn-danger" onclick="cleanupDuplicates()">🗑 Remover duplicados (${pending.filter(p=>p.type==='vacation').length - Object.keys(vacMap).length} extras)</button>` : ''}
    </div>
    </div>`;
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function loadAdmin() {
  switchAdminTab('users');
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tabs .tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ['users','projects','schedules-admin'][i] === tab);
  });
  ['users','projects','schedules-admin'].forEach(t => {
    const el = document.getElementById(`admin-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'users') loadUsers();
  if (tab === 'projects') loadProjects();
  if (tab === 'schedules-admin') loadAllSchedules();
}

async function loadUsers() {
  try {
    allUsers = await api('GET', '/api/users');
    document.getElementById('users-list').innerHTML = `
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Email</th><th>Função</th><th>Departamento</th><th>Email do Gestor</th><th></th></tr></thead>
        <tbody>
          ${allUsers.map(u => `<tr>
            <td class="fw-600">${u.name}</td>
            <td class="text-muted">${u.email}</td>
            <td><span class="status ${u.role === 'admin' ? 'status-approved' : 'status-pending'}">${u.role}</span></td>
            <td class="text-muted">${u.department || '—'}</td>
            <td class="text-muted">${u.manager_email || '—'}</td>
            <td class="td-actions">
              ${u.id !== currentUser.id ? `<button class="btn btn-danger" onclick="deleteUser(${u.id})">Remover</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
    `;
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitUser() {
  try {
    const body = {
      name:          document.getElementById('usr-name').value.trim(),
      email:         document.getElementById('usr-email').value.trim(),
      password:      document.getElementById('usr-pwd').value || 'cicf2024',
      role:          document.getElementById('usr-role').value,
      department:    document.getElementById('usr-dept').value.trim(),
      manager_email: document.getElementById('usr-mgr').value.trim()
    };
    if (!body.name || !body.email) return showToast('Nome e email obrigatórios', 'error');
    await api('POST', '/api/users', body);
    closeModal();
    showToast('Colaborador criado ✓', 'success');
    loadUsers();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteUser(id) {
  if (!confirm('Remover este colaborador? Esta ação não pode ser revertida.')) return;
  try {
    await api('DELETE', `/api/users/${id}`);
    showToast('Colaborador removido', 'success');
    loadUsers();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadProjects() {
  try {
    const projs = await api('GET', '/api/projects');
    projects = projs;
    document.getElementById('projects-list').innerHTML = `
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Código</th><th>Criado</th><th></th></tr></thead>
        <tbody>
          ${projs.map(p => `<tr>
            <td class="fw-600">${p.name}</td>
            <td><span class="project-chip" style="font-size:11px"><span class="project-chip-code">${p.code || '—'}</span></span></td>
            <td class="text-muted">${fmtDate(p.created_at)}</td>
            <td class="td-actions">
              <button class="btn btn-danger" onclick="deleteProject(${p.id})">Arquivar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
    `;
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitProject() {
  try {
    const name = document.getElementById('proj-name').value.trim();
    const code = document.getElementById('proj-code').value.trim().toUpperCase();
    if (!name) return showToast('Nome obrigatório', 'error');
    const proj = await api('POST', '/api/projects', { name, code });
    projects.push(proj);
    closeModal();
    showToast('Projeto criado ✓', 'success');
    loadProjects();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteProject(id) {
  if (!confirm('Arquivar este projeto?')) return;
  try {
    await api('DELETE', `/api/projects/${id}`);
    showToast('Projeto arquivado', 'success');
    loadProjects();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadAllSchedules() {
  try {
    const [schedules, users] = await Promise.all([
      api('GET', '/api/schedules/all'),
      api('GET', '/api/users')
    ]);

    const schedMap = {};
    for (const s of schedules) schedMap[s.user_id] = s;

    const days = ['monday','tuesday','wednesday','thursday','friday'];
    const daysPT = ['Seg','Ter','Qua','Qui','Sex'];

    document.getElementById('all-schedules-list').innerHTML = `
      <div class="card" style="margin-top:20px"><div class="table-wrap"><table>
        <thead><tr>
          <th>Colaborador</th>
          ${daysPT.map(d => `<th>${d}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${users.map(u => {
            const s = schedMap[u.id];
            return `<tr>
              <td class="fw-600">${u.name}</td>
              ${days.map(d => {
                const start = s?.[`${d}_start`]?.substring(0,5);
                const end   = s?.[`${d}_end`]?.substring(0,5);
                return `<td class="text-muted" style="font-size:11px">${start && end ? `${start}–${end}` : '—'}</td>`;
              }).join('')}
              <td class="td-actions">
                <button class="btn btn-ghost" onclick="openScheduleAdmin(${u.id}, '${u.name}')">Editar</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div></div>
    `;
  } catch (e) { showToast(e.message, 'error'); }
}

async function openScheduleAdmin(userId, userName) {
  try {
    const s = await api('GET', `/api/schedules?userId=${userId}`);
    document.getElementById('sched-admin-title').textContent = `Horário — ${userName}`;
    document.getElementById('sched-admin-userid').value = userId;
    buildScheduleForm('schedule-admin-form-grid', s);
    showModal('modal-schedule-admin');
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitScheduleAdmin() {
  try {
    const userId = document.getElementById('sched-admin-userid').value;
    const days = ['monday','tuesday','wednesday','thursday','friday'];
    const body = {};
    for (const d of days) {
      body[`${d}_start`] = document.getElementById(`sf-schedule-admin-form-grid-${d}-start`)?.value || null;
      body[`${d}_end`]   = document.getElementById(`sf-schedule-admin-form-grid-${d}-end`)?.value || null;
    }
    await api('PUT', `/api/schedules/${userId}`, body);
    closeModal();
    showToast('Horário guardado ✓', 'success');
    loadAllSchedules();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function showModal(id) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById(id).style.display = 'block';

  // Populate project select
  if (id === 'modal-timesheet') {
    document.getElementById('ts-modal-title').textContent = 'Registar Horas';
    document.getElementById('ts-edit-id').value = '';
    const sel = document.getElementById('ts-project');
    sel.innerHTML = '<option value="">Selecionar projeto...</option>' +
      projects.map(p => `<option value="${p.id}">${p.code ? `[${p.code}] ` : ''}${p.name}</option>`).join('');
    // Default date = today
    document.getElementById('ts-date').value = new Date().toISOString().split('T')[0];
  }
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'none';
  overlay.style.cssText = 'display:none!important';
  setTimeout(() => { overlay.style.cssText = ''; }, 50);
  document.querySelectorAll('.modal').forEach(m => {
    m.style.display = 'none';
    const errEl = m.querySelector('.modal-error');
    if (errEl) errEl.style.display = 'none';
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function statusPT(s) {
  return { pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado' }[s] || s;
}

function monthPT(m) {
  return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m-1];
}

function showModalError(modalId, msg) {
  const modal = document.getElementById(modalId);
  let errEl = modal.querySelector('.modal-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'modal-error error-msg';
    errEl.style.marginTop = '12px';
    modal.querySelector('.modal-footer').before(errEl);
  }
  errEl.textContent = msg;
  errEl.style.display = 'block';
}

let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});
