# Spec: Integração Notícias de IA

## Visão geral

Serviço que busca e resume notícias recentes sobre inteligência artificial usando o **Google Search grounding** do Gemini.
Não há chamadas a APIs externas de notícias — o próprio Gemini pesquisa e sintetiza as informações.

## Como funciona

O Google Search grounding é uma funcionalidade do Gemini que permite ao modelo buscar informações atualizadas na web em tempo real, além do seu conhecimento de treinamento.

```typescript
// Configuração da tool no SDK @google/genai
const result = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  tools: [{ googleSearch: {} }],
});
```

## Foco das buscas

| Tema | Exemplos |
|------|---------|
| Ferramentas e agentes de IA | Claude Code, Cursor, Devin, novas versões de modelos |
| APIs e SDKs | Anthropic API, OpenAI API, Google Gemini API |
| Agentes em produção | Casos de uso, benchmarks, comparativos |
| Tendências | Novos modelos, pesquisas relevantes, lançamentos |

## Formato de saída

Retorna até **5 notícias** das últimas **48 horas** em português brasileiro, com:

- Título da notícia
- Resumo de 2-3 frases
- Fonte/publicação (quando disponível via grounding)

## Cron job

| Horário | Ação |
|---------|------|
| Diário 12h | Busca e envia resumo de notícias de IA via Telegram |

## Tool disponível

| Tool | Parâmetros | Descrição |
|------|-----------|-----------|
| `noticias_ia()` | — | Busca e retorna resumo das últimas notícias de IA |

## Sem armazenamento

As notícias são geradas **fresh** a cada chamada — não há cache ou banco de dados. Cada requisição faz uma nova busca via grounding. Isso garante que as informações sejam sempre atuais, mas significa que chamadas seguidas podem retornar resultados ligeiramente diferentes.

## Limitações conhecidas

- **Dependência do grounding Gemini**: se o Google Search grounding estiver indisponível ou degradado, o modelo pode responder apenas com seu conhecimento de treinamento (potencialmente desatualizado)
- **Possível repetição**: notícias das últimas 48h podem aparecer em dias consecutivos se ainda forem relevantes
- **Sem fontes verificadas**: o grounding pode incluir fontes de baixa qualidade junto com fontes confiáveis
- **Idioma**: o modelo pode ocasionalmente retornar notícias em inglês se não houver cobertura suficiente em português

## Próximas melhorias

- Filtro por fonte confiável (The Verge, TechCrunch, InfoQ, etc.)
- Deduplicação entre chamadas consecutivas
- Tópicos configuráveis via chat ("me avise sobre X")
