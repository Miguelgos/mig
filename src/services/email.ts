import nodemailer from 'nodemailer';
import ical, { ICalEventStatus } from 'ical-generator';
import { GoogleGenAI } from '@google/genai';
import type { Comunicado } from './escola';

const EMAIL_USER = process.env.EMAIL_USER ?? '';
const EMAIL_PASS = process.env.EMAIL_PASS ?? '';
const EMAIL_DESTINO = process.env.EMAIL_DESTINO ?? 'miguelgos@live.com';

/** Transportador Outlook/Live.com via SMTP */
function criarTransporte() {
  return nodemailer.createTransport({
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { ciphers: 'SSLv3' },
  });
}

export interface EventoAgenda {
  titulo: string;
  descricao: string;
  dataInicio: Date;
  dataFim: Date;
}

/**
 * Usa Gemini para extrair data/hora de um comunicado em linguagem natural.
 * Retorna null se não encontrar data válida.
 */
async function extrairData(comunicado: Comunicado): Promise<Date | null> {
  if (!comunicado.data && !comunicado.resumo) return null;

  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
  const hoje = new Date().toLocaleDateString('pt-BR');

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: `Hoje é ${hoje}. Extraia a data do evento deste comunicado escolar e retorne APENAS no formato ISO 8601 (ex: 2026-04-15T10:00:00).
Se não houver hora, use 08:00:00.
Se não houver data clara, retorne "null".

Comunicado:
Título: ${comunicado.titulo}
Data informada: ${comunicado.data}
Resumo: ${comunicado.resumo}

Retorne apenas a data ISO ou "null":`,
      }],
    }],
  });

  const texto = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? 'null';
  if (texto === 'null' || !texto) return null;

  try {
    const data = new Date(texto);
    if (isNaN(data.getTime())) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Envia um e-mail com agenda (.ics) para os comunicados com datas.
 * Retorna a quantidade de eventos enviados.
 */
export async function enviarAgenda(comunicados: Comunicado[]): Promise<number> {
  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error('EMAIL_USER e EMAIL_PASS não configurados.');
  }

  // Extrai datas de todos os comunicados em paralelo
  const resultados = await Promise.all(
    comunicados.map(async (c) => ({ comunicado: c, data: await extrairData(c) }))
  );

  const comData = resultados.filter((r) => r.data !== null) as {
    comunicado: Comunicado;
    data: Date;
  }[];

  if (comData.length === 0) return 0;

  // Cria o arquivo .ics com todos os eventos
  const calendario = ical({ name: 'Escola do Lucas — Comunicados' });

  for (const item of comData) {
    const inicio = item.data;
    const fim = new Date(inicio.getTime() + 60 * 60 * 1000); // +1h

    calendario.createEvent({
      start: inicio,
      end: fim,
      summary: `🏫 ${item.comunicado.titulo}`,
      description: item.comunicado.resumo || item.comunicado.titulo,
      status: ICalEventStatus.CONFIRMED,
      organizer: { name: 'Mig', email: EMAIL_USER },
    });
  }

  const icsContent = calendario.toString();

  // Monta o e-mail
  const transporte = criarTransporte();
  const nomes = comData.map((r) => r.comunicado.titulo).join(', ');

  await transporte.sendMail({
    from: `"Mig — Assistente" <${EMAIL_USER}>`,
    to: EMAIL_DESTINO,
    subject: `🏫 Agenda da escola do Lucas (${comData.length} evento${comData.length > 1 ? 's' : ''})`,
    text: `Olá Miguel,\n\nSeguem os eventos da escola do Lucas:\n\n${comData
      .map((r) => `• ${r.comunicado.titulo} — ${r.data.toLocaleDateString('pt-BR')}`)
      .join('\n')}\n\nO arquivo .ics em anexo pode ser importado no seu calendário.\n\nMig`,
    html: `<p>Olá Miguel,</p>
<p>Seguem os eventos da escola do Lucas:</p>
<ul>
${comData.map((r) => `<li><strong>${r.comunicado.titulo}</strong> — ${r.data.toLocaleDateString('pt-BR')}</li>`).join('\n')}
</ul>
<p>O arquivo .ics em anexo pode ser importado no seu calendário.</p>
<p><em>Mig</em></p>`,
    attachments: [
      {
        filename: 'escola-lucas.ics',
        content: icsContent,
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      },
    ],
  });

  console.log(`email: agenda enviada com ${comData.length} evento(s) para ${EMAIL_DESTINO}`);
  return comData.length;
}
