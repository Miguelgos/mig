import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/cartola', () => ({
  sugerirTime: vi.fn().mockResolvedValue({ jogadores: [], custoTotal: 0 }),
  consultarPontuacao: vi.fn().mockResolvedValue({ pontos: 42 }),
  statusMercado: vi.fn().mockResolvedValue({ aberto: true, rodada: 5 }),
}));

vi.mock('../services/eatsimple', () => ({
  consultarSaldo: vi.fn().mockResolvedValue({
    aluno: 'Lucas',
    saldo: 'R$ 45,30',
    atualizadoEm: '20/04/2026 06:30:00',
  }),
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

  it('executa saldo_lanchonete', async () => {
    const { executeTool } = await import('./executor');
    const result = await executeTool('saldo_lanchonete', {});
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({ aluno: 'Lucas', saldo: 'R$ 45,30' });
  });

  it('retorna erro para tool desconhecida', async () => {
    const { executeTool } = await import('./executor');
    const result = await executeTool('tool_inexistente', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('erro');
  });
});
