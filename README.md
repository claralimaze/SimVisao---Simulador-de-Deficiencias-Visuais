# SimVisão — Simulador de Deficiências Visuais

Extensão de navegador (Chrome e outros navegadores Chromium, Manifest V3) que **simula deficiências visuais em tempo real sobre qualquer site** e **verifica problemas de acessibilidade**, para que desenvolvedores web testem suas interfaces sem depender de usuários reais em cada etapa do desenvolvimento.

Projeto de Trabalho de Conclusão de Curso — Engenharia da Computação, INATEL.

**Autoras:** Clara de Lima Azevedo e Maria Eduarda de Oliveira.

---

## O que a extensão faz

### Simulações

| Simulação | Como é feita |
|---|---|
| Protanopia, deuteranopia, tritanopia | Filtro SVG `feColorMatrix` com as matrizes de Machado, Oliveira & Fernandes (2009), severidade ajustável de 0 a 100% |
| Monocromacia (acromatopsia) | Filtro SVG `feColorMatrix` com pesos de luminância Rec. 709 (em RGB linear) |
| Baixa visão (embaçamento) | Filtros CSS `blur()` e `contrast()`, com desfoque e contraste ajustáveis |
| Baixo contraste | Filtro CSS `contrast()`, ajustável |
| Visão em túnel | `<div>` fixo com `radial-gradient` que segue o mouse (campo visual com raio ajustável) |

A escolha da simulação e dos ajustes é salva em `chrome.storage.local` e restaurada ao navegar ou recarregar páginas.

### Verificador de acessibilidade

O botão **Verificar acessibilidade** analisa a página e mostra um painel (em Shadow DOM, sem interferir no CSS do site) com os problemas encontrados, destacando em vermelho os elementos na página:

| Verificação | Critério WCAG |
|---|---|
| Contraste insuficiente entre texto e fundo (4,5:1; 3:1 para texto grande) | 1.4.3 |
| Imagens sem atributo `alt` | 1.1.1 |
| Links e botões sem nome acessível | 4.1.2 |
| Campos de formulário sem rótulo | 3.3.2 |

**Contraste sensível à simulação:** com uma simulação ativa, o contraste é recalculado como seria percebido sob aquele efeito (cor → espaço linear → matriz do efeito → luminância → razão). O painel mostra lado a lado a contagem **sem simulação** e **com a simulação ativa**. Essa comparação é um indicador complementar desta ferramenta, não um critério da WCAG: a WCAG define contraste sobre as cores reais da página.

---

## Instalação (modo desenvolvedor)

1. Baixe ou clone este repositório no seu computador (o Chrome precisa ser o do seu computador; não funciona dentro do Codespaces).
2. No Chrome, abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta que contém o `manifest.json`.
5. Fixe a extensão na barra (ícone de peça de quebra-cabeça → alfinete ao lado de SimVisão).

> Sempre que recarregar a extensão em `chrome://extensions`, aperte **F5** nas abas em que for testar. O Chrome não injeta a extensão em abas que já estavam abertas.

## Como usar

1. Abra um site (não funciona em páginas internas como `chrome://` ou na Chrome Web Store).
2. Clique no ícone da SimVisão e escolha uma simulação. A página muda na hora.
3. Use os **Ajustes** (severidade, desfoque, contraste, raio do campo visual) para variar a intensidade.
4. Clique em **Verificar acessibilidade** para abrir o painel de problemas.
5. Clique em **Desativar simulação** para voltar ao normal.

### Sites sugeridos para demonstração

