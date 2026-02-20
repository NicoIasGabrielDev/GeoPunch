# GeoPunch - Sistema de Controlo de Ponto com Geofencing

## Visão Geral

GeoPunch é uma aplicação móvel para controlo de ponto de funcionários com geofencing automático. A aplicação permite:

- **Registo automático** de entrada/saída baseado em localização (geofencing)
- **Registo manual** com validação de localização
- **Pausas de almoço** manuais com validação de regras
- **Exportação** de dados em CSV, XLSX e PDF
- **Painel de administração** para gestão de locais e funcionários

## Tecnologias

- **Frontend**: React Native com Expo
- **Backend**: FastAPI (Python)
- **Base de Dados**: MongoDB
- **Autenticação**: JWT com refresh tokens

## Funcionalidades Implementadas

### ✅ Autenticação
- Registo de utilizadores
- Login com JWT (access token curto + refresh token)
- Rate limiting em tentativas de login (5 tentativas / 5 min)
- Bloqueio de conta após múltiplas falhas (15 min)

### ✅ Locais de Trabalho
- CRUD completo de locais de trabalho
- Coordenadas GPS + raio de geofence
- Horários configuráveis (início/fim + margem)
- Timezone por local

### ✅ Registo de Ponto
- Geofencing automático (ENTER = CLOCK_IN, EXIT = CLOCK_OUT)
- Registo manual com validação de localização
- Idempotência por eventId
- Validação de janelas de tempo
- Prevenção de duplicados (um registo por tipo por dia)

### ✅ Pausas de Almoço
- Início e fim de almoço manuais
- Validação: apenas após CLOCK_IN e antes de CLOCK_OUT
- Apenas uma pausa por dia
- Cálculo automático de tempo de pausa

### ✅ Folha de Ponto
- Status do dia atual
- Histórico dos últimos 30 dias
- Cálculo de horas brutas, pausa e líquidas
- Detecção de anomalias (fora do geofence, GPS impreciso)

### ✅ Exportação
- CSV com dados completos
- Excel XLSX formatado
- PDF (HTML printável)
- Filtros por data e utilizador (admin)

### ✅ Administração
- Gestão de locais de trabalho
- Atribuição de funcionários a locais
- Logs de auditoria
- Visualização de anomalias

### ✅ Segurança
- Passwords com bcrypt
- JWT com tokens curtos (30 min) + refresh
- Rate limiting
- Validação de inputs
- Audit logs para ações admin

## Estrutura do Projeto

```
/app
├── backend/
│   ├── server.py          # API FastAPI
│   ├── requirements.txt   # Dependências Python
│   └── .env              # Variáveis de ambiente
├── frontend/
│   ├── app/              # Expo Router screens
│   │   ├── (auth)/       # Login/Register
│   │   ├── (tabs)/       # Tab navigation
│   │   └── _layout.tsx   # Root layout
│   ├── src/
│   │   ├── components/   # Componentes reutilizáveis
│   │   ├── contexts/     # Auth context
│   │   ├── services/     # API client
│   │   ├── types/        # TypeScript types
│   │   └── utils/        # Utilitários
│   ├── app.json          # Configuração Expo
│   └── package.json      # Dependências Node
└── README.md
```

## Credenciais de Teste

- **Admin**: admin@geopunch.pt / admin123
- **Local de Trabalho**: Escritório Central (Lisboa: 38.7223, -9.1393)
- **Horário**: 09:00 - 18:00 (±120 min margem)
- **Raio**: 150 metros

## API Endpoints

