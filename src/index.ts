import 'dotenv/config';
// Necessário no WSL por problema de certificados SSL locais
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
import express from 'express';
import path from 'path';
import { chatRouter } from './routes/chat';
import { initTelegram, stopTelegram } from './services/telegram';
import { scheduleCrons } from './crons';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas da API
app.use('/api/chat', chatRouter);

// Health check para Railway
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Para o polling do Telegram antes de sair — evita 409 Conflict no redeploy
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido, encerrando...');
  stopTelegram();
  process.exit(0);
});

// Impede que rejeições não tratadas derrubem o processo
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err.message);
});

// Inicializa o servidor — bind explícito em 0.0.0.0 para funcionar no Railway
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Mig rodando na porta ${PORT}`);

  // Inicia o bot do Telegram
  initTelegram();

  // Agenda os cron jobs
  scheduleCrons();
});
