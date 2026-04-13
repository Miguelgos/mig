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

    // Intercepta navegações para diagnóstico — revela para onde o botão "Entrar" redireciona
    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        console.log('cartola: navegação →', req.url().slice(0, 120));
      }
    });

    // 1. Navega ao Cartola (aterrissa em #!/antessala sem redirecionar para login)
    console.log('cartola: navegando para cartola.globo.com...');
    await page.goto(CARTOLA_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('cartola: URL atual:', page.url());

    // 2. Loga todos os links/botões para diagnóstico
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageLinks = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(doc.querySelectorAll('a, button, [role="button"]')).map((el: any) => ({
        tag: el.tagName,
        text: (el.textContent ?? '').trim().slice(0, 50),
        href: el.href ?? '',
        id: el.id ?? '',
        cls: (el.className ?? '').toString().slice(0, 60),
      }));
    });
    console.log('cartola: links/botões na página:', JSON.stringify(pageLinks));

    // 3. Tenta obter o href do botão de login para navegar diretamente
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loginHref = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const links = Array.from(doc.querySelectorAll('a')) as any[];
      const found = links.find((el: any) =>
        /entrar|login|sign.?in/i.test((el.textContent ?? '') + el.href)
      );
      return found?.href ?? null;
    });

    if (loginHref && !loginHref.includes('cartola.globo.com')) {
      // Link externo de login encontrado — navega direto
      console.log('cartola: link de login encontrado:', loginHref.slice(0, 120));
      await page.goto(loginHref, { waitUntil: 'networkidle2', timeout: 30000 });
    } else {
      // Tenta clicar em botão/link pelo texto "Entrar" ou "Login"
      const loginSelectors = [
        'a[href*="login"]',
        'a[href*="entrar"]',
        'a[href*="signin"]',
        'button[class*="login"]',
        'button[class*="entrar"]',
        '[data-action*="login"]',
      ];

      let clicked = false;
      for (const sel of loginSelectors) {
        const el = await page.$(sel);
        if (el) {
          console.log('cartola: clicando login com seletor:', sel);
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
              console.log('cartola: timeout aguardando redirect de login');
            }),
            el.click(),
          ]);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        // Último recurso: login.globo.com sem service ID (endpoint base)
        console.log('cartola: botão de login não encontrado, tentando login.globo.com...');
        await page.goto('https://login.globo.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      }
    }

    console.log('cartola: URL após navegar para login:', page.url());

    // 4. Dump HTML da página de login para diagnóstico
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const htmlSnippet = await page.evaluate(() => (globalThis as any).document.documentElement.outerHTML.slice(0, 3000));
    console.log('cartola: HTML login (primeiros 3000 chars):', htmlSnippet);

    // 5. Aguarda inputs da página de login Conta Globo (authx.globoid.globo.com)
    await page.waitForSelector('input', { timeout: 15000 }).catch(() => {
      console.log('cartola: sem inputs após 15s');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputsInfo = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    console.log('cartola: inputs/botões na página de login:', JSON.stringify(inputsInfo));

    // 6. Passo 1 do Conta Globo: preenche e-mail e clica "Continuar"
    // A página usa fluxo em dois passos: e-mail primeiro, depois senha (SPA — sem reload entre os passos)
    const emailSels = [
      'input[type="email"]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      '#login',
      'input[name="login"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[type="text"]',
    ];

    let emailInput: string | null = null;
    for (const sel of emailSels) {
      const el = await page.$(sel);
      if (el) { emailInput = sel; break; }
    }

    if (!emailInput) throw new Error('Campo de email não encontrado na página Conta Globo (authx.globoid.globo.com).');
    console.log('cartola: campo email encontrado com seletor:', emailInput);

    await page.click(emailInput);
    await page.type(emailInput, email, { delay: 50 });

    // Clica "Continuar" — NÃO aguarda navegação: o SPA troca o formulário sem recarregar
    const btnContinuar = await page.$('button[type="submit"]');
    if (btnContinuar) {
      console.log('cartola: clicando Continuar');
      await btnContinuar.click();
    } else {
      console.log('cartola: pressionando Enter no campo de email');
      await page.keyboard.press('Enter');
    }

    // 7. Passo 2: aguarda campo de senha aparecer (mesmo domínio, DOM atualizado pelo SPA)
    console.log('cartola: aguardando campo de senha...');
    await page.waitForSelector('input[type="password"]', { timeout: 20000 });
    console.log('cartola: campo senha encontrado');

    await page.type('input[type="password"]', senha, { delay: 50 });

    // Clica "Entrar" e aguarda redirect de volta para o Cartola
    console.log('cartola: senha enviada, aguardando redirect para cartola.globo.com...');
    const btnEntrar = await page.$('button[type="submit"]');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
        console.log('cartola: timeout aguardando redirect');
      }),
      btnEntrar ? btnEntrar.click() : page.keyboard.press('Enter'),
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
