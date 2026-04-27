import axios from 'axios';
import https from 'https';

const BASE_URL = 'https://api.cartola.globo.com';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Quando há um proxy HTTP local que não faz CONNECT tunneling para HTTPS (ex: WSL2 dev),
// desabilitamos o proxy e a validação de cert para as chamadas autenticadas do Cartola.
// Em produção (Railway) não há proxy, então o comportamento padrão é usado.
const httpsProxyConfigured = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
const cartolaSafeAgent = httpsProxyConfigured
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;
const cartolaAxiosOverrides = httpsProxyConfigured
  ? { proxy: false as const, httpsAgent: cartolaSafeAgent }
  : {};

const STATUS_NAMES: Record<number, string> = {
  1: 'Mercado aberto',
  2: 'Mercado fechado',
  3: 'Rodada parcial',
  4: 'Manutenção',
  6: 'Fechado para atualização',
};

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
  rodada_id: number;
}

interface MarketResponse {
  atletas: Athlete[];
  clubes: Record<string, { nome: string; abreviacao: string }>;
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

/** Sugere um time dentro do orçamento usando jogadores prováveis (status_id 7). */
export async function sugerirTime(orcamento = 100): Promise<SuggestedTeam> {
  try {
    const [mercadoRes, statusRes] = await Promise.all([
      axios.get<MarketResponse>(`${BASE_URL}/atletas/mercado`, {
        headers: { 'User-Agent': USER_AGENT },
      }),
      axios.get<{ rodada_atual: number }>(`${BASE_URL}/mercado/status`),
    ]);
    const data = mercadoRes.data;
    const rodadaAtual: number = statusRes.data.rodada_atual ?? 0;
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
      rodada: rodadaAtual,
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

/**
 * Consulta a pontuação do time usando cookies de sessão definidos em CARTOLA_COOKIES.
 * Para obter os cookies: faça login em cartola.globo.com, abra DevTools → Application
 * → Cookies → copie todos como "nome=valor" separados por "; " e salve em CARTOLA_COOKIES.
 */
export async function consultarPontuacao(): Promise<{
  rodada: number;
  pontos: number;
  patrimonio: number;
  time: string;
}> {
  const cookies = process.env.CARTOLA_COOKIES;
  if (!cookies) {
    throw new Error(
      'CARTOLA_COOKIES não configurado. Faça login em cartola.globo.com, ' +
      'copie os cookies do DevTools (Application → Cookies) e salve em CARTOLA_COOKIES no .env.'
    );
  }

  try {
    console.log('cartola: chamando /auth/time...');
    const { data, status } = await axios.get(`${BASE_URL}/auth/time`, {
      ...cartolaAxiosOverrides,
      headers: {
        Cookie: cookies,
        'User-Agent': USER_AGENT,
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
    const axiosErr = err as { response?: { status: number; data: unknown } };
    if (axiosErr?.response?.status === 401 || axiosErr?.response?.status === 403) {
      throw new Error(
        'Cookies do Cartola expirados. Faça login em cartola.globo.com e atualize CARTOLA_COOKIES no .env.'
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    if (axiosErr?.response) {
      console.error('cartola /auth/time HTTP', axiosErr.response.status, JSON.stringify(axiosErr.response.data).slice(0, 300));
    }
    console.error('cartola consultarPontuacao:', message);
    throw new Error(`Falha ao consultar pontuação: ${message}`);
  }
}

/** Verifica o status do mercado e rodada atual. */
export async function statusMercado(): Promise<MarketStatus> {
  try {
    const { data } = await axios.get<{ rodada_atual: number; status_mercado: number }>(
      `${BASE_URL}/mercado/status`
    );

    return {
      rodada: data.rodada_atual ?? 0,
      status: STATUS_NAMES[data.status_mercado] ?? `Status ${data.status_mercado}`,
      aberto: data.status_mercado === 1,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cartola statusMercado:', message);
    throw new Error(`Falha ao verificar status do mercado: ${message}`);
  }
}
