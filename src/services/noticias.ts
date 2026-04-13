import { GoogleGenAI } from '@google/genai';

export interface ResumoNoticias {
  resumo: string;
  geradoEm: Date;
}

/**
 * Usa Gemini com Google Search grounding para buscar e resumir
 * as notícias mais relevantes sobre IA, APIs e agentes (foco em Claude Code).
 */
export async function buscarNoticiasIA(): Promise<ResumoNoticias> {
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

  const hoje = new Date().toLocaleDateString('pt-BR');

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: `Hoje é ${hoje}. Use o Google Search para buscar as notícias mais relevantes das últimas 48 horas sobre:

1. Claude Code e Anthropic (novidades, atualizações, features)
2. APIs de IA: Anthropic Claude, OpenAI, Google Gemini — lançamentos, mudanças de pricing, novos modelos
3. Agentes de IA em produção — frameworks, cases, boas práticas
4. Ferramentas para desenvolvedores que usam LLMs

Retorne um resumo com no máximo 5 notícias, em português brasileiro, no seguinte formato:

*🔹 [Título da notícia]*
Uma ou duas frases explicando o que é e por que importa para um desenvolvedor.

Seja direto. Destaque o que é acionável ou relevante para quem desenvolve com APIs de IA.`,
      }],
    }],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const texto = response.candidates?.[0]?.content?.parts
    ?.filter((p) => p.text != null)
    .map((p) => p.text)
    .join('') ?? '';

  if (!texto.trim()) throw new Error('Gemini não retornou conteúdo para o resumo de notícias.');

  return {
    resumo: texto.trim(),
    geradoEm: new Date(),
  };
}
