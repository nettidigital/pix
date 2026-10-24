// Placas PIX da Netti Digital. Sistema SEPARADO das placas de avaliação (store "pix", rotas /x/*).
import { getStore } from "@netlify/blobs";
import QRCode from "qrcode";
import { createHash, randomBytes } from "node:crypto";

export const config = { path: ["/x/*"] };

const WHATS = "5511989524447";
const store = () => getStore({ name: "pix", consistency: "strong" });
const limpa = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hash = (pin, salt) => createHash("sha256").update(salt + pin).digest("hex");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const digits = s => String(s || "").replace(/\D/g, "");

/* ---------- validação das chaves ---------- */
function cpfOk(d) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i);
    if (((s * 10) % 11) % 10 != d[t]) return false;
  }
  return true;
}
function cnpjOk(d) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = n => {
    let s = 0, p = n - 7;
    for (let i = 0; i < n; i++) { s += d[i] * p--; if (p < 2) p = 9; }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) == d[12] && calc(13) == d[13];
}
function validaChave(tipo, raw) {
  raw = String(raw || "").trim();
  if (tipo === "cpf") { const d = digits(raw); return cpfOk(d) ? { chave: d } : { erro: "CPF inválido. Confira os 11 números." }; }
  if (tipo === "cnpj") { const d = digits(raw); return cnpjOk(d) ? { chave: d } : { erro: "CNPJ inválido. Confira os 14 números." }; }
  if (tipo === "tel") {
    let d = digits(raw);
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
    return d.length === 10 || d.length === 11 ? { chave: "+55" + d } : { erro: "Celular inválido. Digite com DDD." };
  }
  if (tipo === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && raw.length <= 77 ? { chave: raw.toLowerCase() } : { erro: "E-mail inválido." };
  if (tipo === "aleatoria") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? { chave: raw.toLowerCase() } : { erro: "Chave aleatória inválida. Copie e cole do seu banco." };
  return { erro: "Escolha o tipo da chave." };
}
const fmtChave = (tipo, c) => {
  if (tipo === "cpf") return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (tipo === "cnpj") return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (tipo === "tel") { const d = c.slice(3); return d.length === 11 ? d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3") : d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3"); }
  return c;
};
const TIPOS = { cpf: "CPF", cnpj: "CNPJ", tel: "Celular", email: "E-mail", aleatoria: "Chave aleatória" };

