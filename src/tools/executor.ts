import { sugerirTime, consultarPontuacao, statusMercado } from '../services/cartola';
import { buscarComunicados } from '../services/escola';

/**
 * Executa uma tool call retornada pelo Gemini.
 * Retorna o resultado como string para devolver ao modelo.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case 'sugerir_time_cartola': {
        const orcamento = typeof args.orcamento === 'number' ? args.orcamento : 100;
        const resultado = await sugerirTime(orcamento);
        return JSON.stringify(resultado);
      }

      case 'pontuacao_cartola': {
        const resultado = await consultarPontuacao();
        return JSON.stringify(resultado);
      }

      case 'status_mercado_cartola': {
        const resultado = await statusMercado();
        return JSON.stringify(resultado);
      }

      case 'comunicados_escola': {
        const limite = typeof args.limite === 'number' ? args.limite : 5;
        const resultado = await buscarComunicados(limite);
        return JSON.stringify(resultado);
      }

      default:
        return JSON.stringify({ erro: `Tool desconhecida: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`executor tool "${name}":`, message);
    return JSON.stringify({ erro: message });
  }
}
