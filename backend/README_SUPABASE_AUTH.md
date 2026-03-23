# GeoPunch Backend - Supabase Auth Edition

Backend GeoPunch refatorado para usar **Supabase Auth** em vez de autenticação manual.

## 🎯 Arquitetura

```
┌─────────────────┐
│   Mobile App    │
│   (Flutter)     │
└────────┬────────┘
         │
         │ Supabase Client SDK
         │ (signUp, signIn, getSession)
         ▼
┌──────────────────────┐
│   Supabase Auth      │
│   (auth.users)       │
│   - Manages passwords│
│   - Issues JWT tokens│
└──────────┬───────────┘
           │
           │ Auto-creates profile via DB trigger
           │
           ├────────────────┐
           │                │
           ▼                ▼
    ┌──────────┐      ┌─────────────┐
    │ profiles │      │  workplaces │
    │          │←─────│   punches   │
    │  (app    │      │   geofence  │
    │   data)  │      │   events    │
    └──────────┘      └─────────────┘
           │
           │ JWT token in Authorization header
           ▼
┌───────────────────────┐
│  FastAPI Backend      │
│  (Python)             │
│  - Validates JWT      │
│  - Business logic     │
│  - CRUD operations    │
└───────────────────────┘
```

## 📁 Estrutura de Ficheiros

```
backend/
├── server.py                          # FastAPI app (SEM endpoints de auth manual)
├── database.py                        # Supabase client wrapper (profiles, workplaces, punches)
├── auth_helper.py                     # JWT validation do Supabase
├── supabase_schema_auth.sql          # Schema com profiles e auth.users
├── requirements.txt                   # Dependencies (SEM bcrypt/passlib)
├── .env                               # Environment variables
├── MIGRATION_GUIDE_SUPABASE_AUTH.md  # Guia detalhado de migração
└── README_SUPABASE_AUTH.md           # Este ficheiro
```

## 🚀 Quick Start

### 1. Setup Supabase

```bash
# 1. Criar projeto no Supabase Dashboard
# 2. Executar SQL no SQL Editor:
#    - Copiar conteúdo de supabase_schema_auth.sql
#    - Executar

# 3. Obter credenciais:
#    Settings > API:
#    - Project URL
#    - anon public key
#    - JWT Secret (diferente do anon key!)
```

### 2. Configurar .env

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co

# Service Role Key (SECRET - backend only!)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# JWT Secret (for token validation)  
SUPABASE_JWT_SECRET=your-jwt-secret-from-settings

# Porta do servidor (opcional)
PORT=8000
```

**⚠️ Atenção:**
- Mobile app usa `anon` key (pública)
- Backend usa `service_role` key (secreta, bypassa RLS)
- Nunca exponhas a `service_role` key ao cliente!

### 3. Instalar Dependencies

```bash
pip install -r requirements.txt
```

### 4. Executar Backend

```bash
uvicorn server:app --reload --port 8000
```

Backend disponível em: `http://localhost:8000`

API Docs: `http://localhost:8000/docs`

## 🔐 Autenticação

### ❌ Removido (autenticação manual):
- `POST /api/auth/register`
- `POST /api/auth/login`  
- `POST /api/auth/refresh`

### ✅ Novo Fluxo (Supabase Auth):

**No Mobile App (Flutter/React Native/etc):**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 1. REGISTRO
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password123',
  options: {
    data: {
      name: 'João Silva',
      employee_id: 'EMP001'  // Opcional
    }
  }
});

// 2. LOGIN
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
});

// 3. OBTER TOKEN PARA BACKEND
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;