/* ---------- BR Code (Pix copia e cola estático) ---------- */
const tlv = (i, v) => i + String(v.length).padStart(2, "0") + v;
const ascii = (s, n) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "").toUpperCase().trim().slice(0, n);
function crc16(s) {
  let c = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
export function brcode(r) {
  const p = tlv("00", "01") + tlv("01", "11") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", r.chave)) +
    tlv("52", "0000") + tlv("53", "986") + tlv("58", "BR") +
    tlv("59", ascii(r.nome, 25) || "RECEBEDOR") + tlv("60", ascii(r.cidade, 15) || "BRASIL") +
    tlv("62", tlv("05", "***")) + "6304";
  return p + crc16(p);
}

/* ---------- visual (paleta Netti: preto, off-white, azul) ---------- */
const CSS = `
:root{--bg:#F5F5F3;--ink:#0B0B0C;--mut:#7a7d84;--line:#E8E8E4;--blue:#2563EB}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Montserrat,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:flex;justify-content:center;padding:22px 16px 36px;-webkit-font-smoothing:antialiased}
.w{width:100%;max-width:420px}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:600;font-size:11px;letter-spacing:.34em;margin:8px 0 24px;padding-left:.34em}
.brand i{width:6px;height:6px;border-radius:50%;background:var(--blue);display:inline-block}
.card{background:#fff;border:1px solid var(--line);border-radius:26px;padding:34px 26px 28px;box-shadow:0 1px 0 #fff inset,0 28px 60px -28px rgba(11,11,12,.20)}
h1{font-size:21px;font-weight:700;line-height:1.25;margin:0 0 8px;letter-spacing:-.02em}
p.s{color:var(--mut);font-size:13.5px;font-weight:500;line-height:1.65;margin:0 0 20px}
label{display:block;font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin:20px 0 8px}
input[type=text],input[type=password],input[type=email],input[type=tel],input[type=number]{width:100%;padding:15px 16px;border:1px solid var(--line);border-radius:14px;font:inherit;font-size:16px;font-weight:500;background:#FBFBFA;color:var(--ink);outline:none;transition:border-color .2s,box-shadow .2s,background .2s}
input:focus{border-color:var(--ink);background:#fff;box-shadow:0 0 0 4px rgba(11,11,12,.06)}
.tipos{display:flex;flex-wrap:wrap;gap:8px}
.tipos input{position:absolute;opacity:0;pointer-events:none}
.tipos label{margin:0;text-transform:none;letter-spacing:.01em;font-size:13px;color:var(--ink);padding:10px 15px;border:1px solid var(--line);border-radius:999px;font-weight:600;cursor:pointer;background:#FBFBFA;transition:all .2s}
.tipos input:checked+label{background:var(--ink);color:#fff;border-color:var(--ink)}
.opt{font-weight:500;text-transform:none;letter-spacing:0;opacity:.8}
.btn{width:100%;padding:17px;border:0;border-radius:14px;font:inherit;font-size:14px;font-weight:600;letter-spacing:.04em;background:var(--ink);color:#fff;margin-top:22px;cursor:pointer;box-shadow:0 14px 26px -12px rgba(11,11,12,.55);transition:transform .15s,box-shadow .15s}
.btn:active{transform:scale(.985);box-shadow:0 8px 16px -10px rgba(11,11,12,.55)}
.btn.sec{background:#fff;color:var(--ink);border:1px solid var(--line);margin-top:10px;font-weight:600;box-shadow:none}
.err{background:#fff6f5;border:1px solid #f6d3cf;color:#9a1c10;padding:13px 15px;border-radius:14px;font-size:13px;font-weight:500;margin-bottom:14px;line-height:1.5}
.info{background:#F8F8F6;border:1px solid var(--line);color:#55585e;padding:14px 16px;border-radius:14px;font-size:12.5px;font-weight:500;line-height:1.65;margin-top:18px}
.info a{color:var(--ink);font-weight:600}
.pay{text-align:center}
.tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--blue);border:1px solid #d9e4ff;padding:7px 14px 7px 16px;border-radius:999px}
.emp{color:var(--mut);font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;margin-top:22px}
.who{font-size:27px;font-weight:700;letter-spacing:-.03em;line-height:1.15;margin:8px 0 0}
.qr{width:216px;height:216px;margin:26px auto 8px;padding:16px;border:1px solid var(--line);border-radius:22px;background:#fff;box-shadow:0 18px 36px -22px rgba(11,11,12,.25)}
.qr svg{width:100%;height:100%;display:block}
.k{margin-top:24px;border-top:1px solid var(--line);padding-top:22px}
.k small{display:block;font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--mut)}
.k b{display:block;font-size:16px;font-weight:600;letter-spacing:.03em;margin-top:8px;word-break:break-all;font-variant-numeric:tabular-nums}
.how{font-size:12px;font-weight:500;color:var(--mut);line-height:1.65;margin-top:16px}
.how b{color:var(--ink);font-weight:600}
.foot{text-align:center;font-size:11.5px;font-weight:500;color:var(--mut);margin-top:22px;line-height:1.7}
.foot a{color:var(--mut);text-decoration-color:#c9c9c4;text-underline-offset:3px}
.steps{list-style:none;counter-reset:s;padding:0;margin:24px 0 0}
.steps li{counter-increment:s;position:relative;padding:0 0 20px 46px;font-size:14px;line-height:1.55}
.steps li:before{content:counter(s);position:absolute;left:0;top:-1px;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--ink);color:var(--ink);font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;background:#fff}
.steps li:not(:last-child):after{content:"";position:absolute;left:14.5px;top:33px;bottom:5px;width:1px;background:var(--line)}
.steps li b{display:block;font-size:14px;font-weight:700;letter-spacing:-.005em}
.steps li span{color:var(--mut);font-size:13px;font-weight:500}
.steps li span b{display:inline;color:var(--ink);font-weight:600;font-size:13px}
.lk{background:#FBFBFA;border:1px solid var(--line);border-radius:14px;padding:14px 16px;font-size:12.5px;font-weight:600;letter-spacing:.01em;word-break:break-all;margin-top:2px}
.stores{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.stores a{font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:8px 16px;background:#FBFBFA}
`;
const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">`;
const shell = (title, body, status = 200, extra = "") => new Response(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#F7F7F6"><title>${esc(title)}</title>${FONT}<style>${CSS}</style></head><body><div class="w"><div class="brand"><i></i>NETTI DIGITAL</div>${body}${extra}</div></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const redirect = to => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });

const naoEncontrada = () => shell("Placa não encontrada", `<div class="card"><h1>Placa não encontrada</h1><p class="s">Confira se o QR code está inteiro e tente de novo. Se precisar, fale com a gente.</p><a class="btn" style="display:block;text-align:center;text-decoration:none" href="https://wa.me/${WHATS}">Falar no WhatsApp</a></div>`, 404);

/* ---------- telas ---------- */
const campos = (v = {}) => `
<label>Tipo da chave Pix</label>
<div class="tipos">${Object.entries(TIPOS).map(([k, n]) => `<input type="radio" name="tipo" id="t-${k}" value="${k}" ${v.tipo === k ? "checked" : ""} required><label for="t-${k}">${n}</label>`).join("")}</div>
<label for="chave">Chave Pix</label>
<input id="chave" name="chave" type="text" autocomplete="off" autocapitalize="off" placeholder="Escolha o tipo acima" value="${esc(v.chaveFmt || "")}" required>
<label for="nome">Nome de quem recebe</label>
<input id="nome" name="nome" type="text" maxlength="25" autocomplete="off" placeholder="Como aparece no seu banco" value="${esc(v.nome || "")}" required>
<label for="empresa">Nome da empresa <span class="opt">(opcional)</span></label>
<input id="empresa" name="empresa" type="text" maxlength="40" autocomplete="off" placeholder="Ex: Barbearia do João" value="${esc(v.empresa || "")}">
<label for="cidade">Cidade <span class="opt">(opcional)</span></label>
<input id="cidade" name="cidade" type="text" maxlength="15" autocomplete="off" placeholder="Ex: Guarulhos" value="${esc(v.cidade || "")}">
<script>
(function(){var P={cpf:["000.000.000-00","numeric"],cnpj:["00.000.000/0000-00","numeric"],tel:["(11) 90000-0000","tel"],email:["voce@email.com","email"],aleatoria:["Cole a chave aleatória","text"]};
var c=document.getElementById("chave");
document.querySelectorAll('input[name=tipo]').forEach(function(r){function f(){if(!r.checked)return;c.placeholder=P[r.value][0];c.inputMode=P[r.value][1]}r.addEventListener("change",f);f()})})();
</script>`;

const telaAtivar = (code, erro = "", v = {}) => shell("Ativar placa Pix", `
<div class="card"><h1>Ative sua placa Pix</h1>
<p class="s">Preencha uma vez só. Depois, quem escanear a placa vê seus dados e paga na hora.</p>
${erro ? `<div class="err">${esc(erro)}</div>` : ""}
<form method="post" action="/x/${code}" autocomplete="off">
${campos(v)}
<label for="pin">Crie um PIN (4 a 6 números)</label>
<input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="Para editar depois" required>
<div class="info">Guarde o PIN. Ele é o que permite alterar os dados da placa depois.</div>
<button class="btn" type="submit">Ativar minha placa</button></form></div>
<div class="foot">Placa ${code}</div>`);

function telaPix(code, r) {
  const cod = brcode(r);
  return QRCode.toString(cod, { type: "svg", errorCorrectionLevel: "M", margin: 0 }).then(s => shell(`Pix · ${r.nome}`, `
<div class="card pay">
<span class="tag">Pagamento via Pix</span>
${r.empresa ? `<div class="emp">${esc(r.empresa)}</div>` : ""}
<div class="who">${esc(r.nome)}</div>
<div class="qr">${s}</div>
<button class="btn" id="cp" data-v="${esc(cod)}">Copiar Pix copia e cola</button>
<div class="how" id="how">Toque no botão, abra o app do seu banco e use a opção <b>Pix copia e cola</b>.</div>
<div class="k"><small>${TIPOS[r.tipo]}</small><b>${esc(fmtChave(r.tipo, r.chave))}</b>
<button class="btn sec" id="ck" data-v="${esc(r.chave)}">Copiar chave</button></div>
</div>
<div class="foot">Confira o nome do recebedor antes de confirmar o pagamento.<br><br><a href="/x/${code}/pronto">Sou o dono · ativar aproximação (NFC)</a> · <a href="/x/${code}/editar">editar dados</a></div>
<script>
function cp(id,msg){var b=document.getElementById(id),t=b.getAttribute("data-v"),o=b.textContent;
function ok(){b.textContent=msg;setTimeout(function(){b.textContent=o},2200)}
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(ok,fb)}else fb();
function fb(){var a=document.createElement("textarea");a.value=t;a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();try{document.execCommand("copy")}catch(e){}a.remove();ok()}}
document.getElementById("cp").onclick=function(){cp("cp","Copiado! Cole no seu banco")};
document.getElementById("ck").onclick=function(){cp("ck","Chave copiada")};
</script>`));
}


const telaPronto = (code, origin) => {
  const link = `${origin}/x/${code}`;
  return shell("Placa ativada", `
<div class="card"><span class="tag">Placa ativada</span>
<h1 style="margin-top:14px">Tudo certo! Agora ative a aproximação</h1>
<p class="s">O QR code já funciona. Para o pagamento por <b>aproximação (NFC)</b> funcionar também, faça os passos abaixo uma única vez. Leva 1 minuto.</p>
<label style="margin-top:0">Seu link personalizado</label>
<div class="lk">${esc(link)}</div>
<button class="btn" id="cl" data-v="${esc(link)}">Copiar meu link</button>
<ol class="steps" style="margin-top:22px">
<li><b>Copie o link acima</b><span>Toque em "Copiar meu link".</span></li>
<li><b>Baixe o app NFC Tools</b><span>É grátis.</span>
<div class="stores"><a href="https://play.google.com/store/apps/details?id=com.wakdev.wdnfc" target="_blank" rel="noopener">Android</a><a href="https://apps.apple.com/app/nfc-tools/id1252962749" target="_blank" rel="noopener">iPhone</a></div></li>
<li><b>Abra o app e toque em Escrever</b><span>Depois em <b style="display:inline">Adicionar um registro</b> e escolha <b style="display:inline">URL / URI</b>.</span></li>
<li><b>Cole o link e confirme</b><span>Cole o link que você copiou e toque em OK.</span></li>
<li><b>Toque em Escrever e aproxime o celular da placa</b><span>Encoste na parte de trás da placa, onde está o chip, e espere aparecer "Escrito com sucesso".</span></li>
<li style="padding-bottom:0"><b>Teste</b><span>Aproxime o celular da placa. A sua página de pagamento deve abrir.</span></li>
</ol>
<div class="info">Se der erro ao escrever, mantenha o celular parado sobre a placa e tente de novo.</div>
<a class="btn sec" style="display:block;text-align:center;text-decoration:none" href="/x/${code}">Ver minha página de pagamento</a></div>
<div class="foot">Placa ${code}</div>
<script>
document.getElementById("cl").onclick=function(){var b=this,t=b.getAttribute("data-v"),o=b.textContent;
function ok(){b.textContent="Link copiado!";setTimeout(function(){b.textContent=o},2200)}
function fb(){var a=document.createElement("textarea");a.value=t;a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();try{document.execCommand("copy")}catch(e){}a.remove();ok()}
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(ok,fb)}else fb()};
</script>`);
};

const telaPin = (code, erro = "") => shell("Editar placa Pix", `
<div class="card"><h1>Editar dados da placa</h1>
<p class="s">Digite o PIN que você criou na ativação.</p>
${erro ? `<div class="err">${esc(erro)}</div>` : ""}
<form method="post" action="/x/${code}/editar"><input type="hidden" name="etapa" value="pin">
<label for="pin">PIN</label>
<input id="pin" name="pin" type="password" inputmode="numeric" maxlength="6" required autofocus>
<button class="btn" type="submit">Continuar</button></form>
<a class="btn sec" style="display:block;text-align:center;text-decoration:none" href="/x/${code}">Voltar</a>
<div class="info">Esqueceu o PIN? Chame a gente no <a href="https://wa.me/${WHATS}">WhatsApp</a>.</div></div>
<div class="foot">Placa ${code}</div>`);

const telaEditar = (code, r, pin, erro = "") => shell("Editar placa Pix", `
<div class="card"><h1>Editar dados da placa</h1>
<p class="s">Altere o que precisar. A placa usa os novos dados na hora.</p>
${erro ? `<div class="err">${esc(erro)}</div>` : ""}
<form method="post" action="/x/${code}/editar" autocomplete="off"><input type="hidden" name="etapa" value="salvar"><input type="hidden" name="pin" value="${esc(pin)}">
${campos({ ...r, chaveFmt: r.chaveFmt ?? fmtChave(r.tipo, r.chave) })}
<label for="novopin">Novo PIN <span class="opt">(opcional)</span></label>
<input id="novopin" name="novopin" type="password" inputmode="numeric" maxlength="6" placeholder="Deixe vazio para manter">
<button class="btn" type="submit">Salvar alterações</button></form>
<a class="btn sec" style="display:block;text-align:center;text-decoration:none" href="/x/${code}">Cancelar</a></div>`);

/* ---------- lógica ---------- */
function lerDados(f) {
  const tipo = String(f.get("tipo") || "");
  const v = { tipo, chaveFmt: String(f.get("chave") || ""), nome: String(f.get("nome") || "").trim(), empresa: String(f.get("empresa") || "").trim(), cidade: String(f.get("cidade") || "").trim() };
  if (v.nome.length < 2) return { v, erro: "Digite o nome de quem recebe." };
  if (!ascii(v.nome, 25)) return { v, erro: "O nome precisa ter letras ou números." };
  const k = validaChave(tipo, v.chaveFmt);
  if (k.erro) return { v, erro: k.erro };
  return { v, dados: { tipo, chave: k.chave, nome: v.nome.slice(0, 25), empresa: v.empresa.slice(0, 40), cidade: v.cidade.slice(0, 15) } };
}
const pinOk = p => /^\d{4,6}$/.test(p);

export default async (req) => {
  const u = new URL(req.url);
  const parts = u.pathname.split("/").filter(Boolean);
  const code = limpa(parts[1]);
  const sub = parts[2] || "";
  if (!code || code.length !== 6) return naoEncontrada();
  const st = store();
  const r = await st.get(code, { type: "json" });
  if (!r) return naoEncontrada();

  /* ativação */
  if (!r.ativa) {
    if (req.method === "POST" && !sub) {
      const f = await req.formData();
      const { v, dados, erro } = lerDados(f);
      const pin = String(f.get("pin") || "");
      if (erro) return telaAtivar(code, erro, v);
      if (!pinOk(pin)) return telaAtivar(code, "O PIN precisa ter de 4 a 6 números.", v);
      const salt = randomBytes(8).toString("hex");
      // grava só se continuar inativa (evita duas ativações simultâneas)
      const atual = await st.get(code, { type: "json" });
      if (atual?.ativa) return redirect(`/x/${code}`);
      await st.setJSON(code, { ...atual, ...dados, ativa: true, salt, ph: hash(pin, salt), erros: 0, bloqueio: 0, ativada: Date.now() });
      return redirect(`/x/${code}/pronto`);
    }
    if (sub) return redirect(`/x/${code}`);
    return telaAtivar(code);
  }

  /* placa ativa */
  if (sub === "editar") {
    if (req.method !== "POST") return telaPin(code);
    const f = await req.formData();
    const pin = String(f.get("pin") || "");
    if (r.bloqueio && Date.now() < r.bloqueio) return telaPin(code, "Muitas tentativas. Tente de novo em alguns minutos.");
    if (!pinOk(pin) || hash(pin, r.salt) !== r.ph) {
      const erros = (r.erros || 0) + 1;
      await st.setJSON(code, { ...r, erros: erros >= 5 ? 0 : erros, bloqueio: erros >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      return telaPin(code, erros >= 5 ? "Muitas tentativas. Tente de novo em 15 minutos." : "PIN incorreto.");
    }
    if (f.get("etapa") !== "salvar") {
      if (r.erros) await st.setJSON(code, { ...r, erros: 0, bloqueio: 0 });
      return telaEditar(code, r, pin);
    }
    const { v, dados, erro } = lerDados(f);
    if (erro) return telaEditar(code, { ...r, ...v, chave: "" }, pin, erro);
    const novo = String(f.get("novopin") || "");
    const upd = { ...r, ...dados, erros: 0, bloqueio: 0, atualizada: Date.now() };
    if (novo) {
      if (!pinOk(novo)) return telaEditar(code, { ...r, ...v }, pin, "O novo PIN precisa ter de 4 a 6 números.");
      upd.salt = randomBytes(8).toString("hex");
      upd.ph = hash(novo, upd.salt);
    }
    await st.setJSON(code, upd);
    return redirect(`/x/${code}`);
  }
  if (sub === "pronto") return telaPronto(code, u.origin);
  if (sub) return redirect(`/x/${code}`);
  return telaPix(code, r);
};
