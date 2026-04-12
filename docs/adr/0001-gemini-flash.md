# ADR 0001 — Uso do Google Gemini 2.0 Flash como LLM

- **Data**: 2026-04-11
- **Status**: Aceito

## Contexto

O Mig precisa de um LLM para entender linguagem natural, executar um loop agêntico com tool use e responder em português. A escolha do modelo afeta custo, latência, qualidade e facilidade de integração.

## Alternativas consideradas

| Opção | Custo (input/output por 1M tokens) | Tool use | Latência | Observações |
|-------|-----------------------------------|----------|----------|-------------|
| **Gemini 2.0 Flash** | ~$0,075 / $0,30 | ✅ nativo | Muito baixa | Context de 1M tokens; grátis no free tier |
| Claude 3.5 Haiku | ~$0,80 / $4,00 | ✅ nativo | Baixa | 10x mais caro no input |
| GPT-4o mini | ~$0,15 / $0,60 | ✅ nativo | Baixa | 2x mais caro; sem free tier generoso |
| Groq (Llama 3) | Gratuito com limites | ❌ limitado | Muito baixa | Tool use instável; sem SLA |
| Ollama local | Gratuito | ❌ depende do modelo | Alta (hardware) | Requer GPU; inviável no Railway |

## Decisão

Usar **Google Gemini 2.0 Flash** via SDK oficial `@google/genai`.

## Justificativa

- Melhor custo-benefício entre as opções com tool use nativo confiável
- Free tier generoso (1500 req/dia) cobre o uso pessoal com folga
- Context window de 1M tokens elimina preocupação com histórico longo
- SDK oficial bem mantido com suporte a `functionDeclarations`
- Latência baixa melhora a experiência no Telegram (digitando... desaparece rápido)

## Consequências

- Dependência da Google Cloud para disponibilidade do serviço
- Necessidade de gerenciar `GEMINI_API_KEY`
- Possível mudança de preço/quotas no futuro

## Como reverter

Substituir `GoogleGenAI` em `src/services/agente.ts` por outro SDK (ex: `@anthropic-ai/sdk`).
O loop agêntico está isolado nesse arquivo — só mudar a chamada de API e o formato das tool declarations.
