const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cicf-ops-secret-change-in-production';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!process.env.DATABASE_URL) console.warn('⚠  DATABASE_URL não definida.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000, max: 10
});

// ─── EMAIL ────────────────────────────────────────────────────────────────────
const sendEmail = (to, subject, html) => {
  if (!process.env.SMTP_HOST) { console.log(`[EMAIL] ${to} | ${subject}`); return; }
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  t.sendMail({ from: process.env.SMTP_FROM || 'noreply@cicf.pt', to, subject, html })
   .catch(e => console.error(`[EMAIL ERR] ${to}: ${e.message}`));
};

const notifyEmail = (to, subject, body) => sendEmail(to, subject,
  `<div style="font-family:monospace;background:#0f1117;color:#e2e8f0;padding:32px;max-width:520px;border-radius:8px">
    ${body}<br><br>
    <a href="${BASE_URL}" style="color:#f59e0b">Aceder ao CICF OPS →</a>
    <p style="color:#475569;font-size:11px;margin-top:24px">CICF OPS · CDI Portugal</p>
  </div>`
);

// ─── FERIADOS PT + DIAS ÚTEIS ─────────────────────────────────────────────────
const ptHolidays = (year) => {
  const a = year%19, b = Math.floor(year/100), c = year%100;
  const d = Math.floor(b/4), e = b%4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15)%30;
  const i = Math.floor(c/4), k = c%4, l = (32+2*e+2*i-h-k)%7;
  const m = Math.floor((a+11*h+22*l)/451);
  const month = Math.floor((h+l-7*m+114)/31), day = ((h+l-7*m+114)%31)+1;
  const easter = new Date(year, month-1, day);
  const add = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
  const fmt = d => d.toISOString().split('T')[0];
  return new Set([
    `${year}-01-01`, fmt(add(easter,-47)), fmt(add(easter,-2)), fmt(easter),
    fmt(add(easter,60)), `${year}-04-25`, `${year}-05-01`, `${year}-06-10`,
    `${year}-08-15`, `${year}-10-05`, `${year}-11-01`,
    `${year}-12-01`, `${year}-12-08`, `${year}-12-25`
  ]);
};

const calcWorkingDaysDecimal = (startStr, endStr, isHalfDay=false, period='full') => {
  if (isHalfDay) return 0.5;
  return calcWorkingDays(startStr, endStr);
};

const calcWorkingDays = (startStr, endStr) => {
  const start = new Date(startStr+'T00:00:00'), end = new Date(endStr+'T00:00:00');
  if (end < start) return 0;
  const holidays = new Set([
    ...ptHolidays(start.getFullYear()),
    ...ptHolidays(end.getFullYear()),
    ...ptHolidays(end.getFullYear()+1)
  ]);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay(), key = cur.toISOString().split('T')[0];
    if (dow !== 0 && dow !== 6 && !holidays.has(key)) count++;
    cur.setDate(cur.getDate()+1);
  }
  return count;
};

