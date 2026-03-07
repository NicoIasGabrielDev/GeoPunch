# Guia de Migração para Supabase Auth

## Resumo da Refatoração

O backend GeoPunch foi refatorado para usar **Supabase Auth** em vez de autenticação manual com password hashing. Esta migração elimina a gestão manual de passwords e aproveita o sistema robusto de autenticação do Supabase.

---

## Alterações Implementadas

### 1. **Novo Schema SQL** - `supabase_schema_auth.sql`

**Mudanças principais:**
- ✅ Tabela `users` removida
- ✅ Nova tabela `profiles` criada (1:1 com `auth.users`)
- ✅ Todas as FKs agora referenciam `auth.users(id)` diretamente
- ✅ Trigger automático para criar perfil quando user se regista via Supabase Auth
- ✅ RLS (Row Level Security) configurado para usar `auth.uid()`

**Estrutura da tabela `profiles`:**
```sql
- id UUID (PK, FK para auth.users)
- email VARCHAR
- name VARCHAR
- employee_id VARCHAR
- role VARCHAR (default: 'employee')
- active_workplace_id UUID
- created_at, updated_at, last_login TIMESTAMP
```

**Campos removidos:**
- ❌ `password_hash` (agora gerido pelo Supabase Auth)

---

### 2. **Novo Ficheiro** - `auth_helper.py`

**Responsabilidades:**
- Validar JWT tokens do Supabase
- Extrair informação do utilizador do token
- Dependency injection para FastAPI (`get_current_user`)
- Criar perfil automaticamente se não existir após signup

**Funções principais:**
- `verify_supabase_token(token)` - Valida e descodifica JWT
- `get_current_user()` - Dependency do FastAPI que retorna o perfil do user autenticado
- `get_current_user_id()` - Versão mais leve que retorna só o ID

---

### 3. **database.py Refatorado**

**Mudanças:**
- ✅ `find_user_by_id()` → `find_profile_by_id()`
- ✅ `find_user_by_email()` → `find_profile_by_email()`
- ✅ `create_user()` → `create_profile()`
- ✅ `update_user()` → `update_profile()`
- ✅ Todas as queries agora usam tabela `profiles`

**Funções de workplaces, punches e geofence_events:**
- Mantidas sem alterações (apenas continuam a usar `user_id`)

---

### 4. **server.py Refatorado**

#### **Imports Removidos:**
```python
❌ from passlib.context import CryptContext
❌ from jose import JWTError, jwt (parcialmente)
❌ from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials (movido para auth_helper)
```

#### **Imports Adicionados:**
```python
✅ from auth_helper import get_current_user
```

#### **Código Removido:**
- ❌ Password hashing functions (`hash_password`, `verify_password`)
- ❌ JWT creation functions (`create_access_token`, `create_refresh_token`)
- ❌ Rate limiting para login (`check_rate_limit`, `record_login_attempt`)
- ❌ Função antiga `get_current_user` (substituída pela do `auth_helper`)

#### **Endpoints Removidos:**
- ❌ `POST /api/auth/register` (agora usa Supabase Auth)
- ❌ `POST /api/auth/login` (agora usa Supabase Auth)
- ❌ `POST /api/auth/refresh` (agora usa Supabase Auth)

#### **Endpoints Mantidos:**
- ✅ `GET /api/auth/me` - Retorna perfil do utilizador autenticado
- ✅ Todos os endpoints de workplaces, punches, geofence events (inalterados)

#### **Endpoint Deprecado:**
- 🔶 `POST /api/seed` - Agora apenas retorna mensagem informativa sobre usar Supabase Auth

#### **Modelos Removidos:**
- ❌ `UserCreate`
- ❌ `UserLogin`
- ❌ `TokenResponse`
- ❌ `RefreshTokenRequest`

#### **Modelo Mantido:**
- ✅ `UserResponse` - Usado para retornar dados do perfil

---

### 5. **requirements.txt Atualizado**

**Dependências Removidas:**
```
❌ bcrypt==4.1.3
❌ passlib==1.7.4
```