### Autenticação
- `POST /api/auth/register` - Registo
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/me` - Utilizador atual

### Locais de Trabalho
- `GET /api/workplace` - Local do utilizador
- `GET /api/admin/workplaces` - Listar (admin)
- `POST /api/admin/workplaces` - Criar (admin)
- `PUT /api/admin/workplaces/:id` - Atualizar (admin)
- `DELETE /api/admin/workplaces/:id` - Eliminar (admin)

### Eventos
- `POST /api/events/geofence` - Evento de geofence
- `POST /api/punch/manual` - Registo manual
- `POST /api/break/manual` - Pausa manual

### Timesheet
- `GET /api/timesheet/today` - Status de hoje
- `GET /api/timesheet` - Histórico
- `GET /api/export/timesheet.csv` - Exportar CSV
- `GET /api/export/timesheet.xlsx` - Exportar Excel
- `GET /api/export/timesheet.pdf` - Exportar PDF

### Admin
- `GET /api/admin/users` - Listar utilizadores
- `POST /api/admin/assign-workplace` - Atribuir local
- `GET /api/admin/audit-logs` - Logs de auditoria
- `GET /api/admin/anomalies` - Anomalias

---

## Limitações iOS/Android - Background Location

### iOS

**Limitações:**
1. **Background Location** requer modo "Always" que Apple escrutina rigorosamente
2. App deve justificar necessidade de localização constante
3. iOS pode limitar atualizações em background para preservar bateria
4. Geofencing nativo limitado a ~20 regiões simultâneas
5. "Significant Location Changes" pode ter delays de minutos

**Mitigações:**
- Usar `expo-location` com `startGeofencingAsync` para geofencing nativo
- Implementar fallback com "Significant Location Changes"
- Adicionar botão manual proeminente na UI
- Mostrar estado do geofencing na app
- Instruir utilizadores a não usar modo "Low Power"

**Configuração app.json:**
```json
{
  "ios": {
    "infoPlist": {
      "NSLocationAlwaysAndWhenInUseUsageDescription": "...",
      "UIBackgroundModes": ["location", "fetch"]
    }
  }
}
```

### Android

**Limitações:**
1. **Doze Mode** (Android 6+) suspende jobs em background
2. **App Standby Buckets** (Android 9+) limitam apps "rarely used"
3. **Battery Optimization** pode matar apps em background
4. Fabricantes (Samsung, Xiaomi, Huawei) têm otimizações agressivas
5. Android 10+ requer permissão explícita para "Always allow"

**Mitigações:**
- Solicitar exclusão de Battery Optimization
- Usar Foreground Service para maior fiabilidade
- Implementar WorkManager para sync periódico
- Detectar fabricante e mostrar instruções específicas
- Manter registo manual como fallback principal

**Configuração app.json:**
```json
{
  "android": {
    "permissions": [
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION"
    ]
  }
}
```

### Recomendações Gerais

1. **Não depender exclusivamente de geofencing automático**
   - Sempre oferecer registo manual
   - Mostrar estado da última sincronização

2. **Feedback visual claro**
   - Indicar se geofencing está ativo
   - Mostrar distância ao local de trabalho
   - Alertar sobre baixa precisão GPS

3. **Offline-first**
   - Queue de eventos local
   - Sync quando há conectividade
   - Idempotência no servidor

4. **Testes extensivos**
   - Testar em dispositivos reais
   - Testar com app em background/fechada
   - Testar após reinício do dispositivo

---

## Checklist de Deployment

### 1. Variáveis de Ambiente

**Backend (.env):**
```env
MONGO_URL=mongodb://...
DB_NAME=geopunch_prod
JWT_SECRET=<secret-32-chars-random>
JWT_REFRESH_SECRET=<another-secret-32-chars>
```

**Frontend (.env):**
```env
EXPO_PUBLIC_BACKEND_URL=https://api.yourdomain.com
```

### 2. Configuração do Mapa (Google Maps / Apple Maps)

**IMPORTANTE:** O GeoPunch usa `react-native-maps` para o seletor de localização.

#### Android (Google Maps)
1. Obtenha uma API key do Google Cloud Console:
   - Ative as APIs: "Maps SDK for Android" e "Geocoding API" (opcional)
   - Restrinja a key ao package name da app

2. Configure em `app.json`:
```json
{
  "expo": {
    "android": {
      "config": {
        "googleMaps": {
          "apiKey": "YOUR_GOOGLE_MAPS_API_KEY"
        }
      }
    }
  }
}
```

Ou via variável de ambiente (recomendado para EAS Build):
```json
{
  "expo": {
    "android": {
      "config": {
        "googleMaps": {
          "apiKey": "${GOOGLE_MAPS_API_KEY}"
        }
      }
    }
  }
}
```

#### iOS (Apple Maps)
- Não requer configuração adicional - usa Apple Maps nativamente
- Para usar Google Maps no iOS (opcional), adicione a API key em `ios.config.googleMapsApiKey`

#### Fallback (Sem API Key)
Se nenhuma API key estiver configurada:
- O mapa funcionará na versão web com limitações
- Em dispositivos móveis, será mostrado um fallback com coordenadas manuais
- A funcionalidade principal (lat/lng) continua a funcionar

#### Limitações
| Plataforma | Provider | Requer Key | Notas |
|------------|----------|------------|-------|
| Android    | Google   | SIM        | Obrigatório para produção |
| iOS        | Apple    | NÃO        | Funciona nativamente |
| Web        | -        | -          | Fallback com coords |

### 3. Base de Dados

- [ ] MongoDB configurado e acessível
- [ ] Índices criados (automático no startup)
- [ ] Backup automático configurado
- [ ] Replica set para HA (produção)

### 3. Segurança

- [ ] HTTPS em todos os endpoints
- [ ] JWT secrets seguros e únicos
- [ ] Rate limiting configurado
- [ ] CORS configurado para domínios específicos
- [ ] Logs de auditoria ativos

### 4. Backend

- [ ] Servidor com Python 3.11+
- [ ] Dependências instaladas (requirements.txt)
- [ ] Gunicorn/Uvicorn para produção
- [ ] Health check endpoint funcionando
- [ ] Logs configurados

### 5. Frontend

- [ ] Build de produção (`expo build` ou EAS Build)
- [ ] Bundle ID/Package name configurados
- [ ] Ícones e splash screens
- [ ] Permissões de localização descritas
- [ ] Deep linking configurado

### 6. App Stores

**iOS (App Store):**
- [ ] Apple Developer Account
- [ ] Justificação para background location
- [ ] Privacy policy URL
- [ ] Screenshots e descrição em português

**Android (Google Play):**
- [ ] Google Play Console
- [ ] Declaração de uso de localização
- [ ] Privacy policy URL
- [ ] Screenshots e descrição

### 7. Monitorização

- [ ] Logs centralizados (ex: Datadog, Sentry)
- [ ] Alertas para erros críticos
- [ ] Métricas de performance
- [ ] Uptime monitoring

### 8. Backup & Recovery

- [ ] Backup diário da base de dados
- [ ] Procedimento de restore documentado
- [ ] Retenção de 30 dias mínimo

---

## Desenvolvimento Local

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001
```

### Frontend
```bash
cd frontend
yarn install
yarn start
```

### Seeds
```bash
curl -X POST http://localhost:8001/api/seed
```

---

## Próximos Passos (Roadmap)

1. **Geofencing nativo** com expo-task-manager
2. **Notificações push** para lembretes
3. **Relatórios avançados** com gráficos
4. **Multi-local** por funcionário
5. **Integração** com sistemas de RH
6. **PWA** para acesso web

---

## Suporte

Para questões ou bugs, contactar a equipa de desenvolvimento.

**Versão**: 2.0.0  
**Última atualização**: Fevereiro 2026