// ─── DB INIT ──────────────────────────────────────────────────────────────────
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'employee', department VARCHAR(255),
        manager_email VARCHAR(255), contract_start DATE, birthdate DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, code VARCHAR(50),
        active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS vacation_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_date DATE NOT NULL, end_date DATE NOT NULL,
        working_days INTEGER NOT NULL DEFAULT 0, notes TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        decided_by VARCHAR(255), decided_at TIMESTAMP, reject_reason TEXT,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL, amount DECIMAL(10,2),
        supplier VARCHAR(255), justification TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        approval_token VARCHAR(36) UNIQUE,
        approved_by VARCHAR(255), approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        monday_start TIME, monday_end TIME, tuesday_start TIME, tuesday_end TIME,
        wednesday_start TIME, wednesday_end TIME, thursday_start TIME, thursday_end TIME,
        friday_start TIME, friday_end TIME, updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS schedule_change_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        new_schedule JSONB NOT NULL, reason TEXT, effective_from DATE,
        status VARCHAR(50) DEFAULT 'pending', approval_token VARCHAR(36) UNIQUE,
        approved_by VARCHAR(255), created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        actor_name VARCHAR(255), action VARCHAR(100) NOT NULL, detail JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS special_days (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'holiday',
        description TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS timesheets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL, project_id INTEGER REFERENCES projects(id),
        task_name VARCHAR(255) NOT NULL, custom_field VARCHAR(255),
        hours DECIMAL(4,2) NOT NULL, notes TEXT, created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Migrations for existing DBs
    const migrations = [
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS working_days INTEGER DEFAULT 0`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS decided_by VARCHAR(255)`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_start DATE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate DATE`,
    ];
    const extraMigrations = [
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN DEFAULT false`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS day_period VARCHAR(10) DEFAULT 'full'`,
      `ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS working_days_decimal DECIMAL(4,1)`,
      `CREATE TABLE IF NOT EXISTS special_days (
        id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL, type VARCHAR(50) NOT NULL DEFAULT 'holiday',
        description TEXT, created_by VARCHAR(255), created_at TIMESTAMP DEFAULT NOW()
      )`,
    ];
    for (const m of extraMigrations) await client.query(m).catch(() => {});
    for (const m of migrations) await client.query(m).catch(() => {});

    await client.query(`INSERT INTO projects (name,code) VALUES
      ('Geral / Interno','INT'),('Norte 2030','N2030'),('InGaming','ING'),('Code&Craft','CC')
      ON CONFLICT DO NOTHING`);

    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (rows[0].count === '0') {
      const hash = await bcrypt.hash('cicf2024', 10);
      await client.query(`INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)`,
        ['Administrador', 'admin@cicf.pt', hash, 'admin']);
      console.log('\n╔══════════════════════════════════════╗');
      console.log('║  admin@cicf.pt  /  cicf2024          ║');
      console.log('╚══════════════════════════════════════╝\n');
    }
  } finally { client.release(); }
};

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());

// Servir JS e CSS sempre frescos (sem cache)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

const auth = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'Não autorizado' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
};
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Apenas administradores' });

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign(
      { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ token, user: { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role, department: rows[0].department } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── UTILITY ──────────────────────────────────────────────────────────────────
app.get('/api/working-days', auth, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start e end obrigatórios' });
  res.json({ working_days: calcWorkingDays(start, end) });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id,name,email,role,department,manager_email,contract_start,birthdate,created_at FROM users ORDER BY name'
  );
  res.json(rows);
});

app.get('/api/users/:id/vacation-balance', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT contract_start,birthdate FROM users WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    const { contract_start, birthdate } = rows[0];
    if (!contract_start) return res.json({ accrued: null, available: null, used: 0 });

    const start = new Date(contract_start), now = new Date();
    const monthsWorked = Math.max(0,
      (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth())
    );
    let accrued = Math.min(monthsWorked*2, 22);
    if (birthdate) {
      const b = new Date(birthdate);
      if (new Date(now.getFullYear(), b.getMonth(), b.getDate()) <= now) accrued++;
    }
    const { rows: usedRows } = await pool.query(
      `SELECT COALESCE(SUM(working_days),0) as used FROM vacation_requests
       WHERE user_id=$1 AND status='approved' AND EXTRACT(YEAR FROM start_date)=$2`,
      [req.params.id, now.getFullYear()]
    );
    const used = parseInt(usedRows[0].used);
    res.json({ accrued, used, available: accrued - used });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, department, manager_email, contract_start, birthdate } = req.body;
  try {
    const hash = await bcrypt.hash(password || 'cicf2024', 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name,email,password_hash,role,department,manager_email,contract_start,birthdate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,email,role,department`,
      [name, email.toLowerCase(), hash, role||'employee', department, manager_email,
       contract_start||null, birthdate||null]
    );
    res.json(rows[0]);
  } catch { res.status(400).json({ error: 'Email já existe' }); }
});

