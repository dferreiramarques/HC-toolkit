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
const DEFAULT_MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'admin@cicf.pt';

// ─── DATABASE ─────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('⚠  DATABASE_URL não definida. Adiciona o PostgreSQL addon no Railway e certifica-te que a variável está ligada ao serviço.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10
});

// ─── EMAIL ────────────────────────────────────────────────────────────────────
const sendEmail = async (to, subject, html) => {
  if (!process.env.SMTP_HOST) {
    console.log(`\n[EMAIL SIMULADO]\nPara: ${to}\nAssunto: ${subject}\n`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@cicf.pt',
    to, subject, html
  });
};

const emailLayout = (title, color, icon, rows, approveUrl, rejectUrl) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:monospace;background:#0f1117;margin:0;padding:32px}
.card{max-width:560px;margin:0 auto;background:#1a1d27;border:1px solid #2a2d3e;border-radius:12px;padding:40px}
h2{color:${color};margin:0 0 8px;font-size:20px}
.sub{color:#64748b;margin:0 0 28px;font-size:13px}
table{width:100%;border-collapse:collapse;margin-bottom:32px}
td{padding:10px 0;border-bottom:1px solid #2a2d3e;font-size:14px;color:#e2e8f0}
td:first-child{color:#64748b;width:140px}
.btn{display:inline-block;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px}
.approve{background:#10b981;color:white}
.reject{background:#ef4444;color:white;margin-left:12px}
</style></head><body>
<div class="card">
  <h2>${icon} ${title}</h2>
  <p class="sub">Ação necessária — clica para aprovar ou rejeitar</p>
  <table>${rows}</table>
  <a href="${approveUrl}" class="btn approve">✓ Aprovar</a>
  <a href="${rejectUrl}" class="btn reject">✗ Rejeitar</a>
</div></body></html>`;

const tr = (label, value) => `<tr><td>${label}</td><td><strong>${value || '—'}</strong></td></tr>`;

// ─── DB INIT ──────────────────────────────────────────────────────────────────
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'employee',
        department VARCHAR(255),
        manager_email VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vacation_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        notes TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        approval_token VARCHAR(36) UNIQUE,
        approved_by VARCHAR(255),
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS purchase_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        amount DECIMAL(10,2),
        supplier VARCHAR(255),
        justification TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        approval_token VARCHAR(36) UNIQUE,
        approved_by VARCHAR(255),
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        monday_start TIME, monday_end TIME,
        tuesday_start TIME, tuesday_end TIME,
        wednesday_start TIME, wednesday_end TIME,
        thursday_start TIME, thursday_end TIME,
        friday_start TIME, friday_end TIME,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS schedule_change_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        new_schedule JSONB NOT NULL,
        reason TEXT,
        effective_from DATE,
        status VARCHAR(50) DEFAULT 'pending',
        approval_token VARCHAR(36) UNIQUE,
        approved_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS timesheets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        task_name VARCHAR(255) NOT NULL,
        custom_field VARCHAR(255),
        hours DECIMAL(4,2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed default projects
    await client.query(`
      INSERT INTO projects (name, code) VALUES
        ('Geral / Interno', 'INT'),
        ('Norte 2030', 'N2030'),
        ('InGaming', 'ING'),
        ('Code&Craft', 'CC')
      ON CONFLICT DO NOTHING;
    `);

    // Create default admin
    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (rows[0].count === '0') {
      const hash = await bcrypt.hash('cicf2024', 10);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)`,
        ['Administrador', 'admin@cicf.pt', hash, 'admin']
      );
      console.log('\n╔══════════════════════════════════════╗');
      console.log('║  CICF OPS — Setup inicial concluído  ║');
      console.log('║  Email: admin@cicf.pt                ║');
      console.log('║  Password: cicf2024                  ║');
      console.log('╚══════════════════════════════════════╝\n');
    }
  } finally {
    client.release();
  }
};

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
};

const getManagerEmail = async (userId) => {
  const { rows } = await pool.query('SELECT manager_email FROM users WHERE id = $1', [userId]);
  return rows[0]?.manager_email || DEFAULT_MANAGER_EMAIL;
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/change-password', auth, async (req, res) => {
  const { current, newPassword } = req.body;
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current, rows[0].password_hash))) {
    return res.status(400).json({ error: 'Password atual incorreta' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ success: true });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, department, manager_email, created_at FROM users ORDER BY name'
  );
  res.json(rows);
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, department, manager_email } = req.body;
  try {
    const hash = await bcrypt.hash(password || 'cicf2024', 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department, manager_email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, department`,
      [name, email.toLowerCase(), hash, role || 'employee', department, manager_email]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'Email já existe' });
  }
});

app.put('/api/users/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const { name, department, manager_email, role, password } = req.body;
  const fields = [];
  const vals = [];
  let i = 1;
  if (name) { fields.push(`name=$${i++}`); vals.push(name); }
  if (department !== undefined) { fields.push(`department=$${i++}`); vals.push(department); }
  if (manager_email !== undefined) { fields.push(`manager_email=$${i++}`); vals.push(manager_email); }
  if (role && req.user.role === 'admin') { fields.push(`role=$${i++}`); vals.push(role); }
  if (password) { fields.push(`password_hash=$${i++}`); vals.push(await bcrypt.hash(password, 10)); }
  vals.push(req.params.id);
  if (fields.length > 0) await pool.query(`UPDATE users SET ${fields.join(',')} WHERE id=$${i}`, vals);
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Não podes eliminar a tua própria conta' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE active = true ORDER BY name');
  res.json(rows);
});

app.post('/api/projects', auth, adminOnly, async (req, res) => {
  const { name, code } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO projects (name, code) VALUES ($1, $2) RETURNING *', [name, code]
  );
  res.json(rows[0]);
});

app.delete('/api/projects/:id', auth, adminOnly, async (req, res) => {
  await pool.query('UPDATE projects SET active = false WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ─── VACATIONS ────────────────────────────────────────────────────────────────
app.get('/api/vacations', auth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const q = isAdmin
    ? `SELECT v.*, u.name as user_name FROM vacation_requests v JOIN users u ON v.user_id = u.id ORDER BY v.created_at DESC`
    : `SELECT v.*, u.name as user_name FROM vacation_requests v JOIN users u ON v.user_id = u.id WHERE v.user_id = $1 ORDER BY v.created_at DESC`;
  const { rows } = await pool.query(q, isAdmin ? [] : [req.user.id]);
  res.json(rows);
});

app.get('/api/vacations/team', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*, u.name as user_name
    FROM vacation_requests v JOIN users u ON v.user_id = u.id
    WHERE v.status IN ('approved','pending')
    ORDER BY v.start_date
  `);
  res.json(rows);
});

