// ─── STATE ────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('cicf_token');
let currentUser = JSON.parse(localStorage.getItem('cicf_user') || 'null');
let projects = [], allUsers = [];
let tsMonth, tsYear, mapMonth, mapYear;

window.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  tsMonth = mapMonth = now.getMonth() + 1;
  tsYear  = mapYear  = now.getFullYear();
  if (token && currentUser) startApp();
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key==='Enter') login(); });
});

// ─── API ──────────────────────────────────────────────────────────────────────
const api = async (method, path, body=null) => {
  const opts = { method, headers: { 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(()=>({}));
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
    token = data.token; currentUser = data.user;
    localStorage.setItem('cicf_token', token);
    localStorage.setItem('cicf_user', JSON.stringify(currentUser));
    startApp();
  } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('cicf_token'); localStorage.removeItem('cicf_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-password').value = '';
}

async function startApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'grid';
  document.getElementById('sidebar-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
  document.getElementById('sidebar-name').textContent = currentUser.name.split(' ')[0];
  document.getElementById('sidebar-role').textContent = currentUser.role==='admin' ? 'Administrador' : 'Colaborador';
  if (currentUser.role==='admin') {
    document.getElementById('admin-divider').style.display = 'block';
    document.getElementById('nav-approvals').style.display = 'flex';
    document.getElementById('nav-admin').style.display = 'flex';
    updatePendingBadge();
  }
  try {
    projects = await api('GET', '/api/projects');
    if (currentUser.role==='admin') allUsers = await api('GET', '/api/users');
  } catch(e) { console.error(e); }
  goto('dashboard');
}

async function updatePendingBadge() {
  try {
    const p = await api('GET', '/api/pending');
    const badge = document.getElementById('pending-badge');
    badge.textContent = p.length;
    badge.style.display = p.length ? 'inline-block' : 'none';
  } catch {}
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
function goto(section) {
  document.querySelectorAll('.section').forEach(s => s.style.display='none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById(`section-${section}`);
  if (el) el.style.display = 'block';
  const nav = document.querySelector(`[data-section="${section}"]`);
  if (nav) nav.classList.add('active');
  const loaders = {
    dashboard: loadDashboard, vacations: loadVacations, teammap: loadTeamMap,
    purchases: loadPurchases, schedules: loadSchedules, timesheet: loadTimesheet,
    approvals: loadPending, admin: loadAdmin, history: loadHistory
  };
  if (loaders[section]) loaders[section]();
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent =
    now.toLocaleDateString('pt-PT', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  try {
    const [vacations, purchases] = await Promise.all([
      api('GET', '/api/vacations'), api('GET', '/api/purchases')
    ]);
    let balance = { available: null };
    try { balance = await api('GET', `/api/users/${currentUser.id}/vacation-balance`); } catch {}

    const myPending  = vacations.filter(v => v.status==='pending');
    const myApproved = vacations.filter(v => v.status==='approved');
    const purPending = purchases.filter(p => p.status==='pending');
    let hoursThisMonth = 0;
    try {
      const ts = await api('GET', `/api/timesheets?month=${now.getMonth()+1}&year=${now.getFullYear()}`);
      hoursThisMonth = ts.reduce((s,t) => s+parseFloat(t.hours), 0);
    } catch {}

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${myApproved.length}</div><div class="stat-label">Férias Aprovadas</div></div>
      <div class="stat-card"><div class="stat-value">${myPending.length}</div><div class="stat-label">Pedidos Pendentes</div></div>
      <div class="stat-card"><div class="stat-value">${balance.available !== null ? balance.available+'d' : '—'}</div><div class="stat-label">Dias Disponíveis</div></div>
      <div class="stat-card"><div class="stat-value">${hoursThisMonth.toFixed(1)}h</div><div class="stat-label">Horas este mês</div></div>
    `;

    const vacEl = document.getElementById('dash-vacations');
    vacEl.innerHTML = myPending.length === 0
      ? '<div class="empty-state"><span class="empty-icon">◫</span>Sem pedidos pendentes</div>'
      : myPending.map(v => `<div class="schedule-day">
          <span class="text-muted">${v.user_name||currentUser.name}</span>
          <span>${fmtDate(v.start_date)} → ${fmtDate(v.end_date)}</span>
          <span class="badge-days">${v.working_days}d úteis</span>
          <span class="status status-pending">pendente</span>
        </div>`).join('');

    const purEl = document.getElementById('dash-purchases');
    purEl.innerHTML = purPending.length === 0
      ? '<div class="empty-state"><span class="empty-icon">◈</span>Sem compras pendentes</div>'
      : purPending.map(p => `<div class="schedule-day">
          <span class="text-muted">${p.user_name||currentUser.name}</span>
          <span>${p.description.substring(0,40)}</span>
          <span class="status status-pending">pendente</span>
        </div>`).join('');
  } catch(e) { showToast(e.message,'error'); }
}

// ─── VACATIONS ────────────────────────────────────────────────────────────────
async function loadVacations() {
  try {
    const [vacations, balance] = await Promise.all([
      api('GET', '/api/vacations'),
      api('GET', `/api/users/${currentUser.id}/vacation-balance`).catch(()=>({available:null}))
    ]);
    const el = document.getElementById('vacations-list');

    // Balance bar
    const balanceHtml = balance.available !== null ? `
      <div class="balance-bar">
        <div class="balance-item"><span class="balance-val text-accent">${balance.accrued}</span><span class="balance-lbl">Dias acumulados</span></div>
        <div class="balance-item"><span class="balance-val text-success">${balance.available}</span><span class="balance-lbl">Disponíveis</span></div>
        <div class="balance-item"><span class="balance-val text-muted">${balance.used}</span><span class="balance-lbl">Usados</span></div>
      </div>` : '';

    if (vacations.length === 0) {
      el.innerHTML = balanceHtml + `<div class="card"><div class="empty-state"><span class="empty-icon">◫</span>Sem pedidos de férias.</div></div>`;
      return;
    }

    el.innerHTML = balanceHtml + `
      <div class="card"><div class="table-wrap"><table>
        <thead><tr>
          ${currentUser.role==='admin' ? '<th>Colaborador</th>' : ''}
          <th>Início</th><th>Fim</th><th>Dias úteis</th><th>Notas</th><th>Estado</th><th>Decidido por</th><th></th>
        </tr></thead>
        <tbody>
          ${vacations.map(v => `<tr>
            ${currentUser.role==='admin' ? `<td class="fw-600">${v.user_name}</td>` : ''}
            <td>${fmtDate(v.start_date)}</td>
            <td>${fmtDate(v.end_date)}</td>
            <td><span class="badge-days">${v.working_days}d</span></td>
            <td class="text-muted">${v.notes||'—'}</td>
            <td>
              <span class="status status-${v.status}">${statusPT(v.status)}</span>
              ${v.reject_reason ? `<div class="reject-reason">${v.reject_reason}</div>` : ''}
              ${v.version > 1 ? `<span class="version-badge">v${v.version}</span>` : ''}
            </td>
            <td class="text-muted" style="font-size:11px">${v.decided_by||'—'}</td>
            <td class="td-actions">
              ${currentUser.role==='admin' && v.status==='pending' ? `
                <button class="btn btn-approve" onclick="decideVacation(${v.id},'approved')">✓</button>
                <button class="btn btn-reject" onclick="promptRejectVacation(${v.id})">✗</button>
              ` : ''}
              <button class="btn btn-ghost" onclick="editVacation(${v.id},'${v.start_date.split('T')[0]}','${v.end_date.split('T')[0]}','${(v.notes||'').replace(/'/g,"\\'")}')">Editar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

async function decideVacation(id, decision, reason='') {
  try {
    await api('POST', `/api/vacations/${id}/decide`, { decision, reject_reason: reason });
    showToast(decision==='approved' ? '✓ Férias aprovadas' : '✗ Férias recusadas',
              decision==='approved' ? 'success' : 'error');
    loadVacations(); updatePendingBadge();
    if (document.getElementById('section-approvals').style.display !== 'none') loadPending();
  } catch(e) { showToast(e.message,'error'); }
}

function promptRejectVacation(id) {
  const reason = prompt('Motivo da recusa (opcional):') || '';
  decideVacation(id, 'rejected', reason);
}

function editVacation(id, start, end, notes) {
  document.getElementById('vac-edit-id').value = id;
  document.getElementById('vac-start').value = start;
  document.getElementById('vac-end').value = end;
  document.getElementById('vac-notes').value = notes;
  document.getElementById('vac-modal-title').textContent = 'Editar Pedido de Férias';
  document.getElementById('vac-working-days').textContent = '';
  updateWorkingDays();
  showModal('modal-vacation');
}

async function updateWorkingDays() {
  const start = document.getElementById('vac-start').value;
  const end   = document.getElementById('vac-end').value;
  const el    = document.getElementById('vac-working-days');
  if (!start || !end || end < start) { el.textContent = ''; return; }
  try {
    const r = await api('GET', `/api/working-days?start=${start}&end=${end}`);
    el.textContent = r.working_days > 0
      ? `${r.working_days} dias úteis (excluindo fds e feriados PT)`
      : '⚠ Nenhum dia útil neste período';
    el.style.color = r.working_days > 0 ? 'var(--accent)' : 'var(--danger)';
  } catch { el.textContent = ''; }
}

async function submitVacation() {
  const btn = document.querySelector('#modal-vacation .btn-primary');
  const id    = document.getElementById('vac-edit-id').value;
  const start = document.getElementById('vac-start').value;
  const end   = document.getElementById('vac-end').value;
  const notes = document.getElementById('vac-notes').value;
  if (!start || !end) return showModalError('modal-vacation','Preenche as datas.');
  if (end < start)    return showModalError('modal-vacation','Data de fim anterior ao início.');
  btn.textContent = 'A submeter…'; btn.disabled = true;
  try {
    if (id) {
      await api('PATCH', `/api/vacations/${id}`, { start_date:start, end_date:end, notes });
      showToast('Pedido atualizado — voltou a pendente ✓','success');
    } else {
      await api('POST', '/api/vacations', { start_date:start, end_date:end, notes });
      showToast('Pedido submetido ✓','success');
    }
    closeModal(); loadVacations(); updatePendingBadge();
  } catch(e) { showModalError('modal-vacation', e.message); }
  finally { btn.textContent='Submeter Pedido'; btn.disabled=false; }
}

// ─── TEAM MAP ─────────────────────────────────────────────────────────────────
function changeMapMonth(d) {
  mapMonth += d;
  if (mapMonth>12){mapMonth=1;mapYear++;} if (mapMonth<1){mapMonth=12;mapYear--;}
  loadTeamMap();
}

async function loadTeamMap() {
  document.getElementById('map-month-label').textContent = `${monthPT(mapMonth)} ${mapYear}`;
  try {
    const [teamVacations, users] = await Promise.all([
      api('GET', '/api/vacations/team'), api('GET', '/api/users')
    ]);
    const daysInMonth = new Date(mapYear, mapMonth, 0).getDate();
    const today = new Date();
    const container = document.getElementById('team-map-container');

    let headers = '<div style="width:140px"></div>';
    for (let d=1; d<=daysInMonth; d++) {
      const date = new Date(mapYear, mapMonth-1, d);
      const isWE = date.getDay()===0||date.getDay()===6;
      const isToday = date.toDateString()===today.toDateString();
      headers += `<div class="map-header-day ${isWE?'weekend':''} ${isToday?'today':''}">${d}</div>`;
    }

    let rows = '';
    for (const user of users) {
      const dayStatus = {};
      for (const v of teamVacations.filter(v=>v.user_id===user.id)) {
        const s=new Date(v.start_date), e=new Date(v.end_date);
        for (const cur=new Date(s); cur<=e; cur.setDate(cur.getDate()+1)) {
          if (cur.getMonth()+1===mapMonth && cur.getFullYear()===mapYear)
            dayStatus[cur.getDate()] = v.status;
        }
      }
      let cells = `<div class="map-name" title="${user.name}">${user.name.split(' ')[0]}</div>`;
      for (let d=1; d<=daysInMonth; d++) {
        const isWE = new Date(mapYear,mapMonth-1,d).getDay()===0||new Date(mapYear,mapMonth-1,d).getDay()===6;
        cells += `<div class="map-cell ${dayStatus[d]?`vacation-${dayStatus[d]}`:''} ${isWE?'weekend':''}"></div>`;
      }
      rows += `<div class="map-row" style="--days:${daysInMonth}">${cells}</div>`;
    }

    container.innerHTML = `<div class="team-map">
      <div class="map-header-row" style="--days:${daysInMonth};display:grid;grid-template-columns:140px repeat(${daysInMonth},1fr)">${headers}</div>
      ${rows}
    </div>`;
  } catch(e) { showToast(e.message,'error'); }
}

// ─── PURCHASES ────────────────────────────────────────────────────────────────
async function loadPurchases() {
  try {
    const purchases = await api('GET', '/api/purchases');
    const el = document.getElementById('purchases-list');
    if (!purchases.length) {
      el.innerHTML = `<div class="card"><div class="empty-state"><span class="empty-icon">◈</span>Sem pedidos.</div></div>`;
      return;
    }
    el.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr>${currentUser.role==='admin'?'<th>Solicitante</th>':''}<th>Descrição</th><th>Valor</th><th>Fornecedor</th><th>Justificação</th><th>Estado</th><th></th></tr></thead>
      <tbody>${purchases.map(p=>`<tr>
        ${currentUser.role==='admin'?`<td class="fw-600">${p.user_name}</td>`:''}
        <td class="fw-600">${p.description}</td>
        <td class="text-accent">${p.amount?`€${parseFloat(p.amount).toFixed(2)}`:'—'}</td>
        <td class="text-muted">${p.supplier||'—'}</td>
        <td class="text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.justification||'—'}</td>
        <td><span class="status status-${p.status}">${statusPT(p.status)}</span></td>
        <td class="td-actions">
          ${currentUser.role==='admin' && p.status==='pending' ? `
            <button class="btn btn-approve" onclick="decidePurchase(${p.id},'approved')">✓</button>
            <button class="btn btn-reject" onclick="decidePurchase(${p.id},'rejected')">✗</button>
          ` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

async function submitPurchase() {
  const btn = document.querySelector('#modal-purchase .btn-primary');
  const desc   = document.getElementById('pur-desc').value.trim();
  const amount = document.getElementById('pur-amount').value;
  const supplier = document.getElementById('pur-supplier').value.trim();
  const justif = document.getElementById('pur-justif').value.trim();
  if (!desc || !justif) return showModalError('modal-purchase','Descrição e justificação obrigatórias.');
  btn.textContent='A submeter…'; btn.disabled=true;
  try {
    await api('POST', '/api/purchases', { description:desc, amount, supplier, justification:justif });
    closeModal(); showToast('Pedido submetido ✓','success'); loadPurchases(); updatePendingBadge();
  } catch(e) { showModalError('modal-purchase', e.message); }
  finally { btn.textContent='Submeter Pedido'; btn.disabled=false; }
}

async function decidePurchase(id, decision) {
  if (decision==='rejected' && !confirm('Rejeitar este pedido de compra?')) return;
  try {
    await api('POST', `/api/purchases/${id}/decide`, { decision });
    showToast(decision==='approved'?'✓ Aprovado':'✗ Rejeitado', decision==='approved'?'success':'error');
    loadPurchases(); updatePendingBadge();
    if (document.getElementById('section-approvals').style.display!=='none') loadPending();
  } catch(e) { showToast(e.message,'error'); }
}

// ─── SCHEDULES ────────────────────────────────────────────────────────────────
async function loadSchedules() {
  try {
    const schedule = await api('GET', '/api/schedules');
    const days = [
      {key:'monday',label:'Segunda-feira'},{key:'tuesday',label:'Terça-feira'},
      {key:'wednesday',label:'Quarta-feira'},{key:'thursday',label:'Quinta-feira'},
      {key:'friday',label:'Sexta-feira'}
    ];
    document.getElementById('schedule-content').innerHTML = !schedule
      ? '<div class="empty-state"><span class="empty-icon">◷</span>Sem horário definido.</div>'
      : days.map(d => {
          const s=schedule[`${d.key}_start`], e=schedule[`${d.key}_end`];
          return `<div class="schedule-day">
            <span class="schedule-day-name">${d.label}</span>
            <span class="schedule-hours">${s&&e?`${s.substring(0,5)} – ${e.substring(0,5)}`:'<span class="text-muted">—</span>'}</span>
          </div>`;
        }).join('');
    buildScheduleForm('schedule-form-grid', schedule);
    const changes = await api('GET', '/api/schedules/change-requests');
    const changesEl = document.getElementById('schedule-changes-list');
    changesEl.innerHTML = !changes.length
      ? '<div class="empty-state"><span class="empty-icon">◎</span>Sem pedidos.</div>'
      : changes.map(c=>`<div class="schedule-day">
          ${currentUser.role==='admin'?`<span class="text-muted">${c.user_name}</span>`:''}
          <span class="text-muted">${c.effective_from?fmtDate(c.effective_from):'—'}</span>
          <span>${c.reason||'—'}</span>
          <span class="status status-${c.status}">${statusPT(c.status)}</span>
          ${currentUser.role==='admin' && c.status==='pending' ? `
            <button class="btn btn-approve" style="padding:4px 10px;font-size:11px" onclick="decideScheduleChange(${c.id},'approved')">✓</button>
            <button class="btn btn-reject" style="padding:4px 10px;font-size:11px" onclick="decideScheduleChange(${c.id},'rejected')">✗</button>
          ` : ''}
        </div>`).join('');
  } catch(e) { showToast(e.message,'error'); }
}

function buildScheduleForm(containerId, prefill=null) {
  const days = [{key:'monday',label:'Seg'},{key:'tuesday',label:'Ter'},{key:'wednesday',label:'Qua'},{key:'thursday',label:'Qui'},{key:'friday',label:'Sex'}];
  document.getElementById(containerId).innerHTML = `
    <div class="schedule-form-row" style="font-size:11px;color:var(--muted);font-weight:500;text-transform:uppercase;letter-spacing:.06em"><span>Dia</span><span>Entrada</span><span>Saída</span></div>
    ${days.map(d=>`<div class="schedule-form-row">
      <label>${d.label}</label>
      <input type="time" id="sf-${containerId}-${d.key}-start" value="${prefill?.[`${d.key}_start`]?.substring(0,5)||'09:00'}">
      <input type="time" id="sf-${containerId}-${d.key}-end" value="${prefill?.[`${d.key}_end`]?.substring(0,5)||'18:00'}">
    </div>`).join('')}`;
}

async function submitScheduleChange() {
  const btn = document.querySelector('#modal-schedule-change .btn-primary');
  const days = ['monday','tuesday','wednesday','thursday','friday'];
  const new_schedule = {};
  for (const d of days) {
    new_schedule[`${d}_start`] = document.getElementById(`sf-schedule-form-grid-${d}-start`)?.value||null;
    new_schedule[`${d}_end`]   = document.getElementById(`sf-schedule-form-grid-${d}-end`)?.value||null;
  }
  btn.textContent='A submeter…'; btn.disabled=true;
  try {
    await api('POST', '/api/schedules/change-request', {
      new_schedule,
      reason: document.getElementById('sch-reason').value,
      effective_from: document.getElementById('sch-effective').value
    });
    closeModal(); showToast('Pedido submetido ✓','success'); loadSchedules(); updatePendingBadge();
  } catch(e) { showModalError('modal-schedule-change', e.message); }
  finally { btn.textContent='Submeter Pedido'; btn.disabled=false; }
}

async function decideScheduleChange(id, decision) {
  try {
    await api('POST', `/api/schedules/change-requests/${id}/decide`, { decision });
    showToast(decision==='approved'?'✓ Horário aprovado e aplicado':'✗ Recusado', decision==='approved'?'success':'error');
    loadSchedules(); updatePendingBadge();
  } catch(e) { showToast(e.message,'error'); }
}

// ─── TIMESHEET ────────────────────────────────────────────────────────────────
function changeTSMonth(d) {
  tsMonth+=d;
  if(tsMonth>12){tsMonth=1;tsYear++;} if(tsMonth<1){tsMonth=12;tsYear--;}
  loadTimesheet();
}

async function loadTimesheet() {
  document.getElementById('ts-month-label').textContent=`${monthPT(tsMonth)} ${tsYear}`;
  const sel=document.getElementById('ts-user-select');
  if (currentUser.role==='admin' && allUsers.length) {
    sel.style.display='block';
    if (!sel.children.length)
      sel.innerHTML=allUsers.map(u=>`<option value="${u.id}" ${u.id===currentUser.id?'selected':''}>${u.name}</option>`).join('');
  }
  const userId = currentUser.role==='admin' ? sel.value : currentUser.id;
  const userParam = currentUser.role==='admin' ? `&userId=${userId}` : '';
  try {
    const entries = await api('GET',`/api/timesheets?month=${tsMonth}&year=${tsYear}${userParam}`);
    const total = entries.reduce((s,e)=>s+parseFloat(e.hours),0);
    const byProj = {};
    for (const e of entries) byProj[e.project_code||e.project_name]=(byProj[e.project_code||e.project_name]||0)+parseFloat(e.hours);

    document.getElementById('ts-summary').innerHTML=`<div class="ts-summary">
      <div class="ts-summary-item">Total: <strong>${total.toFixed(2)}h</strong></div>
      <div class="ts-summary-item">Entradas: <strong>${entries.length}</strong></div>
      <div class="ts-by-project">${Object.entries(byProj).map(([k,h])=>`
        <div class="project-chip"><span class="project-chip-code">${k}</span><span class="project-chip-hours">${h.toFixed(2)}h</span></div>
      `).join('')}</div>
    </div>`;

    const el=document.getElementById('timesheet-list');
    if (!entries.length) { el.innerHTML='<div class="empty-state"><span class="empty-icon">◳</span>Sem registos neste mês.</div>'; return; }
    el.innerHTML=`<div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Projeto</th><th>Tarefa</th><th>Campo Custom</th><th>Horas</th><th>Notas</th><th></th></tr></thead>
      <tbody>${entries.map(e=>`<tr>
        <td class="text-muted">${fmtDate(e.date)}</td>
        <td><span class="project-chip" style="font-size:11px"><span class="project-chip-code">${e.project_code}</span><span style="color:var(--text)">${e.project_name}</span></span></td>
        <td class="fw-600">${e.task_name}</td>
        <td class="text-muted">${e.custom_field||'—'}</td>
        <td class="text-accent fw-600">${parseFloat(e.hours).toFixed(2)}h</td>
        <td class="text-muted">${e.notes||'—'}</td>
        <td class="td-actions">
          <button class="btn btn-ghost" onclick="editTimesheet(${e.id})">Editar</button>
          <button class="btn btn-danger" onclick="deleteTimesheet(${e.id})">✕</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

async function submitTimesheet() {
  const btn=document.querySelector('#modal-timesheet .btn-primary');
  const id=document.getElementById('ts-edit-id').value;
  const body={
    date:document.getElementById('ts-date').value,
    project_id:document.getElementById('ts-project').value,
    task_name:document.getElementById('ts-task').value.trim(),
    custom_field:document.getElementById('ts-custom').value.trim(),
    hours:document.getElementById('ts-hours').value,
    notes:document.getElementById('ts-notes').value.trim()
  };
  if (!body.date||!body.project_id||!body.task_name||!body.hours)
    return showModalError('modal-timesheet','Preenche os campos obrigatórios.');
  btn.textContent='A guardar…'; btn.disabled=true;
  try {
    if (id) await api('PUT',`/api/timesheets/${id}`,body);
    else    await api('POST','/api/timesheets',body);
    closeModal(); showToast('Guardado ✓','success'); loadTimesheet();
  } catch(e) { showModalError('modal-timesheet',e.message); }
  finally { btn.textContent='Guardar'; btn.disabled=false; }
}

async function editTimesheet(id) {
  const userId=currentUser.role==='admin'?document.getElementById('ts-user-select').value:currentUser.id;
  const entries=await api('GET',`/api/timesheets?month=${tsMonth}&year=${tsYear}${currentUser.role==='admin'?`&userId=${userId}`:''}`);
  const e=entries.find(e=>e.id===id); if(!e) return;
  showModal('modal-timesheet');
  document.getElementById('ts-modal-title').textContent='Editar Registo';
  document.getElementById('ts-edit-id').value=id;
  document.getElementById('ts-date').value=e.date.split('T')[0];
  document.getElementById('ts-project').value=e.project_id;
  document.getElementById('ts-task').value=e.task_name;
  document.getElementById('ts-custom').value=e.custom_field||'';
  document.getElementById('ts-hours').value=e.hours;
  document.getElementById('ts-notes').value=e.notes||'';
}

async function deleteTimesheet(id) {
  if (!confirm('Eliminar este registo?')) return;
  try { await api('DELETE',`/api/timesheets/${id}`); showToast('Eliminado','success'); loadTimesheet(); }
  catch(e) { showToast(e.message,'error'); }
}

// ─── APPROVALS ────────────────────────────────────────────────────────────────
async function loadPending() {
  try {
    const pending=await api('GET','/api/pending');
    const el=document.getElementById('approvals-list');
    if (!pending.length) {
      el.innerHTML=`<div class="card"><div class="empty-state"><span class="empty-icon">◎</span>Sem aprovações pendentes 🎉</div></div>`;
      document.getElementById('pending-badge').style.display='none'; return;
    }
    const icons={vacation:'📅',purchase:'🛒',schedule:'🕐'};
    const labels={vacation:'Férias',purchase:'Compra',schedule:'Horário'};
    el.innerHTML=`<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Tipo</th><th>Colaborador</th><th>Detalhe</th><th>Submetido</th><th>Ações</th></tr></thead>
      <tbody>${pending.map(p=>{
        let detail='', actions='';
        if (p.type==='vacation') {
          detail=`${fmtDate(p.start_date)} → ${fmtDate(p.end_date)} <span class="badge-days">${p.working_days||0}d</span>`;
          actions=`<button class="btn btn-approve" onclick="decideVacation(${p.id},'approved')">✓ Aprovar</button>
                   <button class="btn btn-reject"  onclick="promptRejectVacation(${p.id})">✗ Recusar</button>`;
        }
        if (p.type==='purchase') {
          detail=`${p.description}${p.amount?` — €${parseFloat(p.amount).toFixed(2)}`:''}`;
          actions=`<button class="btn btn-approve" onclick="decidePurchase(${p.id},'approved')">✓ Aprovar</button>
                   <button class="btn btn-reject"  onclick="decidePurchase(${p.id},'rejected')">✗ Recusar</button>`;
        }
        if (p.type==='schedule') {
          detail=p.reason||'Alteração de horário';
          actions=`<button class="btn btn-approve" onclick="decideScheduleChange(${p.id},'approved')">✓ Aprovar</button>
                   <button class="btn btn-reject"  onclick="decideScheduleChange(${p.id},'rejected')">✗ Recusar</button>`;
        }
        return `<tr>
          <td>${icons[p.type]} ${labels[p.type]}</td>
          <td class="fw-600">${p.user_name}</td>
          <td>${detail}</td>
          <td class="text-muted">${fmtDate(p.created_at)}</td>
          <td class="td-actions">${actions}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
const actionLabel={
  vacation_submitted:'📅 Férias submetidas', vacation_edited:'✏️ Férias editadas',
  vacation_approved:'✓ Férias aprovadas', vacation_rejected:'✗ Férias recusadas',
};
async function loadHistory() {
  try {
    const logs=await api('GET','/api/history');
    const el=document.getElementById('history-list');
    if (!logs.length) { el.innerHTML='<div class="empty-state"><span class="empty-icon">◴</span>Sem atividade.</div>'; return; }
    el.innerHTML=`<div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Ação</th><th>Detalhe</th><th>Por</th></tr></thead>
      <tbody>${logs.map(l=>{
        const d=l.detail||{};
        let detail='—';
        if (d.start_date) detail=`${fmtDate(d.start_date)} → ${fmtDate(d.end_date)}${d.working_days?` (${d.working_days}d úteis)`:''}`;
        if (d.reason) detail+=` — ${d.reason}`;
        return `<tr>
          <td class="text-muted">${fmtDate(l.created_at)}</td>
          <td>${actionLabel[l.action]||l.action}</td>
          <td>${detail}</td>
          <td class="text-muted">${l.actor_name||'—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function loadAdmin() { switchAdminTab('users'); }
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tabs .tab-btn').forEach((b,i)=>
    b.classList.toggle('active',['users','projects','schedules-admin'][i]===tab));
  ['users','projects','schedules-admin'].forEach(t=>{
    const el=document.getElementById(`admin-tab-${t}`);
    if(el) el.style.display=t===tab?'block':'none';
  });
  if(tab==='users') loadUsers();
  if(tab==='projects') loadProjects();
  if(tab==='schedules-admin') loadAllSchedules();
}

async function loadUsers() {
  try {
    allUsers=await api('GET','/api/users');
    document.getElementById('users-list').innerHTML=`<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Email</th><th>Função</th><th>Depto</th><th>Início Contrato</th><th>Aniversário</th><th></th></tr></thead>
      <tbody>${allUsers.map(u=>`<tr>
        <td class="fw-600">${u.name}</td>
        <td class="text-muted">${u.email}</td>
        <td><span class="status ${u.role==='admin'?'status-approved':'status-pending'}">${u.role}</span></td>
        <td class="text-muted">${u.department||'—'}</td>
        <td class="text-muted">${u.contract_start?fmtDate(u.contract_start):'—'}</td>
        <td class="text-muted">${u.birthdate?fmtDate(u.birthdate):'—'}</td>
        <td class="td-actions">
          ${u.id!==currentUser.id?`<button class="btn btn-danger" onclick="deleteUser(${u.id})">Remover</button>`:''}
        </td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

async function submitUser() {
  const btn=document.querySelector('#modal-user .btn-primary');
  const body={
    name:document.getElementById('usr-name').value.trim(),
    email:document.getElementById('usr-email').value.trim(),
    password:document.getElementById('usr-pwd').value||'cicf2024',
    role:document.getElementById('usr-role').value,
    department:document.getElementById('usr-dept').value.trim(),
    manager_email:document.getElementById('usr-mgr').value.trim(),
    contract_start:document.getElementById('usr-contract').value||null,
    birthdate:document.getElementById('usr-birthdate').value||null,
  };
  if(!body.name||!body.email) return showModalError('modal-user','Nome e email obrigatórios.');
  btn.textContent='A criar…'; btn.disabled=true;
  try {
    await api('POST','/api/users',body);
    closeModal(); showToast('Colaborador criado ✓','success'); loadUsers();
  } catch(e) { showModalError('modal-user',e.message); }
  finally { btn.textContent='Criar Colaborador'; btn.disabled=false; }
}

async function deleteUser(id) {
  if(!confirm('Remover colaborador? Esta ação é irreversível.')) return;
  try { await api('DELETE',`/api/users/${id}`); showToast('Removido','success'); loadUsers(); }
  catch(e) { showToast(e.message,'error'); }
}

async function loadProjects() {
  try {
    const projs=await api('GET','/api/projects'); projects=projs;
    document.getElementById('projects-list').innerHTML=`<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Código</th><th>Criado</th><th></th></tr></thead>
      <tbody>${projs.map(p=>`<tr>
        <td class="fw-600">${p.name}</td>
        <td><span class="project-chip" style="font-size:11px"><span class="project-chip-code">${p.code||'—'}</span></span></td>
        <td class="text-muted">${fmtDate(p.created_at)}</td>
        <td class="td-actions"><button class="btn btn-danger" onclick="deleteProject(${p.id})">Arquivar</button></td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

async function submitProject() {
  const name=document.getElementById('proj-name').value.trim();
  const code=document.getElementById('proj-code').value.trim().toUpperCase();
  if(!name) return showModalError('modal-project','Nome obrigatório.');
  try {
    const p=await api('POST','/api/projects',{name,code});
    projects.push(p); closeModal(); showToast('Projeto criado ✓','success'); loadProjects();
  } catch(e) { showModalError('modal-project',e.message); }
}

async function deleteProject(id) {
  if(!confirm('Arquivar projeto?')) return;
  try { await api('DELETE',`/api/projects/${id}`); showToast('Arquivado','success'); loadProjects(); }
  catch(e) { showToast(e.message,'error'); }
}

async function loadAllSchedules() {
  try {
    const [schedules,users]=await Promise.all([api('GET','/api/schedules/all'),api('GET','/api/users')]);
    const map={}; for(const s of schedules) map[s.user_id]=s;
    const days=['monday','tuesday','wednesday','thursday','friday'];
    const daysPT=['Seg','Ter','Qua','Qui','Sex'];
    document.getElementById('all-schedules-list').innerHTML=`<div class="card" style="margin-top:20px"><div class="table-wrap"><table>
      <thead><tr><th>Colaborador</th>${daysPT.map(d=>`<th>${d}</th>`).join('')}<th></th></tr></thead>
      <tbody>${users.map(u=>{
        const s=map[u.id];
        return `<tr>
          <td class="fw-600">${u.name}</td>
          ${days.map(d=>{
            const st=s?.[`${d}_start`]?.substring(0,5), en=s?.[`${d}_end`]?.substring(0,5);
            return `<td class="text-muted" style="font-size:11px">${st&&en?`${st}–${en}`:'—'}</td>`;
          }).join('')}
          <td><button class="btn btn-ghost" onclick="openScheduleAdmin(${u.id},'${u.name}')">Editar</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
  } catch(e) { showToast(e.message,'error'); }
}

async function openScheduleAdmin(userId, userName) {
  const s=await api('GET',`/api/schedules?userId=${userId}`);
  document.getElementById('sched-admin-title').textContent=`Horário — ${userName}`;
  document.getElementById('sched-admin-userid').value=userId;
  buildScheduleForm('schedule-admin-form-grid',s);
  showModal('modal-schedule-admin');
}

async function submitScheduleAdmin() {
  const userId=document.getElementById('sched-admin-userid').value;
  const days=['monday','tuesday','wednesday','thursday','friday'];
  const body={};
  for(const d of days) {
    body[`${d}_start`]=document.getElementById(`sf-schedule-admin-form-grid-${d}-start`)?.value||null;
    body[`${d}_end`]=document.getElementById(`sf-schedule-admin-form-grid-${d}-end`)?.value||null;
  }
  try {
    await api('PUT',`/api/schedules/${userId}`,body);
    closeModal(); showToast('Horário guardado ✓','success'); loadAllSchedules();
  } catch(e) { showModalError('modal-schedule-admin',e.message); }
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function showModal(id) {
  const overlay=document.getElementById('modal-overlay');
  overlay.style.display='flex';
  document.querySelectorAll('.modal').forEach(m=>m.style.display='none');
  document.getElementById(id).style.display='block';
  if (id==='modal-timesheet') {
    document.getElementById('ts-modal-title').textContent='Registar Horas';
    document.getElementById('ts-edit-id').value='';
    const sel=document.getElementById('ts-project');
    sel.innerHTML='<option value="">Selecionar projeto...</option>'+
      projects.map(p=>`<option value="${p.id}">${p.code?`[${p.code}] `:''}${p.name}</option>`).join('');
    document.getElementById('ts-date').value=new Date().toISOString().split('T')[0];
  }
  if (id==='modal-vacation') {
    if (!document.getElementById('vac-edit-id').value) {
      document.getElementById('vac-modal-title').textContent='Novo Pedido de Férias';
      document.getElementById('vac-start').value='';
      document.getElementById('vac-end').value='';
      document.getElementById('vac-notes').value='';
      document.getElementById('vac-working-days').textContent='';
    }
  }
}

function closeModal() {
  const overlay=document.getElementById('modal-overlay');
  overlay.style.display='none';
  document.querySelectorAll('.modal').forEach(m=>{
    m.style.display='none';
    const e=m.querySelector('.modal-error'); if(e) e.style.display='none';
  });
  // Reset vacation edit state
  document.getElementById('vac-edit-id').value='';
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function showModalError(modalId, msg) {
  const modal=document.getElementById(modalId);
  let el=modal.querySelector('.modal-error');
  if(!el){
    el=document.createElement('div'); el.className='modal-error error-msg';
    el.style.marginTop='12px'; modal.querySelector('.modal-footer').before(el);
  }
  el.textContent=msg; el.style.display='block';
}

function fmtDate(d) {
  if(!d) return '—';
  return new Date(d).toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function statusPT(s) { return {pending:'Pendente',approved:'Aprovado',rejected:'Recusado'}[s]||s; }
function monthPT(m) { return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m-1]; }

let toastTimer;
function showToast(msg, type='success') {
  const el=document.getElementById('toast');
  el.textContent=msg; el.className=`toast ${type} show`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3500);
}

document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
