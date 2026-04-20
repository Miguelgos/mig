import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import Anthropic from '@anthropic-ai/sdk';
import { getChromiumPath, anthropicRetry } from './escola';

const VISION_MODEL = 'claude-sonnet-4-6';
const anthropic = new Anthropic();

const LOGIN_URL = 'https://www.eatsimple.com.br/login';

const EMAIL = process.env.ESCOLA_EMAIL ?? '';
const SENHA = process.env.ESCOLA_SENHA ?? '';

export interface SaldoLanchonete {
  aluno: string;
  saldo: string;
  atualizadoEm: string;
}

/** Faz login no portal Eat Simple com email/senha da escola. */
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
    console.log('eatsimple: abrindo página de login...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 40000 });

    const emailSelector =
      'input[type="email"], input[name="email"], input[autocomplete="email"], input[placeholder*="email" i], input[placeholder*="e-mail" i]';
    await page.waitForSelector(emailSelector, { timeout: 15000 });

    await page.click(emailSelector);
    await page.type(emailSelector, EMAIL, { delay: 60 });

    // Se a senha já está visível, preenche e submete; senão avança (form em etapas)
    const senhaVisivel = await page.$('input[type="password"]');
    if (senhaVisivel) {
      await page.type('input[type="password"]', SENHA, { delay: 60 });
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Enter');
      const apareceu = await page
        .waitForSelector('input[type="password"]', { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!apareceu) throw new Error('Campo de senha não apareceu após submeter email.');
      await page.type('input[type="password"]', SENHA, { delay: 60 });
      await page.keyboard.press('Enter');
    }

    console.log('eatsimple: aguardando redirecionamento pós-login...');
    await page
      .waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 })
      .catch(() => new Promise((r) => setTimeout(r, 6000)));

    console.log('eatsimple: login concluído. URL:', page.url());
  } catch (err) {
    await page.screenshot({ path: '/tmp/eatsimple_erro.png' }).catch(() => {});
    await browser.close();
    throw err;
  }

  return { browser, page };
}

/** Consulta o saldo da lanchonete do Lucas no portal Eat Simple. */
export async function consultarSaldo(): Promise<SaldoLanchonete> {
  if (!EMAIL || !SENHA) {
    throw new Error('ESCOLA_EMAIL e ESCOLA_SENHA não configurados nas variáveis de ambiente.');
  }

  let browser: Browser | null = null;

  try {
    const result = await launchAndLogin();
    browser = result.browser;
    const page = result.page;

    // Aguarda a home renderizar (SPA). Dá um tempo extra para o saldo carregar.
    await new Promise((r) => setTimeout(r, 4000));

    const screenshot = (await page.screenshot({
      encoding: 'base64',
      fullPage: true,
    })) as string;

    const saldo = await extrairSaldoGemini(screenshot);

    return {
      aluno: saldo.aluno || 'Lucas',
      saldo: saldo.saldo || 'indisponível',
      atualizadoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('eatsimple consultarSaldo:', message);
    throw new Error(`Falha ao consultar saldo da lanchonete: ${message}`);
  } finally {
    if (browser) await browser.close();
  }
}

/** Usa Claude Vision para extrair saldo e nome do aluno de um screenshot. */
async function extrairSaldoGemini(imageBase64: string): Promise<{ aluno: string; saldo: string }> {
  const response = await anthropicRetry(() =>
    anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
            {
              type: 'text',
              text: `Esta é a tela do portal Eat Simple (lanchonete escolar). Extraia:
- aluno: nome do aluno exibido (primeiro nome é suficiente)
- saldo: o valor de saldo/crédito visível, no formato "R$ XX,YY"

Retorne APENAS JSON válido, sem markdown:
{"aluno":"...","saldo":"R$ ..."}

Se não encontrar o saldo, use "indisponível".`,
            },
          ],
        },
      ],
    })
  );

  const bloco = response.content.find((b) => b.type === 'text');
  const texto = bloco?.type === 'text' ? bloco.text : '{}';
  const limpo = texto.replace(/```json\n?|\n?```/g, '').trim();

  try {
    const parsed = JSON.parse(limpo) as { aluno?: string; saldo?: string };
    return { aluno: parsed.aluno ?? '', saldo: parsed.saldo ?? 'indisponível' };
  } catch {
    console.error('eatsimple: falha ao parsear JSON do Claude:', limpo.slice(0, 200));
    return { aluno: '', saldo: 'indisponível' };
  }
}
