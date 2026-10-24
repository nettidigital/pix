// Admin das placas PIX: gera códigos novos e o PDF A4 (4 cards 10x10 cm com QR de cada placa).
// Sistema SEPARADO das placas de avaliação: usa o store "pix" e a rota /pixpdf. Não toca em app.mjs nem pdf.mjs.
import { getStore } from "@netlify/blobs";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomBytes } from "node:crypto";

export const config = { path: ["/pixpdf"] };

const store = () => getStore({ name: "pix", consistency: "strong" });
const AL = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const novoCodigo = () => Array.from(randomBytes(6), b => AL[b % AL.length]).join("");
const limpa = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- geometria do card (arte 1254 px = 10 cm) ---------- */
const CM = 28.3465, W = 595.28, H = 841.89;
const CARD = 10 * CM, ART = 1254, S = CARD / ART;
const QR_X = 744, QR_Y = 608, QR_SIZE = 392; // área do QR na arte (px, origem no topo-esquerda)

function auth(req) {
  const pass = process.env.ADMIN_PASS;
  if (!pass) return false;
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(h.slice(6), "base64").toString().split(":");
  return user === "admin" && rest.join(":") === pass;
}
const pedeSenha = () => new Response("Acesso restrito", { status: 401, headers: { "www-authenticate": 'Basic realm="Netti Pix"' } });

async function buildPdf(codigos, origin) {
  const r = await fetch(origin + "/arte-pix.jpg");
  if (!r.ok) throw new Error("Arte /arte-pix.jpg não encontrada no site (suba public/arte-pix.jpg no GitHub).");
  const pdf = await PDFDocument.create();
  const arte = await pdf.embedJpg(new Uint8Array(await r.arrayBuffer()));
  const fonte = await pdf.embedFont(StandardFonts.HelveticaBold);
  const x0 = (W - 2 * CARD) / 2, y0 = (H - 2 * CARD) / 2;
  let page;
  codigos.forEach((codigo, i) => {
    if (i % 4 === 0) page = pdf.addPage([W, H]);
    const pos = i % 4, col = pos % 2, lin = Math.floor(pos / 2);
    const x = x0 + col * CARD;
    const yTopo = y0 + 2 * CARD - lin * CARD; // topo do card
    const y = yTopo - CARD;
    page.drawImage(arte, { x, y, width: CARD, height: CARD });
    // QR vetorial
    const qr = QRCode.create(`${origin}/x/${codigo}`, { errorCorrectionLevel: "M" });
    const n = qr.modules.size, m = (QR_SIZE * S) / n;
    const qx = x + QR_X * S, qyTopo = yTopo - QR_Y * S;
    for (let ry = 0; ry < n; ry++) for (let cx = 0; cx < n; cx++) {
      if (qr.modules.get(ry, cx)) page.drawRectangle({ x: qx + cx * m - 0.15, y: qyTopo - (ry + 1) * m - 0.15, width: m + 0.3, height: m + 0.3, color: rgb(0, 0, 0) });
    }
    // código pequeno para conferência
    const t = codigo, tw = fonte.widthOfTextAtSize(t, 6);
    page.drawText(t, { x: x + CARD / 2 - tw / 2, y: y + 9, size: 6, font: fonte, color: rgb(0.55, 0.55, 0.55) });
    // linhas de corte
    page.drawRectangle({ x, y, width: CARD, height: CARD, borderColor: rgb(0.78, 0.78, 0.78), borderWidth: 0.3 });
  });
  return await pdf.save();
}

const pdfResp = bytes => new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=placas-pix.pdf", "cache-control": "no-store" } });

const CSS = `
:root{--bg:#F7F7F6;--ink:#0B0B0C;--mut:#6b6f76;--line:#e6e6e3;--blue:#2563EB}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Manrope,system-ui,sans-serif;padding:20px 14px 40px}
.w{max-width:760px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}.s{color:var(--mut);font-size:14px;margin:0 0 18px}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:14px}
input,textarea{width:100%;padding:12px;border:1.5px solid var(--line);border-radius:10px;font:inherit;font-size:16px;margin-bottom:10px}
button{padding:12px 16px;border:0;border-radius:10px;font:inherit;font-weight:700;background:var(--ink);color:#fff;cursor:pointer}
button.b{background:var(--blue)}button.g{background:#fff;color:var(--ink);border:1.5px solid var(--line);padding:7px 10px;font-size:13px}button.r{background:#fff;color:#b42318;border:1.5px solid #f3c6c1;padding:7px 10px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.c{font-family:"Space Mono",ui-monospace,monospace;font-weight:700}.ok{color:#067647}.nv{color:var(--mut)}.msg{background:#eef3ff;border:1px solid #dbe5ff;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:14px}
.acts{display:flex;gap:6px;flex-wrap:wrap}.acts form{margin:0}
`;
const html = (body, status = 200) => new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Pix</title><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Space+Mono:wght@700&display=swap" rel="stylesheet"><style>${CSS}</style></head><body><div class="w">${body}</div></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

