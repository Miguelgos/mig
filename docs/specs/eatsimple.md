# Spec: Integração Eat Simple (lanchonete da escola)

## Visão geral

Integração com o portal **Eat Simple** (`eatsimple.com.br`) para consulta do
saldo/crédito da lanchonete do Lucas. O portal não tem API pública — usamos
Puppeteer para fazer login e Gemini Vision para extrair o saldo da tela.

## Plataforma

| Campo | Valor |
|-------|-------|
| Plataforma | Eat Simple |
| URL base | `https://www.eatsimple.com.br` |
| URL de login | `https://www.eatsimple.com.br/login` |
| Tipo de acesso | Login com e-mail e senha (mesmo cadastro da escola) |

## Fluxo de funcionamento

```
1. Puppeteer abre a página de login
        │
        ▼
2. Preenche e-mail (ESCOLA_EMAIL) e senha (ESCOLA_SENHA) → submete
        │
        ▼
3. Aguarda redirecionamento e renderização do SPA (~4s extras)
        │
        ▼
4. Screenshot full-page da home do portal
        │
        ▼
5. Gemini Vision extrai aluno + saldo em JSON
        │
        ▼
6. Retorna SaldoLanchonete { aluno, saldo, atualizadoEm }
```

## Interface de dados

```typescript
interface SaldoLanchonete {
  aluno: string;         // primeiro nome do aluno
  saldo: string;         // "R$ XX,YY" ou "indisponível"
  atualizadoEm: string;  // timestamp pt-BR do momento da consulta
}
```

## Variáveis de ambiente

Reutiliza as mesmas credenciais do portal escolar Layers Digital:

| Variável | Descrição |
|----------|-----------|
| `ESCOLA_EMAIL` | E-mail do responsável (mesmo cadastrado na escola) |
| `ESCOLA_SENHA` | Senha do portal Eat Simple |

## Cron job

| Horário | Ação |
|---------|------|
| Seg–Sex 6:30 (America/Sao_Paulo) | Consulta saldo e envia no Telegram |

## Tool disponível

| Tool | Parâmetros | Descrição |
|------|-----------|-----------|
| `saldo_lanchonete()` | — | Retorna saldo atual da lanchonete do Lucas |

## Limitações conhecidas

- **Sem API oficial**: depende de scraping via screenshot + OCR
- **Lento**: cada consulta leva ~15–25s (login + renderização + Gemini Vision)
- **Frágil a mudanças de layout**: se o portal redesenhar a home, o Gemini pode não achar o saldo
- **Requer Chromium**: configurado via `nixpacks.toml` no Railway
- **Credenciais compartilhadas**: assume que o login da escola é o mesmo do Eat Simple
