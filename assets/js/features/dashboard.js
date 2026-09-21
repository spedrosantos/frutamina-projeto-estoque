// Overview da Visao Geral (KPIs, barras, historico, marcas) e o
// renderizador de grafico de linha reaproveitado pelo historico por produto.
import { state, elements, PAGE_MODE } from "../core/state.js";
import { toNonNegativeInt, formatNumber, formatPercent } from "../core/utils.js";
import { hydrateInventoryRow } from "../core/inventory-core.js";
import { formatUserLabel, formatDateTime } from "./tables.js";

// Exportada para reuso pelo grafico de historico por produto (historico-produto.js) —
// desenho de canvas generico a partir de {values, dates}, sem saber de dominio.
export function renderLineChart(canvas, series, options = {}) {
  if (!canvas) return;
  const values = series?.values || [];
  const dates = series?.dates || [];
  canvas.style.width = "";
  const parentWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 900;
  const height = options.height || 260;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = parentWidth * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${parentWidth}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padding = {
    top: 24,
    right: 20,
    bottom: options.showLabels ? 34 : 16,
    left: options.showLabels ? 40 : 12,
  };
  const width = parentWidth;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);

  const maxValue = values.length ? Math.max(...values, 1) : 1;
  const minValue = values.length ? Math.min(...values, 0) : 0;
  const range = maxValue - minValue || 1;

  const getX = (index) => padding.left + (innerWidth * index) / Math.max(values.length - 1, 1);
  const getY = (value) => padding.top + innerHeight - ((value - minValue) / range) * innerHeight;

  ctx.strokeStyle = options.gridColor || "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1;
  ctx.font = "11px 'Inter', sans-serif";
  ctx.fillStyle = options.labelColor || "rgba(148, 163, 184, 0.9)";
  for (let i = 0; i < 3; i += 1) {
    const y = padding.top + (innerHeight * i) / 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    if (options.showLabels) {
      const value = maxValue - (range * i) / 2;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(value).toLocaleString("pt-BR"), padding.left - 8, y);
    }
  }

  if (options.showLabels && dates.length) {
    const steps = Math.min(4, dates.length - 1);
    ctx.textBaseline = "top";
    for (let i = 0; i <= steps; i += 1) {
      const index = steps ? Math.round((i * (dates.length - 1)) / steps) : 0;
      const date = dates[index];
      if (!date) continue;
      const x = getX(index);
      ctx.textAlign = i === 0 ? "left" : i === steps ? "right" : "center";
      ctx.fillText(
        new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date),
        x,
        padding.top + innerHeight + 10,
      );
    }
  }

  if (values.length) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = getX(index);
      const y = getY(value);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = options.lineColor || "#93c5fd";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, padding.top, 0, height);
    gradient.addColorStop(0, options.fillStart || "rgba(59, 130, 246, 0.35)");
    gradient.addColorStop(1, options.fillEnd || "rgba(59, 130, 246, 0.05)");
    ctx.lineTo(padding.left + innerWidth, padding.top + innerHeight);
    ctx.lineTo(padding.left, padding.top + innerHeight);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    const lastIndex = values.length - 1;
    const lastX = getX(lastIndex);
    const lastY = getY(values[lastIndex]);
    ctx.fillStyle = options.lineColor || "#93c5fd";
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (Number.isInteger(options.hoverIndex)) {
    const index = Math.max(0, Math.min(values.length - 1, options.hoverIndex));
    const hx = getX(index);
    const hy = getY(values[index]);
    ctx.save();
    ctx.strokeStyle = options.hoverLineColor || "rgba(148, 163, 184, 0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, padding.top);
    ctx.lineTo(hx, padding.top + innerHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = options.hoverDotColor || options.lineColor || "#93c5fd";
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    width,
    height,
    padding,
    innerWidth,
    innerHeight,
    getX,
    getY,
    values,
    dates,
  };
}

const DASHBOARD_OVERVIEW_COLORS = [
  "#2563eb",
  "#16a34a",
  "#b45309",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#059669",
  "#4f46e5",
];

