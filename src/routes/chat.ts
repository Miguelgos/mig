import { Router, Request, Response } from 'express';
import { runAgentLoop } from '../services/agente';

export const chatRouter = Router();

// POST /api/chat — recebe mensagem do frontend PWA
chatRouter.post('/', async (req: Request, res: Response) => {
  const { message, chatId } = req.body as { message?: string; chatId?: string };

  if (!message || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'Campo "message" é obrigatório.' });
    return;
  }

  // Usa "web" como chatId padrão para o frontend
  const id = chatId ?? 'web';

  try {
    const reply = await runAgentLoop(id, message.trim());
    res.json({ reply });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('chat route:', error);
    res.status(500).json({ error: 'Erro interno ao processar a mensagem.' });
  }
});