app.put('/api/users/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id))
    return res.status(403).json({ error: 'Acesso negado' });
  const { name, department, manager_email, role, password, contract_start, birthdate } = req.body;
  const fields=[], vals=[]; let i=1;
  if (name)            { fields.push(`name=$${i++}`);            vals.push(name); }
  if (department!==undefined) { fields.push(`department=$${i++}`); vals.push(department); }
  if (manager_email!==undefined) { fields.push(`manager_email=$${i++}`); vals.push(manager_email); }
  if (role && req.user.role==='admin') { fields.push(`role=$${i++}`); vals.push(role); }
  if (password)        { fields.push(`password_hash=$${i++}`);   vals.push(await bcrypt.hash(password,10)); }
  if (contract_start!==undefined) { fields.push(`contract_start=$${i++}`); vals.push(contract_start||null); }
  if (birthdate!==undefined) { fields.push(`birthdate=$${i++}`); vals.push(birthdate||null); }
  vals.push(req.params.id);
  if (fields.length) await pool.query(`UPDATE users SET ${fields.join(',')} WHERE id=$${i}`, vals);
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  if (parseInt(req.params.id)===req.user.id) return res.status(400).json({ error: 'Não podes eliminar a tua conta' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE active=true ORDER BY name');
  res.json(rows);
});
app.post('/api/projects', auth, adminOnly, async (req, res) => {
  const { name, code } = req.body;
  const { rows } = await pool.query('INSERT INTO projects (name,code) VALUES ($1,$2) RETURNING *', [name,code]);
  res.json(rows[0]);
});
app.delete('/api/projects/:id', auth, adminOnly, async (req, res) => {
  await pool.query('UPDATE projects SET active=false WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ─── VACATIONS ────────────────────────────────────────────────────────────────
app.get('/api/vacations', auth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const q = isAdmin
    ? `SELECT v.*, u.name as user_name, u.email as user_email FROM vacation_requests v
       JOIN users u ON v.user_id=u.id ORDER BY v.created_at DESC`
    : `SELECT v.*, u.name as user_name, u.email as user_email FROM vacation_requests v
       JOIN users u ON v.user_id=u.id WHERE v.user_id=$1 ORDER BY v.created_at DESC`;
  const { rows } = await pool.query(q, isAdmin ? [] : [req.user.id]);
  res.json(rows);
});

app.get('/api/vacations/team', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*, u.name as user_name FROM vacation_requests v
    JOIN users u ON v.user_id=u.id WHERE v.status IN ('approved','pending') ORDER BY v.start_date
  `);
  res.json(rows);
});

// Criar pedido
app.post('/api/vacations', auth, async (req, res) => {
  try {
    const { start_date, end_date, notes, is_half_day, day_period } = req.body;
    const halfDay = is_half_day === true || is_half_day === 'true';
    const period  = halfDay ? (day_period || 'full') : 'full';
    const endDate = halfDay ? start_date : end_date; // half day = single date

    const { rows: ov } = await pool.query(`
      SELECT id FROM vacation_requests WHERE user_id=$1
      AND status IN ('pending','approved') AND start_date<=$3 AND end_date>=$2
    `, [req.user.id, start_date, endDate]);
    if (ov.length) return res.status(409).json({ error: 'Já existe um pedido que coincide com estas datas.' });

    const working_days = halfDay ? 0.5 : calcWorkingDays(start_date, endDate);
    if (!working_days) return res.status(400).json({ error: 'O período não tem dias úteis (excluídos fds e feriados PT).' });

    // Check holiday blocks
    const { rows: blocked } = await pool.query(
      `SELECT name FROM special_days WHERE type='holiday' AND date BETWEEN $1 AND $2`,
      [start_date, endDate]
    );
    if (blocked.length > 0)
      return res.status(400).json({ error: `O período inclui dias bloqueados: ${blocked.map(b=>b.name).join(', ')}` });

    const { rows } = await pool.query(
      `INSERT INTO vacation_requests (user_id,start_date,end_date,working_days,notes,is_half_day,day_period)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, start_date, endDate, working_days, notes, halfDay, period]
    );
    await pool.query(`INSERT INTO activity_log (user_id,actor_name,action,detail) VALUES ($1,$2,$3,$4)`,
      [req.user.id, req.user.name, 'vacation_submitted',
       JSON.stringify({ start_date, end_date, working_days })]).catch(()=>{});
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar pedido (volta a pending)
app.patch('/api/vacations/:id', auth, async (req, res) => {
  try {
    const { rows: ex } = await pool.query('SELECT * FROM vacation_requests WHERE id=$1', [req.params.id]);
    if (!ex[0]) return res.status(404).json({ error: 'Não encontrado' });
    if (req.user.role !== 'admin' && ex[0].user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });

    const { start_date, end_date, notes, is_half_day, day_period } = req.body;
    const halfDay = is_half_day === true || is_half_day === 'true';
    const period  = halfDay ? (day_period || 'full') : 'full';
    const endDate = halfDay ? start_date : end_date;

    const { rows: ov } = await pool.query(`
      SELECT id FROM vacation_requests WHERE user_id=$1 AND id!=$4
      AND status IN ('pending','approved') AND start_date<=$3 AND end_date>=$2
    `, [ex[0].user_id, start_date, endDate, req.params.id]);
    if (ov.length) return res.status(409).json({ error: 'Já existe um pedido que coincide com estas datas.' });

    const working_days = halfDay ? 0.5 : calcWorkingDays(start_date, endDate);
    if (!working_days) return res.status(400).json({ error: 'O período não tem dias úteis.' });

    const { rows } = await pool.query(
      `UPDATE vacation_requests SET start_date=$1,end_date=$2,working_days=$3,notes=$4,
       is_half_day=$5,day_period=$6,
       status='pending',decided_by=NULL,decided_at=NULL,reject_reason=NULL,
       version=version+1,updated_at=NOW() WHERE id=$7 RETURNING *`,
      [start_date, endDate, working_days, notes, halfDay, period, req.params.id]
    );
    await pool.query(`INSERT INTO activity_log (user_id,actor_name,action,detail) VALUES ($1,$2,$3,$4)`,
      [ex[0].user_id, req.user.name, 'vacation_edited',
       JSON.stringify({ start_date, end_date, working_days })]).catch(()=>{});
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aprovar ou recusar (admin)
app.post('/api/vacations/:id/decide', auth, adminOnly, async (req, res) => {
  try {
    const { decision, reject_reason } = req.body;
    if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Decisão inválida' });

    const { rows: ex } = await pool.query(
      `SELECT v.*, u.email as user_email, u.name as user_name FROM vacation_requests v
       JOIN users u ON v.user_id=u.id WHERE v.id=$1`, [req.params.id]
    );
    if (!ex[0]) return res.status(404).json({ error: 'Não encontrado' });
    if (ex[0].status !== 'pending') return res.status(400).json({ error: 'Só pedidos pendentes podem ser decididos' });

    const { rows } = await pool.query(
      `UPDATE vacation_requests SET status=$1,decided_by=$2,decided_at=NOW(),reject_reason=$3,updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [decision, req.user.name, reject_reason||null, req.params.id]
    );
    await pool.query(`INSERT INTO activity_log (user_id,actor_name,action,detail) VALUES ($1,$2,$3,$4)`,
      [ex[0].user_id, req.user.name, `vacation_${decision}`,
       JSON.stringify({ start_date: ex[0].start_date, end_date: ex[0].end_date,
                       working_days: ex[0].working_days, reason: reject_reason })]).catch(()=>{});

    const start = new Date(ex[0].start_date).toLocaleDateString('pt-PT');
    const end   = new Date(ex[0].end_date).toLocaleDateString('pt-PT');
    const label = decision==='approved' ? 'APROVADO' : 'RECUSADO';
    const color = decision==='approved' ? '#10b981' : '#ef4444';
    notifyEmail(ex[0].user_email, `[CICF OPS] Férias ${label}`,
      `<h2 style="color:${color}">${label === 'APROVADO' ? '✓' : '✗'} Férias ${label}</h2>
       <p>${start} → ${end} (${ex[0].working_days} dias úteis) — decidido por <strong>${req.user.name}</strong></p>
       ${reject_reason ? `<p><strong>Motivo:</strong> ${reject_reason}</p>` : ''}
       <p style="color:#94a3b8;font-size:12px">Podes editar o pedido na plataforma para nova submissão.</p>`
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cancelar pedido (próprio se pending, admin sempre)
app.delete('/api/vacations/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.*, u.email as user_email FROM vacation_requests v
       JOIN users u ON v.user_id=u.id WHERE v.id=$1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    const v = rows[0];
    if (req.user.role !== 'admin' && v.user_id !== req.user.id)
      return res.status(403).json({ error: 'Acesso negado' });
    if (req.user.role !== 'admin' && v.status !== 'pending')
      return res.status(400).json({ error: 'Só podes cancelar pedidos pendentes' });

    await pool.query(
      `UPDATE vacation_requests SET status='cancelled', decided_by=$1, decided_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [req.user.name, req.params.id]
    );
    await pool.query(`INSERT INTO activity_log (user_id,actor_name,action,detail) VALUES ($1,$2,$3,$4)`,
      [v.user_id, req.user.name, 'vacation_cancelled',
       JSON.stringify({ start_date: v.start_date, end_date: v.end_date })]).catch(()=>{});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PURCHASES ────────────────────────────────────────────────────────────────
app.get('/api/purchases', auth, async (req, res) => {
  const isAdmin = req.user.role==='admin';
  const q = isAdmin
    ? `SELECT p.*,u.name as user_name FROM purchase_requests p JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC`
    : `SELECT p.*,u.name as user_name FROM purchase_requests p JOIN users u ON p.user_id=u.id WHERE p.user_id=$1 ORDER BY p.created_at DESC`;
  const { rows } = await pool.query(q, isAdmin ? [] : [req.user.id]);
  res.json(rows);
});
app.post('/api/purchases', auth, async (req, res) => {
  try {
    const { description, amount, supplier, justification } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO purchase_requests (user_id,description,amount,supplier,justification,approval_token)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, description, amount||null, supplier, justification, uuidv4()]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/purchases/:id/decide', auth, adminOnly, async (req, res) => {
  const { decision } = req.body;
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Decisão inválida' });
  const { rows } = await pool.query(
    `UPDATE purchase_requests SET status=$1,approved_by=$2,approved_at=NOW()
     WHERE id=$3 AND status='pending' RETURNING *`,
    [decision, req.user.name, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado ou já decidido' });
  res.json(rows[0]);
});
app.delete('/api/purchases/:id', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM purchase_requests WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role!=='admin' && rows[0].user_id!==req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  await pool.query('DELETE FROM purchase_requests WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ─── SCHEDULES ────────────────────────────────────────────────────────────────
app.get('/api/schedules', auth, async (req, res) => {
  const uid = (req.user.role==='admin' && req.query.userId) ? req.query.userId : req.user.id;
  const { rows } = await pool.query('SELECT * FROM schedules WHERE user_id=$1', [uid]);
  res.json(rows[0]||null);
});
app.get('/api/schedules/all', auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`SELECT s.*,u.name as user_name FROM schedules s JOIN users u ON s.user_id=u.id ORDER BY u.name`);
  res.json(rows);
});
app.put('/api/schedules/:userId', auth, adminOnly, async (req, res) => {
  const s = req.body;
  await pool.query(`
    INSERT INTO schedules (user_id,monday_start,monday_end,tuesday_start,tuesday_end,
      wednesday_start,wednesday_end,thursday_start,thursday_end,friday_start,friday_end,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      monday_start=$2,monday_end=$3,tuesday_start=$4,tuesday_end=$5,
      wednesday_start=$6,wednesday_end=$7,thursday_start=$8,thursday_end=$9,
      friday_start=$10,friday_end=$11,updated_at=NOW()
  `, [req.params.userId,s.monday_start,s.monday_end,s.tuesday_start,s.tuesday_end,
      s.wednesday_start,s.wednesday_end,s.thursday_start,s.thursday_end,s.friday_start,s.friday_end]);
  res.json({ success: true });
});
app.post('/api/schedules/change-request', auth, async (req, res) => {
  const { new_schedule, reason, effective_from } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO schedule_change_requests (user_id,new_schedule,reason,effective_from,approval_token)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, JSON.stringify(new_schedule), reason, effective_from, uuidv4()]
  );
  res.json(rows[0]);
});
app.get('/api/schedules/change-requests', auth, async (req, res) => {
  const isAdmin = req.user.role==='admin';
  const q = isAdmin
    ? `SELECT s.*,u.name as user_name FROM schedule_change_requests s JOIN users u ON s.user_id=u.id ORDER BY s.created_at DESC`
    : `SELECT s.*,u.name as user_name FROM schedule_change_requests s JOIN users u ON s.user_id=u.id WHERE s.user_id=$1 ORDER BY s.created_at DESC`;
  const { rows } = await pool.query(q, isAdmin ? [] : [req.user.id]);
  res.json(rows);
});
app.post('/api/schedules/change-requests/:id/decide', auth, adminOnly, async (req, res) => {
  const { decision } = req.body;
  const { rows: ex } = await pool.query('SELECT * FROM schedule_change_requests WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (decision === 'approved') {
    const ns = ex[0].new_schedule;
    await pool.query(`
      INSERT INTO schedules (user_id,monday_start,monday_end,tuesday_start,tuesday_end,
        wednesday_start,wednesday_end,thursday_start,thursday_end,friday_start,friday_end,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monday_start=$2,monday_end=$3,tuesday_start=$4,tuesday_end=$5,
        wednesday_start=$6,wednesday_end=$7,thursday_start=$8,thursday_end=$9,
        friday_start=$10,friday_end=$11,updated_at=NOW()
    `, [ex[0].user_id,ns.monday_start,ns.monday_end,ns.tuesday_start,ns.tuesday_end,
        ns.wednesday_start,ns.wednesday_end,ns.thursday_start,ns.thursday_end,ns.friday_start,ns.friday_end]);
  }
  await pool.query(`UPDATE schedule_change_requests SET status=$1,approved_by=$2 WHERE id=$3`,
    [decision, req.user.name, req.params.id]);
  res.json({ success: true });
});

// ─── TIMESHEETS ───────────────────────────────────────────────────────────────
app.get('/api/timesheets', auth, async (req, res) => {
  const { month, year, userId } = req.query;
  const uid = (req.user.role==='admin' && userId) ? parseInt(userId) : req.user.id;
  let q = `SELECT t.*,p.name as project_name,p.code as project_code,u.name as user_name
           FROM timesheets t JOIN projects p ON t.project_id=p.id JOIN users u ON t.user_id=u.id
           WHERE t.user_id=$1`;
  const params = [uid];
  if (month && year) { q += ` AND EXTRACT(MONTH FROM t.date)=$2 AND EXTRACT(YEAR FROM t.date)=$3`; params.push(month,year); }
  q += ' ORDER BY t.date ASC,t.id ASC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});
app.post('/api/timesheets', auth, async (req, res) => {
  const { date, project_id, task_name, custom_field, hours, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO timesheets (user_id,date,project_id,task_name,custom_field,hours,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id,date,project_id,task_name,custom_field,parseFloat(hours),notes]
  );
  res.json(rows[0]);
});
app.put('/api/timesheets/:id', auth, async (req, res) => {
  const { rows: ex } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role!=='admin' && ex[0].user_id!==req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  const { date, project_id, task_name, custom_field, hours, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE timesheets SET date=$1,project_id=$2,task_name=$3,custom_field=$4,hours=$5,notes=$6
     WHERE id=$7 RETURNING *`,
    [date,project_id,task_name,custom_field,parseFloat(hours),notes,req.params.id]
  );
  res.json(rows[0]);
});
app.delete('/api/timesheets/:id', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role!=='admin' && rows[0].user_id!==req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  await pool.query('DELETE FROM timesheets WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ─── SPECIAL DAYS ────────────────────────────────────────────────────────────
app.get('/api/special-days', auth, async (req, res) => {
  const { year } = req.query;
  let q = 'SELECT * FROM special_days';
  const params = [];
  if (year) { q += ' WHERE EXTRACT(YEAR FROM date) = $1'; params.push(year); }
  q += ' ORDER BY date ASC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

app.post('/api/special-days', auth, adminOnly, async (req, res) => {
  try {
    const { date, name, type, description } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'Data e nome obrigatórios' });
    if (!['holiday','cdi_event'].includes(type))
      return res.status(400).json({ error: 'Tipo inválido' });
    const { rows } = await pool.query(
      `INSERT INTO special_days (date, name, type, description, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [date, name, type, description || null, req.user.name]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe um dia especial nesta data' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/special-days/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM special_days WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ─── PENDING ──────────────────────────────────────────────────────────────────
app.get('/api/pending', auth, adminOnly, async (req, res) => {
  const [v,p,s] = await Promise.all([
    pool.query(`SELECT v.*,u.name as user_name,'vacation' as type FROM vacation_requests v
                JOIN users u ON v.user_id=u.id WHERE v.status='pending' ORDER BY v.created_at`),
    pool.query(`SELECT p.*,u.name as user_name,'purchase' as type FROM purchase_requests p
                JOIN users u ON p.user_id=u.id WHERE p.status='pending' ORDER BY p.created_at`),
    pool.query(`SELECT s.*,u.name as user_name,'schedule' as type FROM schedule_change_requests s
                JOIN users u ON s.user_id=u.id WHERE s.status='pending' ORDER BY s.created_at`)
  ]);
  res.json([...v.rows,...p.rows,...s.rows].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
});

// ─── HISTORY ──────────────────────────────────────────────────────────────────
app.get('/api/history', auth, async (req, res) => {
  const uid = (req.user.role==='admin' && req.query.userId) ? req.query.userId : req.user.id;
  const { rows } = await pool.query(
    `SELECT * FROM activity_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [uid]
  );
  res.json(rows);
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Não encontrado' });
  const idx = path.join(__dirname, 'public', 'index.html');
  res.sendFile(idx, err => {
    if (err) res.status(500).send(
      `<h2>Erro</h2><p>index.html não encontrado: ${idx}</p>
       <pre>${require('fs').readdirSync(__dirname).join(', ')}</pre>`
    );
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`CICF OPS na porta ${PORT}`));
const startDB = async (n=1) => {
  try { await initDB(); console.log(`✓ BD pronta — ${BASE_URL}`); }
  catch (e) {
    console.error(`✗ BD tentativa ${n}: ${e.message}`);
    if (n < 10) setTimeout(() => startDB(n+1), Math.min(n*3000,30000));
  }
};
startDB();
