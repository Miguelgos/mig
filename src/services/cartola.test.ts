import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('cartola', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('statusMercado', () => {
    it('retorna status aberto quando id === 1', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: {
          rodada: { rodada_atual: 5 },
          status_mercado: { id: 1, nome: 'Mercado aberto' },
        },
      });

      const { statusMercado } = await import('./cartola');
      const result = await statusMercado();

      expect(result.aberto).toBe(true);
      expect(result.rodada).toBe(5);
      expect(result.status).toBe('Mercado aberto');
    });

    it('retorna status fechado quando id !== 1', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: {
          rodada: { rodada_atual: 5 },
          status_mercado: { id: 2, nome: 'Mercado fechado' },
        },
      });

      const { statusMercado } = await import('./cartola');
      const result = await statusMercado();

      expect(result.aberto).toBe(false);
    });

    it('lança erro quando a API falha', async () => {
      mockedAxios.get = vi.fn().mockRejectedValue(new Error('Network error'));

      const { statusMercado } = await import('./cartola');
      await expect(statusMercado()).rejects.toThrow('Falha ao verificar status do mercado');
    });
  });

  describe('sugerirTime', () => {
    it('seleciona jogadores prováveis (status_id 7) dentro do orçamento', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: {
          rodada_atual: 5,
          atletas: [
            { atleta_id: 1, apelido: 'Goleiro A', clube_id: 1, posicao_id: 1, status_id: 7, preco_num: 10, media_num: 8 },
            { atleta_id: 2, apelido: 'Goleiro B', clube_id: 2, posicao_id: 1, status_id: 2, preco_num: 5, media_num: 9 }, // não provável
            { atleta_id: 3, apelido: 'Lateral A', clube_id: 1, posicao_id: 2, status_id: 7, preco_num: 8, media_num: 7 },
            { atleta_id: 4, apelido: 'Lateral B', clube_id: 2, posicao_id: 2, status_id: 7, preco_num: 7, media_num: 6 },
            { atleta_id: 5, apelido: 'Zagueiro A', clube_id: 1, posicao_id: 3, status_id: 7, preco_num: 6, media_num: 7 },
            { atleta_id: 6, apelido: 'Zagueiro B', clube_id: 2, posicao_id: 3, status_id: 7, preco_num: 5, media_num: 6 },
            { atleta_id: 7, apelido: 'Meia A', clube_id: 1, posicao_id: 4, status_id: 7, preco_num: 10, media_num: 9 },
            { atleta_id: 8, apelido: 'Meia B', clube_id: 2, posicao_id: 4, status_id: 7, preco_num: 9, media_num: 8 },
            { atleta_id: 9, apelido: 'Meia C', clube_id: 3, posicao_id: 4, status_id: 7, preco_num: 8, media_num: 7 },
            { atleta_id: 10, apelido: 'Atacante A', clube_id: 1, posicao_id: 5, status_id: 7, preco_num: 12, media_num: 10 },
            { atleta_id: 11, apelido: 'Atacante B', clube_id: 2, posicao_id: 5, status_id: 7, preco_num: 11, media_num: 9 },
            { atleta_id: 12, apelido: 'Atacante C', clube_id: 3, posicao_id: 5, status_id: 7, preco_num: 10, media_num: 8 },
          ],
          clubes: {
            '1': { nome: 'Flamengo', abreviacao: 'FLA' },
            '2': { nome: 'Palmeiras', abreviacao: 'PAL' },
            '3': { nome: 'Corinthians', abreviacao: 'COR' },
          },
        },
      });

      const { sugerirTime } = await import('./cartola');
      const result = await sugerirTime(100);

      expect(result.jogadores).toHaveLength(11);
      // Goleiro B (status_id 2) não deve estar no time
      expect(result.jogadores.find((j) => j.nome === 'Goleiro B')).toBeUndefined();
    });
  });
});
