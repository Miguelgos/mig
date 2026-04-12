import 'dotenv/config';
// Necessário no WSL por problema de certificados SSL locais
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import express from 'express';
import path from 'path';
import { chatRouter } from './routes/chat';
import { initTelegram } from './services/telegram';
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

// Inicializa o servidor
app.listen(PORT, () => {
  console.log(`Mig rodando na porta ${PORT}`);

  // Inicia o bot do Telegram
  initTelegram();

  // Agenda os cron jobs
  scheduleCrons();
});
