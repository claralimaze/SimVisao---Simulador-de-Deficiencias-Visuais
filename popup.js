// popup.js
// Roda no contexto do popup. Ao clicar em um botão, salva a escolha em
// chrome.storage.local e manda uma mensagem para o content script da aba
// ativa aplicar o efeito imediatamente. Os sliders ajustam parâmetros do
// efeito atual (severidade, desfoque, contraste, raio do túnel).

const botoes = document.querySelectorAll("button[data-effect]");
const statusEl = document.getElementById("status");
const ajustesEl = document.getElementById("ajustes");

const DALTONISMOS = ["protanopia", "deuteranopia", "tritanopia", "acromatopsia"];

// Parâmetros padrão de cada efeito
function opcoesPadrao(effect) {
  if (DALTONISMOS.includes(effect)) return { severidade: 1 };
  if (effect === "baixa-visao") return { blur: 3, contrast: 0.6 };
  if (effect === "baixo-contraste") return { contrast: 0.4 };
  if (effect === "visao-tunel") return { raio: 120 };
  return {};
}

// Definição dos sliders: chave da opção, conversão slider <-> valor e rótulo
const AJUSTES = {
  severidade: { id: "severidade", paraSlider: (v) => Math.round(v * 100), deSlider: (v) => v / 100, rotulo: (v) => `${v}%` },
  blur: { id: "blur", paraSlider: (v) => v, deSlider: (v) => v, rotulo: (v) => `${v}px` },
  contrast: { id: "contrast", paraSlider: (v) => Math.round(v * 100), deSlider: (v) => v / 100, rotulo: (v) => `${v}%` },
  raio: { id: "raio", paraSlider: (v) => v, deSlider: (v) => v, rotulo: (v) => `${v}px` },
};

let efeitoAtual = "none";
let opcoesAtuais = {};

async function getAbaAtiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function destacarBotaoAtivo(effect) {
  botoes.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.effect === effect);
  });
}

function mostrarStatus(texto) {
  statusEl.textContent = texto || "";
}

// Mostra apenas os sliders relevantes ao efeito atual e sincroniza valores
function atualizarAjustes() {
  const chaves = Object.keys(opcoesPadrao(efeitoAtual));
  ajustesEl.classList.toggle("oculto", chaves.length === 0);

  Object.entries(AJUSTES).forEach(([chave, def]) => {
    const linha = document.querySelector(`[data-ajuste="${chave}"]`);
    const visivel = chaves.includes(chave);
    linha.classList.toggle("oculto", !visivel);
    if (!visivel) return;
    const valor = opcoesAtuais[chave] !== undefined ? opcoesAtuais[chave] : opcoesPadrao(efeitoAtual)[chave];
    const slider = document.getElementById(`ajuste-${def.id}`);
    slider.value = def.paraSlider(valor);
    document.getElementById(`valor-${def.id}`).textContent = def.rotulo(Number(slider.value));
  });
}

async function definirEfeito(effect, options) {
  efeitoAtual = effect;
  opcoesAtuais = options || {};
  mostrarStatus("");

  // 1) Persiste a escolha (restaurada em outras páginas/reload)
  await chrome.storage.local.set({
    simvisaoEffect: effect,
    simvisaoOptions: opcoesAtuais,
  });

  destacarBotaoAtivo(effect);
  atualizarAjustes();

  // 2) Aplica imediatamente na aba atual
  const tab = await getAbaAtiva();
  if (!tab || !tab.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "APPLY_EFFECT",
      effect,
      options: opcoesAtuais,
    });
  } catch (erro) {
    // Sem content script na aba: página interna do navegador, ou aba aberta
    // antes de a extensão ser instalada/recarregada.
    mostrarStatus(
      "Não foi possível aplicar nesta aba. Se ela já estava aberta antes de carregar a extensão, aperte F5. Páginas internas (chrome://) não são suportadas."
    );
    console.warn("[SimVisão] Não foi possível aplicar nesta aba:", erro);
  }
}

botoes.forEach((btn) => {
  btn.addEventListener("click", () => {
    const effect = btn.dataset.effect;
    definirEfeito(effect, opcoesPadrao(effect));
  });
});

// Sliders: atualizam a opção correspondente e reaplicam o efeito
Object.entries(AJUSTES).forEach(([chave, def]) => {
  const slider = document.getElementById(`ajuste-${def.id}`);
  slider.addEventListener("input", () => {
    const valor = def.deSlider(Number(slider.value));
    document.getElementById(`valor-${def.id}`).textContent = def.rotulo(Number(slider.value));
    definirEfeito(efeitoAtual, { ...opcoesAtuais, [chave]: valor });
  });
});

// Ao abrir o popup, restaura o efeito ativo e os ajustes salvos
chrome.storage.local.get(["simvisaoEffect", "simvisaoOptions"], (resultado) => {
  efeitoAtual = resultado.simvisaoEffect || "none";
  opcoesAtuais = { ...opcoesPadrao(efeitoAtual), ...(resultado.simvisaoOptions || {}) };
  destacarBotaoAtivo(efeitoAtual);
  atualizarAjustes();
});

// --- Botão "Verificar acessibilidade" ---------------------------

const botaoVerificar = document.getElementById("verificar-a11y");
const resumoEl = document.getElementById("resumo-a11y");

botaoVerificar.addEventListener("click", async () => {
  const tab = await getAbaAtiva();
  if (!tab || !tab.id) return;

  resumoEl.textContent = "Verificando...";

  try {
    const resposta = await chrome.tabs.sendMessage(tab.id, {
      type: "RUN_A11Y_CHECK",
    });

    if (resposta && resposta.resumo) {
      const { contraste, contrasteBase, imagens, linksBotoes, campos } = resposta.resumo;
      const total = contraste + imagens + linksBotoes + campos;

      let texto =
        total === 0
          ? "Nenhum problema encontrado. 🎉"
          : `${total} problema(s) encontrado(s): ` +
            `${contraste} de contraste, ${imagens} imagem(ns) sem alt, ` +
            `${linksBotoes} link/botão sem nome, ${campos} campo(s) sem rótulo. ` +
            `Veja o painel na página.`;
      if (contrasteBase !== undefined && contrasteBase !== contraste) {
        texto += ` (Contraste sem simulação: ${contrasteBase}.)`;
      }
      resumoEl.textContent = texto;
    }
  } catch (erro) {
    resumoEl.textContent =
      "Não foi possível verificar esta página. Se ela já estava aberta antes de carregar a extensão, aperte F5. Páginas internas (chrome://) não são suportadas.";
    console.warn("[SimVisão] Erro ao verificar acessibilidade:", erro);
  }
});
