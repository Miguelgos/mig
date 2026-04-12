import { Type, type FunctionDeclaration } from '@google/genai';

/**
 * Declarações de tools disponíveis para o Gemini no loop agêntico.
 * Cada tool corresponde a uma função em executor.ts.
 */
export const toolDefinitions: FunctionDeclaration[] = [
  {
    name: 'sugerir_time_cartola',
    description:
      'Sugere um time para o Cartola FC dentro de um orçamento. Usa jogadores com status "provável" (status_id 7) e maior média de pontos.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orcamento: {
          type: Type.NUMBER,
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
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: 'status_mercado_cartola',
    description:
      'Verifica o status atual do mercado do Cartola FC (aberto, fechado) e informações da rodada atual.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];