// 4. CHAMAR BACKEND API
fetch('http://localhost:8000/api/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(res => res.json())
.then(profile => console.log(profile));
```

**Perfil é criado automaticamente** quando o user se regista via Supabase Auth (trigger no SQL).

## 📡 API Endpoints

### Auth

| Endpoint | Método | Autenticação | Descrição |
|----------|--------|--------------|-----------|
| `/api/auth/me` | GET | ✅ Required | Retorna perfil do user autenticado |

### Workplaces

| Endpoint | Método | Autenticação | Descrição |
|----------|--------|--------------|-----------|
| `/api/workplaces` | GET | ✅ Required | Lista workplaces do user |
| `/api/workplaces` | POST | ✅ Required | Criar novo workplace |
| `/api/workplaces/{id}` | PUT | ✅ Required | Atualizar workplace |
| `/api/workplaces/{id}/activate` | POST | ✅ Required | Definir workplace ativo |
| `/api/workplaces/active` | GET | ✅ Required | Obter workplace ativo |

### Punches

| Endpoint | Método | Autenticação | Descrição |
|----------|--------|--------------|-----------|
| `/api/punch` | POST | ✅ Required | Registar punch (IN/OUT/BREAK) |
| `/api/timesheet` | GET | ✅ Required | Ver timesheet com cálculos |

### Geofence Events

| Endpoint | Método | Autenticação | Descrição |
|----------|--------|--------------|-----------|
| `/api/events/geofence` | POST | ✅ Required | Processar evento de geofence |

### Utility

| Endpoint | Método | Autenticação | Descrição |
|----------|--------|--------------|-----------|
| `/api/health` | GET | ❌ Public | Health check |
| `/api/seed` | POST | ❌ Public | Deprecated (retorna info sobre Supabase Auth) |

## 🔑 Autenticação nos Endpoints

Todos os endpoints protegidos requerem header:

```
Authorization: Bearer <supabase-jwt-token>
```

O backend:
1. Extrai o token do header
2. Valida via JWKS (chave pública ECC P-256 do Supabase) com fallback para legacy HS256
3. Extrai `user_id` do claim `sub`
4. Carrega perfil da tabela `profiles`
5. Atualiza `last_login`
6. Disponibiliza `user` no endpoint via dependency injection

## 💾 Estrutura de Dados

### Tabela `profiles`

```python
{
  "id": "uuid",                    # Mesmo ID do auth.users
  "email": "user@example.com",
  "name": "João Silva",
  "employee_id": "EMP001",         # Opcional
  "role": "employee",
  "active_workplace_id": "uuid",   # FK para workplaces
  "created_at": "2024-01-01T10:00:00Z",
  "updated_at": "2024-01-01T10:00:00Z",
  "last_login": "2024-01-01T10:00:00Z"
}
```

### Relações

```
auth.users (Supabase Auth)
    ↓ 1:1
profiles (app data)
    ↓ 1:N
workplaces, punches, geofence_events
```

## 🛡️ Segurança (RLS)

Row Level Security está ativo:

```sql
-- Exemplo: workplaces
CREATE POLICY "Users can view their own workplaces" 
ON workplaces FOR SELECT 
USING (auth.uid() = user_id);
```

Isto garante que:
- Users só veem os seus próprios dados
- Mesmo com token válido, não podem aceder dados de outros users
- Proteção a nível de base de dados (não apenas no backend)

## 📊 Exemplo de Fluxo Completo

### 1. User regista-se no app mobile

```typescript
const { data, error } = await supabase.auth.signUp({
  email: 'maria@example.com',
  password: 'senha123',
  options: {
    data: { name: 'Maria Costa' }
  }
});

// Supabase:
// 1. Cria entrada em auth.users
// 2. Trigger cria perfil em profiles automaticamente
// 3. Envia email de confirmação (se ativo)
// 4. Retorna session com JWT token
```

### 2. User faz login

```typescript
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'maria@example.com',
  password: 'senha123'
});

const token = session.access_token;
// Guardar token para chamadas ao backend
```

### 3. User cria workplace

```typescript
const response = await fetch('http://localhost:8000/api/workplaces', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Escritório Lisboa',
    latitude: 38.7223,
    longitude: -9.1393,
    radiusMeters: 150,
    workdays: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false
    },
    schedule: {
      startTime: '09:00',
      endTime: '18:00',
      marginMinutes: 120
    }
  })
});

const workplace = await response.json();
// Backend valida token, cria workplace, define como ativo se for o primeiro
```

### 4. User regista entrada

```typescript
const response = await fetch('http://localhost:8000/api/punch', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    punchType: 'IN',
    latitude: 38.7223,
    longitude: -9.1393,
    accuracy: 10.5,
    method: 'manual'
  })
});

