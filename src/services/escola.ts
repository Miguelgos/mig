import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { execSync } from 'child_process';

const LOGIN_URL =
  'https://id.layers.digital/?context=web&community=morumbisul&location=%2Fportal%2F%40admin%3Alayers-comunicados%2Ffeed%2Finbox';

const EMAIL = process.env.ESCOLA_EMAIL ?? '';
const SENHA = process.env.ESCOLA_SENHA ?? '';

export interface Comunicado {
  titulo: string;
  autor: string;
  data: string;
  resumo: string;
  detalhes?: string;
}

/** Localiza o Chromium disponível no ambiente, inclusive no Nix store do Railway. */
export function getChromiumPath(): string {
  // 1. Tenta via PATH (Railway nixpacks instala o chromium no PATH)
  try {
    const path = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')[0];
    if (path) {
      console.log('escola: Chromium encontrado via PATH:', path);
      return path;
    }
  } catch {
    // continua
  }

  // 2. Tenta encontrar no Nix store (formato /nix/store/HASH-chromium-VERSION/bin/chromium)
  try {
    const nixPath = execSync(
      'find /nix/store -maxdepth 3 -name "chromium" -path "*/bin/chromium" 2>/dev/null | head -1',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (nixPath) {
      console.log('escola: Chromium encontrado no Nix store:', nixPath);
      return nixPath;
    }
  } catch {
    // continua
  }

  // 3. Candidatos fixos
  const candidates = [
    '/run/current-system/sw/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/nix/var/nix/profiles/default/bin/chromium',
  ];

  const fs = require('fs') as typeof import('fs');
  for (const p of candidates) {
    try {
      fs.accessSync(p);
      console.log('escola: Chromium encontrado em', p);
      return p;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Chromium não encontrado. Instale o Chrome/Chromium ou configure o nixpacks.toml.'
  );
}

/** Lança browser headless e faz login na plataforma Layers. */
async function launchAndLogin(): Promise<{ browser: Browser; page: Page }> {
  const executablePath = getChromiumPath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--window-size=1280,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  try {
    console.log('escola: abrindo página de login...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 40000 });
    console.log('escola: URL após carregamento:', page.url());

    // Screenshot do estado inicial para debug
    const ss0 = await page.screenshot({ encoding: 'base64' }) as string;
    const estado0 = await descreverPagina(ss0);
    console.log('escola: estado inicial:', estado0);

    // Aguarda campo de email
    const emailSelector = 'input[type="email"], input[name="email"], input[autocomplete="email"], input[placeholder*="email" i], input[placeholder*="e-mail" i]';
    await page.waitForSelector(emailSelector, { timeout: 15000 });

    // Verifica se senha já está visível na mesma tela (formulário único)
    const senhaVisivel = await page.$('input[type="password"]');

    await page.click(emailSelector);
    await page.type(emailSelector, EMAIL, { delay: 60 });
    console.log('escola: email preenchido');

    if (senhaVisivel) {
      // Formulário único: preenche tudo e submete
      console.log('escola: formulário único detectado');
      await page.type('input[type="password"]', SENHA, { delay: 60 });
      await page.click('button[type="submit"]');
    } else {
      // Formulário em duas etapas: submete email, aguarda campo de senha
      console.log('escola: formulário em duas etapas, submetendo email...');
      await page.keyboard.press('Enter');

      // Aguarda até 15s para senha aparecer
      const apareceu = await page.waitForSelector('input[type="password"]', { timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (!apareceu) {
        const ss1 = await page.screenshot({ encoding: 'base64' }) as string;
        const estado1 = await descreverPagina(ss1);
        console.log('escola: campo de senha não apareceu. Estado da página:', estado1);
        throw new Error(`Campo de senha não apareceu. Estado: ${estado1}`);
      }

      await page.type('input[type="password"]', SENHA, { delay: 60 });
      await page.keyboard.press('Enter');
    }

    console.log('escola: aguardando redirecionamento pós-login...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 })
      .catch(() => new Promise((r) => setTimeout(r, 6000)));

    console.log('escola: login concluído. URL:', page.url());
  } catch (err) {
    await page.screenshot({ path: '/tmp/escola_erro.png' }).catch(() => {});
    await browser.close();
    throw err;
  }

  return { browser, page };
}

/** Retry com backoff exponencial para erros transitórios do Gemini (503/429). */
export async function geminiRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let delay = 3000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (isTransient && attempt < maxAttempts) {
        console.log(`escola: Gemini erro transitório (tentativa ${attempt}/${maxAttempts}), aguardando ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30000);
      } else {
        throw err;
      }
    }
  }
  throw new Error('geminiRetry: máximo de tentativas excedido');
}

/** Pede ao Gemini para descrever brevemente o estado da página (para debug). */
async function descreverPagina(imageBase64: string): Promise<string> {
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
    const r = await geminiRetry(() => genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: imageBase64 } },
          { text: 'Descreva em 1 frase o que está sendo exibido nesta tela (ex: formulário de login com campo de email, lista de comunicados, erro, etc).' },
        ],
      }],
    }));
    return r.candidates?.[0]?.content?.parts?.[0]?.text ?? 'desconhecido';
  } catch {
    return 'não foi possível descrever';
  }
}

/** Busca os comunicados mais recentes do inbox. */
export async function buscarComunicados(limite = 5): Promise<Comunicado[]> {
  if (!EMAIL || !SENHA) {
    throw new Error('ESCOLA_EMAIL e ESCOLA_SENHA não configurados nas variáveis de ambiente.');
  }

  let browser: Browser | null = null;

  try {
    const result = await launchAndLogin();
    browser = result.browser;
    const page = result.page;

    // Aguarda qualquer conteúdo da lista de comunicados
    console.log('escola: aguardando lista de comunicados...');
    await Promise.race([
      page.waitForSelector('[class*="feed"], [class*="inbox"], [class*="message"], article, [class*="card"], [class*="item"]', { timeout: 20000 }),
      new Promise((r) => setTimeout(r, 12000)), // fallback após 12s
    ]);

    // Screenshot da página para Gemini Vision extrair o conteúdo
    console.log('escola: capturando screenshot...');
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    const comunicados = await extrairComImagemGemini(screenshot as string);
    console.log(`escola: ${comunicados.length} comunicado(s) extraído(s)`);

    const alvo = comunicados.slice(0, limite);

    // Para cada comunicado, abre o item e extrai os detalhes completos
    for (const c of alvo) {
      try {
        const detalhes = await extrairDetalhesDoComunicado(page, c.titulo);
        if (detalhes) c.detalhes = detalhes;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`escola: falha ao abrir detalhes de "${c.titulo}":`, msg);
      }
    }

    return alvo;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('escola buscarComunicados:', message);
    throw new Error(`Falha ao buscar comunicados: ${message}`);
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Abre um comunicado específico (clicando pelo título), captura a tela detalhada
 * e usa Gemini Vision para extrair o conteúdo completo. Retorna string vazia se falhar.
 */
async function extrairDetalhesDoComunicado(page: Page, titulo: string): Promise<string> {
  const tituloNormalizado = titulo.trim();
  if (!tituloNormalizado) return '';

  // Busca e clica no elemento visível que contém o título
  const clicado = await page.evaluate((alvo: string) => {
    const g = globalThis as unknown as {
      document: { querySelectorAll: (s: string) => ArrayLike<unknown> };
    };
    const trecho = alvo.slice(0, Math.min(40, alvo.length)).toLowerCase();
    const candidatos = Array.from(g.document.querySelectorAll('button, a, [role="button"], li, article, div')) as unknown[];
    for (const raw of candidatos) {
      const el = raw as {
        textContent: string | null;
        getBoundingClientRect: () => { width: number; height: number };
        click: () => void;
      };
      const texto = (el.textContent ?? '').trim().toLowerCase();
      if (!texto || texto.length > 500) continue;
      if (!texto.includes(trecho)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      el.click();
      return true;
    }
    return false;
  }, tituloNormalizado);

  if (!clicado) {
    console.log(`escola: não encontrou elemento clicável para "${tituloNormalizado.slice(0, 40)}"`);
    return '';
  }

  // Aguarda renderização do detalhe (SPA) e estabiliza
  await new Promise((r) => setTimeout(r, 2500));

  const screenshot = (await page.screenshot({ encoding: 'base64', fullPage: true })) as string;

  const { GoogleGenAI } = await import('@google/genai');
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

  const response = await geminiRetry(() =>
    genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: screenshot } },
            {
              text: `Esta é a tela de um comunicado escolar aberto. Extraia o conteúdo completo do comunicado em texto corrido: corpo da mensagem, datas, horários, o que fazer, material necessário, links visíveis. Ignore menus, cabeçalhos e barras laterais. Responda em português, sem markdown, em até 800 caracteres. Se a tela não mostrar um comunicado aberto, responda com a string vazia.`,
            },
          ],
        },
      ],
    })
  );

  const texto = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

  // Tenta voltar para a lista: back do navegador, depois tecla Escape como fallback
  await page.goBack({ waitUntil: 'networkidle2', timeout: 8000 }).catch(async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  });

  return texto;
}

/** Usa Gemini Vision para extrair comunicados de um screenshot em base64. */
async function extrairComImagemGemini(imageBase64: string): Promise<Comunicado[]> {
  const { GoogleGenAI } = await import('@google/genai');
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

  const response = await geminiRetry(() => genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: { mimeType: 'image/png', data: imageBase64 },
          },
          {
            text: `Esta é uma tela de comunicados escolares. Extraia todos os comunicados ou avisos visíveis e retorne um JSON válido:
[
  {
    "titulo": "Título do comunicado",
    "autor": "Autor ou escola",
    "data": "Data se visível, senão vazio",
    "resumo": "Resumo do conteúdo visível"
  }
]
Se a tela mostrar login ou erro, retorne [].
Retorne APENAS o JSON, sem markdown.`,
          },
        ],
      },
    ],
  }));

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  const clean = text.replace(/```json\n?|\n?```/g, '').trim();

  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('escola: falha ao parsear JSON do Gemini:', clean.slice(0, 300));
    return [];
  }
}
