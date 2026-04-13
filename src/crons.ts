import cron from 'node-cron';
import { sendMessage } from './services/telegram';
import { consultarPontuacao, statusMercado } from './services/cartola';
import { buscarComunicados, type Comunicado } from './services/escola';
import { GoogleGenAI } from '@google/genai';

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
        await sendMessage(
          `⚽ *Cartola FC* — Não foi possível buscar sua pontuação automaticamente.\n\nDigite "minha pontuação no cartola" para tentar manualmente.`
        );
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );

  // 3x ao dia (7h, 13h, 18h): verifica comunicados da escola do Lucas
  for (const hora of [7, 13, 18]) {
    cron.schedule(
      `0 ${hora} * * *`,
      async () => {
        console.log(`cron: verificando comunicados da escola (${hora}h)...`);
        await verificarComunicadosEscola();
      },
      { timezone: 'America/Sao_Paulo' }
    );
  }

  console.log('Cron jobs agendados.');
}

/** Busca comunicados, filtra os importantes com Gemini e notifica. */
async function verificarComunicadosEscola(): Promise<void> {
  try {
    const comunicados = await buscarComunicados(10);

    if (comunicados.length === 0) {
      console.log('cron escola: nenhum comunicado encontrado.');
      return;
    }

    const importantes = await filtrarImportantes(comunicados);

    if (importantes.length === 0) {
      console.log('cron escola: nenhum comunicado importante encontrado.');
      return;
    }

    // Monta e envia a notificação
    let msg = `🏫 *Comunicados da escola do Lucas*\n\n`;
    for (const c of importantes) {
      msg += `📌 *${c.titulo}*\n`;
      if (c.autor) msg += `👤 ${c.autor}\n`;
      if (c.data) msg += `📅 ${c.data}\n`;
      if (c.resumo) msg += `${c.resumo}\n`;
      msg += '\n';
    }

    await sendMessage(msg.trim());
    console.log(`cron escola: ${importantes.length} comunicado(s) importante(s) enviado(s).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cron escola:', message);
    // Não notifica o usuário sobre erros silenciosos do cron
  }
}

/** Usa Gemini para filtrar apenas os comunicados relevantes/urgentes. */
async function filtrarImportantes(comunicados: Comunicado[]): Promise<Comunicado[]> {
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

  const lista = comunicados
    .map((c, i) => `${i + 1}. Título: ${c.titulo} | Resumo: ${c.resumo}`)
    .join('\n');

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: `Você é um assistente que ajuda um pai a acompanhar a escola do filho Lucas.

Analise estes comunicados escolares e retorne APENAS os índices (números) dos que são importantes ou urgentes para um pai saber:
- Eventos, datas importantes, provas, reuniões de pais
- Avisos urgentes, emergências, mudanças de horário
- Atividades que exigem participação ou material do aluno

Ignore comunicados genéricos, newsletters, propagandas ou informativos rotineiros sem ação necessária.

Comunicados:
${lista}

Retorne apenas os números separados por vírgula (ex: 1,3,5) ou "nenhum" se nenhum for importante.`,
      }],
    }],
  });

  const resposta = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'nenhum';
  console.log('cron escola: Gemini avaliou como importantes:', resposta);

  if (resposta.toLowerCase() === 'nenhum') return [];

  const indices = resposta
    .split(',')
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < comunicados.length);

  return indices.map((i) => comunicados[i]);
}
