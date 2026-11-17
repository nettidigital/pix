// Placas Pix (QR dinâmico): o cliente escaneia a placa, cadastra a chave Pix e pronto.
// Projeto independente: banco próprio "pix"; não usa nem altera nenhuma outra placa.
import { getStore } from "@netlify/blobs";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash, randomBytes } from "node:crypto";

export const config = { path: ["/p/*", "/admin"] };

const CM = 28.3465, W = 595.28, H = 841.89, CARD = 10 * CM, MX = 8, MY = 50;
const QR_PADRAO = { cx: 0.7353, cy: 0.632, size: 0.2672 };
const WHATS = "5511989524447";
const AL = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const novoCodigo = () => Array.from(randomBytes(6), b => AL[b % AL.length]).join("");
const hash = (pin, salt) => createHash("sha256").update(salt + pin).digest("hex");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const limpa = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const dt = t => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";

// ---------- Pix: validação da chave ----------
const soNum = s => String(s).replace(/\D/g, "");
const cpfOk = c => { if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const d = (s * 10) % 11 % 10; if (d !== +c[n]) return false; } return true; };
const cnpjOk = c => { if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [12, 13]) { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; } const d = s % 11 < 2 ? 0 : 11 - (s % 11); if (d !== +c[n]) return false; } return true; };
const celOk = c => c.length === 11 && +c.slice(0, 2) >= 11 && c[2] === "9";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOMES = { cpf: "CPF", cnpj: "CNPJ", cel: "Celular", email: "E-mail", aleatoria: "Chave aleatória" };

function parseChave(raw, tipo) {
  const t = String(raw || "").trim(), n = soNum(t);
  const feito = (tp, valor) => ({ tipo: tp, valor });
  if (tipo === "auto" || !tipo) {
    if (t.includes("@")) tipo = "email";
    else if (UUID.test(t)) tipo = "aleatoria";
    else if (n.length === 14) tipo = "cnpj";
    else if (n.length === 11) {
      const a = cpfOk(n), b = celOk(n);
      if (a && b) return { erro: "Essa chave pode ser CPF ou celular. Escolha o tipo da chave na lista." };
      tipo = a ? "cpf" : b ? "cel" : "";
    } else if (n.length === 13 && n.startsWith("55") && celOk(n.slice(2))) { tipo = "cel"; }
    if (!tipo) return { erro: "Não reconheci essa chave. Confira se é um CPF, CNPJ, celular, e-mail ou chave aleatória válidos." };
  }
  if (tipo === "cpf") return cpfOk(n) ? feito("cpf", n) : { erro: "CPF inválido. Confira os números." };
  if (tipo === "cnpj") return cnpjOk(n) ? feito("cnpj", n) : { erro: "CNPJ inválido. Confira os números." };
  if (tipo === "cel") { const c = n.length === 13 && n.startsWith("55") ? n.slice(2) : n; return celOk(c) ? feito("cel", "+55" + c) : { erro: "Celular inválido. Use DDD + número, com o 9 na frente (ex.: 11 98765-4321)." }; }
  if (tipo === "email") return EMAIL.test(t) && t.length <= 77 ? feito("email", t.toLowerCase()) : { erro: "E-mail inválido." };
  if (tipo === "aleatoria") return UUID.test(t) ? feito("aleatoria", t.toLowerCase()) : { erro: "Chave aleatória inválida. Ela tem o formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx." };
  return { erro: "Tipo de chave inválido." };
}
const mascara = (tp, v) => tp === "cpf" ? `•••.${v.slice(3, 6)}.${v.slice(6, 9)}-••` : tp === "cnpj" ? `••.${v.slice(2, 5)}.${v.slice(5, 8)}/••••-••`
  : tp === "cel" ? `(${v.slice(3, 5)}) •••••-${v.slice(-4)}` : tp === "email" ? v.replace(/^(.).*(@.*)$/, "$1•••$2") : v.slice(0, 8) + "••••••••";

// ---------- Pix: BR Code estático (copia e cola) ----------
const tlv = (id, v) => id + String(v.length).padStart(2, "0") + v;
const crc16 = s => { let c = 0xFFFF; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, "0"); };
const asc = (s, max) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
function brcode(chave, nome, cidade) {
  const p = tlv("00", "01") + tlv("01", "11") + tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", chave)) + tlv("52", "0000") + tlv("53", "986")
    + tlv("58", "BR") + tlv("59", asc(nome, 25).toUpperCase() || "RECEBEDOR") + tlv("60", asc(cidade, 15).toUpperCase() || "BRASIL") + tlv("62", tlv("05", "***")) + "6304";
  return p + crc16(p);
}

