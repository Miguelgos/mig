# Mig

Assistente pessoal do Miguel, acessível via chat web (PWA) e Telegram.

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env com suas chaves
```

Variáveis obrigatórias: `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`.

Variáveis opcionais por integração:

| Integração | Variáveis |
|------------|-----------|
| Cartola FC (autenticado) | `CARTOLA_EMAIL`, `CARTOLA_SENHA` |
| Portal escolar | `ESCOLA_EMAIL`, `ESCOLA_SENHA` |
| Envio de e-mail | `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_DESTINO` |

### 3. Criar o banco de dados

```bash
npm run db:push
```

### 4. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000` para o chat web.

## Integrações disponíveis

### Cartola FC

- **Sugestão de escalação**: busca atletas do mercado e sugere o melhor time dentro do orçamento
- **Pontuação do time**: consulta a pontuação parcial via Puppeteer (requer `CARTOLA_EMAIL` e `CARTOLA_SENHA`)
- **Status do mercado**: verifica se o mercado está aberto ou fechado
- Cron automático todo sábado às 20h: avisa a pontuação e sugere escalação se o mercado estiver aberto

### Portal escolar (Layers Digital)

- Login via Puppeteer no portal do Lucas (layers.digital)
- Screenshot da página → Gemini Vision extrai comunicados como JSON
- Para cada comunicado importante, abre o item e extrai o conteúdo completo (`detalhes`) via Gemini Vision
- Cron automático às 7h, 13h e 18h: filtra comunicados importantes com Gemini, envia no Telegram com detalhes e envia e-mail com `.ics` quando houver data
- Deduplicação persistente: cada comunicado enviado fica salvo em `SentEscola` (SQLite) pelo fingerprint `titulo|autor|data` e não é reenviado
- Requer `ESCOLA_EMAIL` e `ESCOLA_SENHA`

### E-mail com agenda

- Envia e-mails via Outlook (SMTP smtp-mail.outlook.com:587)
- Usa `ical-generator` para criar eventos `.ics` a partir de texto em linguagem natural
- Gemini extrai data/hora do texto para montar o evento
- Requer `EMAIL_USER` e `EMAIL_PASS` (senha de app, não a senha principal da conta)

### Notícias de IA

- Usa Google Search grounding via Gemini para buscar notícias recentes
- Foco: Claude Code, APIs da Anthropic/OpenAI/Gemini, agentes em produção
- Retorna até 5 notícias das últimas 48h em português
- Cron automático diário ao meio-dia

## Deploy no Railway

1. Crie um projeto no Railway e conecte o repositório
2. Configure as variáveis de ambiente no painel do Railway
3. O Railway usa `railway.toml` e `nixpacks.toml` para build e deploy automático

O `nixpacks.toml` instala o **Chromium** automaticamente — necessário para as integrações que usam Puppeteer (Cartola autenticado e portal escolar).

## Obter o TELEGRAM_ALLOWED_CHAT_ID

1. Inicie uma conversa com `@userinfobot` no Telegram
2. Ele responderá com seu chat ID

## Estrutura

Veja [CLAUDE.md](./CLAUDE.md) para a documentação técnica completa.
