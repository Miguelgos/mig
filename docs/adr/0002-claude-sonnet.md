# ADR 0002 — Migração de Gemini Flash para Claude Sonnet 4.6

- **Data**: 2026-04-20
- **Status**: Aceito
- **Substitui**: ADR 0001

## Contexto

Durante uso em produção, o Gemini 2.5 Flash (free tier) começou a retornar 503 UNAVAILABLE com alta frequência, afetando:

- Loop agêntico (`agente.ts`) — timeouts no Telegram e no PWA
- OCR de screenshots em `escola.ts` (3 calls) e `eatsimple.ts` (1 call) — cada execução do cron virava uma sequência de retries
- Extração de datas em `email.ts` para montagem de `.ics`

Os `geminiRetry` com backoff exponencial mitigavam, mas não resolviam — o cron de notícias diárias batia o teto de retry consistentemente.

## Decisão

Migrar totalmente para **Claude Sonnet 4.6** (`claude-sonnet-4-6`) via SDK oficial `@anthropic-ai/sdk`. A integração de notícias (que dependia do Google Search grounding) foi **removida**, já que era a única feature sem equivalente trivial em outro provedor.

## Alternativas consideradas

| Opção | Custo (input/output por 1M) | Tool use | Vision | Observações |
|-------|------------------------------|----------|--------|-------------|
| **Claude Sonnet 4.6** | $3 / $15 | ✅ nativo | ✅ nativo | SDK maduro, vision forte, sem 503 recorrente no paid tier |
| Claude Haiku 4.5 | $1 / $5 | ✅ nativo | ✅ nativo | Mais barato; vision ok mas um degrau abaixo |
| Continuar com Gemini 2.5 Flash (pago) | $0.075 / $0.30 | ✅ | ✅ | Mais barato, mas manter o 503 resolvido exige paid tier e sem garantia |
| Híbrido (Claude + Gemini só p/ notícias) | — | — | — | Duas contas, duas SDKs, manter `geminiRetry` — complexidade desnecessária |

## Justificativa

- **Confiabilidade** é o driver principal: o bot é pessoal, mas falhas silenciosas em cron jobs (perda de comunicado da escola) saem caro
- Volume estimado: ~20-30 calls/dia entre agente, OCR e extração de datas → custo mensal na ordem de centavos a poucos dólares
- Vision do Claude tem qualidade equivalente ou superior ao Gemini Flash para screenshots em português
- Tool use nativo no SDK TS com JSON Schema puro é mais simples que o `FunctionDeclaration` do Gemini
- SDK provê retry automático para 429/5xx e classes de exceção tipadas (`Anthropic.RateLimitError`, `Anthropic.APIError`)

## Consequências

- Custo mensal sai de ~$0 (free tier Gemini) para algo em torno de $1-5/mês
- Dependência da Anthropic (EUA) em vez da Google Cloud
- Feature de notícias de IA descontinuada (seria necessário integrar Brave Search / Tavily separadamente)
- Necessidade de gerenciar `ANTHROPIC_API_KEY` em vez de `GEMINI_API_KEY`

## Como reverter

Substituir imports de `@anthropic-ai/sdk` por outro SDK. O código isolou as chamadas ao LLM em funções pequenas (`anthropicRetry`, `extrairTexto`, `visionMessages`) que servem de pontos de troca. As definições de tools estão em JSON Schema padrão — portável para qualquer provider com tool use.