- [W3C BAD — página inacessível](https://www.w3.org/WAI/demos/bad/before/home.html) e [versão acessível](https://www.w3.org/WAI/demos/bad/after/home.html): comparação direta antes/depois.
- Sites com muitas cores e gráficos (por exemplo, um site de cotações) para ver o efeito do daltonismo.

---

## Como funciona

```
┌────────────┐   mensagem    ┌────────────────┐  aplica   ┌──────────────┐
│  popup     │ ────────────▶ │ content script │ ────────▶ │ página (DOM) │
│ (HTML/JS)  │ APPLY_EFFECT  │  content.js    │  filtros  │              │
└─────┬──────┘ RUN_A11Y_CHECK└────────────────┘           └──────────────┘
      │ salva                          ▲ restaura ao carregar a página
      ▼                                │
chrome.storage.local ──────────────────┘
```

- **Popup** (`popup.html` / `popup.js`): interface; salva a escolha e envia mensagens para a aba ativa.
- **Content script** (`content.js`): roda em cada página (`document_start`), injeta um `<svg>` oculto com os filtros `feColorMatrix` e aplica `filter` no elemento `<html>`; cria o overlay da visão em túnel; executa o verificador.
- **Filtro SVG em RGB linear:** o `<filter>` usa `color-interpolation-filters="linearRGB"`, necessário porque as matrizes de Machado et al. (2009) foram calculadas para esse espaço.
- **Severidade:** a matriz de uma severidade `s` é a interpolação linear entre a matriz identidade (visão normal) e a matriz de dicromacia completa (`s = 1`).
- **Painel isolado do filtro:** o painel de resultados usa a camada superior do navegador (`popover`), então permanece nítido e colorido durante qualquer simulação.
- **Permissões mínimas:** apenas `storage`. O content script é declarado no manifesto; não são pedidas as permissões `tabs`, `scripting` nem `host_permissions`.

### Estrutura do repositório

```
manifest.json     Manifesto (Manifest V3)
content.js        Content script: simulações + verificador de acessibilidade
popup.html        Interface do popup
popup.js          Lógica do popup (efeitos, ajustes, verificação)
icons/            Ícones da extensão (16, 32, 48, 128 px)
tests/            Testes automatizados
package.json      Scripts e dependências de teste
```

---

## Testes

Requer Node.js 18+. Os testes ponta a ponta carregam a extensão de verdade em um Chromium controlado pelo Playwright.

```bash
npm install
npx playwright install chromium   # uma vez
npm test
```

| Script | O que cobre |
|---|---|
| `npm run test:unit` | content script em jsdom: aplicar/remover efeitos, túnel, verificador |
| `npm run test:popup` | popup com a API `chrome` simulada: sliders, mensagens enviadas, resumo |
| `npm run test:e2e` | extensão real no Chromium: cores resultantes (pixels), severidade 0/50/100%, acromatopsia, túnel, contagem sem simulação, persistência após recarregar |

---

## Limitações conhecidas

- **A simulação é uma aproximação.** Os modelos representam a percepção média de dicromatas e não substituem testes com pessoas reais.
- **Tritanopia:** a matriz de Machado et al. (2009) é uma aproximação; o modelo de referência para essa condição é o de Brettel, Viénot & Mollon (1997).
- **Baixa visão e visão em túnel** são aproximações visuais simples (desfoque, contraste e máscara), não modelos fisiológicos.
- **O verificador analisa a página uma vez**, no momento do clique; conteúdo carregado depois (aplicações de página única) exige nova verificação.
- **Não analisa `iframes`** (`all_frames` está desativado) nem trata cores de texto sobre imagens de fundo, gradientes ou elementos com transparência.
- O recálculo de contraste sob simulação é um indicador próprio da ferramenta e não um critério da WCAG.
- Não funciona em páginas internas do navegador (`chrome://`, Chrome Web Store) nem em PDFs.

## Trabalhos futuros

- Cobertura de mais condições (por exemplo, catarata, glaucoma, escotomas) com modelos fisiológicos.
- Tritanopia com o modelo de Brettel et al. (1997).
- Verificação dentro de `iframes` e reanálise automática em páginas dinâmicas.
- Tratamento de imagens de fundo e transparências no cálculo de contraste.
- Avaliação com usuários reais e comparação sistemática com Lighthouse e axe.
- Publicação na Chrome Web Store e suporte a Firefox.

## Referências

- Machado, G. M.; Oliveira, M. M.; Fernandes, L. A. F. *A Physiologically-based Model for Simulation of Color Vision Deficiency.* IEEE Transactions on Visualization and Computer Graphics, 15(6), 2009.
- Brettel, H.; Viénot, F.; Mollon, J. D. *Computerized simulation of color appearance for dichromats.* Journal of the Optical Society of America A, 14(10), 1997.
- W3C. *Web Content Accessibility Guidelines (WCAG) 2.1* — critérios 1.1.1, 1.4.3, 3.3.2 e 4.1.2.
- W3C WAI. *Before and After Demonstration (BAD).*
- Chrome for Developers. *Chrome Extensions — Manifest V3* e *Content scripts.*

## Licença

A definir.