// ---------- visual ----------
const CSS = `:root{--bg:#0b0b0b;--card:#141414;--line:#262626;--ink:#f5f5f5;--mut:#9a9a9a;--acc:#c6ff00;--accink:#0b0b0b}*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:radial-gradient(900px 500px at 50% -10%,#1f2a00,#0b0b0b 60%) fixed;color:var(--ink);display:flex;justify-content:center;padding:22px 16px 40px}
.w{width:100%;max-width:440px}.w.wide{max-width:720px}.brand{display:flex;align-items:center;justify-content:center;gap:10px;color:#fff;font-weight:700;letter-spacing:2px;font-size:13px;text-transform:uppercase;margin:6px 0 20px}.brand img{width:34px;height:34px;border-radius:50%}.brand b{color:var(--acc);font-weight:700}
.card{background:linear-gradient(180deg,#171717,#111);border:1px solid var(--line);border-radius:22px;padding:26px 20px;box-shadow:0 24px 60px rgba(0,0,0,.55);margin-bottom:16px}
.ico{width:54px;height:54px;border-radius:16px;background:rgba(198,255,0,.1);border:1px solid rgba(198,255,0,.35);display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:14px}
h1{font-size:23px;margin:0 0 6px;line-height:1.2;font-weight:800;letter-spacing:-.2px}h2{font-size:17px;margin:0 0 4px}.s{color:var(--mut);margin:0 0 6px;font-size:15px;line-height:1.5}.k{font-size:11.5px;font-weight:700;letter-spacing:2px;color:var(--acc);text-transform:uppercase}
label{display:block;font-size:12.5px;font-weight:700;margin:18px 0 6px;color:#d4d4d4;letter-spacing:.3px}.h{font-size:12.5px;color:var(--mut);margin-top:6px}
input,select,textarea{width:100%;padding:14px;font-size:16px;border:1.5px solid var(--line);border-radius:12px;outline:none;background:#0d0d0d;color:var(--ink);font-family:inherit}
input::placeholder,textarea::placeholder{color:#5c5c5c}
input:focus,select:focus,textarea:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(198,255,0,.15)}
.btn{display:block;width:100%;padding:15px;font-size:16px;font-weight:800;border:0;border-radius:12px;background:var(--acc);color:var(--accink);margin-top:16px;text-align:center;text-decoration:none;cursor:pointer;font-family:inherit;letter-spacing:.2px}.btn:active{transform:scale(.99)}.btn.g{background:#1d1d1d;color:var(--ink);border:1px solid #333}.btn.r{background:#2a1111;color:#ff8a8a;border:1px solid #4a1d1d}
.chip{display:inline-block;background:rgba(198,255,0,.1);color:var(--acc);border:1px solid rgba(198,255,0,.3);border-radius:999px;padding:5px 12px;font-weight:700;font-size:12.5px;letter-spacing:1.5px}
.err{background:#2a1111;border:1px solid #4a1d1d;color:#ff9a9a;border-radius:12px;padding:12px 14px;margin:14px 0 0;font-size:14px;line-height:1.4}
.box{word-break:break-all;background:#0d0d0d;border:1px dashed #333;border-radius:12px;padding:12px;font-size:13.5px;margin:8px 0;color:#e5e5e5}
.qr{display:flex;justify-content:center;margin:16px 0 6px}.qr svg{width:220px;height:220px;border-radius:16px;padding:12px;background:#fff;box-shadow:0 0 0 2px var(--acc),0 12px 40px rgba(198,255,0,.12)}
details{margin-top:18px;font-size:14px;color:var(--mut)}summary{cursor:pointer;font-weight:700;color:var(--ink)}details ol{padding-left:20px;line-height:1.75;margin:8px 0 0}details b{color:#fff}
.f{text-align:center;color:#6b6b6b;font-size:12.5px;margin-top:20px}.f a{color:#8a8a8a}a.l{color:var(--acc);font-weight:600}
.row{display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);padding:10px 0;font-size:14px}.row .c{flex:1;min-width:0;word-break:break-word}.row form{margin:0}.row button{width:auto;padding:9px 12px;margin:0;font-size:13px}`;
const JS = `function copiar(id,b,t0){var t=document.getElementById(id).textContent.trim();var o=t0||b.textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copiado ✓';setTimeout(function(){b.textContent=o},2500)}).catch(function(){prompt('Copie:',t)})}`;
const page = (body, status = 200, wide = false) => new Response(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0b0b"><link rel="icon" href="/logo-netti.png"><meta name="robots" content="noindex"><title>Pix · Netti Digital</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style></head><body><div class="w${wide ? " wide" : ""}"><div class="brand"><img src="/logo-netti.png" alt="">Netti <b>Digital</b></div>${body}</div><script>${JS}</script></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const opTipo = sel => ["auto:Detectar automaticamente", "cpf:CPF", "cnpj:CNPJ", "cel:Celular", "email:E-mail", "aleatoria:Chave aleatória"].map(o => { const [v, t] = o.split(":"); return `<option value="${v}"${sel === v ? " selected" : ""}>${t}</option>`; }).join("");
const form = (modo, codigo, msg = "", v = {}) => {
  const at = modo === "ativar";
  return `<div class="card"><div class="ico">💸</div><h1>${at ? "Configure sua placa Pix" : "Alterar dados do Pix"}</h1>
<p class="s">${at ? "Leva 1 minuto. Depois disso, quem escanear sua placa vê seus dados e paga pelo Pix." : "Digite os novos dados e confirme com seu PIN."}</p>
${msg ? `<div class="err">${esc(msg)}</div>` : ""}
<form method="post" action="/p/${esc(codigo)}${at ? "" : "?editar=1"}" autocomplete="off"><span class="chip">PLACA ${esc(codigo)}</span>
<label>Nome de quem recebe</label><input name="nome" value="${esc(v.nome)}" placeholder="Nome ou nome da empresa" maxlength="25" required>
<div class="h">Aparece para quem paga, para conferir. Máximo de 25 letras.</div>
<label>Chave Pix</label><input name="chave" value="${esc(v.chave)}" placeholder="CPF, CNPJ, celular, e-mail ou chave aleatória" autocapitalize="none" autocorrect="off" spellcheck="false" required>
<label>Tipo da chave</label><select name="tipo">${opTipo(v.tipo || "auto")}</select>
<label>Cidade (opcional)</label><input name="cidade" value="${esc(v.cidade)}" placeholder="Ex.: Guarulhos" maxlength="15">
<label>${at ? "Crie um PIN (4 a 6 números)" : "Seu PIN"}</label><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="••••" required>
${at ? `<div class="h">Guarde o PIN: é com ele que você altera seus dados depois.</div>` : ""}
<button class="btn">${at ? "Salvar e ativar" : "Salvar alteração"}</button></form>
${at ? "" : `<div class="f"><a href="https://wa.me/${WHATS}?text=${encodeURIComponent("Esqueci o PIN da placa Pix " + codigo)}">Esqueci meu PIN</a></div>`}</div>`;
};

const pagar = (codigo, p) => {
  const payload = brcode(p.chave, p.nome, p.cidade);
  return QRCode.toString(payload, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(svg => `<div class="card">
<div class="k">Pagamento via Pix</div><h1 style="margin-top:4px">${esc(p.nome)}</h1><p class="s">Confira o nome do recebedor antes de pagar.</p>
<div class="qr">${svg}</div>
<div id="pl" style="display:none">${esc(payload)}</div>
<button class="btn" onclick="copiar('pl',this,'Copiar Pix copia e cola')">Copiar Pix copia e cola</button>
<div id="ch" style="display:none">${esc(p.chave)}</div>
<div class="box" style="margin-top:14px"><b>${NOMES[p.tipo]}:</b> ${esc(mascara(p.tipo, p.chave))}</div>
<button class="btn g" style="margin-top:0" onclick="copiar('ch',this,'Copiar chave Pix')">Copiar chave Pix</button>
<details open><summary>Como pagar</summary><ol><li>Toque em <b>Copiar Pix copia e cola</b>.</li><li>Abra o app do seu banco e vá em <b>Pix → Copia e Cola</b>.</li><li>Cole o código, digite o valor e confirme o nome do recebedor.</li></ol></details>
<div class="f"><a href="/p/${esc(codigo)}?editar=1">Sou o dono: alterar dados</a></div></div>`);
};

const pronto = (origin, codigo, p, titulo, nfc) => `<div class="card"><div class="ico">✅</div><h1>${titulo}</h1>
<p class="s">Quem escanear sua placa vai ver o Pix de:</p><div class="box"><b>${esc(p.nome)}</b><br>${NOMES[p.tipo]}: ${esc(mascara(p.tipo, p.chave))}</div>
<a class="btn" href="/p/${esc(codigo)}">Ver como o cliente vê</a>
${nfc ? `<label>Link da sua placa (para gravar no NFC)</label><div class="box" id="lk">${esc(origin)}/p/${esc(codigo)}</div>
<button class="btn g" style="margin-top:8px" onclick="copiar('lk',this,'Copiar link da placa')">Copiar link da placa</button>
<details open><summary>Como gravar no NFC</summary><ol><li>Abra o app <b>NFC Tools</b>.</li><li>Gravar → Adicionar registro → <b>URL</b>.</li><li>Cole o link copiado acima e toque em Gravar.</li><li>Encoste o celular na placa e teste.</li></ol></details>
<details><summary>Dica de segurança</summary><p style="line-height:1.6">Depois de testar, você pode <b>bloquear a tag</b> no NFC Tools (menu <b>Outros → Bloquear tag</b>) para ninguém regravá-la. Atenção: bloquear é definitivo.</p></details>` : ""}
<div class="f"><a class="l" href="/p/${esc(codigo)}?editar=1">Alterar dados depois</a></div></div>`;

async function buildPdf(codigos, origin, arteBytes, QR, direto) {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.HelveticaBold);
  const img = await pdf.embedJpg(arteBytes);
  for (let i = 0; i < codigos.length; i += 4) {
    const pg = pdf.addPage([W, H]);
    codigos.slice(i, i + 4).forEach((codigo, j) => {
      const col = j % 2, lin = Math.floor(j / 2);
      const x = col === 0 ? MX : W - MX - CARD, y = lin === 0 ? H - MY - CARD : MY;
      pg.drawImage(img, { x, y, width: CARD, height: CARD });
      const qr = QRCode.create(direto ? direto : `${origin}/p/${codigo}`, { errorCorrectionLevel: "M" });
      const n = qr.modules.size, lado = QR.size * CARD, m = lado / n;
      const qx = x + QR.cx * CARD - lado / 2, qy = y + (1 - QR.cy) * CARD - lado / 2;
      for (let r = 0; r < n; r++) {
        let k = 0;
        while (k < n) {
          if (!qr.modules.get(r, k)) { k++; continue; }
          const ini = k; while (k < n && qr.modules.get(r, k)) k++;
          pg.drawRectangle({ x: qx + ini * m, y: qy + (n - r - 1) * m, width: (k - ini) * m + 0.2, height: m + 0.2, color: rgb(0, 0, 0) });
        }
      }
      const txt = direto ? `Cód.: ${codigo}` : `Cód.: ${codigo}`, tw = fonte.widthOfTextAtSize(txt, 12);
      pg.drawText(txt, { x: x + (CARD - tw) / 2, y: lin === 0 ? y - 20 : y + CARD + 10, size: 12, font: fonte, color: rgb(0.15, 0.15, 0.15) });
    });
  }
  return pdf.save();
}

export default async (req) => {
  const u = new URL(req.url), path = u.pathname, s = getStore("pix");

  // ---------- cliente / pagador ----------
  if (path.startsWith("/p/")) {
    const codigo = limpa(path.slice(3)), p = await s.get(codigo, { type: "json" });
    if (!p) return page(`<div class="card"><div class="ico">🔎</div><h1>Placa não encontrada</h1><p class="s">Confira o código ou fale com a Netti Digital.</p></div>`, 404);
    const editar = u.searchParams.has("editar");
    if (req.method !== "POST") {
      if (!p.ativa) return page(form("ativar", codigo));
      return page(editar ? form("editar", codigo) : await pagar(codigo, p));
    }
    const f = await req.formData(), modo = p.ativa ? "editar" : "ativar";
    const v = { nome: String(f.get("nome") || "").trim(), chave: String(f.get("chave") || "").trim(), tipo: String(f.get("tipo") || "auto"), cidade: String(f.get("cidade") || "").trim() };
    const pin = String(f.get("pin") || "").trim();
    const erro = m => page(form(modo, codigo, m, v), 400);
    if (!asc(v.nome, 25)) return erro("Digite o nome de quem recebe.");
    const ch = parseChave(v.chave, v.tipo); if (ch.erro) return erro(ch.erro);
    if (!/^\d{4,6}$/.test(pin)) return erro("O PIN precisa ter de 4 a 6 números.");
    if (modo === "editar") {
      if (p.lock && p.lock > Date.now()) return erro("Muitas tentativas. Tente de novo em 15 minutos.");
      if (hash(pin, p.salt) !== p.pin) {
        p.fails = (p.fails || 0) + 1;
        if (p.fails >= 5) { p.lock = Date.now() + 15 * 60000; p.fails = 0; }
        await s.setJSON(codigo, p);
        return erro("PIN incorreto.");
      }
      p.fails = 0;
    } else { p.salt = randomBytes(8).toString("hex"); p.pin = hash(pin, p.salt); p.ativa = true; }
    Object.assign(p, { nome: asc(v.nome, 25), chave: ch.valor, tipo: ch.tipo, cidade: asc(v.cidade, 15) });
    await s.setJSON(codigo, p);
    return page(pronto(u.origin, codigo, p, modo === "ativar" ? "Placa ativada!" : "Dados atualizados!", modo === "ativar"));
  }

  // ---------- admin ----------
  if (path === "/admin") {
    if (!process.env.ADMIN_PASS || req.headers.get("authorization") !== "Basic " + btoa("admin:" + process.env.ADMIN_PASS))
      return new Response("Acesso restrito", { status: 401, headers: { "www-authenticate": 'Basic realm="admin"' } });
    if (req.method === "POST") {
      const f = await req.formData(), acao = f.get("acao");
      const voltar = m => page(`<div class="card"><h1>${esc(m)}</h1><a class="btn g" href="/admin">← Voltar</a></div>`, 200, true);
      if (acao === "resetar" || acao === "apagar") {
        const c = limpa(f.get("codigo")), p = await s.get(c, { type: "json" });
        if (!p) return voltar("Placa não encontrada");
        if (acao === "apagar") { if (p.ativa) return voltar("Placa ativada não pode ser apagada. Use Resetar."); await s.delete(c); return voltar(`Placa ${c} apagada`); }
        await s.setJSON(c, { criada: p.criada || Date.now(), ativa: false });
        return voltar(`Placa ${c} resetada`);
      }
      if (acao === "links") {
        const qtd = Math.min(Math.max(parseInt(f.get("qtd")) || 1, 1), 50), ls = [];
        for (let i = 0; i < qtd; i++) { let c; do { c = novoCodigo(); } while (await s.get(c)); await s.setJSON(c, { criada: Date.now(), ativa: false }); ls.push(`${u.origin}/p/${c}`); }
        return page(`<div class="card"><h1>${ls.length} links criados</h1><p class="s">Cada link é uma placa nova. Quem abrir pela primeira vez configura o próprio Pix.</p><div class="box" id="lks" style="white-space:pre-line;line-height:1.9">${ls.map(esc).join("\n")}</div><button class="btn" onclick="copiar('lks',this,'Copiar todos')">Copiar todos</button><a class="btn g" href="/admin">← Voltar</a></div>`, 200, true);
      }
      let codigos = [], direto = null;
      if (acao === "direto") {
        const ch = parseChave(String(f.get("chave") || ""), String(f.get("tipo") || "auto"));
        if (ch.erro) return new Response(ch.erro, { status: 400 });
        const nome = asc(f.get("nome"), 25); if (!nome) return new Response("Digite o nome do recebedor.", { status: 400 });
        direto = brcode(ch.valor, nome, f.get("cidade"));
        const n = Math.min(Math.max(parseInt(f.get("qtd")) || 1, 1), 4);
        codigos = Array.from({ length: n }, () => "PIX");
      } else if (acao === "criar") {
        const qtd = Math.min(Math.max(parseInt(f.get("qtd")) || 0, 1), 200);
        for (let i = 0; i < qtd; i++) { let c; do { c = novoCodigo(); } while (await s.get(c)); await s.setJSON(c, { criada: Date.now(), ativa: false }); codigos.push(c); }
      } else {
        for (const c of String(f.get("lista") || "").split(/[\s,;]+/).map(limpa).filter(Boolean)) if (await s.get(c)) codigos.push(c);
        if (!codigos.length) return new Response("Nenhum código encontrado.", { status: 400 });
      }
      const r = await fetch(u.origin + "/arte-pix.jpg");
      if (!r.ok) return new Response('Arte não encontrada. Suba "arte-pix.jpg" na pasta "public" do GitHub. (Os códigos já foram criados: use "Reimprimir" depois.)', { status: 500 });
      let QR = QR_PADRAO; try { const j = await (await fetch(u.origin + "/arte-pix.json")).json(); if (j && j.size) QR = j; } catch {}
      return new Response(await buildPdf(codigos, u.origin, new Uint8Array(await r.arrayBuffer()), QR, direto), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=placas-pix.pdf", "cache-control": "no-store" } });
    }
    const { blobs } = await s.list();
    const todos = (await Promise.all(blobs.map(async b => ({ k: b.key, p: (await s.get(b.key, { type: "json" })) || {} })))).sort((a, b) => (b.p.criada || 0) - (a.p.criada || 0));
    const q = (u.searchParams.get("q") || "").trim().toLowerCase();
    const lista = todos.filter(({ k, p }) => !q || k.toLowerCase().includes(q) || (p.nome || "").toLowerCase().includes(q) || (p.chave || "").toLowerCase().includes(q)).slice(0, 100);
    const linhas = lista.map(({ k, p }) => `<div class="row"><div class="c"><b>${k}</b> · ${p.ativa ? "✅ " + esc(p.nome) : "⚪ nova"} <span class="h">${dt(p.criada)}</span>${p.ativa ? `<div class="h">${NOMES[p.tipo]}: ${esc(p.chave)}</div>` : ""}</div>
<form method="post" action="/admin" onsubmit="return confirm('${p.ativa ? "Resetar" : "Apagar"} ${k}?')"><input type="hidden" name="acao" value="${p.ativa ? "resetar" : "apagar"}"><input type="hidden" name="codigo" value="${k}"><button class="btn r">${p.ativa ? "Resetar" : "Apagar"}</button></form></div>`).join("") || `<p class="s">Nada encontrado.</p>`;
    return page(`<div class="card"><h1>Placas Pix</h1><p class="s">${todos.length} placas no sistema</p></div>
<div class="card"><h2>1. Criar placas novas + PDF</h2><p class="s">Gera códigos novos e o PDF A4 (4 cards de 10x10 cm) com o QR de cada placa.</p>
<form method="post" action="/admin" target="_blank" onsubmit="return confirm('Criar ' + this.qtd.value + ' placas novas?')"><input type="hidden" name="acao" value="criar"><label>Quantidade (múltiplo de 4 enche as folhas)</label><input name="qtd" type="number" min="1" max="200" value="4" required><button class="btn">Criar e baixar PDF</button></form></div>
<div class="card"><h2>Gerar só links (sem PDF)</h2><p class="s">Para colar no campo de link de outra placa. Cada link vira uma página Pix.</p><form method="post" action="/admin"><input type="hidden" name="acao" value="links"><label>Quantidade</label><input name="qtd" type="number" min="1" max="50" value="5"><button class="btn">Gerar links</button></form></div>
<div class="card"><h2>Placa com Pix direto (QR abre o banco)</h2><p class="s">O QR já é o Pix do cliente: ao escanear, o app do banco abre direto no pagamento. É fixo e não pode ser alterado depois. Use com os dados do cliente, antes de imprimir.</p>
<form method="post" action="/admin" target="_blank"><input type="hidden" name="acao" value="direto"><label>Nome do recebedor</label><input name="nome" maxlength="25" required><label>Chave Pix</label><input name="chave" required><label>Tipo</label><select name="tipo">${opTipo("auto")}</select><label>Cidade</label><input name="cidade" maxlength="15"><label>Quantidade de cards (1 a 4)</label><input name="qtd" type="number" min="1" max="4" value="1"><button class="btn">Gerar PDF</button></form></div>
<div class="card"><h2>2. Reimprimir códigos existentes</h2><form method="post" action="/admin" target="_blank"><input type="hidden" name="acao" value="reimprimir"><label>Códigos (vírgula ou espaço)</label><textarea name="lista" rows="2" required></textarea><button class="btn g">Gerar PDF</button></form></div>
<div class="card"><h2>3. Placas: buscar, resetar, apagar</h2><p class="s">Busque por código, nome ou chave. Resetar apaga os dados e o PIN; Apagar só vale para placas novas.</p>
<form method="get" action="/admin"><input name="q" value="${esc(q)}" placeholder="Código, nome ou chave"><button class="btn g">Buscar</button></form>${linhas}</div>`, 200, true);
  }
  return new Response("Not found", { status: 404 });
};
