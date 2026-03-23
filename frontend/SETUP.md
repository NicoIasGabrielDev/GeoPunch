# GeoPunch - Configuração do Supabase para Sincronização de Usuários

## 🎯 Problema Resolvido

Este documento descreve a solução implementada para resolver o problema de sincronização de usuários entre o Supabase Auth e a aplicação.

### Problema Original
- ❌ Registro criava usuário apenas no `auth.users` do Supabase
- ❌ Aplicação não conseguia buscar informações do usuário após login
- ❌ Faltava sincronização entre autenticação e dados de perfil
- ❌ Dependência do backend para informações básicas do usuário

### Solução Implementada ✅
- ✅ Tabela `public.profiles` no Supabase para dados do usuário
- ✅ Trigger automático que cria perfil quando usuário se registra
- ✅ Serviço TypeScript para gerenciar perfis
- ✅ AuthContext atualizado para buscar dados diretamente do Supabase
- ✅ Row Level Security (RLS) para proteger dados
- ✅ Sincronização automática e confiável

---

## 📋 Instruções de Configuração

### Passo 1: Configurar o Banco de Dados Supabase

1. Acesse o [Supabase Dashboard](https://app.supabase.com)
2. Selecione seu projeto GeoPunch
3. No menu lateral, clique em **SQL Editor**
4. Clique em **New Query**
5. Copie todo o conteúdo do arquivo `supabase-setup.sql`
6. Cole no editor e clique em **Run**

Isso irá criar:
- ✅ Tabela `public.profiles`
- ✅ Trigger para criar perfil automaticamente
- ✅ Políticas de segurança (RLS)
- ✅ Funções auxiliares
- ✅ Migração de usuários existentes

### Passo 2: Criar um Usuário Admin (Opcional)

Se você já tem uma conta e quer torná-la admin:

```sql
UPDATE public.profiles 
SET role = 'admin' 
WHERE email = 'seu-email@exemplo.com';
```

Execute isso no SQL Editor do Supabase.

### Passo 3: Testar a Aplicação

1. Limpe o cache da aplicação:
```bash
npx expo start --clear
```

2. Teste o registro de um novo usuário
3. Teste o login com o usuário criado
4. Verifique no Supabase Dashboard -> Table Editor -> profiles se o perfil foi criado

---

## 🏗️ Arquitetura da Solução

### Estrutura de Arquivos Criados/Modificados

```
frontend/
├── src/
│   ├── services/
│   │   └── supabaseProfile.ts          ✨ NOVO - Serviço de perfis
│   ├── contexts/
│   │   └── AuthContext.tsx              🔧 MODIFICADO - Usa Supabase direto
│   └── config/
│       └── supabase.ts                  ✓ Já existia
├── supabase-setup.sql                   ✨ NOVO - Script de setup
└── SUPABASE_SETUP.md                    ✨ NOVO - Esta documentação
```

### Fluxo de Autenticação Atualizado

#### Registro de Usuário
```
1. Usuário preenche formulário
2. App chama supabase.auth.signUp()
3. Supabase cria usuário em auth.users
4. 🔥 TRIGGER automático cria perfil em public.profiles
5. App busca perfil completo
6. Usuário está autenticado ✅
```

#### Login de Usuário
```
1. Usuário fornece email/senha
2. App chama supabase.auth.signInWithPassword()
3. Supabase valida credenciais
4. App busca perfil de public.profiles
5. Usuário está autenticado ✅
```

### Estrutura da Tabela `profiles`

```typescript
{
  id: UUID                    // Referência a auth.users(id)
  email: string              // Email do usuário
  name: string               // Nome completo
  employee_id?: string       // ID do funcionário (opcional)
  role: string               // 'employee' ou 'admin'
  active_workplace_id?: UUID // Local de trabalho ativo (opcional)
  created_at: timestamp      // Data de criação
  updated_at: timestamp      // Última atualização (auto)
}
```

---

## 🔐 Segurança - Row Level Security (RLS)

As seguintes políticas foram configuradas:

### Usuários Normais
- ✅ Podem **ver** apenas seu próprio perfil
- ✅ Podem **editar** apenas seu próprio perfil
- ✅ Podem **criar** apenas seu próprio perfil

### Usuários Admin
- ✅ Podem **ver** todos os perfis
- ✅ Podem **editar** todos os perfis

---

## 🔧 API de Serviços

### `supabaseProfileService`

Novo serviço criado em `src/services/supabaseProfile.ts`:

```typescript
// Buscar perfil do usuário atual
const profile = await supabaseProfileService.getProfile();

// Criar novo perfil
const profile = await supabaseProfileService.createProfile({
  id: userId,
  email: 'user@example.com',
  name: 'Nome do Usuário',
  employee_id: '12345',
});

// Atualizar perfil
const updated = await supabaseProfileService.updateProfile({
  name: 'Novo Nome',
  employee_id: '67890',
});

// Definir local de trabalho ativo
await supabaseProfileService.setActiveWorkplace(workplaceId);
```

---

## 🧪 Como Testar

### Teste 1: Registro de Novo Usuário ✅

1. Abra a aplicação
2. Vá para a tela de registro
3. Preencha os dados:
   - Email: test@example.com
   - Senha: Test123!@#
   - Nome: Usuário Teste
   - ID Funcionário: 001
4. Clique em "Registrar"
5. **Resultado Esperado**: 
   - ✅ Usuário criado no Supabase
   - ✅ Perfil criado automaticamente
   - ✅ Login automático realizado
   - ✅ Redirecionado para tela principal

### Teste 2: Login com Usuário Existente ✅

1. Faça logout (se estiver logado)
2. Vá para tela de login
3. Entre com email e senha
4. **Resultado Esperado**:
   - ✅ Login bem-sucedido
   - ✅ Perfil carregado
   - ✅ Dados do usuário visíveis

### Teste 3: Verificar no Supabase Dashboard ✅

1. Acesse Supabase Dashboard
2. Vá em **Table Editor** → **profiles**
3. **Resultado Esperado**:
   - ✅ Usuário aparece na tabela
   - ✅ Todos os campos preenchidos corretamente

---

## 🐛 Troubleshooting

### Erro: "Profile not found"

**Causa**: Trigger não executou corretamente  
**Solução**: 
```sql
-- Execute no SQL Editor do Supabase
SELECT public.handle_new_user() FROM auth.users WHERE id = 'USER_ID_AQUI';
```

### Erro: "RLS policy violation"

**Causa**: Políticas de segurança mal configuradas  
**Solução**: Re-execute o script `supabase-setup.sql`

### Erro: "duplicate key value violates unique constraint"

**Causa**: Perfil já existe  
**Solução**: Isso é normal, a aplicação vai buscar o perfil existente automaticamente

### Login não funciona após registro

**Solução**:
1. Verifique se email de confirmação está habilitado no Supabase
2. Para desenvolvimento: Desabilite confirmação de email em:
   - Supabase Dashboard → Authentication → Settings
   - "Enable email confirmations" → OFF

---

## 📝 Notas Importantes

### Modo de Desenvolvimento

Para facilitar o desenvolvimento, você pode desabilitar a confirmação de email:
1. Supabase Dashboard → Authentication → Settings
2. Desmarque "Enable email confirmations"

### Modo de Produção

Em produção, mantenha a confirmação de email ativada por segurança.

### Compatibilidade com Backend

A solução atual usa **apenas Supabase** para autenticação e perfis de usuário. Se você ainda precisa integrar com o backend Python/FastAPI, isso pode ser feito posteriormente adicionando sincronização entre Supabase e o backend via webhooks ou triggers.

---

## ✅ Checklist de Implementação

- [x] Criar tabela `public.profiles`
- [x] Criar triggers automáticos
- [x] Configurar RLS policies
- [x] Criar serviço `supabaseProfileService`
- [x] Atualizar `AuthContext` para usar Supabase
- [x] Documentar solução
- [ ] Testar registro de usuário
- [ ] Testar login de usuário
- [ ] Verificar sincronização automática
- [ ] (Opcional) Criar primeiro usuário admin

---

## 🎓 Para Desenvolvedores

### Por que esta solução é melhor?

1. **Sincronização Automática**: Triggers garantem que perfil é criado sempre
2. **Menos Complexidade**: Elimina dependência de backend para auth
3. **Mais Rápido**: Dados vêm diretamente do Supabase
4. **Mais Seguro**: RLS protege dados a nível de banco
5. **Escalável**: Supabase gerencia toda a infraestrutura
6. **Padrão do Mercado**: Arquitetura moderna e recomendada

### Próximos Passos Sugeridos

1. ✅ Implementar refresh token automático
2. ✅ Adicionar campos customizados ao perfil
3. ✅ Criar dashboard admin para gerenciar usuários
4. ✅ Implementar roles e permissões granulares
5. ✅ Adicionar avatar/foto de perfil

---

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs do console do app
2. Verifique os logs do Supabase Dashboard → Logs
3. Confirme que todas as migrações SQL foram executadas
4. Verifique variáveis de ambiente (.env)

---

**Última atualização**: março de 2026  
**Versão**: 2.0.0 - Senior Developer Solution
