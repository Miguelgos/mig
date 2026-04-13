import axios from 'axios';
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

const BASE_URL = 'https://api.cartola.globo.com';
const CARTOLA_LOGIN_URL = 'https://cartola.globo.com';

// Esquema tático fixo
const SCHEME: Record<string, number> = {
  gol: 1,
  lat: 2,
  zag: 2,
  mei: 3,
  ata: 3,
};

const POSITION_MAP: Record<number, string> = {
  1: 'gol',
  2: 'lat',
  3: 'zag',
  4: 'mei',
  5: 'ata',
  6: 'tec',
};

interface Athlete {
  atleta_id: number;
  apelido: string;
  clube_id: number;
  posicao_id: number;
  status_id: number;
  preco_num: number;
  media_num: number;
  pontos_num: number;
}

interface MarketResponse {
  atletas: Athlete[];
  clubes: Record<string, { nome: string; abreviacao: string }>;
  rodada_atual: number;
  mercado_status: { id: number; nome: string };
}

interface SuggestedPlayer {
  id: number;
  nome: string;
  clube: string;
  posicao: string;
  preco: number;
  media: number;
}

interface SuggestedTeam {
  rodada: number;
  orcamento: number;
  custoTotal: number;
  jogadores: SuggestedPlayer[];
  mensagem?: string;
}

interface MarketStatus {
  rodada: number;
  status: string;
  aberto: boolean;
}

