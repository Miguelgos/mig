# Spec: Integração Cartola FC

## Visão geral

Integração com a API não-oficial do Cartola FC para sugestão de escalação e consulta de pontuação.
A API não exige autenticação para dados públicos (atletas, mercado); autenticação Globo é necessária para dados do time do usuário.

## Endpoints usados

### Dados públicos

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `https://api.cartola.globo.com/atletas/mercado` | GET | Lista todos os atletas com preços, médias e status |
| `https://api.cartola.globo.com/mercado/status` | GET | Status do mercado e rodada atual |

### Autenticados

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `https://api.cartola.globo.com/auth/time` | GET | Time do usuário (requer cookie de sessão Globo) |

## Autenticação

O login direto via `POST https://login.globo.com/api/authentication` não funciona de forma confiável (proteções anti-bot). O fluxo atual usa **Puppeteer** para simular o login no browser:

### Fluxo via Puppeteer

1. Abre `https://cartola.globo.com` em modo headless
2. Clica no botão "Entrar" da página
3. Se o botão não for encontrado, navega diretamente para `https://cartola.globo.com?produto=437` (fallback)
4. Preenche e-mail e senha no formulário de login da Globo
5. Aguarda redirecionamento de volta ao Cartola
6. Extrai os cookies de sessão do browser
7. Usa os cookies extraídos nas chamadas subsequentes à API (`/auth/time`)

### Cache de cookies

Os cookies de sessão ficam em cache por **30 minutos** em memória. Novas consultas dentro desse período reutilizam os cookies sem novo login, evitando sobrecarga no Puppeteer.

```
cookie cache (memória)
  └── expira após 30min → novo login via Puppeteer
```

### Variáveis necessárias

- `CARTOLA_EMAIL` — e-mail da conta Globo
- `CARTOLA_SENHA` — senha da conta Globo

## Exemplos de request/response

### GET /atletas/mercado (trecho)

```json
{
  "rodada_atual": 5,
  "atletas": [
    {
      "atleta_id": 12345,
      "apelido": "Pedro",
      "clube_id": 21,
      "posicao_id": 5,
      "status_id": 7,
      "preco_num": 18.43,
      "media_num": 9.2,
      "pontos_num": 11.5
    }
  ],
  "clubes": {
    "21": { "nome": "Flamengo", "abreviacao": "FLA" }
  }
}
```

### GET /mercado/status

```json
{
  "rodada": { "rodada_atual": 5 },
  "status_mercado": { "id": 1, "nome": "Mercado aberto" }
}
```

## Status dos atletas (status_id)

| ID | Significado |
|----|-------------|
| 2 | Dúvida |
| 3 | Suspenso |
| 5 | Contundido |
| 6 | Nulo |
| 7 | Provável ✅ |

## IDs de posição (posicao_id)

| ID | Posição |
|----|---------|
| 1 | Goleiro |
| 2 | Lateral |
| 3 | Zagueiro |
| 4 | Meia |
| 5 | Atacante |
| 6 | Técnico |

## Esquema tático usado

`1-2-2-3-3`: 1 goleiro, 2 laterais, 2 zagueiros, 3 meias, 3 atacantes (sem técnico).

## Algoritmo de sugestão

1. Buscar `/atletas/mercado`
2. Filtrar `status_id === 7` (prováveis)
3. Agrupar por posição
4. Ordenar cada grupo por `media_num` decrescente
5. Seleção gulosa: melhor média que cabe no orçamento restante

## Limitações conhecidas

- A API não é oficial e pode mudar sem aviso
- Login via Puppeteer é lento (~10-20s) e frágil a mudanças no DOM do site
- Cookie cache de 30min em memória: reiniciar o processo invalida o cache e força novo login
- Puppeteer requer Chromium instalado — configurado via `nixpacks.toml` no Railway

## Próximas melhorias

- Cache de 5 minutos para `/atletas/mercado`
- Suporte a técnico no esquema tático
- Filtro por clube (evitar mais de N do mesmo clube)
- Diferencial calculado automaticamente
