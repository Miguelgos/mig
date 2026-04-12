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
| `https://login.globo.com/api/authentication` | POST | Login — retorna GLBID cookie |
| `https://api.cartola.globo.com/auth/time` | GET | Time do usuário (requer cookie GLBID) |

## Autenticação

```
POST https://login.globo.com/api/authentication
Content-Type: application/json

{
  "payload": {
    "email": "usuario@email.com",
    "password": "senha123",
    "serviceId": 4728
  }
}
```

Resposta: `{ "glbid": "TOKEN_AQUI", ... }`

O token é passado como cookie nas requisições autenticadas: `Cookie: GLBID=TOKEN_AQUI`

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
- O endpoint de login pode ter rate limiting
- GLBID expira — não há refresh automático implementado (faz login a cada consulta)
- Não há cache implementado — cada chamada vai à API do Cartola

## Próximas melhorias

- Cache de 5 minutos para `/atletas/mercado`
- Suporte a técnico no esquema tático
- Filtro por clube (evitar mais de N do mesmo clube)
- Diferencial calculado automaticamente
