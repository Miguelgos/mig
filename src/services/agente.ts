import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { toolDefinitions } from '../tools/definitions';
import { executeTool } from '../tools/executor';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// Histórico em memória por chatId: máximo 20 turns (40 mensagens)
const histories = new Map<string, Content[]>();

const MAX_TURNS = 20;
const MAX_TOOL_CALLS = 10; // limite de segurança por iteração

/** Retry com backoff exponencial para erros transitórios do Gemini (503/429). */
async function geminiRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let delay = 3000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (isTransient && attempt < maxAttempts) {
        console.log(`agente: Gemini erro transitório (tentativa ${attempt}/${maxAttempts}), aguardando ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30000);
      } else {
        throw err;
      }
    }
  }
  throw new Error('geminiRetry: máximo de tentativas excedido');
}

const SYSTEM_INSTRUCTION = `Você é o Mig, assistente pessoal do Miguel.

Regras:
- Responda sempre em português brasileiro
- Seja direto, conciso e útil
- Use as tools disponíveis quando o usuário pedir informações do Cartola FC
- Nunca invente dados — use as tools para obter informações reais
- Quando não souber algo, diga claramente`;

/**
 * Executa o loop agêntico do Gemini para um chatId e mensagem.
 * Mantém histórico em memória, limitado a MAX_TURNS turns.
 */
export async function runAgentLoop(chatId: string, userMessage: string): Promise<string> {
  const history = histories.get(chatId) ?? [];

  // Adiciona mensagem do usuário ao histórico
  const userContent: Content = {
    role: 'user',
    parts: [{ text: userMessage }],
  };
  history.push(userContent);

  let toolCallCount = 0;
  let finalResponse = '';

  // Loop agêntico: continua enquanto o modelo retornar function calls
  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await geminiRetry(() => genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: history,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: toolDefinitions }],
      },
    }));

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      finalResponse = 'Desculpe, não consegui gerar uma resposta.';
      break;
    }

    const parts: Part[] = candidate.content.parts ?? [];
    const hasFunctionCall = parts.some((p) => p.functionCall != null);

    if (!hasFunctionCall) {
      // Resposta de texto final
      finalResponse = parts
        .filter((p) => p.text != null)
        .map((p) => p.text)
        .join('');

      // Adiciona resposta do modelo ao histórico
      history.push({ role: 'model', parts });
      break;
    }

    // Adiciona a resposta do modelo com function calls ao histórico
    history.push({ role: 'model', parts });

    // Executa todas as function calls em paralelo
    const functionCallParts = parts.filter((p) => p.functionCall != null);
    const functionResponseParts: Part[] = await Promise.all(
      functionCallParts.map(async (p) => {
        const fc = p.functionCall!;
        const result = await executeTool(
          fc.name ?? '',
          (fc.args as Record<string, unknown>) ?? {}
        );
        return {
          functionResponse: {
            name: fc.name ?? '',
            response: { result },
          },
        } as Part;
      })
    );

    // Adiciona resultados das tools ao histórico como mensagem "user"
    history.push({ role: 'user', parts: functionResponseParts });
    toolCallCount++;
  }

  if (toolCallCount >= MAX_TOOL_CALLS) {
    finalResponse = 'Limite de chamadas de ferramentas atingido. Tente novamente.';
  }

  // Limita o histórico a MAX_TURNS turns (2 mensagens por turn)
  const maxMessages = MAX_TURNS * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }

  histories.set(chatId, history);
  return finalResponse;
}

/** Limpa o histórico de um chatId específico. */
export function clearHistory(chatId: string): void {
  histories.delete(chatId);
}
