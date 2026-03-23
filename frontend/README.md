# GeoPunch 📍⏱️

> Sistema de ponto eletrônico com geolocalização - Frontend Mobile

[![Expo](https://img.shields.io/badge/Expo-~52.0.30-000020?style=flat&logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.76.5-61DAFB?style=flat&logo=react)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Auth-3ECF8E?style=flat&logo=supabase)](https://supabase.com)

## 📋 Sobre

GeoPunch é um sistema moderno de controle de ponto que utiliza geolocalização para validar registros de entrada/saída. Desenvolvido com React Native e Expo, oferece uma experiência nativa em iOS, Android e Web.

### ✨ Funcionalidades

- 🔐 **Autenticação**: Login/Registro via Supabase Auth
- 📍 **Geolocalização**: Validação de ponto por GPS
- ⏱️ **Timesheet**: Relatórios de horas trabalhadas
- 🏢 **Workplaces**: Gerenciamento de locais de trabalho
- 📊 **Admin**: Dashboard administrativo
- 📤 **Exportação**: Relatórios em CSV/XLSX

---

## 🚀 Quick Start

### 1️⃣ Pré-requisitos

- Node.js 18+ 
- npm ou yarn
- Expo CLI (instalado automaticamente)
- Conta no [Supabase](https://supabase.com) (gratuita)

### 2️⃣ Instalação

```bash
# Clone o repositório
git clone <seu-repo>
cd frontend

# Instale as dependências
npm install
```

### 3️⃣ Configuração

1. **Copie o arquivo de exemplo:**
```bash
cp .env.example .env
```

2. **Configure as variáveis de ambiente:**

Edite o arquivo `.env`:

```env
# Obtenha em: https://app.supabase.com → Settings → API
EXPO_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anonima

# Obtenha em: https://console.cloud.google.com
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=sua_chave_google_maps

# (Opcional) Se usar backend próprio
EXPO_PUBLIC_BACKEND_URL=https://seu-backend.onrender.com
```

3. **Configure o Supabase:**

⚠️ **IMPORTANTE**: Execute o setup do banco de dados antes de usar o app!

```bash
# Veja as instruções completas em SETUP.md
# Resumo: Copie o SQL de supabase-setup.sql e execute no Supabase Dashboard
```

### 4️⃣ Executar o App

```bash
# Desenvolvimento com cache limpo
npx expo start --clear

# Ou simplesmente
npm start
```

Isso abrirá o Expo DevTools. Você pode:
- Pressionar `a` para abrir no Android
- Pressionar `i` para abrir no iOS (apenas macOS)
- Pressionar `w` para abrir no navegador
- Escanear o QR code com Expo Go

---

## 📁 Estrutura do Projeto

```
frontend/
├── app/                          # Rotas (Expo Router)
│   ├── (auth)/                  # Telas de autenticação
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (tabs)/                  # Telas principais
│   │   ├── index.tsx            # Dashboard
│   │   ├── workplaces.tsx       # Locais
│   │   ├── history.tsx          # Histórico
│   │   ├── profile.tsx          # Perfil
│   │   └── admin.tsx            # Admin
│   └── _layout.tsx              # Layout root
├── src/
│   ├── components/              # Componentes reutilizáveis
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── MapPicker.tsx
│   ├── contexts/                # React Contexts
│   │   └── AuthContext.tsx      # Autenticação global
│   ├── services/                # Serviços API
│   │   ├── supabase.ts          # Cliente Supabase (não edite)
│   │   ├── supabaseProfile.ts   # Gerenciamento de perfis
│   │   ├── backend.ts           # API do backend (opcional)
│   │   └── api.ts               # Cliente Axios (legacy)
│   ├── types/                   # TypeScript types
│   │   └── index.ts
│   └── utils/                   # Funções utilitárias
├── assets/                      # Imagens, fontes
├── supabase-setup.sql          # Script SQL do Supabase
├── .env                         # Variáveis de ambiente (não commitar!)
├── .env.example                 # Template de variáveis
├── app.json                     # Configuração Expo
├── package.json
└── tsconfig.json

```

---

## 🔐 Autenticação - Arquitetura

### Fluxo de Autenticação

```
┌─────────────────┐
│   Mobile App    │
└────────┬────────┘
         │
         ├──► Supabase Auth (Gerenciamento de usuários)
         │    • signup/signin (email/senha)
         │    • JWT tokens
         │    • Session management
         │    • Email confirmation
         │
         └──► Supabase Database (Perfis de usuários)
              • public.profiles (dados do usuário)
              • Trigger automático (cria perfil ao registrar)
              • Row Level Security (RLS)
```

### Como Funciona

1. **Registro**:
   - App → `supabase.auth.signUp()`
   - Supabase cria usuário em `auth.users`
   - **Trigger SQL** cria perfil automático em `public.profiles`
   - App busca perfil e autentica usuário

2. **Login**:
   - App → `supabase.auth.signInWithPassword()`
   - Supabase valida credenciais e gera JWT
   - App busca perfil de `public.profiles`
   - JWT é usado para chamadas autenticadas

3. **Integração com Backend** (se usar):
   - JWT do Supabase é enviado: `Authorization: Bearer <token>`
   - Backend valida JWT com chave pública do Supabase
   - Backend retorna dados específicos da aplicação

---

## 🛠️ Desenvolvimento

### Comandos Úteis

```bash
# Iniciar desenvolvimento
npm start

# Limpar cache e reiniciar
npx expo start --clear

# Build para produção
eas build --platform android
eas build --platform ios

# Executar testes (se configurado)
npm test

# Lint
npm run lint
```

### Debug

Para debugar problemas:

1. **Verifique os logs do console** no terminal
2. **Ative Remote Debugging** (CMD+D no iOS, CMD+M no Android)
3. **Verifique variáveis de ambiente**: 
   ```bash
   npx expo config --type public
   ```

### Problemas Comuns

#### Erro de autenticação

**Problema**: Login funciona mas perfil não carrega  
**Solução**: Execute o SQL setup no Supabase (veja `SETUP.md`)

#### Maps não carrega

**Problema**: Mapa não aparece  
**Solução**: Verifique se `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` está configurada

#### Backend retorna 401

**Problema**: Backend não aceita token  
**Solução**: Configure backend para validar JWT do Supabase

---

## 📦 Deploy em Produção

### Opção 1: Expo Go (Desenvolvimento)

Apenas compartilhe o QR code gerado por `npx expo start`

### Opção 2: Build Standalone (Produção)

1. **Configure EAS**:
```bash
npm install -g eas-cli
eas login
eas build:configure
```

2. **Configure variáveis de ambiente no EAS**:
```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "..."
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "..."
eas secret:create --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY --value "..."
```

3. **Build**:
```bash
# Android (APK para teste)
eas build --platform android --profile preview

# Android (AAB para Google Play)
eas build --platform android --profile production

# iOS (para TestFlight/App Store)
eas build --platform ios --profile production
```

4. **Publish OTA Updates**:
```bash
eas update --branch production
```

### Opção 3: Web (Netlify/Vercel)

```bash
# Build para web
npx expo export --platform web

# Deploy na Netlify
npm install -g netlify-cli
netlify deploy --dir web-build --prod
```

---

## 🔧 Configuração Avançada

### Supabase

Documentação completa em [`SETUP.md`](./SETUP.md)

### Backend Integration

Se você tem um backend próprio (Python/FastAPI, Node.js, etc.):

1. Configure `EXPO_PUBLIC_BACKEND_URL` no `.env`
2. Backend deve validar JWT do Supabase:
   - Endpoint: `https://<projeto>.supabase.co/auth/v1/jwks`
   - Algoritmo: RS256
   - Issuer: `https://<projeto>.supabase.co/auth/v1`

Exemplo em Python (FastAPI):
```python
from fastapi import Security, HTTPException
from fastapi.security import HTTPBearer
import jwt

security = HTTPBearer()

async def get_current_user(token: str = Security(security)):
    try:
        # Validar JWT do Supabase
        payload = jwt.decode(
            token.credentials,
            # Use a chave pública do Supabase
            audience="authenticated",
            algorithms=["RS256"]
        )
        return payload
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
```

---

## 📝 Scripts Disponíveis

| Script | Comando | Descrição |
|--------|---------|-----------|
| Start | `npm start` | Inicia o servidor de desenvolvimento |
| Android | `npm run android` | Abre no emulador Android |
| iOS | `npm run ios` | Abre no simulador iOS |
| Web | `npm run web` | Abre no navegador |
| Lint | `npm run lint` | Executa ESLint |
| Reset | `npm run reset-project` | Reseta projeto para template |

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch: `git checkout -b feature/nova-feature`
3. Commit: `git commit -m 'Adiciona nova feature'`
4. Push: `git push origin feature/nova-feature`
5. Abra um Pull Request

---

## 📄 Licença

Este projeto está sob a licença MIT.

---

## 📞 Suporte

- **Documentação Completa**: [`SETUP.md`](./SETUP.md)
- **Supabase Docs**: https://supabase.com/docs
- **Expo Docs**: https://docs.expo.dev
- **React Native**: https://reactnative.dev/docs

---

## ✅ Checklist para Produção

Antes de fazer deploy:

- [ ] SQL executado no Supabase (`supabase-setup.sql`)
- [ ] Variáveis de ambiente configuradas no EAS
- [ ] Email confirmation habilitada no Supabase (produção)
- [ ] Google Maps API key configurada
- [ ] Row Level Security (RLS) habilitado no Supabase
- [ ] Backend configurado para validar JWT (se aplicável)
- [ ] Build testado em dispositivos reais
- [ ] Performance otimizada (sem logs desnecessários)

---

**Desenvolvido com ❤️ usando React Native + Expo + Supabase**
