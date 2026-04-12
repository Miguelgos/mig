# Mig — Contexto do Projeto

## O que é

**Mig** é um assistente pessoal do Miguel, acessível via chat web (PWA) e Telegram.
Responde sempre em português brasileiro, com foco em ser direto, conciso e útil.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20 + TypeScript |
| LLM | Google Gemini 2.0 Flash (`@google/genai`) |
| Bot | Telegram (`node-telegram-bot-api`) |
| HTTP | Express 4 |
| Agendamento | node-cron |
| Banco | SQLite via Prisma |
| Deploy | Railway |
| Frontend | PWA HTML/CSS/JS vanilla em `public/` |
| Testes | Vitest |

---

## Estrutura de pastas

```
mig/
├── CLAUDE.md                  ← este arquivo (contexto central)
├── README.md                  ← setup e uso para humanos
├── .env.example               ← variáveis necessárias
├── package.json
├── tsconfig.json
├── railway.toml               ← config de deploy
├── prisma/
│   └── schema.prisma          ← modelos Message e Config
├── public/
│   ├── index.html             ← PWA frontend (chat dark)
│   └── manifest.json          ← manifest para "Adicionar à tela inicial"
├── src/
│   ├── index.ts               ← entry point: Express + Telegram + crons
│   ├── crons.ts               ← todos os cron jobs (Cartola sábado 20h)
│   ├── routes/
│   │   └── chat.ts            ← POST /api/chat (usado pelo PWA)
│   ├── services/
│   │   ├── agente.ts          ← loop agêntico Gemini (histórico em memória)
│   │   ├── cartola.ts         ← integração Cartola FC
│   │   └── telegram.ts        ← bot Telegram (polling + envio proativo)
│   └── tools/
│       ├── definitions.ts     ← FunctionDeclaration[] para o Gemini
│       └── executor.ts        ← executa cada tool call por nome
├── docs/
│   ├── adr/                   ← Architecture Decision Records
│   └── specs/                 ← especificações de cada integração
└── .claude/
    └── agents/                ← perfis de agentes especializados
```

---

## Arquitetura do loop agêntico

```
Usuário envia mensagem
        │
        ▼
  runAgentLoop(chatId, msg)
        │
        ├── Carrega histórico em memória (máx 20 turns)
        │
        ▼
  Gemini generateContent(histórico + system instruction + tools)
        │
        ├── Resposta de TEXTO? ──► Retorna ao usuário ✓
        │
        └── Resposta com functionCall?
                │
                ▼
        executeTool(name, args)   ← dispatcher em executor.ts
                │
                ▼
        Adiciona resultado ao histórico como role "user"
                │
                └──► Volta para generateContent (máx 10 iterações)
```

Histórico em memória: `Map<chatId, Content[]>`, limitado a 40 mensagens (20 turns).
Cada canal (Telegram chatId, "web") tem seu histórico independente.

---

## Como adicionar uma nova integração

1. **Criar o serviço** em `src/services/novaIntegracao.ts`
   - Função principal exportada com try/catch
   - Erros lançados com contexto: `throw new Error('contexto: ' + msg)`

2. **Declarar a tool** em `src/tools/definitions.ts`
   - Adicionar um objeto `FunctionDeclaration` ao array `toolDefinitions`
   - Nome em snake_case, descrição em português, parâmetros tipados

3. **Registrar no executor** em `src/tools/executor.ts`
   - Adicionar um `case` no switch com o nome exato da tool
   - Converter o resultado para `JSON.stringify(resultado)`

4. **Escrever testes** em `src/services/novaIntegracao.test.ts`
   - Mockar chamadas externas (axios, fetch)
   - Testar caminho feliz + erros

5. **Documentar** em `docs/specs/novaIntegracao.md`
   - Endpoints usados, autenticação, exemplos de request/response

6. **(Opcional) Adicionar cron** em `src/crons.ts`
   - Usar `cron.schedule` com timezone `America/Sao_Paulo`

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `GEMINI_API_KEY` | ✅ | Chave da API do Google Gemini |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token do bot no @BotFather |
| `TELEGRAM_ALLOWED_CHAT_ID` | ✅ | ID do chat autorizado (só um) |
| `CARTOLA_EMAIL` | ❌ | Email Globo (pontuação do time) |
| `CARTOLA_SENHA` | ❌ | Senha Globo (pontuação do time) |
| `DATABASE_URL` | ❌ | Padrão: `file:./dev.db` |
| `PORT` | ❌ | Padrão: `3000` |

---

## Comandos úteis

```bash
npm run dev          # inicia em modo watch (tsx)
npm run build        # compila TypeScript
npm start            # roda o build compilado
npm run db:push      # aplica schema no banco
npm run db:studio    # abre Prisma Studio
npm test             # roda os testes com Vitest
npm run test:watch   # testes em modo watch
```

---

## Convenções

| Aspecto | Convenção |
|---------|-----------|
| Idioma do código | Inglês (variáveis, funções, tipos) |
| Idioma de docs/comentários | Português brasileiro |
| Commits | Conventional commits: `feat:`, `fix:`, `docs:`, `chore:` |
| Testes | Vitest, arquivo `*.test.ts` ao lado do testado |
| Erros | `console.error('contexto:', err.message)` + throw com contexto |
| TypeScript | Sem `any` desnecessário; strict mode ativado |
| Chamadas externas | Sempre dentro de try/catch |

---

## Backlog de integrações futuras

- **Loteria Federal** — resultados via API pública da Caixa
- **App da escola** — OCR via Gemini Vision para avisos/comunicados
- **Google Calendar** — consultar e criar eventos
- **Notificações configuráveis** — usuário define horário/frequência via chat
