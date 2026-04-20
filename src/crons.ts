import cron from 'node-cron';
import { createHash } from 'crypto';
import { sendMessage } from './services/telegram';
import { consultarPontuacao, statusMercado } from './services/cartola';
import { buscarComunicados, type Comunicado } from './services/escola';
import { enviarAgenda } from './services/email';
import { consultarSaldo } from './services/eatsimple';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './db';

/** Identificador estável de um comunicado para dedup persistente. */
function fingerprintComunicado(c: Comunicado): string {
  const base = `${c.titulo}|${c.autor}|${c.data}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(base).digest('hex');
}

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

  // Seg a sex às 6:30: saldo da lanchonete do Lucas (Eat Simple)
  cron.schedule(
    '30 6 * * 1-5',
    async () => {
      console.log('cron: consultando saldo da lanchonete...');
      try {
        const s = await consultarSaldo();
        await sendMessage(
          `🍔 *Lanchonete da escola — ${s.aluno}*\n\n` +
            `💰 Saldo: *${s.saldo}*\n` +
            `🕕 Consultado em ${s.atualizadoEm}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('cron lanchonete:', message);
      }
    },
    { timezone: 'America/Sao_Paulo' }
  );


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

    // Filtra comunicados já enviados em execuções anteriores
    const candidatos = importantes.map((c) => ({ c, fp: fingerprintComunicado(c) }));
    const jaEnviados = await prisma.sentEscola.findMany({
      where: { fingerprint: { in: candidatos.map((x) => x.fp) } },
      select: { fingerprint: true },
    });
    const enviadosSet = new Set(jaEnviados.map((r) => r.fingerprint));
    const novos = candidatos.filter((x) => !enviadosSet.has(x.fp));

    if (novos.length === 0) {
      console.log(`cron escola: todos os ${importantes.length} comunicado(s) importantes já foram enviados.`);
      return;
    }

    // Monta e envia a notificação no Telegram com os detalhes abertos
    let msg = `🏫 *Comunicados da escola do Lucas*\n\n`;
    for (const { c } of novos) {
      msg += `📌 *${c.titulo}*\n`;
      if (c.autor) msg += `👤 ${c.autor}\n`;
      if (c.data) msg += `📅 ${c.data}\n`;
      const corpo = c.detalhes || c.resumo;
      if (corpo) msg += `\n${corpo}\n`;
      msg += '\n';
    }

    await sendMessage(msg.trim());
    console.log(`cron escola: ${novos.length} comunicado(s) novo(s) enviado(s).`);

    // Envia agenda por e-mail para comunicados com data
    const comData = novos.map((x) => x.c).filter((c) => c.data);
    if (comData.length > 0) {
      const enviados = await enviarAgenda(comData).catch((err) => {
        console.error('cron escola email:', err instanceof Error ? err.message : err);
        return 0;
      });
      if (enviados > 0) {
        await sendMessage(`📅 Agenda com ${enviados} evento${enviados > 1 ? 's' : ''} enviada para miguelgos@live.com`);
      }
    }

    // Marca os comunicados como enviados para não repetir
    await prisma.sentEscola.createMany({
      data: novos.map(({ c, fp }) => ({ fingerprint: fp, titulo: c.titulo })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cron escola:', message);
    // Não notifica o usuário sobre erros silenciosos do cron
  }
}

/** Usa Claude para filtrar apenas os comunicados relevantes/urgentes. */
export async function filtrarImportantesExport(comunicados: Comunicado[]): Promise<Comunicado[]> {
  return filtrarImportantes(comunicados);
}

async function filtrarImportantes(comunicados: Comunicado[]): Promise<Comunicado[]> {
  const anthropic = new Anthropic();

  const lista = comunicados
    .map((c, i) => `${i + 1}. Título: ${c.titulo} | Resumo: ${c.resumo}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Você é um assistente que ajuda um pai a acompanhar a escola do filho Lucas.

Analise estes comunicados escolares e retorne APENAS os índices (números) dos que são importantes ou urgentes para um pai saber:
- Eventos, datas importantes, provas, reuniões de pais
- Avisos urgentes, emergências, mudanças de horário
- Atividades que exigem participação ou material do aluno

Ignore comunicados genéricos, newsletters, propagandas ou informativos rotineiros sem ação necessária.

Comunicados:
${lista}

Retorne apenas os números separados por vírgula (ex: 1,3,5) ou "nenhum" se nenhum for importante.`,
      },
    ],
  });

  const bloco = response.content.find((b) => b.type === 'text');
  const resposta = (bloco?.type === 'text' ? bloco.text : 'nenhum').trim();
  console.log('cron escola: Claude avaliou como importantes:', resposta);

  if (resposta.toLowerCase() === 'nenhum') return [];

  const indices = resposta
    .split(',')
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < comunicados.length);

  return indices.map((i) => comunicados[i]);
}
