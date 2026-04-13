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
}

/** Localiza o Chromium disponível no ambiente, inclusive no Nix store do Railway. */
function getChromiumPath(): string {
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
    'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
  );

  try {
    console.log('escola: abrindo página de login...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 40000 });

    // Aguarda campo de email (pode demorar se carregamento é lento)
    const emailSelector = 'input[type="email"], input[name="email"], input[autocomplete="email"]';
    await page.waitForSelector(emailSelector, { timeout: 15000 });
    await page.type(emailSelector, EMAIL, { delay: 60 });

    console.log('escola: email preenchido, clicando em continuar...');

    // Alguns flows pedem email → botão → senha
    const btn = await page.$('button[type="submit"]');
    if (btn) await btn.click();

    // Aguarda senha
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    await page.type('input[type="password"]', SENHA, { delay: 60 });

    console.log('escola: senha preenchida, submetendo...');
    await page.click('button[type="submit"]');

    // Aguarda carregamento do portal
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 }).catch(() => {
      // Alguns SPAs não disparam navigation — aguarda um tempo fixo
      return new Promise((r) => setTimeout(r, 5000));
    });

    console.log('escola: login concluído, URL atual:', page.url());
  } catch (err) {
    // Tira screenshot de debug antes de fechar
    await page.screenshot({ path: '/tmp/escola_erro.png' }).catch(() => {});
    await browser.close();
    throw err;
  }

  return { browser, page };
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

    return comunicados.slice(0, limite);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('escola buscarComunicados:', message);
    throw new Error(`Falha ao buscar comunicados: ${message}`);
  } finally {
    if (browser) await browser.close();
  }
}

/** Usa Gemini Vision para extrair comunicados de um screenshot em base64. */
async function extrairComImagemGemini(imageBase64: string): Promise<Comunicado[]> {
  const { GoogleGenAI } = await import('@google/genai');
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

  const response = await genai.models.generateContent({
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
  });

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