**Dependências Mantidas:**
```
✅ python-jose==3.5.0  (necessário para validar JWT do Supabase)
✅ supabase==2.3.0
✅ postgrest==0.13.0
✅ fastapi==0.110.1
✅ pydantic==2.12.5
... (outras dependências inalteradas)
```

---

## Passos para Implementar

### 1️⃣ **Atualizar Base de Dados Supabase**

```sql
-- Executar no SQL Editor do Supabase
-- Ficheiro: supabase_schema_auth.sql
```

Este script:
- Cria tabela `profiles`
- Configura RLS (Row Level Security)
- Cria trigger para auto-criar perfis em novos registos
- Configura FKs para `auth.users`

⚠️ **IMPORTANTE:** Se já tens dados na tabela `users` antiga:
- Os utilizadores precisam re-registar via Supabase Auth
- OU escrever script de migração para criar entradas em `auth.users`

### 2️⃣ **Configurar Variáveis de Ambiente**

Adiciona ao ficheiro `.env`:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co

# Service Role Key (SECRET - backend only!)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT Secret (for token validation)
SUPABASE_JWT_SECRET=your-jwt-secret
```

**Como obter as chaves:**
1. Vai ao Dashboard do Supabase
2. Settings > API
3. Copia:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** (secret) → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ NÃO o anon key!
   - **JWT Secret** → `SUPABASE_JWT_SECRET`

**⚠️ IMPORTANTE:**
- Mobile/Web apps usam `anon` key (pública)
- Backend usa `service_role` key (secreta, bypassa RLS)
- Backend controla acesso via `get_current_user` + filtros `user_id`

### 3️⃣ **Instalar Dependências Atualizadas**

```bash
pip install -r requirements.txt
```

### 4️⃣ **Configurar Supabase Auth no Dashboard**

1. **Enable Email Provider:**
   - Authentication > Providers > Email
   - Enable "Email"

2. **Configure Email Templates:**
   - Authentication > Email Templates
   - Customize "Confirm signup", "Reset password", etc.

3. **Set Site URL:**
   - Authentication > URL Configuration
   - Set "Site URL" (e.g., `https://your-app.com`)
   - Add "Redirect URLs"

### 5️⃣ **Testar o Backend**

```bash
uvicorn server:app --reload
```

**Endpoints disponíveis:**
- ✅ `GET /api/auth/me` - Retorna perfil do user autenticado
- ✅ `GET /api/workplaces` - Lista workplaces
- ✅ `POST /api/workplaces` - Criar workplace
- ✅ `POST /api/punch` - Registar entrada/saída
- ✅ `GET /api/timesheet` - Ver timesheet

---

## Como Autenticar Agora

### ❌ Antes (Manual Auth):
```typescript
// Mobile App
const response = await fetch('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email, password, name })
});
const { access_token } = await response.json();
```

### ✅ Agora (Supabase Auth):
```typescript
// Mobile App - usando Supabase Client
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Registro
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password123',
  options: {
    data: {
      name: 'Nome do Utilizador'  // Vai para raw_user_meta_data
    }
  }
});

// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
});

// Obter token para chamar o backend
const session = await supabase.auth.getSession();
const token = session.data.session?.access_token;

// Chamar API do backend
const response = await fetch('/api/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

## Fluxo de Autenticação

```
┌─────────────┐
│  Mobile App │
└──────┬──────┘
       │
       │ 1. signUp/signIn
       ▼
┌──────────────────┐
│  Supabase Auth   │
│   (auth.users)   │
└────────┬─────────┘
         │
         │ 2. Trigger auto-creates profile
         ▼
    ┌─────────┐
    │ profiles│
    └─────────┘
         │
         │ 3. Returns JWT token
         ▼
┌─────────────────┐
│   Mobile App    │
│ (stores token)  │
└────────┬────────┘
         │
         │ 4. API calls with Bearer token
         ▼
