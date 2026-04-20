import TelegramBot from 'node-telegram-bot-api';
import { runAgentLoop, clearHistory } from './agente';
import { consultarSaldo } from './eatsimple';

let bot: TelegramBot | null = null;

const ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID ?? '';

/** Inicializa o bot do Telegram em modo polling. */
export function initTelegram(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN não configurado — bot desativado.');
    return;
  }

  // Se não configurado, roda em modo de descoberta — loga o chat ID de quem escrever
  const discoverMode = !ALLOWED_CHAT_ID;
  if (discoverMode) {
    console.warn('TELEGRAM_ALLOWED_CHAT_ID não configurado — rodando em modo descoberta.');
  }

  bot = new TelegramBot(token, { polling: false });

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text?.trim();

    // Modo descoberta: imprime o chat ID e instrui o usuário
    if (discoverMode) {
      console.log(`\n>>> SEU CHAT ID É: ${chatId} <<<\n`);
      await bot!.sendMessage(chatId, `Seu chat ID é: \`${chatId}\`\nAdicione ao .env como TELEGRAM_ALLOWED_CHAT_ID`);
      return;
    }

    // Bloqueia qualquer chat que não seja o autorizado
    if (chatId !== ALLOWED_CHAT_ID) {
      await bot!.sendMessage(
        chatId,
        'Acesso negado. Este assistente é privado.'
      );
      return;
    }

    if (!text) return;

    // Comando para limpar histórico
    if (text === '/start' || text === '/clear') {
      clearHistory(chatId);
      await bot!.sendMessage(
        chatId,
        'Oi, Miguel! Sou o Mig, seu assistente pessoal. Como posso ajudar?'
      );
      return;
    }

    // Atalho: /saldo consulta direto o saldo da lanchonete (sem passar pelo agente)
    if (text === '/saldo') {
      await bot!.sendChatAction(chatId, 'typing');
      try {
        const s = await consultarSaldo();
        await bot!.sendMessage(
          chatId,
          `🍔 *Lanchonete — ${s.aluno}*\n\n💰 Saldo: *${s.saldo}*\n🕕 ${s.atualizadoEm}`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('telegram /saldo:', message);
        await bot!.sendMessage(chatId, `Não consegui consultar o saldo: ${message}`);
      }
      return;
    }

    // Indica que está processando
    await bot!.sendChatAction(chatId, 'typing');

    try {
      const reply = await runAgentLoop(chatId, text);
      await bot!.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('telegram message handler:', message);
      await bot!.sendMessage(
        chatId,
        'Ocorreu um erro ao processar sua mensagem. Tente novamente.'
      );
    }
  });

  bot.on('polling_error', (err) => {
    console.error('telegram polling error:', err.message);
  });

  // Aguarda 3s antes de iniciar polling — dá tempo da instância anterior encerrar
  // e evita 409 Conflict durante rolling deploy no Railway
  console.log('Telegram bot aguardando 3s antes de iniciar polling...');
  setTimeout(() => {
    bot?.startPolling();
    console.log('Telegram bot iniciado em modo polling.');
  }, 3000);
}

/** Para o polling do bot (chamado no SIGTERM para evitar 409 no redeploy). */
export function stopTelegram(): void {
  if (bot) {
    bot.stopPolling();
    bot = null;
    console.log('Telegram bot encerrado.');
  }
}

/** Envia uma mensagem proativa para o chat autorizado. */
export async function sendMessage(text: string): Promise<void> {
  if (!bot || !ALLOWED_CHAT_ID) {
    console.warn('Bot não inicializado ou chat ID não configurado.');
    return;
  }

  try {
    await bot.sendMessage(ALLOWED_CHAT_ID, text, { parse_mode: 'Markdown' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('telegram sendMessage:', message);
  }
}
