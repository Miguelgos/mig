import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions } from '../tools/definitions';
import { executeTool } from '../tools/executor';

const anthropic = new Anthropic();

// Histórico em memória por chatId: máximo 20 turns (40 mensagens)
const histories = new Map<string, Anthropic.MessageParam[]>();

const MAX_TURNS = 20;
const MAX_TOOL_CALLS = 10; // limite de segurança por iteração
const MODEL = 'claude-sonnet-4-6';

/** Retry com backoff exponencial para erros transitórios (429/5xx/overloaded). */
async function anthropicRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let delay = 3000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient =
        err instanceof Anthropic.RateLimitError ||
        (err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 500);
      if (isTransient && attempt < maxAttempts) {
        console.log(`agente: erro transitório (tentativa ${attempt}/${maxAttempts}), aguardando ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30000);
      } else {
        throw err;
      }
    }
  }
  throw new Error('anthropicRetry: máximo de tentativas excedido');
}

const SYSTEM_INSTRUCTION = `Você é o Mig, assistente pessoal do Miguel.

Regras:
- Responda sempre em português brasileiro
- Seja direto, conciso e útil
- Use as tools disponíveis quando o usuário pedir informações do Cartola FC, escola do Lucas ou lanchonete
- Nunca invente dados — use as tools para obter informações reais
- Quando não souber algo, diga claramente`;

/**
 * Executa o loop agêntico do Claude para um chatId e mensagem.
 * Mantém histórico em memória, limitado a MAX_TURNS turns.
 */
export async function runAgentLoop(chatId: string, userMessage: string): Promise<string> {
  const history = histories.get(chatId) ?? [];

  history.push({ role: 'user', content: userMessage });

  let toolCallCount = 0;
  let finalResponse = '';

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await anthropicRetry(() =>
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_INSTRUCTION,
        tools: toolDefinitions,
        messages: history,
      })
    );

    // Adiciona a resposta do assistente ao histórico
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      // Resposta textual final
      finalResponse = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      break;
    }

    // Executa cada tool_use e monta os tool_result
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (t) => {
        const result = await executeTool(t.name, (t.input as Record<string, unknown>) ?? {});
        return { type: 'tool_result', tool_use_id: t.id, content: result };
      })
    );

    history.push({ role: 'user', content: toolResults });
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
  return finalResponse || 'Desculpe, não consegui gerar uma resposta.';
}

/** Limpa o histórico de um chatId específico. */
export function clearHistory(chatId: string): void {
  histories.delete(chatId);
}