// A sobra do donut acompanha o tema (antes era um azul-escuro fixo, que
// aparecia como mancha no tema claro).
function readOverviewTrackColor() {
  const value = getComputedStyle(document.body).getPropertyValue("--app-track").trim();
  return value || "#eef0f4";
}

function getDashboardSnapshotHistory() {
  const snapshotsAsc = (state.snapshotRows || [])
    .map((row) => {
      const dateValue = row?.created_at || row?.updated_at;
      const date = dateValue ? new Date(dateValue) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      return {
        date,
        total: toNonNegativeInt(row?.total_caixas, 0),
        outflow: toNonNegativeInt(row?.outflow_caixas, 0),
        userId: row?.user_id || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  const entries = snapshotsAsc.map((entry, index) => {
    const previous = snapshotsAsc[index - 1] || null;
    const delta = previous ? entry.total - previous.total : 0;
    const eventBase =
      entry.outflow > 0
        ? `Contagem completa · saída ${formatNumber(entry.outflow)} cx`
        : "Snapshot de estoque";
    return {
      when: entry.date,
      operator: formatUserLabel(entry.userId),
      event: `${eventBase} · ${formatNumber(entry.total)} cx`,
      total: entry.total,
      delta,
    };
  });

  return entries.reverse();
}

function buildDashboardOverviewData() {
  const rows = (state.publicRows || []).map((row) => hydrateInventoryRow(row));
  const totalCaixas = rows.reduce((sum, row) => sum + toNonNegativeInt(row.total_caixas, 0), 0);
  const totalPallets = rows.reduce((sum, row) => sum + toNonNegativeInt(row.pallets, 0), 0);

  const setorMap = new Map();
  const produtoMap = new Map();
  const marcaMap = new Map();

  rows.forEach((row) => {
    const setor = row.setor || "Sem setor";
    const produto = row.produto || "Sem produto";
    const marca = row.marca || "Sem marca";
    const totalRow = toNonNegativeInt(row.total_caixas, 0);
    const palletsRow = toNonNegativeInt(row.pallets, 0);

    setorMap.set(setor, (setorMap.get(setor) || 0) + totalRow);

    const productKey = `${produto}|||${marca}`;
    const productCurrent = produtoMap.get(productKey) || {
      produto,
      marca,
      totalCaixas: 0,
      pallets: 0,
      setores: new Set(),
    };
    productCurrent.totalCaixas += totalRow;
    productCurrent.pallets += palletsRow;
    productCurrent.setores.add(setor);
    produtoMap.set(productKey, productCurrent);

    const marcaCurrent = marcaMap.get(marca) || {
      marca,
      totalCaixas: 0,
      pallets: 0,
      produtos: new Set(),
    };
    marcaCurrent.totalCaixas += totalRow;
    marcaCurrent.pallets += palletsRow;
    marcaCurrent.produtos.add(produto);
    marcaMap.set(marca, marcaCurrent);
  });

  const setores = Array.from(setorMap.entries())
    .map(([setor, total]) => ({ setor, total }))
    .sort((a, b) => b.total - a.total);

  const produtos = Array.from(produtoMap.values())
    .map((item) => ({
      ...item,
      setorCount: item.setores.size,
    }))
    .sort((a, b) => b.totalCaixas - a.totalCaixas);

  const marcas = Array.from(marcaMap.values())
    .map((item) => ({
      marca: item.marca,
      totalCaixas: item.totalCaixas,
      pallets: item.pallets,
      produtos: item.produtos.size,
    }))
    .sort((a, b) => b.totalCaixas - a.totalCaixas);

  const history = getDashboardSnapshotHistory();
  const latestSnapshot = history[0];
  const previousSnapshot = history[1];

  let totalCaixasMeta = "Sem base comparativa ainda.";
  if (latestSnapshot && previousSnapshot) {
    const diff = latestSnapshot.delta;
    const sign = diff >= 0 ? "+" : "-";
    const prevTotal = toNonNegativeInt(previousSnapshot.total, 0);
    const pct = previousSnapshot && prevTotal > 0 ? (Math.abs(diff) / prevTotal) * 100 : null;
    const pctText = Number.isFinite(pct) ? ` (${formatPercent(pct)}%)` : "";
    totalCaixasMeta = `${sign}${formatNumber(Math.abs(diff))} cx${pctText} vs. contagem anterior`;
  }

  const setorLabel = setores.length === 1 ? "setor" : "setores";
  const marcaLabel = marcas.length === 1 ? "marca" : "marcas";

  return {
    totalCaixas,
    totalPallets,
    produtosDistintos: produtos.length,
    marcasDistintas: marcas.length,
    setores,
    produtos,
    marcas,
    history,
    totalCaixasMeta,
    palletsMeta: `${setores.length} ${setorLabel} com pallets ativos`,
    produtosMeta: `${marcas.length} ${marcaLabel} cadastradas`,
  };
}

function renderDashboardSetorBars(setores) {
  if (!elements.ovSetorBars) return;
  elements.ovSetorBars.innerHTML = "";

  if (!setores.length) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = "Sem dados de setor no momento.";
    elements.ovSetorBars.appendChild(empty);
    return;
  }

  const maxValue = Math.max(...setores.map((item) => item.total), 1);
  setores.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "overview-bar-row";

    const label = document.createElement("span");
    label.className = "overview-bar-label";
    label.textContent = item.setor;

    const track = document.createElement("div");
    track.className = "overview-bar-track";

    const fill = document.createElement("div");
    fill.className = "overview-bar-fill";
    fill.style.width = `${Math.max(6, (item.total / maxValue) * 100)}%`;
    fill.style.setProperty(
      "--bar-color",
      DASHBOARD_OVERVIEW_COLORS[index % DASHBOARD_OVERVIEW_COLORS.length],
    );

    const value = document.createElement("span");
    value.className = "overview-bar-value";
    value.textContent = formatNumber(item.total);

    fill.appendChild(value);
    track.appendChild(fill);
    row.append(label, track);
    elements.ovSetorBars.appendChild(row);
  });
}

