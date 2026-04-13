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
    console.log('cartola: usando cookie em cache');
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

    // Navega ao Cartola e segue o redirect natural para o Globo ID
    console.log('cartola: abrindo cartola.globo.com para seguir redirect de login...');
    await page.goto(CARTOLA_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('cartola: URL após goto cartola:', page.url());

    // Se ainda estiver no cartola (usuário já logado ou sem redirect), força login
    if (page.url().includes('cartola.globo.com') && !page.url().includes('login')) {
      console.log('cartola: não redirecionou para login, tentando URL direta...');
      await page.goto('https://login.globo.com/login/43', { waitUntil: 'networkidle2', timeout: 30000 });
      console.log('cartola: URL após goto login direto:', page.url());
    }

    // Aguarda QUALQUER input aparecer (a SPA do Globo pode demorar para renderizar)
    await page.waitForSelector('input', { timeout: 20000 });
    console.log('cartola: URL quando inputs apareceram:', page.url());

    // Debug: loga todos os inputs para diagnóstico (roda no contexto do browser)
    const inputsInfo = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      return Array.from(doc.querySelectorAll('input, button')).map((el: any) => ({
        tag: el.tagName,
        type: el.type,
        id: el.id,
        name: el.name,
        placeholder: el.placeholder,
        autocomplete: el.autocomplete,
        text: (el.textContent ?? '').trim().slice(0, 40),
      }));
    });
    console.log('cartola: elementos na página:', JSON.stringify(inputsInfo));

    // Se a página for a de busca do Globo (input id="q"), o redirect não funcionou
    const isSearchPage = inputsInfo.some((el: { id: string }) => el.id === 'q');
    if (isSearchPage) {
      console.log('cartola: detectada página de busca, tentando URL de login /login/43 diretamente...');
      await page.goto('https://login.globo.com/login/43', { waitUntil: 'networkidle2', timeout: 30000 });
      console.log('cartola: URL após fallback para /login/43:', page.url());
      await page.waitForSelector('input', { timeout: 20000 });
    }

    // Tenta seletores em ordem de preferência
    const emailSel = [
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[type="email"]',
      '#login',
      'input[name="login"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[type="text"]',
    ];

    let emailInput: string | null = null;
    for (const sel of emailSel) {
      const el = await page.$(sel);
      if (el) { emailInput = sel; break; }
    }

    if (!emailInput) throw new Error('Campo de email não encontrado na página de login do Globo.');
    console.log('cartola: campo email encontrado com seletor:', emailInput);

    await page.click(emailInput);
    await page.type(emailInput, email, { delay: 50 });

    // Submete email (botão ou Enter)
    const btnContinuar = await page.$('button[type="submit"], #loginButton, input[type="submit"]');
    if (btnContinuar) {
      console.log('cartola: clicando botão continuar');
      await btnContinuar.click();
    } else {
      console.log('cartola: pressionando Enter para continuar');
      await page.keyboard.press('Enter');
    }

    // Aguarda campo de senha
    await page.waitForSelector('#password, input[type="password"]', { timeout: 20000 });
    console.log('cartola: campo senha encontrado');

    await page.type('#password, input[type="password"]', senha, { delay: 50 });

    // Submete senha e aguarda navegação
    console.log('cartola: senha enviada, aguardando redirect...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
        console.log('cartola: timeout aguardando redirect');
      }),
      page.keyboard.press('Enter'),
    ]);

    const urlFinal = page.url();
    console.log('cartola: URL final após login:', urlFinal);

    // Extrai cookies e loga os nomes para diagnóstico
    const cookies = await page.cookies();
    console.log('cartola: cookies capturados (' + cookies.length + '):', cookies.map((c) => c.name).join(', '));

    if (cookies.length === 0) throw new Error('Login falhou: nenhum cookie capturado.');

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

    console.log('cartola: chamando /auth/time...');
    const { data, status } = await axios.get(`${BASE_URL}/auth/time`, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Origin': 'https://cartola.globo.com',
        'Referer': 'https://cartola.globo.com/',
      },
    });
    console.log('cartola: /auth/time status HTTP:', status);

    return {
      rodada: data.time?.rodada_atual ?? 0,
      pontos: data.time?.pontos ?? 0,
      patrimonio: data.time?.patrimonio ?? 0,
      time: data.time?.nome ?? 'Sem nome',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Loga o status HTTP e corpo da resposta se for erro de API
    const axiosErr = err as { response?: { status: number; data: unknown } };
    if (axiosErr?.response) {
      console.error(
        'cartola /auth/time HTTP',
        axiosErr.response.status,
        JSON.stringify(axiosErr.response.data).slice(0, 300)
      );
    }
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