/** Reutiliza a lógica de detecção de Chromium da integração da escola. */
function getChromiumPath(): string {
  try {
    const path = execSync(
      'which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().split('\n')[0];
    if (path) return path;
  } catch { /* continua */ }

  try {
    const nixPath = execSync(
      'find /nix/store -maxdepth 3 -name "chromium" -path "*/bin/chromium" 2>/dev/null | head -1',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (nixPath) return nixPath;
  } catch { /* continua */ }

  const fs = require('fs') as typeof import('fs');
  for (const p of [
    '/run/current-system/sw/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ]) {
    try { fs.accessSync(p); return p; } catch { /* continua */ }
  }

  throw new Error('Chromium não encontrado.');
}

/**
 * Faz login no Cartola via Puppeteer e retorna os cookies de sessão.
 * Armazena em cache para evitar login repetido.
 */
let cookieCache: { cookies: string; expiry: number } | null = null;

async function loginViaPuppeteer(): Promise<string> {
  // Reusa o cookie por até 30 minutos
  if (cookieCache && Date.now() < cookieCache.expiry) {
    return cookieCache.cookies;
  }

  const email = process.env.CARTOLA_EMAIL;
  const senha = process.env.CARTOLA_SENHA;
  if (!email || !senha) throw new Error('CARTOLA_EMAIL e CARTOLA_SENHA não configurados.');

  console.log('cartola: iniciando login via Puppeteer...');

  const browser = await puppeteer.launch({
    executablePath: getChromiumPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Abre o Cartola — vai redirecionar para login do Globo
    await page.goto(CARTOLA_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Clica em "Entrar" se existir
    const btnEntrar = await page.$('a[href*="login"], button[data-testid*="login"], a[class*="login"], .header-login');
    if (btnEntrar) {
      await btnEntrar.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    }

    // Aguarda campo de email
    const emailSel = 'input[type="email"], input[name="email"], input[id="login"]';
    await page.waitForSelector(emailSel, { timeout: 15000 });

    // Verifica se senha já está visível
    const senhaJaVisivel = await page.$('input[type="password"]');

    await page.click(emailSel);
    await page.type(emailSel, email, { delay: 60 });
    console.log('cartola: email preenchido');

    if (senhaJaVisivel) {
      await page.type('input[type="password"]', senha, { delay: 60 });
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Enter');
      await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      await page.type('input[type="password"]', senha, { delay: 60 });
      await page.keyboard.press('Enter');
    }

    // Aguarda redirecionamento de volta ao Cartola
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
      .catch(() => new Promise((r) => setTimeout(r, 5000)));

    console.log('cartola: login concluído, URL:', page.url());

    // Extrai todos os cookies e formata para o header
    const cookies = await page.cookies();
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // Cache por 30 minutos
    cookieCache = { cookies: cookieStr, expiry: Date.now() + 30 * 60 * 1000 };
    return cookieStr;
  } finally {
    await browser.close();
  }
}

/** Sugere um time dentro do orçamento usando jogadores prováveis (status_id 7). */
export async function sugerirTime(orcamento = 100): Promise<SuggestedTeam> {
  try {
    const { data } = await axios.get<MarketResponse>(`${BASE_URL}/atletas/mercado`);
    const clubs = data.clubes;

    const provaveis = data.atletas.filter(
      (a) => a.status_id === 7 && POSITION_MAP[a.posicao_id] !== 'tec'
    );

    const byPosition: Record<string, Athlete[]> = { gol: [], lat: [], zag: [], mei: [], ata: [] };

    for (const a of provaveis) {
      const pos = POSITION_MAP[a.posicao_id];
      if (pos && pos in byPosition) byPosition[pos].push(a);
    }

    for (const pos of Object.keys(byPosition)) {
      byPosition[pos].sort((a, b) => b.media_num - a.media_num);
    }

    const selected: SuggestedPlayer[] = [];
    let custoTotal = 0;
    let orcamentoRestante = orcamento;

    for (const [pos, count] of Object.entries(SCHEME)) {
      let adicionados = 0;
      for (const athlete of byPosition[pos]) {
        if (adicionados >= count) break;
        if (athlete.preco_num > orcamentoRestante) continue;

        const clube = clubs[String(athlete.clube_id)];
        selected.push({
          id: athlete.atleta_id,
          nome: athlete.apelido,
          clube: clube?.abreviacao ?? `Clube ${athlete.clube_id}`,
          posicao: pos.toUpperCase(),
          preco: athlete.preco_num,
          media: athlete.media_num,
        });

        orcamentoRestante -= athlete.preco_num;
        custoTotal += athlete.preco_num;
        adicionados++;
      }
    }

    return {
      rodada: data.rodada_atual,
      orcamento,
      custoTotal: Math.round(custoTotal * 100) / 100,
      jogadores: selected,
      mensagem:
        selected.length < 11
          ? `Atenção: apenas ${selected.length} jogadores encontrados dentro do orçamento de C$ ${orcamento}.`
          : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cartola sugerirTime:', message);
    throw new Error(`Falha ao sugerir time: ${message}`);
  }
}

/** Consulta a pontuação do time do usuário via Puppeteer (login com CAPTCHA). */
export async function consultarPontuacao(): Promise<{
  rodada: number;
  pontos: number;
  patrimonio: number;
  time: string;
}> {
  try {
    const cookies = await loginViaPuppeteer();

    const { data } = await axios.get(`${BASE_URL}/auth/time`, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Origin': 'https://cartola.globo.com',
        'Referer': 'https://cartola.globo.com/',
      },
    });

    return {
      rodada: data.time?.rodada_atual ?? 0,
      pontos: data.time?.pontos ?? 0,
      patrimonio: data.time?.patrimonio ?? 0,
      time: data.time?.nome ?? 'Sem nome',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cartola consultarPontuacao:', message);
    // Limpa cache se falhar para tentar novo login na próxima chamada
    cookieCache = null;
    throw new Error(`Falha ao consultar pontuação: ${message}`);
  }
}

/** Verifica o status do mercado e rodada atual. */
export async function statusMercado(): Promise<MarketStatus> {
  try {
    const { data } = await axios.get<{ rodada: { rodada_atual: number }; status_mercado: { id: number; nome: string } }>(
      `${BASE_URL}/mercado/status`
    );

    return {
      rodada: data.rodada?.rodada_atual ?? 0,
      status: data.status_mercado?.nome ?? 'Desconhecido',
      aberto: data.status_mercado?.id === 1,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cartola statusMercado:', message);
    throw new Error(`Falha ao verificar status do mercado: ${message}`);
  }
}