function renderDashboardTopProducts(produtos) {
  if (!elements.ovTopProdutosList) return;
  elements.ovTopProdutosList.innerHTML = "";

  const topList = produtos.slice(0, 7);
  if (!topList.length) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = "Sem produtos para exibir.";
    elements.ovTopProdutosList.appendChild(empty);
    return;
  }

  topList.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "overview-top-item";

    const rank = document.createElement("span");
    rank.className = "overview-rank";
    rank.textContent = `#${index + 1}`;

    const details = document.createElement("div");
    details.className = "overview-top-details";

    const name = document.createElement("strong");
    name.textContent = item.produto;

    const brand = document.createElement("span");
    brand.textContent = item.marca;

    details.append(name, brand);

    const total = document.createElement("strong");
    total.className = "overview-top-total";
    total.textContent = `${formatNumber(item.totalCaixas)} cx`;

    row.append(rank, details, total);
    elements.ovTopProdutosList.appendChild(row);
  });
}

function renderDashboardHistory(history) {
  if (!elements.ovHistoryBody) return;
  elements.ovHistoryBody.innerHTML = "";

  const rows = history.slice(0, 8);
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" class="overview-empty-cell">Sem histórico registrado.</td>';
    elements.ovHistoryBody.appendChild(tr);
    return;
  }

  rows.forEach((entry) => {
    const tr = document.createElement("tr");
    const deltaClass = entry.delta > 0 ? "positive" : entry.delta < 0 ? "negative" : "neutral";
    const deltaSign = entry.delta > 0 ? "+" : "";
    // O nome do operador vem da tabela usuarios_label, ou seja, de fora: e o
    // unico texto desta tela que nao passa pela whitelist do catalogo. Vai por
    // textContent para nao poder virar HTML.
    tr.innerHTML = `
      <td>${formatDateTime(entry.when)}</td>
      <td class="overview-operator"></td>
      <td>${entry.event}</td>
      <td class="overview-delta ${deltaClass}">${deltaSign}${formatNumber(entry.delta)} cx</td>
    `;
    tr.querySelector(".overview-operator").textContent = entry.operator;
    elements.ovHistoryBody.appendChild(tr);
  });
}

