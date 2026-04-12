# ADR 0002 — Telegram como canal de notificações e chat

- **Data**: 2026-04-11
- **Status**: Aceito

## Contexto

O Mig precisa de um canal de comunicação para o Miguel receber notificações proativas (ex: pontuação do Cartola) e enviar mensagens quando não estiver no browser. O canal deve ser confiável, ter API estável e funcionar bem no celular.

## Alternativas consideradas

| Opção | Setup | Custo | Push nativo | API estável | Observações |
|-------|-------|-------|-------------|-------------|-------------|
| **Telegram** | Fácil (BotFather) | Gratuito | ✅ | ✅ | Polling ou webhook; rich text; app excelente |
| WhatsApp (Business API) | Complexo | Pago por mensagem | ✅ | ⚠️ | Requer número dedicado; custos por conversa |
| E-mail | Trivial | Gratuito | ❌ | ✅ | Sem interatividade; chegada atrasada |
| Push web (PWA) | Médio | Gratuito | ✅ | ✅ | Só funciona com browser/app instalado; iOS limitado |
| SMS | Fácil via Twilio | Pago | ✅ | ✅ | Custo por mensagem; sem rich text |

## Decisão

Usar **Telegram** via `node-telegram-bot-api` em modo **polling**.

## Justificativa

- App de qualidade no iPhone; notificações confiáveis
- API gratuita, estável e bem documentada
- Polling elimina necessidade de domínio/SSL para webhook em dev
- Suporte a Markdown nas mensagens (bold, code, etc.)
- `TELEGRAM_ALLOWED_CHAT_ID` garante acesso privado sem lógica complexa

## Consequências

- Polling consome uma conexão HTTP persistente; pequeno overhead
- Bot só funciona se o processo Node estiver rodando
- Migrar para webhook no futuro é trivial (Railway tem HTTPS nativo)

## Como reverter

Remover `src/services/telegram.ts` e a chamada `initTelegram()` em `src/index.ts`.
O loop agêntico não depende do Telegram — o PWA continua funcionando independentemente.
