# Mig — Contexto do Projeto

## O que é

**Mig** é um assistente pessoal do Miguel, acessível via chat web (PWA) e Telegram.
Responde sempre em português brasileiro, com foco em ser direto, conciso e útil.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20 + TypeScript |
| LLM | Google Gemini 2.5 Flash (`@google/genai`) |
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
├── nixpacks.toml              ← config nixpacks (Chromium para Puppeteer)
├── prisma/
│   └── schema.prisma          ← modelos Message e Config
├── public/
│   ├── index.html             ← PWA frontend (chat dark)
│   └── manifest.json          ← manifest para "Adicionar à tela inicial"
├── src/
│   ├── index.ts               ← entry point: Express + Telegram + crons
│   ├── crons.ts               ← todos os cron jobs (Cartola, escola, notícias)
│   ├── routes/
│   │   └── chat.ts            ← POST /api/chat (usado pelo PWA)
│   ├── services/
│   │   ├── agente.ts          ← loop agêntico Gemini (histórico em memória)
│   │   ├── cartola.ts         ← integração Cartola FC (Puppeteer + cookie cache)
│   │   ├── escola.ts          ← portal escolar Layers Digital (Puppeteer + Gemini Vision)
│   │   ├── eatsimple.ts       ← saldo da lanchonete (Puppeteer + Gemini Vision)
│   │   ├── email.ts           ← envio de e-mail Outlook com agenda .ics (nodemailer)
│   │   ├── noticias.ts        ← resumo de notícias de IA via Google Search grounding
│   │   └── telegram.ts        ← bot Telegram (polling + stopPolling no SIGTERM)
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

### Tools disponíveis

| Tool | Descrição |
|------|-----------|
| `sugerir_time_cartola(orcamento?)` | Sugere escalação com base em preço e média (dados públicos) |
| `pontuacao_cartola()` | Consulta pontuação do time do usuário (requer autenticação via Puppeteer) |
| `status_mercado_cartola()` | Verifica se o mercado está aberto/fechado e a rodada atual |
| `verificar_escola_agora()` | Busca comunicados, filtra importantes com Gemini e envia e-mail |
| `comunicados_escola(limite?)` | Retorna lista de comunicados recentes do portal escolar |
| `saldo_lanchonete()` | Consulta saldo da lanchonete do Lucas no Eat Simple |
| `noticias_ia()` | Busca e resume notícias de IA das últimas 48h via Google Search grounding |

### Cron jobs ativos

| Horário | Job |
|---------|-----|
| Sábados 20h | Pontuação do Cartola (se mercado aberto, avisa para escalar) |
| Diário 7h, 13h, 18h | Comunicados da escola do Lucas (filtra importantes, envia .ics se tiver datas) |
| Seg–Sex 6:30 | Saldo da lanchonete do Lucas (Eat Simple) |
| Diário 12h | Resumo de notícias de IA via Google Search grounding |

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
| `CARTOLA_EMAIL` | ❌ | Email Globo (pontuação do time via Puppeteer) |
| `CARTOLA_SENHA` | ❌ | Senha Globo (pontuação do time via Puppeteer) |
| `ESCOLA_EMAIL` | ❌ | Email do portal escolar Layers Digital |
| `ESCOLA_SENHA` | ❌ | Senha do portal escolar Layers Digital |
| `EMAIL_USER` | ❌ | Conta Outlook para envio de e-mails (SMTP) |
| `EMAIL_PASS` | ❌ | Senha de app do Outlook (não a senha principal) |
| `EMAIL_DESTINO` | ❌ | Destinatário dos e-mails (padrão: `miguelgos@live.com`) |
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

- ✅ **Cartola FC** — sugestão de escalação e pontuação via Puppeteer
- ✅ **App da escola** — OCR via Gemini Vision para avisos/comunicados (Layers Digital)
- ✅ **E-mail com agenda .ics** — envio de comunicados com datas via Outlook/nodemailer
- ✅ **Notícias de IA** — Google Search grounding via Gemini
- ✅ **Lanchonete da escola** — saldo via Eat Simple (Puppeteer + Gemini Vision)
- ✅ **Cron jobs de notificação** — escola 3x/dia, Cartola sábados, notícias ao meio-dia, lanchonete seg-sex 6h30
- ❌ **Loteria Federal** — resultados via API pública da Caixa
- ❌ **Google Calendar** — consultar e criar eventos
- ❌ **Histórico persistente no SQLite** — hoje o histórico é apenas em memória
- ❌ **Webhook Telegram** — hoje usa polling