function buildDashboardBrandGradient(marcas) {
  if (!marcas.length) {
    return `conic-gradient(${readOverviewTrackColor()} 0 100%)`;
  }
  const total = marcas.reduce((sum, item) => sum + item.totalCaixas, 0) || 1;
  let cursor = 0;
  const segments = marcas.map((item, index) => {
    const share = (item.totalCaixas / total) * 100;
    const start = cursor;
    const end = Math.min(100, start + share);
    cursor = end;
    return `${DASHBOARD_OVERVIEW_COLORS[index % DASHBOARD_OVERVIEW_COLORS.length]} ${start.toFixed(
      2,
    )}% ${end.toFixed(2)}%`;
  });
  if (cursor < 100) {
    segments.push(`${readOverviewTrackColor()} ${cursor.toFixed(2)}% 100%`);
  }
  return `conic-gradient(${segments.join(", ")})`;
}

function renderDashboardBrands(data) {
  if (elements.ovBrandChartTotal) {
    elements.ovBrandChartTotal.textContent = formatNumber(data.marcasDistintas);
  }
  if (elements.ovBrandChart) {
    elements.ovBrandChart.style.setProperty(
      "--app-brand-donut",
      buildDashboardBrandGradient(data.marcas),
    );
  }
  if (!elements.ovBrandGrid) return;
  elements.ovBrandGrid.innerHTML = "";

  if (!data.marcas.length) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = "Sem marcas para exibir.";
    elements.ovBrandGrid.appendChild(empty);
    return;
  }

  data.marcas.forEach((marca, index) => {
    const card = document.createElement("article");
    card.className = "overview-brand-item";
    card.style.setProperty(
      "--brand-accent",
      DASHBOARD_OVERVIEW_COLORS[index % DASHBOARD_OVERVIEW_COLORS.length],
    );

    const label = document.createElement("span");
    label.className = "overview-brand-label";
    label.textContent = marca.marca;

    const total = document.createElement("strong");
    total.className = "overview-brand-total";
    total.textContent = formatNumber(marca.totalCaixas);

    const meta = document.createElement("span");
    meta.className = "overview-brand-meta";
    meta.textContent = `${formatNumber(marca.produtos)} produtos · ${formatNumber(
      marca.pallets,
    )} pallets`;

    card.append(label, total, meta);
    elements.ovBrandGrid.appendChild(card);
  });
}

function renderDashboardOverview() {
  if (PAGE_MODE !== "dashboard") return;
  if (!elements.ovTotalCaixas) return;

  // Sem linha nenhuma e com consulta em voo, os cards escreveriam 0 - um numero
  // errado na cara do operador, que nao distingue "estoque zerado" de "ainda
  // carregando". Mantem o "--" do HTML e liga o skeleton ate a rede responder.
  const carregandoVazio = state.carregando && !(state.publicRows || []).length;
  document.body.classList.toggle("dash-loading", carregandoVazio);
  if (carregandoVazio) return;

  const data = buildDashboardOverviewData();

  if (elements.ovTotalCaixas) {
    elements.ovTotalCaixas.textContent = formatNumber(data.totalCaixas);
  }
  if (elements.ovTotalCaixasMeta) {
    elements.ovTotalCaixasMeta.textContent = data.totalCaixasMeta;
  }
  if (elements.ovTotalPallets) {
    elements.ovTotalPallets.textContent = formatNumber(data.totalPallets);
  }
  if (elements.ovTotalPalletsMeta) {
    elements.ovTotalPalletsMeta.textContent = data.palletsMeta;
  }
  if (elements.ovProdutosDistintos) {
    elements.ovProdutosDistintos.textContent = formatNumber(data.produtosDistintos);
  }
  if (elements.ovProdutosDistintosMeta) {
    elements.ovProdutosDistintosMeta.textContent = data.produtosMeta;
  }
  renderDashboardSetorBars(data.setores);
  renderDashboardTopProducts(data.produtos);
  renderDashboardHistory(data.history);
  renderDashboardBrands(data);
}

export function renderDashboard() {
  if (PAGE_MODE !== "dashboard") return;
  if (elements.ovTotalCaixas) renderDashboardOverview();
}
