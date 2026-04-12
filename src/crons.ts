import cron from 'node-cron';
import { sendMessage } from './services/telegram';
import { consultarPontuacao, statusMercado } from './services/cartola';

/**
 * Registra todos os cron jobs do Mig.
 * Fuso horário: America/Sao_Paulo
 */
export function scheduleCrons(): void {
  // Todo sábado às 20h: notifica a pontuação do Cartola
  cron.schedule(
    '0 20 * * 6',
    async () => {
      console.log('cron: verificando pontuação do Cartola...');

      try {
        const mercado = await statusMercado();
        // Só notifica se o mercado estiver processando (rodada em andamento)
        if (mercado.aberto) {
          await sendMessage(
            `⚽ *Cartola FC — Rodada ${mercado.rodada}*\n\nO mercado ainda está aberto. Certifique-se de escalar seu time!`
          );
          return;
        }

        const pontuacao = await consultarPontuacao();
        await sendMessage(
          `⚽ *Cartola FC — Rodada ${pontuacao.rodada}*\n\n` +
            `🏆 *${pontuacao.time}*\n` +
            `📊 Pontuação: ${pontuacao.pontos} pts\n` +
            `💰 Patrimônio: C$ ${pontuacao.patrimonio}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('cron cartola:', message);

        // Notifica mesmo em caso de erro (sem dados de autenticação, por ex.)
        await sendMessage(
          `⚽ *Cartola FC* — Não foi possível buscar sua pontuação automaticamente.\n\nDigite "minha pontuação no cartola" para tentar manualmente.`
        );
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );

  console.log('Cron jobs agendados.');
}
