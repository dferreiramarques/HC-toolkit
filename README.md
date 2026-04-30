# CICF OPS

Sistema interno de gestão para o Centro de Inovação Carlos Fiolhais.

## Funcionalidades

- 📅 **Férias** — Pedidos com aprovação por email (link direto approve/reject)
- 🛒 **Compras** — Pedidos de material com fluxo de aprovação
- 🕐 **Horários** — Visualização e pedidos de alteração por colaborador
- 🗺 **Mapa de Equipa** — Calendário mensal com todas as férias
- ⏱ **Folha de Horas** — Registo de horas por tarefa e projeto
- ✅ **Aprovações** — Painel central (admin) com todos os pedidos pendentes
- ⚙️ **Admin** — Gestão de colaboradores, projetos e horários

## Deploy no Railway

### 1. Criar projeto no Railway

```bash
# No GitHub, criar repositório e push do código
git init && git add . && git commit -m "init"
git remote add origin https://github.com/SEU_USER/cicf-ops.git
git push -u origin main
```

No Railway: **New Project → Deploy from GitHub repo**

### 2. Adicionar PostgreSQL

Railway Dashboard → **+ New Service → Database → PostgreSQL**

A variável `DATABASE_URL` é injetada automaticamente.

### 3. Variáveis de Ambiente

No Railway Dashboard → Settings → Variables:

```env
# Obrigatória em produção
JWT_SECRET=uma-string-longa-e-aleatoria-aqui

# URL pública do Railway (para links nos emails)
BASE_URL=https://cicf-ops-production.up.railway.app

# Email do gestor padrão (para quem não tem manager_email definido)
MANAGER_EMAIL=david@cicf.pt

# SMTP para envio de emails (ex: Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=cicf@gmail.com
SMTP_PASS=app-password-do-gmail
SMTP_FROM=CICF OPS <cicf@gmail.com>
```

> **Nota:** Se `SMTP_HOST` não estiver definido, os emails são apenas simulados no log (útil para desenvolvimento).

### 4. Primeiro acesso

Após o deploy, o sistema cria automaticamente:
- **Email:** `admin@cicf.pt`  
- **Password:** `cicf2024`

⚠️ Muda a password depois do primeiro login (em breve via UI, por agora usa a API).

## Desenvolvimento local

```bash
npm install

# Criar .env local
echo "DATABASE_URL=postgresql://localhost/cicf_ops" > .env
echo "JWT_SECRET=dev-secret" >> .env

# Iniciar
npm run dev
# → http://localhost:3000
```

## Stack

- **Backend:** Node.js + Express
- **Base de dados:** PostgreSQL
- **Frontend:** Vanilla JS SPA (sem framework)
- **Email:** Nodemailer (SMTP configurável)
- **Auth:** JWT (30 dias)

## Fluxo de aprovação por email

1. Colaborador submete pedido (férias/compra/alteração de horário)
2. Email enviado ao gestor com dois links tokenizados
3. Gestor clica `Aprovar` ou `Rejeitar` — sem necessidade de login
4. Sistema atualiza estado e notifica o colaborador
5. Tokens são UUID únicos de uso único

## Estrutura de ficheiros

```
cicf-ops/
├── server.js          # Express API + serve static
├── package.json
├── public/
│   ├── index.html     # SPA shell
│   ├── style.css      # Dark industrial theme
│   └── app.js         # Frontend logic
└── README.md
```