async function painel(st, msg = "") {
  const { blobs } = await st.list();
  const regs = (await Promise.all(blobs.map(async b => ({ codigo: b.key, ...(await st.get(b.key, { type: "json" })) })))).filter(r => r.codigo);
  regs.sort((a, b) => (b.criada || 0) - (a.criada || 0));
  const ativas = regs.filter(r => r.ativa).length;
  const rows = regs.map(r => {
    const dados = r.ativa ? `<b>${esc(r.nome)}</b>${r.empresa ? `<br><span class="nv">${esc(r.empresa)}</span>` : ""}<br><span class="nv">${esc(r.tipo)} · ${esc(r.chave)}</span>` : `<span class="nv">aguardando ativação</span>`;
    const reset = r.ativa ? `<form method="post" onsubmit="return confirm('Resetar a placa ${r.codigo}? Os dados do cliente serão apagados e ela volta a pedir ativação.')"><input type="hidden" name="acao" value="reset"><input type="hidden" name="codigo" value="${r.codigo}"><button class="r">Resetar</button></form>` : `<form method="post" onsubmit="return confirm('Excluir a placa ${r.codigo}?')"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="codigo" value="${r.codigo}"><button class="r">Excluir</button></form>`;
    return `<tr data-t="${esc((r.codigo + " " + (r.nome || "") + " " + (r.empresa || "") + " " + (r.chave || "")).toLowerCase())}"><td class="c">${r.codigo}</td><td class="${r.ativa ? "ok" : "nv"}">${r.ativa ? "Ativa" : "Nova"}</td><td>${dados}</td><td><div class="acts"><a href="/x/${r.codigo}" target="_blank"><button class="g" type="button">Abrir</button></a><form method="post" target="_blank"><input type="hidden" name="acao" value="reimprimir"><input type="hidden" name="codigos" value="${r.codigo}"><button class="g">PDF</button></form>${reset}</div></td></tr>`;
  }).join("");
  return html(`
<h1>Placas Pix</h1><p class="s">Sistema separado das placas de avaliação. Total: ${regs.length} · Ativas: ${ativas}</p>
${msg ? `<div class="msg">${esc(msg)}</div>` : ""}
<div class="card"><h2>Gerar novas placas (PDF A4, 4 cards por folha)</h2>
<form method="post" target="_blank"><input type="hidden" name="acao" value="gerar">
<input name="qtd" type="number" min="1" max="100" placeholder="Quantidade (ex: 8)" required>
<button class="b" type="submit">Gerar códigos e PDF</button></form>
<p class="s" style="margin:10px 0 0">Imprima em A4, tamanho real (100%), sem "ajustar à página". Cada card sai com 10x10 cm.</p></div>
<div class="card"><h2>Reimprimir por código</h2>
<form method="post" target="_blank"><input type="hidden" name="acao" value="reimprimir"><textarea name="codigos" rows="2" placeholder="Códigos separados por espaço ou vírgula"></textarea><button type="submit">Gerar PDF</button></form></div>
<div class="card"><h2>Placas</h2><input id="q" placeholder="Buscar por código, nome, empresa ou chave" oninput="var v=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(function(r){r.style.display=r.dataset.t.indexOf(v)>-1?'':'none'})">
<div style="overflow-x:auto"><table><thead><tr><th>Código</th><th>Status</th><th>Dados</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="nv">Nenhuma placa ainda.</td></tr>`}</tbody></table></div></div>`);
}

export default async (req) => {
  if (!auth(req)) return pedeSenha();
  const st = store();
  const origin = new URL(req.url).origin;
  if (req.method !== "POST") return painel(st);
  const f = await req.formData();
  const acao = String(f.get("acao") || "");

  try {
    if (acao === "gerar") {
      const qtd = Math.min(Math.max(parseInt(f.get("qtd")) || 0, 1), 100);
      const novos = [];
      while (novos.length < qtd) {
        const c = novoCodigo();
        if (novos.includes(c) || (await st.get(c))) continue;
        await st.setJSON(c, { ativa: false, criada: Date.now() });
        novos.push(c);
      }
      return pdfResp(await buildPdf(novos, origin));
    }
    if (acao === "reimprimir") {
      const lista = [...new Set(String(f.get("codigos") || "").toUpperCase().split(/[^A-Z0-9]+/).filter(c => c.length === 6))];
      const ok = [];
      for (const c of lista) if (await st.get(c)) ok.push(c);
      if (!ok.length) return html(`<div class="card">Nenhum código válido encontrado.</div>`, 400);
      return pdfResp(await buildPdf(ok, origin));
    }
    if (acao === "reset") {
      const c = limpa(f.get("codigo")), r = await st.get(c, { type: "json" });
      if (!r) return painel(st, "Código não encontrado.");
      await st.setJSON(c, { ativa: false, criada: r.criada || Date.now() });
      return painel(st, `Placa ${c} resetada. Ela volta a pedir ativação.`);
    }
    if (acao === "excluir") {
      const c = limpa(f.get("codigo")), r = await st.get(c, { type: "json" });
      if (!r) return painel(st, "Código não encontrado.");
      if (r.ativa) return painel(st, "Placa ativa não pode ser excluída. Use Resetar antes.");
      await st.delete(c);
      return painel(st, `Placa ${c} excluída.`);
    }
  } catch (e) {
    return html(`<div class="card"><h2>Erro</h2><p>${esc(e.message)}</p></div>`, 500);
  }
  return painel(st);
};
