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

### 3. Criar o banco de dados

```bash
npm run db:push
```

### 4. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000` para o chat web.

## Deploy no Railway

1. Crie um projeto no Railway e conecte o repositório
2. Configure as variáveis de ambiente no painel do Railway
3. O Railway usa o `railway.toml` para build e deploy automático

## Obter o TELEGRAM_ALLOWED_CHAT_ID

1. Inicie uma conversa com `@userinfobot` no Telegram
2. Ele responderá com seu chat ID

## Estrutura

Veja [CLAUDE.md](./CLAUDE.md) para a documentação técnica completa.
