# Spec: Integração Telegram Bot

## Visão geral

Bot do Telegram que recebe mensagens do Miguel, passa pelo loop agêntico do Claude e responde.
Suporta também envio proativo de notificações via cron jobs.

## Configuração inicial

1. Criar bot com `@BotFather` no Telegram → `/newbot`
2. Guardar o token em `TELEGRAM_BOT_TOKEN`
3. Descobrir o chat ID com `@userinfobot` → guardar em `TELEGRAM_ALLOWED_CHAT_ID`

## Modo de operação

**Polling** — o bot faz long polling na API do Telegram.

Vantagens sobre webhook:
- Sem necessidade de domínio público com SSL em desenvolvimento
- Mais simples de configurar
- Funciona atrás de NAT/firewall

Desvantagem: latência marginal (~1s) vs webhook.

## Comandos suportados

| Comando | Ação |
|---------|------|
| `/start` | Limpa histórico e exibe saudação |
| `/clear` | Mesmo que `/start` |
| Qualquer texto | Passa para o loop agêntico |

## Fluxo de mensagem

```
Telegram → polling → handler → runAgentLoop(chatId, text)
                                      │
                                      ▼
                              Claude (com tools)
                                      │
                                      ▼
                              bot.sendMessage(chatId, reply)
```

## Controle de acesso

Qualquer `msg.chat.id` diferente de `TELEGRAM_ALLOWED_CHAT_ID` recebe:
```
Acesso negado. Este assistente é privado.
```

## Parse mode

Respostas enviadas com `parse_mode: 'Markdown'` — o Claude pode usar:
- `**negrito**`
- `` `código` ``
- Listas com `-`

## Notificações proativas

Envio via `sendMessage(text)` exportado de `src/services/telegram.ts`.
Chamado pelos cron jobs em `src/crons.ts`.

## Limitações conhecidas

- Um único chat autorizado (sem multi-usuário)
- Histórico em memória — perdido ao reiniciar o processo
- Sem suporte a imagens, áudio ou outros media types
- Polling falha silenciosamente se o token for inválido (apenas log de erro)

## Próximas melhorias

- Migrar para webhook (Railway tem HTTPS nativo — só mudar `polling: false`)
- Persistir histórico no SQLite para sobreviver a restarts
- Suporte a fotos (enviar captura do app da escola para OCR)