const punch = await response.json();
// Backend valida token, regista punch no workplace ativo
```

### 5. User vê timesheet

```typescript
const response = await fetch('http://localhost:8000/api/timesheet', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const timesheet = await response.json();
// Array de dias com cálculos de horas trabalhadas
```

## 🧪 Testes

### Testar registo via Supabase Dashboard

1. Ir para **Authentication > Users**
2. Click "Add user" > "Create new user"
3. Inserir email e password
4. User aparece em `auth.users`
5. Profile criado automaticamente em `profiles` (via trigger)

### Testar backend com token

```bash
# 1. Obter token do Supabase (via app ou dashboard)
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 2. Testar endpoint
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/auth/me

# Resposta:
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "User Name",
  "role": "employee",
  ...
}
```

## 🔄 Diferenças vs Versão Anterior

| Feature | Antes | Agora |
|---------|-------|-------|
| **Tabela de users** | `users` (com password_hash) | `profiles` (sem password) |
| **Auth provider** | Backend próprio | Supabase Auth |
| **Password hashing** | bcrypt no backend | Supabase (automático) |
| **JWT secret** | `JWT_SECRET` próprio | `SUPABASE_JWT_SECRET` |
| **Registro** | `POST /api/auth/register` | `supabase.auth.signUp()` |
| **Login** | `POST /api/auth/login` | `supabase.auth.signInWithPassword()` |
| **Reset password** | Manual | Built-in Supabase |
| **Email verification** | Manual | Built-in Supabase |
| **Rate limiting** | Implementado no backend | Supabase (automático) |

## 🐛 Troubleshooting

### Erro: "Token inválido ou expirado"

```bash
# Verifica se SUPABASE_JWT_SECRET está correto
# Vai ao Dashboard > Settings > API > JWT Secret
# ATENÇÃO: É diferente do anon key!
```

### Erro: "Perfil de utilizador não encontrado"

Verifica se trigger está ativo:

```sql
-- SQL Editor
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

Criar perfil manualmente:

```sql
INSERT INTO profiles (id, email, name, role)
SELECT id, email, raw_user_meta_data->>'name', 'employee'
FROM auth.users
WHERE email = 'user@example.com';
```

### Token expira muito rápido

Por default, tokens Supabase expiram em 1h. Para alterar:

**Dashboard > Authentication > Settings > JWT Expiry**

## 📚 Recursos

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [JWT Verification Server-Side](https://supabase.com/docs/guides/auth/server-side-auth)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [FastAPI Docs](https://fastapi.tiangolo.com/)

## 📝 Notas Importantes

1. **JWT Secret ≠ Anon Key ≠ Service Role Key**
   - `SUPABASE_KEY` (anon/public): Usado pelo Supabase Client no mobile/web app
   - `SUPABASE_SERVICE_ROLE_KEY` (secret): Usado pelo backend Python para queries diretas
   - `SUPABASE_JWT_SECRET`: Usado como fallback legacy (HS256). A validação primária usa JWKS via `SUPABASE_URL`
   - **Nunca exponhas service_role ou jwt_secret ao cliente!**

2. **Por que Service Role Key no Backend?**
   - Backend não propaga o JWT do utilizador para o Supabase client
   - Service role key bypassa RLS (Row Level Security)
   - Controlo de acesso é feito no backend via:
     - `get_current_user()` valida o token do utilizador
     - Queries filtram por `user_id` explicitamente
     - Exemplo: `db.find_workplaces_by_user(user["id"])`

3. **Profiles Auto-criados**
   - Sempre que um user se regista via Supabase Auth
   - Trigger `on_auth_user_created` cria entrada em `profiles`
   - Nome vem de `raw_user_meta_data->>'name'`

3. **RLS Ativo**
   - Proteção a nível de base de dados
   - Mesmo com SQL direto, users só veem os seus dados
   - Policies baseadas em `auth.uid()`

4. **Migração de Dados**
   - Se tens users na tabela antiga `users`, precisam re-registar
   - OU criar script de migração (requer admin access)

## 🎉 Benefícios

✅ **Segurança melhorada** - Password hashing robusto do Supabase  
✅ **Menos código** - Não gerir autenticação manualmente  
✅ **Features built-in** - Email verification, password reset, etc.  
✅ **Escalável** - Supabase gere rate limiting e sessions  
✅ **Standard** - OAuth 2.0, JWT standard  
✅ **Social login** - Fácil adicionar Google, Apple, etc.  

---

**Versão:** 3.0.0  
**Última atualização:** Março 2026  
**Licença:** MIT
