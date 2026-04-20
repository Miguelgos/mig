# Spec: Integração Portal Escolar (Layers Digital)

## Visão geral

Integração com o portal escolar **Layers Digital** (`layers.digital`) para consulta de comunicados da escola do Lucas.
Não há API oficial disponível — a integração usa Puppeteer para navegar pelo portal e Claude Vision para extrair as informações da tela via OCR.

## Plataforma

| Campo | Valor |
|-------|-------|
| Plataforma | Layers Digital |
| URL base | `https://id.layers.digital` |
| URL de login | `https://id.layers.digital/?client_id=...&redirect_uri=...&scope=...` |
| Tipo de acesso | Login com e-mail e senha (conta do responsável) |

## Fluxo de funcionamento

```
1. Puppeteer abre a URL de login com query params do portal
        │
        ▼
2. Preenche e-mail e senha → submete formulário
        │
        ▼
3. Aguarda redirecionamento e carregamento da página principal
        │
        ▼
4. Tira screenshot da área de comunicados
        │
        ▼
5. Claude Vision descreve o estado atual da página (para debug)
        │
        ▼
6. Claude Vision extrai os comunicados visíveis como JSON estruturado
        │
        ▼
7. Para cada comunicado: clica pelo título, screenshot da tela aberta,
   Claude Vision extrai o conteúdo completo em `detalhes` e volta
        │
        ▼
8. Retorna lista de objetos Comunicado
```

## Interface de dados

```typescript
interface Comunicado {
  titulo: string;    // título do comunicado
  autor: string;     // nome do remetente/escola
  data: string;      // data de publicação (formato livre conforme aparece na tela)
  resumo: string;    // resumo do conteúdo extraído da lista
  detalhes?: string; // conteúdo completo extraído ao abrir o comunicado
}
```

## Deduplicação de envios

Para não reenviar o mesmo comunicado a cada execução do cron, cada comunicado
importante tem um `fingerprint` (sha1 de `titulo|autor|data` normalizado) que é
gravado na tabela `SentEscola` do SQLite após o envio. Nas execuções seguintes
os comunicados já persistidos são filtrados antes do envio.

## Uso do Claude Vision

Duas chamadas são feitas ao Claude com o screenshot:

1. **Descrição de estado (debug)**: prompt pedindo ao Claude para descrever o que está visível na tela. Útil para diagnosticar falhas de login ou carregamento.

2. **Extração de comunicados**: prompt estruturado pedindo ao Claude para retornar um array JSON com os comunicados visíveis, respeitando a interface `Comunicado`.

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `ESCOLA_EMAIL` | E-mail do responsável no portal Layers Digital |
| `ESCOLA_SENHA` | Senha da conta no portal Layers Digital |

## Cron jobs relacionados

| Horário | Ação |
|---------|------|
| Diário 7h | Busca comunicados, filtra importantes com Claude, envia e-mail (com `.ics` se houver data) |
| Diário 13h | Idem |
| Diário 18h | Idem |

## Tool disponível

| Tool | Parâmetros | Descrição |
|------|-----------|-----------|
| `verificar_escola_agora()` | — | Busca comunicados, filtra importantes e envia e-mail |
| `comunicados_escola(limite?)` | `limite`: número máximo de itens (opcional) | Retorna lista de comunicados recentes |

## Limitações conhecidas

- **Sem API oficial**: depende inteiramente de scraping via screenshot e OCR
- **Lento**: cada consulta leva ~15-30 segundos (login + carregamento + Claude Vision)
- **Frágil a mudanças de layout**: se o portal mudar o HTML/CSS, o Puppeteer pode falhar
- **OCR impreciso**: datas e nomes podem ser extraídos incorretamente se a resolução do screenshot for baixa
- **Sem paginação**: só vê os comunicados visíveis na tela inicial — comunicados antigos não são acessados
- **Requer Chromium**: configurado via `nixpacks.toml` no Railway

## Próximas melhorias

- Scroll automático para capturar mais comunicados
- Detecção de falha de login com alerta via Telegram
