import axios from 'axios';

const BASE_URL = 'https://api.cartola.globo.com';
const LOGIN_URL = 'https://login.globo.com/api/authentication';
const SERVICE_ID = 4728;

// Esquema tático fixo
const SCHEME: Record<string, number> = {
  gol: 1,
  lat: 2,
  zag: 2,
  mei: 3,
  ata: 3,
};

// Mapeamento de posição por abreviação da API
const POSITION_MAP: Record<number, string> = {
  1: 'gol',
  2: 'lat',
  3: 'zag',
  4: 'mei',
  5: 'ata',
  6: 'tec', // técnico (não usado no esquema)
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

/** Faz login no Globo e retorna o token GLBID. */
async function login(): Promise<string> {
  const email = process.env.CARTOLA_EMAIL;
  const senha = process.env.CARTOLA_SENHA;

  if (!email || !senha) {
    throw new Error('CARTOLA_EMAIL e CARTOLA_SENHA não configurados.');
  }

  const response = await axios.post(LOGIN_URL, {
    payload: { email, password: senha, serviceId: SERVICE_ID },
  });

  const glbid = response.data?.glbid;
  if (!glbid) throw new Error('Login no Globo falhou: GLBID não retornado.');

  return glbid as string;
}

/** Sugere um time dentro do orçamento usando jogadores prováveis (status_id 7). */
export async function sugerirTime(orcamento = 100): Promise<SuggestedTeam> {
  try {
    const { data } = await axios.get<MarketResponse>(`${BASE_URL}/atletas/mercado`);

    const clubs = data.clubes;
    // Filtra apenas jogadores prováveis (status_id 7)
    const provaveis = data.atletas.filter(
      (a) => a.status_id === 7 && POSITION_MAP[a.posicao_id] !== 'tec'
    );

    // Agrupa por posição e ordena por média decrescente
    const byPosition: Record<string, Athlete[]> = {
      gol: [],
      lat: [],
      zag: [],
      mei: [],
      ata: [],
    };

    for (const a of provaveis) {
      const pos = POSITION_MAP[a.posicao_id];
      if (pos && pos in byPosition) {
        byPosition[pos].push(a);
      }
    }

    for (const pos of Object.keys(byPosition)) {
      byPosition[pos].sort((a, b) => b.media_num - a.media_num);
    }

    // Seleciona jogadores usando programação gulosa (melhor média que cabe no orçamento)
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

    const mensagem =
      selected.length < 11
        ? `Atenção: apenas ${selected.length} jogadores encontrados dentro do orçamento de C$ ${orcamento}.`
        : undefined;

    return {
      rodada: data.rodada_atual,
      orcamento,
      custoTotal: Math.round(custoTotal * 100) / 100,
      jogadores: selected,
      mensagem,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cartola sugerirTime:', message);
    throw new Error(`Falha ao sugerir time: ${message}`);
  }
}

/** Consulta a pontuação do time do usuário na rodada atual. */
export async function consultarPontuacao(): Promise<{
  rodada: number;
  pontos: number;
  patrimonio: number;
  time: string;
}> {
  try {
    const glbid = await login();

    const { data } = await axios.get(`${BASE_URL}/auth/time`, {
      headers: { Cookie: `GLBID=${glbid}` },
    });

    return {
      rodada: data.time?.rodada_atual ?? 0,
      pontos: data.time?.pontos ?? 0,
      patrimonio: data.time?.patrimonio ?? 0,
      time: data.time?.nome ?? 'Sem nome',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('cartola consultarPontuacao:', message);
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
