# GeoPunch

Aplicação de registo de ponto com geolocalização, composta por um frontend mobile/web em Expo React Native e um backend em FastAPI. O estado atual do projeto já usa Supabase Auth e Supabase Database como base da autenticação e dos dados da aplicação.

## Estado atual

- Frontend em `frontend/` com Expo Router, React Native e TypeScript
- Backend em `backend/` com FastAPI
- Autenticação feita no cliente com Supabase Auth
- Backend valida o token JWT do Supabase e aplica a lógica de negócio
- Dados persistidos no Supabase (`profiles`, `workplaces`, `punches`, `geofence_events`)
- Exportação disponível em CSV e XLSX
- Endpoints antigos de login/registo no backend continuam apenas como stubs legados e devolvem `410 Gone`

## Funcionalidades implementadas

- Registo e login com Supabase
- Criação e gestão de locais de trabalho
- Definição de local ativo
- Registo manual de ponto (`IN`, `OUT`, `BREAK_START`, `BREAK_END`)
- Sugestões/eventos de geofence
- Timesheet diário e histórico
- Exportação de folha de ponto em CSV e XLSX
- Área administrativa para listar utilizadores, listar locais, atribuir local e remover locais
- Reverse geocoding no backend

## Arquitetura

```text
frontend (Expo / React Native)
  -> Supabase Auth
  -> FastAPI backend (/api)
       -> valida JWT do Supabase
       -> aplica regras de negócio
       -> acede ao Supabase com service role key
```

## Estrutura do projeto

```text
.
├── backend/
│   ├── server.py
│   ├── database.py
│   ├── auth_helper.py
│   ├── requirements.txt
│   ├── supabase_schema.sql
│   ├── supabase_schema_auth.sql
│   ├── README_SUPABASE_AUTH.md
│   └── MIGRATION_GUIDE_SUPABASE_AUTH.md
├── frontend/
│   ├── app/
│   │   ├── (auth)/
│   │   └── (tabs)/
│   ├── src/
│   │   ├── components/
│   │   ├── config/
│   │   ├── contexts/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   ├── app.json
│   ├── package.json
│   ├── SETUP.md
│   └── supabase-setup.sql
├── backend_test.py
└── test_result.md
```

## Requisitos

- Node.js 18+
- Yarn ou npm
- Python 3.11+
- Conta/projeto Supabase

## Configuração do frontend

Criar `frontend/.env` com:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<google-maps-key>
```

Notas:

- `EXPO_PUBLIC_BACKEND_URL` é usado pelo cliente Axios do app
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` é lida pelo `app.json` para Android
- O frontend persiste sessão com `expo-secure-store` em mobile e `localStorage` na web

## Configuração do backend

Criar `backend/.env` com:

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret-se-necessario-para-projetos-hs256>
SUPABASE_JWT_ISSUER=https://<project>.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
AUTH_DEBUG_ERRORS=true
PORT=8000
```

Notas:

- O backend deve usar `SUPABASE_SERVICE_ROLE_KEY`, não a anon key
- A validação de token suporta JWKS para tokens assimétricos e fallback HS256

## Setup do Supabase

Há documentação específica já incluída no repositório:

- `frontend/SETUP.md`
- `backend/README_SUPABASE_AUTH.md`
- `backend/MIGRATION_GUIDE_SUPABASE_AUTH.md`

Como base, o projeto espera que o schema SQL do Supabase seja aplicado antes de usar a app. Os ficheiros principais para isso são:

- `frontend/supabase-setup.sql`
- `backend/supabase_schema.sql`
- `backend/supabase_schema_auth.sql`

## Executar localmente

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

API disponível em `http://localhost:8000` e documentação Swagger em `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
yarn install
yarn start
```

Scripts disponíveis no frontend:

- `yarn start`
- `yarn android`
- `yarn ios`
- `yarn web`
- `yarn lint`

## Ecrãs principais do frontend

- `app/(auth)/login.tsx`
- `app/(auth)/register.tsx`
- `app/(tabs)/index.tsx` para estado do dia e punch manual
- `app/(tabs)/workplaces.tsx` para gerir locais
- `app/(tabs)/history.tsx` para histórico
- `app/(tabs)/export.tsx` para exportação
- `app/(tabs)/admin.tsx` para administração
- `app/(tabs)/profile.tsx` para perfil

## Endpoints atuais do backend

### Auth

- `GET /api/auth/me`
- `POST /api/auth/register` legado, devolve `410`
- `POST /api/auth/login` legado, devolve `410`

### Workplaces

- `GET /api/workplaces`
- `POST /api/workplaces`
- `PUT /api/workplaces/{workplace_id}`
- `POST /api/workplaces/{workplace_id}/activate`
- `GET /api/workplaces/active`
- `GET /api/workplace`

### Punch / geofence / timesheet

- `POST /api/punch`
- `POST /api/punch/manual`
- `POST /api/break/manual`
- `POST /api/events/geofence`
- `GET /api/timesheet`
- `GET /api/timesheet/today`
- `GET /api/export/timesheet.csv`
- `GET /api/export/timesheet.xlsx`
- `GET /api/geocode/reverse`

### Admin

- `GET /api/admin/workplaces`
- `DELETE /api/admin/workplaces/{workplace_id}`
- `POST /api/admin/assign-workplace`
- `GET /api/admin/users`

### Utilidade

- `GET /api/`
- `GET /api/health`
- `POST /api/seed` legado/deprecated

## Notas importantes

- O `README` antigo descrevia MongoDB, JWT manual, refresh tokens próprios e exportação PDF; isso já não corresponde ao código atual
- O frontend e o backend ainda têm alguma documentação histórica nos subdiretórios, por isso vale a pena consultar os ficheiros específicos de cada camada quando estiveres a mexer em auth/migração
- O projeto já inclui configuração de permissões de localização em `frontend/app.json`, incluindo background location em iOS e Android

## Verificação rápida

Depois de configurar variáveis e schema:

1. Iniciar o backend
2. Iniciar o frontend
3. Registar um utilizador pelo app
4. Confirmar criação do perfil em `profiles` no Supabase
5. Criar um workplace
6. Fazer um punch manual
7. Confirmar que a exportação CSV/XLSX funciona
