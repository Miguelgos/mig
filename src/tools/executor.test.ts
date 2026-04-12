import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/cartola', () => ({
  sugerirTime: vi.fn().mockResolvedValue({ jogadores: [], custoTotal: 0 }),
  consultarPontuacao: vi.fn().mockResolvedValue({ pontos: 42 }),
  statusMercado: vi.fn().mockResolvedValue({ aberto: true, rodada: 5 }),
}));

describe('executor', () => {
  it('executa sugerir_time_cartola com orçamento padrão', async () => {
    const { executeTool } = await import('./executor');
    const result = await executeTool('sugerir_time_cartola', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('jogadores');
  });

  it('executa pontuacao_cartola', async () => {
    const { executeTool } = await import('./executor');
    const result = await executeTool('pontuacao_cartola', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('pontos');
  });

  it('retorna erro para tool desconhecida', async () => {
    const { executeTool } = await import('./executor');
    const result = await executeTool('tool_inexistente', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('erro');
  });
});
