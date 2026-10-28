// content.js
// Roda dentro de todas as páginas (context isolado). É responsável por:
// 1) Injetar um <svg> invisível com os filtros feColorMatrix de daltonismo
// 2) Aplicar/remover a propriedade CSS "filter" no elemento raiz (<html>)
// 3) Escutar mensagens vindas do popup e restaurar o último estado salvo

(function () {
  const FILTER_ID_PREFIX = "simvisao-filter-";
  const SVG_CONTAINER_ID = "simvisao-svg-filters";

  // Matrizes de transformação de cor (feColorMatrix) para cada tipo de
  // daltonismo, em espaço linearRGB. Baseadas nos modelos de Machado,
  // Oliveira & Fernandes (2009) e Viénot, Brettel & Mollon (1999).
  // Cada matriz tem 20 números (4 linhas x 5 colunas: R,G,B,A,offset),
  // reaproveitados tanto para gerar o filtro SVG quanto para recalcular
  // o contraste percebido sob cada simulação (ver Seção "Verificador de
  // acessibilidade sensível à simulação" mais abaixo).
  // Matrizes de Machado, Oliveira & Fernandes (2009), severidade 1.0
  // (dicromacia completa), calculadas para espaço RGB LINEAR. Por isso o
  // filtro SVG usa color-interpolation-filters="linearRGB".
  // A tritanopia de Machado é uma aproximação; o modelo de referência para
  // essa condição é o de Brettel, Viénot & Mollon (1997) (ver limitações no artigo).
  const COLOR_BLINDNESS_MATRICES = {
    protanopia: [
      0.152286, 1.052583, -0.204868, 0, 0,
      0.114503, 0.786281, 0.099216, 0, 0,
      -0.003882, -0.048116, 1.051998, 0, 0,
      0, 0, 0, 1, 0,
    ],
    deuteranopia: [
      0.367322, 0.860646, -0.227968, 0, 0,
      0.280085, 0.672501, 0.047413, 0, 0,
      -0.01182, 0.04294, 0.968881, 0, 0,
      0, 0, 0, 1, 0,
    ],
    tritanopia: [
      1.255528, -0.076749, -0.178779, 0, 0,
      -0.078411, 0.930809, 0.147602, 0, 0,
      0.004733, 0.691367, 0.3039, 0, 0,
      0, 0, 0, 1, 0,
    ],
    // Monocromacia total: luminância Rec.709 aplicada em RGB linear
    acromatopsia: [
      0.2126, 0.7152, 0.0722, 0, 0,
      0.2126, 0.7152, 0.0722, 0, 0,
      0.2126, 0.7152, 0.0722, 0, 0,
      0, 0, 0, 1, 0,
    ],
  };

  function matrizParaStringSvg(matriz) {
    // Formata como 4 linhas de 5 valores, como o atributo "values" espera
    const linhas = [];
    for (let i = 0; i < 4; i++) {
      linhas.push(matriz.slice(i * 5, i * 5 + 5).join(" "));
    }
    return linhas.join("\n");
  }

  // Matriz efetiva de um efeito de daltonismo para uma severidade s (0-1).
  // s = 1 é a dicromacia completa (matriz de Machado et al. 2009); valores
  // menores aproximam a tricromacia anômala por interpolação linear entre a
  // matriz identidade (visão normal) e a matriz de dicromacia.
  const MATRIZ_IDENTIDADE = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

  function matrizEfetiva(efeito, opcoes) {
    const base = COLOR_BLINDNESS_MATRICES[efeito];
    if (!base) return null;
    let sev = opcoes && typeof opcoes.severidade === "number" ? opcoes.severidade : 1;
    sev = Math.min(1, Math.max(0, sev));
    if (sev === 1) return base;
    return base.map((v, i) => MATRIZ_IDENTIDADE[i] + (v - MATRIZ_IDENTIDADE[i]) * sev);
  }

  // Nomes legíveis dos efeitos, usados na interface do painel
  const NOMES_EFEITOS = {
    none: "nenhuma simulação",
    protanopia: "Protanopia",
    deuteranopia: "Deuteranopia",
    tritanopia: "Tritanopia",
    acromatopsia: "Acromatopsia",
    "baixa-visao": "Baixa visão",
    "baixo-contraste": "Baixo contraste",
    "visao-tunel": "Visão em túnel",
  };

  // Estado do efeito atualmente ativo nesta página, mantido em memória
  // para que o verificador de acessibilidade saiba qual transformação
  // de cor aplicar antes de calcular o contraste (ver applyEffect abaixo).
  let efeitoAtivo = "none";
  let opcoesEfeitoAtivo = {};

  // Cria (uma única vez por página) o <svg> com todos os filtros de
  // daltonismo definidos acima. O SVG fica invisível (0x0) e serve apenas
  // como "depósito" de definições de filtro que o CSS referencia via url(#id).
  function ensureSvgFilters() {
    if (document.getElementById(SVG_CONTAINER_ID)) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("id", SVG_CONTAINER_ID);
    svg.setAttribute(
      "style",
      "position:absolute; width:0; height:0; overflow:hidden;"
    );
    svg.setAttribute("aria-hidden", "true");

    Object.keys(COLOR_BLINDNESS_MATRICES).forEach((name) => {
      const filter = document.createElementNS(svgNS, "filter");
      filter.setAttribute("id", FILTER_ID_PREFIX + name);
      // linearRGB é essencial para a matriz produzir cores fisiologicamente
      // corretas (ver seção 4.4 da pesquisa sobre feColorMatrix).
      filter.setAttribute("color-interpolation-filters", "linearRGB");

      const feColorMatrix = document.createElementNS(svgNS, "feColorMatrix");
      feColorMatrix.setAttribute("type", "matrix");
      feColorMatrix.setAttribute(
        "values",
        matrizParaStringSvg(matrizEfetiva(name, {}))
      );

      filter.appendChild(feColorMatrix);
      svg.appendChild(filter);
    });

    // documentElement (<html>) já existe mesmo em document_start
    document.documentElement.appendChild(svg);
  }

  // --- Visão em túnel --------------------------------------------
  // Não usa Canvas: um <div> fixo, com pointer-events:none, cobre a
  // janela e pinta um radial-gradient transparente no centro (campo
  // visual preservado) e escuro nas bordas. O centro segue o mouse,
  // simulando o deslocamento do olhar. O raio é ajustável.
  let tunelOverlay = null;
  let tunelHandler = null;
  let tunelRaio = 120;
  let tunelX = null;
  let tunelY = null;

  function pintarTunel() {
    if (!tunelOverlay) return;
    const x = tunelX !== null ? tunelX : window.innerWidth / 2;
    const y = tunelY !== null ? tunelY : window.innerHeight / 2;
    tunelOverlay.style.background =
      `radial-gradient(circle at ${x}px ${y}px, transparent ${tunelRaio}px, rgba(0,0,0,0.95) ${tunelRaio + 160}px)`;
  }

  function ensureTunnel(raio) {
    if (typeof raio === "number") tunelRaio = Math.min(400, Math.max(30, raio));
    if (tunelOverlay) {
      pintarTunel();
      return;
    }
    tunelOverlay = document.createElement("div");
    tunelOverlay.id = "simvisao-tunel-overlay";
    tunelOverlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    tunelHandler = (e) => {
      tunelX = e.clientX;
      tunelY = e.clientY;
      pintarTunel();
    };
    document.addEventListener("mousemove", tunelHandler, { passive: true });
    document.documentElement.appendChild(tunelOverlay);
    pintarTunel();
  }

  function removeTunnel() {
    if (tunelHandler) document.removeEventListener("mousemove", tunelHandler);
    if (tunelOverlay) tunelOverlay.remove();
    tunelOverlay = null;
    tunelHandler = null;
  }

  // Atualiza a matriz do filtro SVG de um efeito conforme a severidade.
  function atualizarMatrizSvg(efeito, opcoes) {
    const filtro = document.getElementById(FILTER_ID_PREFIX + efeito);
    if (!filtro) return;
    const fe = filtro.querySelector("feColorMatrix");
    if (fe) fe.setAttribute("values", matrizParaStringSvg(matrizEfetiva(efeito, opcoes)));
  }

  // Aplica um efeito visual ao elemento raiz da página.
  // effect: "none" | "protanopia" | "deuteranopia" | "tritanopia" |
  //         "acromatopsia" | "baixa-visao" | "baixo-contraste" | "visao-tunel"
  // options: parâmetros extra para efeitos ajustáveis, ex. { blur, contrast }
  function applyEffect(effect, options) {
    const opts = options || {};

    // Guarda o estado atual em memória, para o verificador de
    // acessibilidade saber qual transformação de cor considerar.
    efeitoAtivo = effect || "none";
    opcoesEfeitoAtivo = opts;

    // Qualquer troca de efeito remove o overlay do túnel (se existir)
    if (effect !== "visao-tunel") removeTunnel();

    if (effect === "visao-tunel") {
      document.documentElement.style.filter = "none";
      ensureTunnel(opts.raio);
      return;
    }

    if (!effect || effect === "none") {
      document.documentElement.style.filter = "none";
      return;
    }

    if (COLOR_BLINDNESS_MATRICES[effect]) {
      ensureSvgFilters();
      atualizarMatrizSvg(effect, opts);
      // Reaplica o filtro para o navegador redesenhar com a matriz atualizada
      document.documentElement.style.filter = "none";
      document.documentElement.style.filter = `url(#${FILTER_ID_PREFIX}${effect})`;
      return;
    }

    if (effect === "baixa-visao") {
      const blur = opts.blur !== undefined ? opts.blur : 3;
      const contrast = opts.contrast !== undefined ? opts.contrast : 0.6;
      document.documentElement.style.filter = `blur(${blur}px) contrast(${contrast})`;
      return;
    }

    if (effect === "baixo-contraste") {
      const contrast = opts.contrast !== undefined ? opts.contrast : 0.4;
      document.documentElement.style.filter = `contrast(${contrast})`;
      return;
    }

    // Efeito desconhecido: não faz nada, por segurança
    console.warn("[SimVisão] Efeito desconhecido:", effect);
  }

  // ===========================================================
  // Verificador de acessibilidade
  // ===========================================================
  // Escaneia o DOM da página em busca de problemas comuns de
  // acessibilidade, baseados nos critérios de sucesso da WCAG 2.1:
  //  - 1.1.1 Conteúdo não textual (imagens sem alt)
  //  - 1.4.3 Contraste mínimo (texto vs. fundo)
  //  - 4.1.2 Nome, função, valor (links/botões sem nome acessível)
  //  - 3.3.2 Rótulos ou instruções (campos de formulário sem label)

  const A11Y_PANEL_HOST_ID = "simvisao-a11y-panel-host";

  // --- Utilitários de cor e contraste -------------------------

  function parseRgb(corStr) {
    const match = corStr.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/
    );
    if (!match) return null;
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
  }

  // Sobe a árvore do DOM até encontrar um plano de fundo não
  // transparente. Se nenhum for encontrado, assume branco (padrão
  // do navegador para o elemento <html>).
  function getEffectiveBackgroundColor(el) {
    let atual = el;
    while (atual) {
      const bg = getComputedStyle(atual).backgroundColor;
      const cor = parseRgb(bg);
      if (cor && cor.a > 0) return cor;
      atual = atual.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  // Converte um canal sRGB (0-255) para o espaço linear, conforme a
  // fórmula de luminância relativa da WCAG 2.1.
  function paraLinear(c) {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }

  // Luminância relativa a partir de valores já em espaço linear (0-1)
  function luminanciaDeLinear(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Luminância relativa, conforme fórmula da WCAG 2.1, a partir de uma
  // cor em sRGB (0-255) - usado quando nenhuma simulação está ativa.
  function luminanciaRelativa({ r, g, b }) {
    return luminanciaDeLinear(paraLinear(r), paraLinear(g), paraLinear(b));
  }

  // Aplica a mesma matriz de transformação de cor usada no filtro SVG
  // sobre uma cor específica, em espaço linear (mesmo espaço declarado
  // em color-interpolation-filters="linearRGB" no SVG injetado). Isso
  // permite calcular como o CONTRASTE seria percebido por alguém com
  // aquele tipo de daltonismo, e não apenas como o site aparece "hoje".
  function aplicarMatrizDaltonismoEmLinear({ r, g, b }, matriz) {
    const rl = paraLinear(r);
    const gl = paraLinear(g);
    const bl = paraLinear(b);
    const al = 1; // alpha tratado como opaco

    const novoR = matriz[0] * rl + matriz[1] * gl + matriz[2] * bl + matriz[3] * al + matriz[4];
    const novoG = matriz[5] * rl + matriz[6] * gl + matriz[7] * bl + matriz[8] * al + matriz[9];
    const novoB = matriz[10] * rl + matriz[11] * gl + matriz[12] * bl + matriz[13] * al + matriz[14];

    // O navegador satura (clampa) valores fora de [0,1] nesse espaço
    const clampar = (v) => Math.min(1, Math.max(0, v));
    return { r: clampar(novoR), g: clampar(novoG), b: clampar(novoB) };
  }

  // Aproxima o efeito de CSS contrast(amount) sobre uma cor sRGB
  // (0-255), usado para os efeitos de "baixa-visao" e "baixo-contraste".
  function aplicarFiltroContrasteCss({ r, g, b }, amount) {
    const ajustar = (c) => Math.min(255, Math.max(0, (c - 127.5) * amount + 127.5));
    return { r: ajustar(r), g: ajustar(g), b: ajustar(b) };
  }

  // Calcula a luminância relativa de uma cor sRGB (0-255) LEVANDO EM
  // CONTA o efeito de simulação atualmente ativo na página. É o ponto
  // central da verificação de contraste "sensível à simulação".
  function luminanciaConsiderandoEfeito(corSrgb, efeito, opcoes) {
    if (COLOR_BLINDNESS_MATRICES[efeito]) {
      const linearTransformado = aplicarMatrizDaltonismoEmLinear(
        corSrgb,
        matrizEfetiva(efeito, opcoes)
      );
      return luminanciaDeLinear(
        linearTransformado.r,
        linearTransformado.g,
        linearTransformado.b
      );
    }

    if (efeito === "baixa-visao" || efeito === "baixo-contraste") {
      const amount =
        opcoes && opcoes.contrast !== undefined
          ? opcoes.contrast
          : efeito === "baixa-visao"
          ? 0.6
          : 0.4;
      const transformado = aplicarFiltroContrasteCss(corSrgb, amount);
      return luminanciaRelativa(transformado);
    }

    // "none" ou efeito desconhecido: usa a cor real, sem transformação
    return luminanciaRelativa(corSrgb);
  }

  function razaoDeContrasteComEfeito(cor1, cor2, efeito, opcoes) {
    const l1 = luminanciaConsiderandoEfeito(cor1, efeito, opcoes);
    const l2 = luminanciaConsiderandoEfeito(cor2, efeito, opcoes);
    const claro = Math.max(l1, l2);
    const escuro = Math.min(l1, l2);
    return (claro + 0.05) / (escuro + 0.05);
  }

  function temTextoVisivel(el) {
    return Array.from(el.childNodes).some(
      (no) => no.nodeType === Node.TEXT_NODE && no.textContent.trim().length > 0
    );
  }

  // --- Verificações individuais --------------------------------

  // Verifica o contraste de todo o texto da página, considerando a
  // transformação de cor do efeito atualmente ativo (efeitoAtivo).
  // Quando nenhuma simulação está ativa, o comportamento é idêntico ao
  // cálculo de contraste "real" (WCAG padrão).
  function verificarContraste(efeito, opcoes) {
    const elementos = document.body
      ? document.body.querySelectorAll("*")
      : [];
    const problemáticos = [];

    elementos.forEach((el) => {
      if (!temTextoVisivel(el)) return;
      const estilo = getComputedStyle(el);
      if (estilo.display === "none" || estilo.visibility === "hidden") return;

      const corTexto = parseRgb(estilo.color);
      if (!corTexto) return;
      const corFundo = getEffectiveBackgroundColor(el);

      const tamanhoFonte = parseFloat(estilo.fontSize) || 16;
      const negrito = parseInt(estilo.fontWeight, 10) >= 700;
      const textoGrande = tamanhoFonte >= 24 || (tamanhoFonte >= 18.66 && negrito);
      const limiar = textoGrande ? 3.0 : 4.5;

      const razao = razaoDeContrasteComEfeito(corTexto, corFundo, efeito, opcoes);
      if (razao < limiar) {
        problemáticos.push({ elemento: el, razao: razao.toFixed(2), limiar });
      }
    });

    return problemáticos;
  }

  function verificarImagensSemAlt() {
    return Array.from(document.querySelectorAll("img")).filter((img) => {
      const alt = img.getAttribute("alt");
      return alt === null; // alt ausente (alt="" é decorativo, considerado válido)
    });
  }

  function temNomeAcessivel(el) {
    if (el.getAttribute("aria-label")?.trim()) return true;
    if (el.getAttribute("aria-labelledby")?.trim()) return true;
    if (el.getAttribute("title")?.trim()) return true;
    if (el.textContent?.trim()) return true;
    const imgFilho = el.querySelector("img[alt]");
    if (imgFilho && imgFilho.getAttribute("alt")?.trim()) return true;
    return false;
  }

  function verificarLinksBotoesSemNome() {
    const candidatos = document.querySelectorAll("a[href], button");
    return Array.from(candidatos).filter((el) => !temNomeAcessivel(el));
  }

  function verificarCamposSemLabel() {
    const campos = document.querySelectorAll("input, select, textarea");
    return Array.from(campos).filter((campo) => {
      const tipo = (campo.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset"].includes(tipo)) return false;

      if (campo.id && document.querySelector(`label[for="${campo.id}"]`))
        return false;
      if (campo.closest("label")) return false;
      if (campo.getAttribute("aria-label")?.trim()) return false;
      if (campo.getAttribute("aria-labelledby")?.trim()) return false;
      if (campo.getAttribute("title")?.trim()) return false;

      return true;
    });
  }

  // --- Destaque visual dos elementos problemáticos --------------

  function destacarElementos(elementos, cor) {
    elementos.forEach((el) => {
      el.style.outline = `3px solid ${cor}`;
      el.style.outlineOffset = "2px";
    });
  }

  function removerDestaques() {
    document.querySelectorAll('[data-simvisao-destacado="1"]').forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.removeAttribute("data-simvisao-destacado");
    });
  }

  function marcarComoDestacado(elementos) {
    elementos.forEach((el) => el.setAttribute("data-simvisao-destacado", "1"));
  }

  // --- Painel flutuante (renderizado em Shadow DOM) -------------
  // Usa Shadow DOM para que o CSS do painel não seja afetado pelos
  // estilos do site, e vice-versa.

  function removerPainel() {
    const host = document.getElementById(A11Y_PANEL_HOST_ID);
    if (host) host.remove();
    removerDestaques();
  }

  function criarSecaoPainel(shadowRoot, titulo, itens, corDestaque, montarLinha) {
    const secao = document.createElement("div");
    secao.className = "simvisao-secao";

    const cabecalho = document.createElement("div");
    cabecalho.className = "simvisao-secao-titulo";
    cabecalho.textContent = `${titulo} (${itens.length})`;
    secao.appendChild(cabecalho);

    if (itens.length === 0) {
      const ok = document.createElement("div");
      ok.className = "simvisao-item simvisao-ok";
      ok.textContent = "Nenhum problema encontrado.";
      secao.appendChild(ok);
    } else {
      itens.slice(0, 8).forEach((item) => {
        const linha = document.createElement("div");
        linha.className = "simvisao-item";
        linha.textContent = montarLinha(item);
        secao.appendChild(linha);
      });
      if (itens.length > 8) {
        const resto = document.createElement("div");
        resto.className = "simvisao-item simvisao-mais";
        resto.textContent = `+ ${itens.length - 8} outro(s) caso(s) semelhante(s).`;
        secao.appendChild(resto);
      }
    }

    return secao;
  }

  function mostrarPainelResultados(resultado) {
    removerPainel();

    const host = document.createElement("div");
    host.id = A11Y_PANEL_HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.top = "16px";
    host.style.right = "16px";
    host.style.zIndex = "2147483647";
    host.style.margin = "0";
    // Popover (camada superior do navegador): o painel fica FORA do efeito
    // de filtro aplicado em <html>, então permanece nítido e colorido
    // durante qualquer simulação.
    host.setAttribute("popover", "manual");
    document.documentElement.appendChild(host);
    try {
      host.showPopover();
    } catch (e) {
      // Navegadores sem suporte a popover: o painel só sofre o filtro
    }

    const shadow = host.attachShadow({ mode: "open" });

    const estilo = document.createElement("style");
    estilo.textContent = `
      .simvisao-painel {
        all: initial;
        font-family: system-ui, Arial, sans-serif;
        display: block;
        width: 320px;
        max-height: 80vh;
        overflow-y: auto;
        background: #ffffff;
        color: #1a1a1a;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        border: 1px solid #ddd;
      }
      .simvisao-cabecalho {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: #1f2937;
        color: #fff;
        border-radius: 10px 10px 0 0;
        font-size: 13px;
        font-weight: 600;
      }
      .simvisao-fechar {
        cursor: pointer;
        background: transparent;
        border: none;
        color: #fff;
        font-size: 16px;
        line-height: 1;
        padding: 2px 6px;
      }
      .simvisao-corpo { padding: 10px 12px; }
      .simvisao-secao { margin-bottom: 12px; }
      .simvisao-secao-titulo {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #374151;
        margin-bottom: 4px;
        border-bottom: 1px solid #eee;
        padding-bottom: 3px;
      }
      .simvisao-item {
        font-size: 12px;
        padding: 4px 0;
        color: #b91c1c;
        line-height: 1.35;
      }
      .simvisao-ok { color: #15803d; }
      .simvisao-mais { color: #6b7280; font-style: italic; }
      .simvisao-comparativo {
        font-size: 12px;
        font-weight: 600;
        background: #eef2ff;
        color: #1e3a8a;
        border-radius: 6px;
        padding: 6px 8px;
        margin-bottom: 8px;
      }
      .simvisao-rodape {
        font-size: 11px;
        color: #6b7280;
        padding: 8px 12px;
        border-top: 1px solid #eee;
      }
    `;
    shadow.appendChild(estilo);

    const painel = document.createElement("div");
    painel.className = "simvisao-painel";

    const cabecalho = document.createElement("div");
    cabecalho.className = "simvisao-cabecalho";
    const titulo = document.createElement("span");
    titulo.textContent =
      efeitoAtivo === "none"
        ? "⚠ Verificação de Acessibilidade"
        : `⚠ Verificação de Acessibilidade — simulando: ${NOMES_EFEITOS[efeitoAtivo]}`;
    const botaoFechar = document.createElement("button");
    botaoFechar.className = "simvisao-fechar";
    botaoFechar.textContent = "✕";
    botaoFechar.addEventListener("click", removerPainel);
    cabecalho.appendChild(titulo);
    cabecalho.appendChild(botaoFechar);
    painel.appendChild(cabecalho);

    const corpo = document.createElement("div");
    corpo.className = "simvisao-corpo";

    if (efeitoAlteraContraste(efeitoAtivo)) {
      const comp = document.createElement("div");
      comp.className = "simvisao-comparativo";
      comp.textContent =
        `Contraste — sem simulação: ${resultado.contrasteBase} · ` +
        `com ${NOMES_EFEITOS[efeitoAtivo]}: ${resultado.contraste.length}`;
      corpo.appendChild(comp);
    }

    corpo.appendChild(
      criarSecaoPainel(
        shadow,
        `Contraste insuficiente (considerando: ${NOMES_EFEITOS[efeitoAtivo] || efeitoAtivo})`,
        resultado.contraste,
        "#dc2626",
        (item) =>
          `Razão ${item.razao}:1 (mínimo exigido: ${item.limiar}:1) em <${item.elemento.tagName.toLowerCase()}>`
      )
    );
    corpo.appendChild(
      criarSecaoPainel(
        shadow,
        "Imagens sem texto alternativo",
        resultado.imagens,
        "#dc2626",
        (img) => `<img src="${(img.getAttribute("src") || "").slice(0, 40)}..."> sem atributo alt`
      )
    );
    corpo.appendChild(
      criarSecaoPainel(
        shadow,
        "Links/botões sem nome acessível",
        resultado.linksBotoes,
        "#dc2626",
        (el) => `<${el.tagName.toLowerCase()}> sem texto, aria-label ou title`
      )
    );
    corpo.appendChild(
      criarSecaoPainel(
        shadow,
        "Campos de formulário sem rótulo",
        resultado.campos,
        "#dc2626",
        (campo) =>
          `<${campo.tagName.toLowerCase()}${campo.name ? ` name="${campo.name}"` : ""}> sem label associado`
      )
    );

    painel.appendChild(corpo);

    const rodape = document.createElement("div");
    rodape.className = "simvisao-rodape";
    rodape.textContent =
      efeitoAtivo === "none"
        ? "Os elementos com problemas estão destacados em vermelho na página."
        : `O contraste foi recalculado como seria percebido sob a simulação de ${NOMES_EFEITOS[efeitoAtivo]}. Os elementos problemáticos estão destacados em vermelho.`;
    painel.appendChild(rodape);

    shadow.appendChild(painel);

    // Destaca todos os elementos problemáticos diretamente na página
    const todosOsElementos = [
      ...resultado.contraste.map((c) => c.elemento),
      ...resultado.imagens,
      ...resultado.linksBotoes,
      ...resultado.campos,
    ];
    destacarElementos(todosOsElementos, "#dc2626");
    marcarComoDestacado(todosOsElementos);
  }

  // Efeitos que alteram as cores percebidas (e portanto o contraste).
  // Os demais (nenhum, visão em túnel) não transformam cor.
  function efeitoAlteraContraste(efeito) {
    return !!COLOR_BLINDNESS_MATRICES[efeito] || efeito === "baixa-visao" || efeito === "baixo-contraste";
  }

  function executarVerificacaoDeAcessibilidade() {
    const contraste = verificarContraste(efeitoAtivo, opcoesEfeitoAtivo);
    // Contagem de referência: contraste real da página, sem simulação
    const contrasteBase = efeitoAlteraContraste(efeitoAtivo)
      ? verificarContraste("none", {}).length
      : contraste.length;

    const resultado = {
      contraste,
      contrasteBase,
      imagens: verificarImagensSemAlt(),
      linksBotoes: verificarLinksBotoesSemNome(),
      campos: verificarCamposSemLabel(),
    };
    mostrarPainelResultados(resultado);
    return {
      contraste: resultado.contraste.length,
      contrasteBase,
      imagens: resultado.imagens.length,
      linksBotoes: resultado.linksBotoes.length,
      campos: resultado.campos.length,
    };
  }

  // Escuta comandos vindos do popup (popup.js)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "APPLY_EFFECT") {
      applyEffect(message.effect, message.options);
      sendResponse({ ok: true });
    }

    if (message && message.type === "RUN_A11Y_CHECK") {
      const resumo = executarVerificacaoDeAcessibilidade();
      sendResponse({ ok: true, resumo });
    }

    if (message && message.type === "CLOSE_A11Y_PANEL") {
      removerPainel();
      sendResponse({ ok: true });
    }

    // Retornar true indica resposta assíncrona (boa prática, evita warnings)
    return true;
  });

  // Ao carregar qualquer página, restaura o último efeito escolhido pelo
  // usuário, para que a simulação persista entre navegações/recarregamentos.
  chrome.storage.local.get(
    ["simvisaoEffect", "simvisaoOptions"],
    (result) => {
      if (result.simvisaoEffect && result.simvisaoEffect !== "none") {
        applyEffect(result.simvisaoEffect, result.simvisaoOptions);
      }
    }
  );
})();