┌─────────────────────┐
│  Backend (FastAPI)  │
│  - Validates JWT    │
│  - Gets profile     │
│  - Returns data     │
└─────────────────────┘
```

---

## Validação JWT no Backend

O helper `auth_helper.py` valida tokens assim:

```python
# auth_helper.py
def verify_supabase_token(token: str) -> Dict:
    payload = jwt.decode(
        token, 
        SUPABASE_JWT_SECRET,  # Secret do Supabase (não o anon key!)
        algorithms=["HS256"]
    )
    return payload  # Contém: sub (user_id), email, etc.
```

---

## Diferenças Principais

| Aspeto | Antes (Manual Auth) | Agora (Supabase Auth) |
|--------|---------------------|----------------------|
| **Registo** | `POST /api/auth/register` | `supabase.auth.signUp()` |
| **Login** | `POST /api/auth/login` | `supabase.auth.signInWithPassword()` |
| **Token** | JWT próprio gerado pelo backend | JWT do Supabase |
| **Password** | Stored in `users.password_hash` | Gerido pelo Supabase Auth |
| **Validação** | Backend valida com SECRET_KEY próprio | Backend valida com SUPABASE_JWT_SECRET |
| **User Data** | Tabela `users` | Tabela `profiles` + `auth.users` |
| **Reset Password** | Implementação manual | Built-in no Supabase |
| **Email Verification** | Implementação manual | Built-in no Supabase |

---

## Segurança

### ✅ Melhorias de Segurança:
1. **Password hashing** gerido pelo Supabase (bcrypt automático)
2. **JWT secrets** separados e geridos pelo Supabase
3. **Row Level Security (RLS)** configurado
4. **Email verification** built-in
5. **Rate limiting** gerido pelo Supabase
6. **Session management** robusto

### ⚠️ **IMPORTANTE - JWT Secret:**
- O `SUPABASE_JWT_SECRET` é **diferente** do `SUPABASE_KEY` (anon key)
- Nunca commits o JWT secret no código
- Guarda-o apenas no `.env` e nas variáveis de ambiente de produção

---

## Resolução de Problemas

### ❌ Erro: "Token inválido ou expirado"
- Verifica se `SUPABASE_JWT_SECRET` está correto
- Confirma que o token está no formato `Bearer <token>`
- Check se o token não expirou (Supabase tokens expiram em 1h por default)

### ❌ Erro: "Perfil de utilizador não encontrado"
- Verifica se o trigger `on_auth_user_created` está ativo
- Ou cria perfil manualmente via SQL:
```sql
INSERT INTO profiles (id, email, name, role) 
SELECT id, email, raw_user_meta_data->>'name', 'employee' 
FROM auth.users WHERE id = 'user-uuid';
```

### ❌ Erro: "Invalid API key"
- Usa `SUPABASE_KEY` (anon/public key) nas chamadas do Supabase Client
- Usa `SUPABASE_JWT_SECRET` para validar tokens no backend

---

## Checklist Final

- [ ] Schema SQL executado no Supabase
- [ ] Variáveis de ambiente configuradas (`.env`)
- [ ] Dependencies instaladas (`pip install -r requirements.txt`)
- [ ] Supabase Auth providers ativados (Email)
- [ ] Site URL e Redirect URLs configurados
- [ ] Trigger `on_auth_user_created` ativo
- [ ] RLS policies verificadas
- [ ] App mobile atualizado para usar Supabase Client
- [ ] Testado signup/login no mobile
- [ ] Testado chamadas à API com Bearer token

---

## Próximos Passos Sugeridos

1. **Atualizar Mobile App:**
   - Instalar `@supabase/supabase-js`
   - Substituir chamadas `/api/auth/register` e `/api/auth/login`
   - Implementar gestão de sessão

2. **Features Adicionais** (opcional):
   - Social login (Google, Apple)
   - Magic link login (passwordless)
   - Multi-factor authentication (MFA)
   - Password policies customizadas

3. **Migração de Dados** (se necessário):
   - Script para migrar users antigos para Supabase Auth
   - Requer admin privileges no Supabase

---

## Suporte

Para mais informações:
- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Supabase JWT Verification](https://supabase.com/docs/guides/auth/server-side-auth)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)

---

**Autor:** GeoPunch Backend Refactoring  
**Data:** Março 2026  
**Versão:** 3.0.0