app.post('/api/vacations', auth, async (req, res) => {
  try {
    const { start_date, end_date, notes } = req.body;

    // Check for overlapping pending/approved requests
    const { rows: overlap } = await pool.query(`
      SELECT id FROM vacation_requests
      WHERE user_id = $1
        AND status IN ('pending', 'approved')
        AND start_date <= $3
        AND end_date >= $2
    `, [req.user.id, start_date, end_date]);

    if (overlap.length > 0) {
      return res.status(409).json({ error: 'Já existe um pedido de férias pendente ou aprovado que coincide com estas datas.' });
    }

    const token = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO vacation_requests (user_id, start_date, end_date, notes, approval_token)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, start_date, end_date, notes, token]
    );
    const managerEmail = await getManagerEmail(req.user.id);
    const approveUrl = `${BASE_URL}/approve/${token}/approve`;
    const rejectUrl = `${BASE_URL}/approve/${token}/reject`;
    const start = new Date(start_date).toLocaleDateString('pt-PT');
    const end = new Date(end_date).toLocaleDateString('pt-PT');
    const days = Math.ceil((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
    await sendEmail(
      managerEmail,
      `[CICF OPS] Pedido de Férias — ${req.user.name}`,
      emailLayout(
        `Pedido de Férias — ${req.user.name}`, '#10b981', '📅',
        tr('Colaborador', req.user.name) +
        tr('Início', start) +
        tr('Fim', end) +
        tr('Dias', days) +
        tr('Notas', notes),
        approveUrl, rejectUrl
      )
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/vacations/:id', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM vacation_requests WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role !== 'admin' && rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  if (rows[0].status === 'approved' && req.user.role !== 'admin') return res.status(400).json({ error: 'Não podes cancelar férias já aprovadas' });
  await pool.query('DELETE FROM vacation_requests WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// Admin: delete all pending duplicates for a user keeping only the latest
app.delete('/api/admin/vacations/duplicates', auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    DELETE FROM vacation_requests
    WHERE id NOT IN (
      SELECT DISTINCT ON (user_id, start_date, end_date) id
      FROM vacation_requests
      ORDER BY user_id, start_date, end_date, created_at DESC
    )
    AND status = 'pending'
    RETURNING id
  `);
  res.json({ deleted: rows.length });
});

// ─── PURCHASES ────────────────────────────────────────────────────────────────
app.get('/api/purchases', auth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const q = isAdmin
    ? `SELECT p.*, u.name as user_name FROM purchase_requests p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`
    : `SELECT p.*, u.name as user_name FROM purchase_requests p JOIN users u ON p.user_id = u.id WHERE p.user_id = $1 ORDER BY p.created_at DESC`;
  const { rows } = await pool.query(q, isAdmin ? [] : [req.user.id]);
  res.json(rows);
});

app.post('/api/purchases', auth, async (req, res) => {
  try {
    const { description, amount, supplier, justification } = req.body;
    const token = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO purchase_requests (user_id, description, amount, supplier, justification, approval_token)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, description, amount || null, supplier, justification, token]
    );
    const managerEmail = await getManagerEmail(req.user.id);
    const approveUrl = `${BASE_URL}/approve/${token}/approve`;
    const rejectUrl = `${BASE_URL}/approve/${token}/reject`;
    await sendEmail(
      managerEmail,
      `[CICF OPS] Pedido de Compra — ${req.user.name}`,
      emailLayout(
        `Pedido de Compra — ${req.user.name}`, '#f59e0b', '🛒',
        tr('Solicitante', req.user.name) +
        tr('Descrição', description) +
        tr('Valor estimado', amount ? `€${parseFloat(amount).toFixed(2)}` : null) +
        tr('Fornecedor', supplier) +
        tr('Justificação', justification),
        approveUrl, rejectUrl
      )
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/purchases/:id', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM purchase_requests WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role !== 'admin' && rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  await pool.query('DELETE FROM purchase_requests WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ─── SCHEDULES ────────────────────────────────────────────────────────────────
app.get('/api/schedules', auth, async (req, res) => {
  const userId = (req.user.role === 'admin' && req.query.userId) ? req.query.userId : req.user.id;
  const { rows } = await pool.query('SELECT * FROM schedules WHERE user_id = $1', [userId]);
  res.json(rows[0] || null);
});

app.get('/api/schedules/all', auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, u.name as user_name FROM schedules s JOIN users u ON s.user_id = u.id ORDER BY u.name`
  );
  res.json(rows);
});

app.put('/api/schedules/:userId', auth, adminOnly, async (req, res) => {
  const s = req.body;
  await pool.query(`
    INSERT INTO schedules (user_id, monday_start, monday_end, tuesday_start, tuesday_end,
      wednesday_start, wednesday_end, thursday_start, thursday_end, friday_start, friday_end, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      monday_start=$2, monday_end=$3, tuesday_start=$4, tuesday_end=$5,
      wednesday_start=$6, wednesday_end=$7, thursday_start=$8, thursday_end=$9,
      friday_start=$10, friday_end=$11, updated_at=NOW()
  `, [req.params.userId, s.monday_start, s.monday_end, s.tuesday_start, s.tuesday_end,
      s.wednesday_start, s.wednesday_end, s.thursday_start, s.thursday_end,
      s.friday_start, s.friday_end]);
  res.json({ success: true });
});

app.post('/api/schedules/change-request', auth, async (req, res) => {
  try {
    const { new_schedule, reason, effective_from } = req.body;
    const token = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO schedule_change_requests (user_id, new_schedule, reason, effective_from, approval_token)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, JSON.stringify(new_schedule), reason, effective_from, token]
    );
    const managerEmail = await getManagerEmail(req.user.id);
    const approveUrl = `${BASE_URL}/approve/${token}/approve`;
    const rejectUrl = `${BASE_URL}/approve/${token}/reject`;
    const days = ['monday','tuesday','wednesday','thursday','friday'];
    const dayPT = ['Segunda','Terça','Quarta','Quinta','Sexta'];
    const scheduleRows = days.map((d,i) =>
      new_schedule[`${d}_start`]
        ? tr(dayPT[i], `${new_schedule[`${d}_start`]} – ${new_schedule[`${d}_end`]}`)
        : ''
    ).join('');
    await sendEmail(
      managerEmail,
      `[CICF OPS] Alteração de Horário — ${req.user.name}`,
      emailLayout(
        `Alteração de Horário — ${req.user.name}`, '#8b5cf6', '🕐',
        tr('Colaborador', req.user.name) +
        tr('Vigência a partir de', effective_from ? new Date(effective_from).toLocaleDateString('pt-PT') : null) +
        tr('Motivo', reason) +
        scheduleRows,
        approveUrl, rejectUrl
      )
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/schedules/change-requests', auth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const q = isAdmin
    ? `SELECT s.*, u.name as user_name FROM schedule_change_requests s JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC`
    : `SELECT s.*, u.name as user_name FROM schedule_change_requests s JOIN users u ON s.user_id = u.id WHERE s.user_id = $1 ORDER BY s.created_at DESC`;
  const { rows } = await pool.query(q, isAdmin ? [] : [req.user.id]);
  res.json(rows);
});

// ─── TIMESHEETS ───────────────────────────────────────────────────────────────
app.get('/api/timesheets', auth, async (req, res) => {
  const { month, year, userId } = req.query;
  const targetUser = (req.user.role === 'admin' && userId) ? parseInt(userId) : req.user.id;
  let q = `
    SELECT t.*, p.name as project_name, p.code as project_code, u.name as user_name
    FROM timesheets t
    JOIN projects p ON t.project_id = p.id
    JOIN users u ON t.user_id = u.id
    WHERE t.user_id = $1
  `;
  const params = [targetUser];
  if (month && year) {
    q += ` AND EXTRACT(MONTH FROM t.date) = $2 AND EXTRACT(YEAR FROM t.date) = $3`;
    params.push(month, year);
  }
  q += ' ORDER BY t.date ASC, t.id ASC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

app.post('/api/timesheets', auth, async (req, res) => {
  const { date, project_id, task_name, custom_field, hours, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO timesheets (user_id, date, project_id, task_name, custom_field, hours, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.user.id, date, project_id, task_name, custom_field, parseFloat(hours), notes]
  );
  res.json(rows[0]);
});

app.put('/api/timesheets/:id', auth, async (req, res) => {
  const { rows: ex } = await pool.query('SELECT * FROM timesheets WHERE id = $1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role !== 'admin' && ex[0].user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  const { date, project_id, task_name, custom_field, hours, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE timesheets SET date=$1, project_id=$2, task_name=$3, custom_field=$4, hours=$5, notes=$6
     WHERE id=$7 RETURNING *`,
    [date, project_id, task_name, custom_field, parseFloat(hours), notes, req.params.id]
  );
  res.json(rows[0]);
});

app.delete('/api/timesheets/:id', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM timesheets WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  if (req.user.role !== 'admin' && rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
  await pool.query('DELETE FROM timesheets WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ─── PENDING (admin overview) ─────────────────────────────────────────────────
app.get('/api/pending', auth, adminOnly, async (req, res) => {
  const [vac, pur, sch] = await Promise.all([
    pool.query(`SELECT v.*, u.name as user_name, 'vacation' as type FROM vacation_requests v
                JOIN users u ON v.user_id = u.id WHERE v.status = 'pending' ORDER BY v.created_at`),
    pool.query(`SELECT p.*, u.name as user_name, 'purchase' as type FROM purchase_requests p
                JOIN users u ON p.user_id = u.id WHERE p.status = 'pending' ORDER BY p.created_at`),
    pool.query(`SELECT s.*, u.name as user_name, 'schedule' as type FROM schedule_change_requests s
                JOIN users u ON s.user_id = u.id WHERE s.status = 'pending' ORDER BY s.created_at`)
  ]);
  res.json([...vac.rows, ...pur.rows, ...sch.rows].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)));
});

// ─── APPROVAL ROUTES (tokenized, no auth needed) ──────────────────────────────
app.get('/approve/:token/:action', async (req, res) => {
  const { token, action } = req.params;
  if (!['approve', 'reject'].includes(action)) return res.status(400).send('Ação inválida');
  const status = action === 'approve' ? 'approved' : 'rejected';
  const statusPT = action === 'approve' ? 'aprovado' : 'rejeitado';
  const color = action === 'approve' ? '#10b981' : '#ef4444';
  const icon = action === 'approve' ? '✓' : '✗';

  const notify = async (userId, subject, message) => {
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (rows[0]) await sendEmail(rows[0].email, `[CICF OPS] ${subject}`, `<div style="font-family:monospace;background:#0f1117;color:#e2e8f0;padding:32px;border-radius:8px"><p>${message}</p><br><a href="${BASE_URL}" style="color:#f59e0b">Aceder ao sistema →</a></div>`);
  };

  // Vacation
  const { rows: vac } = await pool.query('SELECT * FROM vacation_requests WHERE approval_token = $1', [token]);
  if (vac[0]) {
    if (vac[0].status !== 'pending') {
      return res.send(approvalResultPage('Já processado', `Este pedido já foi ${vac[0].status === 'approved' ? 'aprovado' : 'rejeitado'} anteriormente.`, '#f59e0b', '⚠'));
    }
    await pool.query('UPDATE vacation_requests SET status=$1, approved_at=NOW() WHERE approval_token=$2', [status, token]);
    const start = new Date(vac[0].start_date).toLocaleDateString('pt-PT');
    const end = new Date(vac[0].end_date).toLocaleDateString('pt-PT');
    await notify(vac[0].user_id, `Férias ${statusPT}`, `O teu pedido de férias de <strong>${start}</strong> a <strong>${end}</strong> foi <strong style="color:${color}">${statusPT}</strong>.`);
    return res.send(approvalResultPage(`${icon} Férias ${statusPT}`, `O pedido de férias foi ${statusPT} com sucesso.`, color, icon));
  }

  // Purchase
  const { rows: pur } = await pool.query('SELECT * FROM purchase_requests WHERE approval_token = $1', [token]);
  if (pur[0]) {
    if (pur[0].status !== 'pending') {
      return res.send(approvalResultPage('Já processado', `Este pedido já foi ${pur[0].status === 'approved' ? 'aprovado' : 'rejeitado'} anteriormente.`, '#f59e0b', '⚠'));
    }
    await pool.query('UPDATE purchase_requests SET status=$1, approved_at=NOW() WHERE approval_token=$2', [status, token]);
    await notify(pur[0].user_id, `Compra ${statusPT}`, `O teu pedido de compra <strong>${pur[0].description}</strong> foi <strong style="color:${color}">${statusPT}</strong>.`);
    return res.send(approvalResultPage(`${icon} Compra ${statusPT}`, `O pedido de compra foi ${statusPT} com sucesso.`, color, icon));
  }

  // Schedule change
  const { rows: sch } = await pool.query('SELECT * FROM schedule_change_requests WHERE approval_token = $1', [token]);
  if (sch[0]) {
    if (sch[0].status !== 'pending') {
      return res.send(approvalResultPage('Já processado', 'Este pedido já foi processado anteriormente.', '#f59e0b', '⚠'));
    }
    await pool.query('UPDATE schedule_change_requests SET status=$1 WHERE approval_token=$2', [status, token]);
    if (status === 'approved') {
      const ns = sch[0].new_schedule;
      await pool.query(`
        INSERT INTO schedules (user_id, monday_start, monday_end, tuesday_start, tuesday_end,
          wednesday_start, wednesday_end, thursday_start, thursday_end, friday_start, friday_end, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          monday_start=$2, monday_end=$3, tuesday_start=$4, tuesday_end=$5,
          wednesday_start=$6, wednesday_end=$7, thursday_start=$8, thursday_end=$9,
          friday_start=$10, friday_end=$11, updated_at=NOW()
      `, [sch[0].user_id, ns.monday_start, ns.monday_end, ns.tuesday_start, ns.tuesday_end,
          ns.wednesday_start, ns.wednesday_end, ns.thursday_start, ns.thursday_end,
          ns.friday_start, ns.friday_end]);
    }
    await notify(sch[0].user_id, `Horário ${statusPT}`, `O teu pedido de alteração de horário foi <strong style="color:${color}">${statusPT}</strong>.`);
    return res.send(approvalResultPage(`${icon} Horário ${statusPT}`, `A alteração de horário foi ${statusPT} com sucesso.`, color, icon));
  }

  res.status(404).send(approvalResultPage('Link inválido', 'Este link não é válido ou já expirou.', '#64748b', '?'));
});

const approvalResultPage = (title, message, color, icon) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title} — CICF OPS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1117;color:#e2e8f0;font-family:'IBM Plex Mono',monospace;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#1a1d27;border:1px solid #2a2d3e;border-radius:16px;padding:56px 48px;
      text-align:center;max-width:440px;width:100%}
.icon{font-size:48px;margin-bottom:24px;display:block}
h1{color:${color};font-size:22px;margin-bottom:12px;font-weight:600}
p{color:#94a3b8;line-height:1.7;font-size:14px;margin-bottom:32px}
a{color:#f59e0b;text-decoration:none;font-size:13px;border:1px solid #f59e0b33;
  padding:10px 20px;border-radius:6px;transition:background .2s}
a:hover{background:#f59e0b15}
.brand{color:#64748b;font-size:11px;margin-top:32px;letter-spacing:.1em;text-transform:uppercase}
</style></head>
<body>
  <div class="card">
    <span class="icon">${icon}</span>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${BASE_URL}">← Voltar ao sistema</a>
    <p class="brand">CICF OPS · CDI Portugal</p>
  </div>
</body></html>`;

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Rota não encontrada' });
  }
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Erro ao servir index.html:', err.message, '| Path:', indexPath);
      res.status(500).send(`
        <h2>Erro de configuração</h2>
        <p>Ficheiro index.html não encontrado em: <code>${indexPath}</code></p>
        <p>Garante que a pasta <code>public/</code> foi incluída no repositório git.</p>
        <pre>ls: ${require('fs').readdirSync(__dirname).join(', ')}</pre>
      `);
    }
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
// Arrancar HTTP imediatamente (Railway health checks), depois inicializar BD com retry
app.listen(PORT, () => console.log('CICF OPS a ouvir na porta ' + PORT));

const startDB = async (attempt = 1) => {
  try {
    await initDB();
    console.log('✓ Base de dados pronta — ' + BASE_URL);
  } catch (err) {
    const delay = Math.min(attempt * 3000, 30000);
    console.error('✗ BD falhou (tentativa ' + attempt + '): ' + err.message);
    if (attempt >= 10) {
      console.error('Desistindo após 10 tentativas. Verifica DATABASE_URL no Railway.');
      return;
    }
    console.log('  A tentar de novo em ' + (delay / 1000) + 's...');
    setTimeout(() => startDB(attempt + 1), delay);
  }
};

startDB();
