import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const COLLECTION = "pedidos";

/* =========================================================
   Helpers
   ========================================================= */

function formatBRL(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Normaliza o texto digitado para comparar com o ID do documento
function normalizeCode(str) {
  return (str || "").trim().toUpperCase();
}

// Extrai apenas os dígitos de um código (ex: "AO-BR-AG2268-Z4H" -> "2268")
function extractDigits(str) {
  const matches = (str || "").match(/\d+/g);
  return matches ? matches.join("") : "";
}

// Ícones usados na timeline, por status
const STATUS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>`;

// Formata valor como "670,00" (sem "R$", usado na mensagem para o cliente)
function formatValorSimples(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Gera um código de rastreio aleatório no padrão AO-BR-AG####-XXX
function gerarCodigoAleatorio() {
  const digitos = String(Math.floor(1000 + Math.random() * 9000)); // 4 dígitos
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem caracteres ambíguos
  let sufixo = "";
  for (let i = 0; i < 3; i++) {
    sufixo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }
  return `AO-BR-AG${digitos}-${sufixo}`;
}

// Gera um código de rastreio garantindo que ainda não exista no Firestore
async function gerarCodigoUnico() {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const candidato = gerarCodigoAleatorio();
    const snap = await getDoc(doc(db, COLLECTION, candidato));
    if (!snap.exists()) return candidato;
  }
  // Fallback improvável: adiciona timestamp para garantir unicidade
  return `${gerarCodigoAleatorio()}-${Date.now().toString().slice(-4)}`;
}

/* =========================================================
   PÁGINA DO CLIENTE (index.html)
   ========================================================= */

function initClientPage() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const btn = document.getElementById("search-btn");

  const stateInitial = document.getElementById("state-initial");
  const stateLoading = document.getElementById("state-loading");
  const stateEmpty = document.getElementById("state-empty");
  const resultContainer = document.getElementById("result-container");

  function showState(state) {
    stateInitial.classList.add("hidden");
    stateLoading.classList.add("hidden");
    stateEmpty.classList.add("hidden");
    resultContainer.classList.add("hidden");
    if (state) state.classList.remove("hidden");
  }

  async function buscarPedido(termoOriginal) {
    const termo = normalizeCode(termoOriginal);
    if (!termo) return;

    showState(stateLoading);
    btn.disabled = true;

    try {
      // 1) Tenta encontrar diretamente pelo código completo (ID do documento)
      let snap = await getDoc(doc(db, COLLECTION, termo));
      let data = snap.exists() ? snap.data() : null;

      // 2) Se não encontrou, tenta buscar pelos dígitos do código (ex: "2268")
      if (!data) {
        const digitos = extractDigits(termo);
        if (digitos) {
          const q = query(
            collection(db, COLLECTION),
            where("numeroBusca", "==", digitos)
          );
          const results = await getDocs(q);
          if (!results.empty) {
            data = results.docs[0].data();
          }
        }
      }

      if (!data) {
        showState(stateEmpty);
        return;
      }

      renderPedido(data);
      showState(resultContainer);
    } catch (err) {
      console.error("Erro ao buscar pedido:", err);
      showState(stateEmpty);
    } finally {
      btn.disabled = false;
    }
  }

  function renderPedido(data) {
    document.getElementById("tracking-code").textContent = data.codigo || "—";
    document.getElementById("status-current").textContent = data.status || "—";
    document.getElementById("cliente-nome").textContent = data.clienteNome || "—";
    document.getElementById("cliente-destino").textContent = data.destino || "—";
    document.getElementById("endereco-completo").textContent = data.enderecoCompleto || "—";
    document.getElementById("frete-seguro").textContent = formatBRL(data.frete);
    document.getElementById("valor-total").textContent = formatBRL(data.valorTotal);

    // Produtos
    const produtosList = document.getElementById("produtos-list");
    produtosList.innerHTML = "";
    (data.produtos || []).forEach((p) => {
      const row = document.createElement("div");
      row.className = "product-row";
      row.innerHTML = `
        <span class="name">${escapeHTML(p.nome)}</span>
        <span class="price">${formatBRL(p.valor)}</span>
      `;
      produtosList.appendChild(row);
    });

    // Timeline (mais recente primeiro)
    const timelineList = document.getElementById("timeline-list");
    timelineList.innerHTML = "";
    const historico = [...(data.historico || [])].sort(
      (a, b) => new Date(b.dataHora) - new Date(a.dataHora)
    );

    historico.forEach((evento, index) => {
      const isLast = index === historico.length - 1;
      const item = document.createElement("div");
      item.className = "timeline-item" + (index > 0 ? " is-past" : "");
      item.innerHTML = `
        <div class="icon-col">
          <div class="timeline-icon">${STATUS_ICON}</div>
          ${!isLast ? '<div class="timeline-line"></div>' : ""}
        </div>
        <div class="timeline-content">
          <div class="timeline-status">${escapeHTML(evento.status)}</div>
          <div class="timeline-meta">${formatDateTime(evento.dataHora)}</div>
          ${evento.localizacao ? `<div class="timeline-location">${escapeHTML(evento.localizacao)}</div>` : ""}
        </div>
      `;
      timelineList.appendChild(item);
    });
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    buscarPedido(input.value);
  });

  // Botão de PDF (simulado)
  document.getElementById("btn-pdf").addEventListener("click", () => {
    const original = document.getElementById("btn-pdf").innerHTML;
    document.getElementById("btn-pdf").innerHTML = '<span class="spinner"></span> Gerando...';
    setTimeout(() => {
      document.getElementById("btn-pdf").innerHTML = original;
      alert("Resumo em PDF gerado com sucesso! (funcionalidade simulada)");
    }, 900);
  });
}

/* =========================================================
   PAINEL ADMINISTRATIVO (admin.html)
   ========================================================= */

function initAdminPage() {
  const tabNovo = document.getElementById("tab-novo");
  const tabBuscar = document.getElementById("tab-buscar");
  const panelBuscar = document.getElementById("panel-buscar");
  const formTitle = document.getElementById("form-title");

  const form = document.getElementById("pedido-form");
  const feedback = document.getElementById("form-feedback");
  const btnSalvar = document.getElementById("btn-salvar");

  const fCodigo = document.getElementById("f-codigo");
  const fNome = document.getElementById("f-nome");
  const fCidadeUf = document.getElementById("f-cidade-uf");
  const fProdutos = document.getElementById("f-produtos");
  const fFrete = document.getElementById("f-frete");
  const fTotal = document.getElementById("f-total");
  const fEndereco = document.getElementById("f-endereco");
  const fStatus = document.getElementById("f-status");
  const fLocalizacao = document.getElementById("f-localizacao");

  let historicoAtual = []; // histórico do pedido carregado, se houver

  // ---- Gera um código novo para um pedido novo (limpa o formulário) ----
  async function iniciarNovoPedido() {
    form.reset();
    historicoAtual = [];
    formTitle.textContent = "Dados do pedido";
    document.getElementById("mensagem-card").style.display = "none";
    fCodigo.value = "Gerando código...";
    fCodigo.value = await gerarCodigoUnico();
  }

  // ---- Tabs ----
  tabNovo.addEventListener("click", () => {
    tabNovo.classList.add("active");
    tabBuscar.classList.remove("active");
    panelBuscar.style.display = "none";
    iniciarNovoPedido();
  });

  tabBuscar.addEventListener("click", () => {
    tabBuscar.classList.add("active");
    tabNovo.classList.remove("active");
    panelBuscar.style.display = "block";
  });

  // ---- Buscar pedido existente para editar ----
  document.getElementById("btn-buscar").addEventListener("click", async () => {
    const codigo = normalizeCode(document.getElementById("buscar-codigo").value);
    const buscarFeedback = document.getElementById("buscar-feedback");
    buscarFeedback.className = "admin-feedback";

    if (!codigo) {
      showFeedback(buscarFeedback, "Digite um código para buscar.", "error");
      return;
    }

    try {
      const snap = await getDoc(doc(db, COLLECTION, codigo));
      if (!snap.exists()) {
        showFeedback(buscarFeedback, "Nenhum pedido encontrado com esse código.", "error");
        return;
      }

      const data = snap.data();
      preencherFormulario(data);
      historicoAtual = data.historico || [];
      showFeedback(buscarFeedback, "Pedido carregado! Edite os campos abaixo e salve.", "success");
      formTitle.textContent = `Editando pedido: ${data.codigo}`;
    } catch (err) {
      console.error("Erro ao buscar pedido:", err);
      showFeedback(buscarFeedback, "Erro ao buscar o pedido. Tente novamente.", "error");
    }
  });

  function preencherFormulario(data) {
    document.getElementById("mensagem-card").style.display = "none";
    fCodigo.value = data.codigo || "";
    fNome.value = data.clienteNome || "";
    fCidadeUf.value = data.destino || "";
    fProdutos.value = (data.produtos || [])
      .map((p) => `${p.nome} - ${p.valor}`)
      .join("\n");
    fFrete.value = data.frete ?? "";
    fTotal.value = data.valorTotal ?? "";
    fEndereco.value = data.enderecoCompleto || "";
    fStatus.value = data.status || "Confirmado";
    fLocalizacao.value = "";
  }

  // ---- Parse do textarea de produtos ----
  function parseProdutos(texto) {
    return texto
      .split("\n")
      .map((linha) => linha.trim())
      .filter(Boolean)
      .map((linha) => {
        const partes = linha.split(" - ");
        const valor = parseFloat(partes[partes.length - 1].replace(",", "."));
        const nome = partes.length > 1 ? partes.slice(0, -1).join(" - ") : linha;
        return {
          nome: nome.trim(),
          valor: isNaN(valor) ? 0 : valor
        };
      });
  }

  // ---- Salvar (criar ou atualizar) ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    feedback.className = "admin-feedback";

    const codigo = normalizeCode(fCodigo.value);
    if (!codigo) {
      showFeedback(feedback, "Informe o código do pedido.", "error");
      return;
    }

    btnSalvar.disabled = true;
    const originalBtnHTML = btnSalvar.innerHTML;
    btnSalvar.innerHTML = '<span class="spinner"></span> Salvando...';

    try {
      const novoStatus = fStatus.value;
      const localizacaoInformada = fLocalizacao.value.trim();

      // Verifica se o status mudou em relação ao último evento do histórico
      const ultimoStatus = historicoAtual.length
        ? historicoAtual[historicoAtual.length - 1].status
        : null;

      let historicoAtualizado = [...historicoAtual];
      if (novoStatus !== ultimoStatus) {
        historicoAtualizado.push({
          status: novoStatus,
          dataHora: new Date().toISOString(),
          localizacao: localizacaoInformada || fCidadeUf.value.trim()
        });
      }

      const pedidoData = {
        codigo: codigo,
        numeroBusca: extractDigits(codigo),
        clienteNome: fNome.value.trim(),
        destino: fCidadeUf.value.trim(),
        produtos: parseProdutos(fProdutos.value),
        frete: parseFloat(fFrete.value) || 0,
        valorTotal: parseFloat(fTotal.value) || 0,
        enderecoCompleto: fEndereco.value.trim(),
        status: novoStatus,
        historico: historicoAtualizado,
        atualizadoEm: new Date().toISOString(),
        criadoEm: historicoAtual.length ? undefined : new Date().toISOString()
      };

      // Remove campos undefined antes de gravar
      Object.keys(pedidoData).forEach((key) => {
        if (pedidoData[key] === undefined) delete pedidoData[key];
      });

      await setDoc(doc(db, COLLECTION, codigo), pedidoData, { merge: true });

      historicoAtual = historicoAtualizado;
      showFeedback(feedback, `Pedido ${codigo} salvo com sucesso!`, "success");
      exibirMensagemCliente(pedidoData);
    } catch (err) {
      console.error("Erro ao salvar pedido:", err);
      showFeedback(feedback, "Erro ao salvar o pedido. Verifique os dados e tente novamente.", "error");
    } finally {
      btnSalvar.disabled = false;
      btnSalvar.innerHTML = originalBtnHTML;
    }
  });

  // ---- Monta a mensagem pronta para copiar e enviar ao cliente ----
  function montarMensagemCliente(pedidoData) {
    const linhasProdutos = pedidoData.produtos
      .map((p) => `* ${p.nome} — R$ ${formatValorSimples(p.valor)}`)
      .join("\n");

    return [
      `Cliente: ${pedidoData.clienteNome} (#${pedidoData.numeroBusca})`,
      `📦 Produto:`,
      linhasProdutos,
      `🚚 Frete + Seguro (primeira compra):`,
      `* R$ ${formatValorSimples(pedidoData.frete)}`,
      `💰 Valor total:`,
      `* R$ ${formatValorSimples(pedidoData.valorTotal)}`,
      `📍 Endereço de entrega:`,
      pedidoData.enderecoCompleto,
      ``,
      `Por gentileza, confirme se os dados acima estão corretos.`
    ].join("\n");
  }

  function exibirMensagemCliente(pedidoData) {
    const mensagemCard = document.getElementById("mensagem-card");
    const mensagemTexto = document.getElementById("mensagem-texto");
    mensagemTexto.textContent = montarMensagemCliente(pedidoData);
    mensagemCard.style.display = "block";
    mensagemCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("btn-copiar-mensagem").addEventListener("click", async () => {
    const btnCopiar = document.getElementById("btn-copiar-mensagem");
    const texto = document.getElementById("mensagem-texto").textContent;
    const originalHTML = btnCopiar.innerHTML;

    try {
      await navigator.clipboard.writeText(texto);
    } catch (err) {
      // Fallback para navegadores sem suporte à Clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = texto;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    btnCopiar.textContent = "Mensagem copiada!";
    setTimeout(() => {
      btnCopiar.innerHTML = originalHTML;
    }, 1800);
  });

  function showFeedback(el, message, type) {
    el.textContent = message;
    el.className = `admin-feedback show ${type}`;
  }

  // Ao carregar a página, já gera um código para um novo pedido
  iniciarNovoPedido();
}

/* =========================================================
   Detecta a página atual e inicializa
   ========================================================= */

if (document.getElementById("search-form")) {
  initClientPage();
} else if (document.getElementById("pedido-form")) {
  initAdminPage();
}
