// Envio por WhatsApp em PDF.
//
// O WhatsApp Web/app nao aceita anexo por URL (wa.me so leva texto), entao o PDF
// e gerado aqui e entregue pelo Web Share do aparelho - que no celular mostra o
// WhatsApp na lista. Onde o Share nao aceita arquivo (desktop), o PDF e baixado
// e o WhatsApp abre com o texto pedindo para anexar.
//
// jsPDF entra sob demanda (CDN) para nao pesar o boot de quem so vai contar.
import { pushMessage, formatTipoLabelValue } from "../core/utils.js";
import { hydrateInventoryRow } from "../core/inventory-core.js";

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const AUTOTABLE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

async function loadJsPdf() {
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  const ctor = window.jspdf?.jsPDF;
  if (!ctor) throw new Error("jsPDF nao disponivel.");
  return ctor;
}

function buildPdfBlob(JsPDF, { title, meta, rows }) {
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(15);
  doc.text(title, 40, 46);
  doc.setFontSize(9);
  doc.setTextColor(102, 112, 133);
  doc.text(meta, 40, 62);
  doc.autoTable({
    startY: 76,
    head: [["Setor", "Produto", "Marca", "Tipo", "Cx/Pallet", "Pallets", "Avulsas", "Total"]],
    body: rows.map((row) => {
      const item = hydrateInventoryRow(row);
      return [
        item.setor || "--",
        item.produto || "",
        item.marca || "",
        formatTipoLabelValue(item.produto, item.tipo, item.marca),
        item.caixas_pallet,
        item.pallets,
        item.caixas_avulsas || "",
        item.total_caixas,
      ];
    }),
    styles: { fontSize: 8.5, cellPadding: 4, textColor: 17, lineColor: 17, lineWidth: 0.4 },
    headStyles: { fillColor: [242, 244, 247], textColor: 17, fontStyle: "bold" },
    columnStyles: {
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right", fontStyle: "bold" },
    },
  });
  return doc.output("blob");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Gera o PDF das linhas e entrega para o WhatsApp.
 * @param {object} options
 * @param {string} options.title  Titulo impresso no topo do PDF.
 * @param {string} options.meta   Linha de contexto (itens, total, data).
 * @param {Array}  options.rows   Linhas de inventario.
 * @param {string} options.filename
 */
export async function shareRowsAsPdf({ title, meta, rows, filename }) {
  try {
    const JsPDF = await loadJsPdf();
    const blob = buildPdfBlob(JsPDF, { title, meta, rows });
    const file = new File([blob], filename, { type: "application/pdf" });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text: `${title} - ${meta}` });
      return;
    }

    downloadBlob(blob, filename);
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${title}\n${meta}\n\n(PDF baixado neste aparelho - anexe na conversa)`)}`,
      "_blank",
      "noopener",
    );
    pushMessage("info", "PDF baixado. Anexe o arquivo na conversa do WhatsApp.");
  } catch (error) {
    // AbortError = o proprio operador fechou a folha de compartilhamento.
    if (error?.name === "AbortError") return;
    pushMessage("error", `Nao foi possivel gerar o PDF: ${error?.message || error}`);
  }
}
