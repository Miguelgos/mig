import puppeteer, { type Browser } from 'puppeteer-core';

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

/** Retorna o caminho do Chromium disponível no ambiente. */
function getChromiumPath(): string {
  // Railway/Linux (instalado via nixpacks)
  const candidates = [
    '/run/current-system/sw/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/nix/var/nix/profiles/default/bin/chromium',
  ];

  for (const path of candidates) {
    try {
      require('fs').accessSync(path);
      return path;
    } catch {
      continue;
    }
  }

  // Desenvolvimento local no WSL — tenta o Chrome do Windows
  return '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
}

/** Lança um browser headless e faz login na plataforma Layers. */
async function launchAndLogin(): Promise<Browser> {
  const executablePath = getChromiumPath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Preenche email
    await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', { timeout: 10000 });
    await page.type('input[type="email"], input[name="email"], input[placeholder*="email" i]', EMAIL, { delay: 50 });

    // Clica em continuar / próximo (alguns fluxos têm duas etapas)
    const btnContinue = await page.$('button[type="submit"], button:not([disabled])');
    if (btnContinue) await btnContinue.click();

    // Aguarda campo de senha aparecer
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.type('input[type="password"]', SENHA, { delay: 50 });

    // Submete login
    await page.click('button[type="submit"]');

    // Aguarda navegação para o portal
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    console.log('escola: login realizado com sucesso');
  } catch (err) {
    await browser.close();
    throw err;
  }

  return browser;
}

/** Busca os comunicados mais recentes do inbox. */
export async function buscarComunicados(limite = 5): Promise<Comunicado[]> {
  if (!EMAIL || !SENHA) {
    throw new Error('ESCOLA_EMAIL e ESCOLA_SENHA não configurados.');
  }

  let browser: Browser | null = null;

  try {
    browser = await launchAndLogin();
    const pages = await browser.pages();
    const page = pages[pages.length - 1];

    // Aguarda a lista de comunicados carregar
    await page.waitForSelector(
      '[class*="comunicado"], [class*="message"], [class*="feed"], article, [class*="card"]',
      { timeout: 20000 }
    );

    // Tira screenshot para debug (salva localmente)
    await page.screenshot({ path: '/tmp/escola_debug.png', fullPage: false });

    // Usa Gemini Vision para extrair os comunicados da tela
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const comunicados = await extrairComImagemGemini(screenshot as string);

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
            inlineData: {
              mimeType: 'image/png',
              data: imageBase64,
            },
          },
          {
            text: `Esta é uma tela de comunicados escolares. Extraia todos os comunicados visíveis e retorne um JSON válido no formato:
[
  {
    "titulo": "Título do comunicado",
    "autor": "Nome do autor ou escola",
    "data": "Data se visível, ou vazio",
    "resumo": "Resumo do conteúdo"
  }
]
Retorne APENAS o JSON, sem markdown, sem explicação.`,
          },
        ],
      },
    ],
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

  try {
    const parsed = JSON.parse(text.trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('escola: falha ao parsear JSON do Gemini:', text.slice(0, 200));
    return [];
  }
}
