# ADR 0003 — PWA HTML/CSS/JS vanilla como frontend

- **Data**: 2026-04-11
- **Status**: Aceito

## Contexto

O Mig precisa de uma interface de chat acessível pelo browser no iPhone e computador, com possibilidade de "Adicionar à tela inicial" para experiência próxima a um app nativo.

## Alternativas consideradas

| Opção | Complexidade de build | Tamanho do bundle | "Add to Home" iOS | Deploy simples | Observações |
|-------|----------------------|-------------------|-------------------|----------------|-------------|
| **PWA vanilla** | Nenhuma | ~0 KB de framework | ✅ via Safari | ✅ `express.static` | HTML/CSS/JS puro; sem build step |
| Next.js / React | Alta | ~80-200 KB | ✅ | Moderado | Overkill para um chat simples |
| React Native | Muito alta | App nativo | ✅ | App Store | Requer conta Apple; loja de apps |
| Flutter | Muito alta | App nativo | ✅ | App Store | Mesmo problema; linguagem diferente |
| Ionic / Capacitor | Alta | Médio | ✅ | App Store | Wrapper web; ainda precisaria de build |

## Decisão

Usar **PWA com HTML/CSS/JS vanilla** servido pelo Express via `express.static`.

## Justificativa

- Zero dependências de build — o Express serve os arquivos diretamente
- "Adicionar à tela inicial" no iPhone via Safari funciona com `manifest.json` + meta tags
- Interface de chat é simples o suficiente — nenhum framework agrega valor aqui
- Fácil de modificar sem toolchain
- Carregamento instantâneo — sem JavaScript de framework para parsear

## Consequências

- Sem tipagem no frontend (JS puro)
- Sem hot reload (recarregar o browser manualmente)
- Se a interface crescer muito, considerar migrar para um framework leve (Preact, Solid)

## Como reverter

Substituir `public/index.html` por qualquer build de framework.
Remover `express.static` de `src/index.ts` se preferir deploy separado.
