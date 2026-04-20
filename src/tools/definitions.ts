import Anthropic from '@anthropic-ai/sdk';

/**
 * Tools disponíveis para o Claude no loop agêntico.
 * Cada tool corresponde a uma função em executor.ts.
 */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'sugerir_time_cartola',
    description:
      'Sugere um time para o Cartola FC dentro de um orçamento. Usa jogadores com status "provável" (status_id 7) e maior média de pontos.',
    input_schema: {
      type: 'object',
      properties: {
        orcamento: {
          type: 'number',
          description: 'Orçamento em cartoletas (padrão: 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'pontuacao_cartola',
    description:
      'Consulta a pontuação do time do usuário na rodada atual do Cartola FC. Requer login configurado.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'status_mercado_cartola',
    description:
      'Verifica o status atual do mercado do Cartola FC (aberto, fechado) e informações da rodada atual.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'verificar_escola_agora',
    description:
      'Verifica os comunicados da escola do Lucas agora mesmo, filtra os importantes e envia agenda por e-mail para os que tiverem data.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'comunicados_escola',
    description:
      'Busca os comunicados mais recentes da escola do Lucas no portal Layers Digital. Retorna título, autor, data e resumo de cada comunicado.',
    input_schema: {
      type: 'object',
      properties: {
        limite: {
          type: 'number',
          description: 'Quantidade máxima de comunicados a retornar (padrão: 5)',
        },
      },
      required: [],
    },
  },
  {
    name: 'saldo_lanchonete',
    description:
      'Consulta o saldo atual da lanchonete do Lucas no portal Eat Simple (eatsimple.com.br). Retorna o nome do aluno e o saldo em reais.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];
