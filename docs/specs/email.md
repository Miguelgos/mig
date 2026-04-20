# Spec: Integração E-mail com Agenda (.ics)

## Visão geral

Serviço de envio de e-mails via Outlook/SMTP com suporte a geração de arquivo de agenda `.ics`.
Usado principalmente para notificar sobre comunicados escolares que contêm datas de eventos.

## Configuração SMTP

| Campo | Valor |
|-------|-------|
| Provedor | Microsoft Outlook |
| Host | `smtp-mail.outlook.com` |
| Porta | `587` |
| Segurança | STARTTLS |
| Biblioteca | `nodemailer` |

### Autenticação

Usa **senha de app** do Outlook, não a senha principal da conta. Para gerar uma senha de app:

1. Acesse `https://account.microsoft.com/security`
2. Vá em "Verificação em duas etapas" → "Gerenciar senhas de app"
3. Crie uma senha de app para o Mig

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `EMAIL_USER` | Conta Outlook usada para envio (ex: `miguelgos@live.com`) |
| `EMAIL_PASS` | Senha de app do Outlook (não a senha principal) |
| `EMAIL_DESTINO` | E-mail de destino (padrão: `miguelgos@live.com`) |

## Geração de agenda (.ics)

Quando um comunicado contém data/hora de evento (ex: "reunião de pais na sexta às 19h"), o serviço:

1. Passa o texto do comunicado para o **Claude**, que extrai data, hora e descrição em linguagem natural
2. Usa `ical-generator` para criar um arquivo `.ics` com o evento
3. Anexa o `.ics` ao e-mail — ao abrir, o cliente de e-mail oferece "Adicionar ao calendário"

### Extração de data pelo Claude

O Claude recebe o texto do comunicado e retorna um objeto JSON com:

```json
{
  "titulo": "Reunião de pais",
  "inicio": "2026-04-18T19:00:00-03:00",
  "fim": "2026-04-18T20:00:00-03:00",
  "descricao": "Reunião de pais e responsáveis — sala 3B"
}
```

Se não houver data identificável no texto, nenhum `.ics` é gerado e o e-mail é enviado sem anexo.

## Fluxo completo

```
Comunicado com possível data
        │
        ▼
Claude extrai data/hora (linguagem natural → ISO 8601)
        │
        ├── Data encontrada? ──► ical-generator cria evento .ics
        │                               │
        │                               ▼
        │                       Anexa .ics ao e-mail
        │
        └── Sem data? ──────────► E-mail sem anexo
                │
                ▼
        nodemailer envia para EMAIL_DESTINO
```

## Limitações conhecidas

- **Apenas Outlook**: a configuração SMTP é específica para `smtp-mail.outlook.com`; outros provedores exigem mudança de host/porta
- **Sem retry**: se o envio falhar (rede, credenciais), não há tentativa automática de reenvio
- **Sem confirmação de leitura**: não há rastreamento de abertura ou confirmação de entrega
- **Senha de app obrigatória**: contas com autenticação em duas etapas ativada não aceitam a senha principal via SMTP

## Próximas melhorias

- Suporte a múltiplos destinatários
- Retry automático em caso de falha de envio
- Suporte a outros provedores SMTP (Gmail, etc.)
