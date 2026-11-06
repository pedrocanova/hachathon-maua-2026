// Pulso — protótipo de triagem (hackathon). Não é diagnóstico.
// Toda regra clínica está em rules.json; este arquivo só interpreta.
// Persistência: só localStorage, só com consentimento, só para teste (LGPD art. 11).
const ORDEM = {verde:0, amarelo:1, vermelho:2};
const ROTULO = {verde:'Sem sinais de alerta agora', amarelo:'Procure o CAPS AD ou a UBS em até 24 h', vermelho:'Busque ajuda agora'};
const CHAVE = 'pulso_v1';
const CAMPOS = ['resp','contato','etapa','pos','nivel','motivos','info','log','base','pre','compFeito'];
const RAPIDO = new URLSearchParams(location.search).has('rapido'); // demonstração/testes: pulseira 10x mais rápida
let R, S = novoEstado(), M = null, E = null;

function novoEstado(){ return {salvar:false, resp:{}, contato:null, etapa:'nucleo', pos:0, nivel:null, motivos:[], info:[], log:[], base:null, pre:[], compFeito:false}; }
const el = id => document.getElementById(id);
const $ = h => { el('app').innerHTML = h; window.scrollTo(0,0); };
const on = (id, f) => { const e = el(id); if (e) e.onclick = f; };
const tema = t => document.body.dataset.tema = t;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------- armazenamento (falha em silêncio: o app funciona sem ele) ----------
const store = {
  ler(){ try { return JSON.parse(localStorage.getItem(CHAVE)); } catch { return null; } },
  gravar(){ if (!S.salvar) return; try { const o = {v:1, salvoEm:Date.now()}; CAMPOS.forEach(k => o[k] = S[k]); localStorage.setItem(CHAVE, JSON.stringify(o)); } catch {} },
  apagar(){ try { localStorage.removeItem(CHAVE); } catch {} }
};

// ---------- motor de regras ----------
function escore(nome, r){ return R.escores[nome].reduce((s,k) => s + (typeof r[k] === 'number' ? r[k] : NaN), 0); }
function cond(c, r){
  if (c.algum) return c.algum.some(x => cond(x, r));
  if (c.todos) return c.todos.every(x => cond(x, r));
  let v = c.escore ? escore(c.escore, r) : r[c.q];
  if (v === undefined || v === null || Number.isNaN(v)) return !!c.se_ausente;
  const lista = c.conta || (c.conta_grupo && R.grupos[c.conta_grupo]);
  if (lista) v = [].concat(v).filter(x => lista.includes(x)).length;
  if ('eq' in c) return v === c.eq;
  if (c.em) return c.em.includes(v);
  if (c.inclui) return [].concat(v).some(x => c.inclui.includes(x));
  if ('gte' in c) return v >= c.gte;
  if ('lt' in c) return v < c.lt;
  return false;
}
function classificar(regras, r, obrig = []){
  let nivel = 'verde'; const motivos = [], info = [];
  for (const g of regras) if (cond(g.quando, r)) (g.nivel === 'info' ? info : motivos).push(g);
  for (const m of motivos) if (ORDEM[m.nivel] > ORDEM[nivel]) nivel = m.nivel;
  const faltam = obrig.filter(o => (!o.se || cond(o.se, r)) && r[o.q] === undefined);
  if (faltam.length){ // falha segura: resposta ausente nunca resulta em verde
    if (nivel === 'verde') nivel = 'amarelo';
    motivos.push({nivel:'amarelo', motivo:`Dados incompletos: a pergunta ${faltam.map(o => o.q.slice(1)).join(', ')} ficou sem resposta. Sem isso não dá para dizer que está tudo bem.`});
  }
  return {nivel, motivos, info};
}
// após a triagem, sensor/EMA só podem SUBIR o nível; rebaixar exige nova triagem
function aplicar(res, origem){
  if (origem !== 'triagem' && S.nivel && ORDEM[res.nivel] < ORDEM[S.nivel]) res = {...res, nivel:S.nivel, motivos:S.motivos.concat(res.motivos)};
  const vistos = new Set();
  S.motivos = res.motivos.filter(m => !vistos.has(m.motivo) && vistos.add(m.motivo)).sort((a,b) => ORDEM[b.nivel] - ORDEM[a.nivel]);
  S.nivel = res.nivel; if (origem === 'triagem') S.info = res.info;
  S.log.unshift({t:new Date().toLocaleString('pt-BR'), origem, nivel:S.nivel, motivo:S.motivos[0]?.motivo || 'Sem critérios de alerta'});
  store.gravar();
}

// ---------- perguntas ----------
function faseDe(q){ return q.nucleo_se ? (cond(q.nucleo_se, S.resp) ? 'nucleo' : 'complementar') : q.fase; }
function visiveis(etapa){
  const sel = [].concat(S.resp.q7 || []);
  if (sel.length === 1) S.resp.q8 = sel[0]; // q8 redundante com uma só substância
  return R.triagem.filter(q => faseDe(q) === etapa && (!q.se || cond(q.se, S.resp)) && !S.pre.includes(q.id));
}
function opcoes(q){
  if (q.tipo === 'simnao') return [{v:'sim',l:'Sim'},{v:'nao',l:'Não'}];
  if (q.tipo === 'escala010') return [...Array(11).keys()].map(i => ({v:i, l:String(i)}));
  if (q.opcoes_de){ const src = R.triagem.find(x => x.id === q.opcoes_de), sel = [].concat(S.resp[q.opcoes_de] || []); return src.opcoes.filter(o => sel.includes(o.v)); }
  return q.opcoes || [];
}
const botao = o => `<button class=op data-v='${esc(JSON.stringify(o.v))}' aria-pressed=false>${esc(o.l)}</button>`;
// mesmo padrão visual para triagem e EMA: uma pergunta por tela, botões grandes, barra de progresso
function telaPergunta(q, ctx, responder){
  let corpo;
  if (q.tipo === 'contato') corpo = `<label>Nome ou apelido<input id=cnome maxlength=30 autocomplete=off value="${esc(S.contato?.nome || '')}"></label>
    <label>Telefone com DDD<input id=ctel inputmode=numeric maxlength=15 autocomplete=off value="${esc(S.contato?.tel || '')}"></label>
    <p id=cerro class=aviso hidden>Digite um telefone com DDD (10 ou 11 números).</p>
    <div class=opc><button class=op id=csim>Sim, salvar contato</button><button class=op id=cnao>Não tenho</button></div>`;
  else if (q.tipo === 'regiao') corpo = `<label>CEP (só os 5 primeiros números)<input id=cep inputmode=numeric maxlength=5 pattern="\\d{5}"></label>
    <label>ou bairro<input id=bairro maxlength=40 autocomplete=off></label><div class=opc><button class=op id=ok>Continuar</button></div>`;
  else if (q.tipo === 'numero') corpo = `<input id=num type=number inputmode=numeric min=0 max=${q.max || 999}><div class=opc><button class=op id=ok>Continuar</button></div>`;
  else corpo = `<div class="opc${q.tipo === 'escala010' ? ' grade' : ''}">${opcoes(q).map(botao).join('')}</div>${q.tipo === 'multi' ? '<button class=big id=continuar>Continuar</button>' : ''}`;
  $(`<div class=bar role=progressbar aria-valuemin=0 aria-valuemax=${ctx.total} aria-valuenow=${ctx.pos}><i style="width:${100 * ctx.pos / ctx.total}%"></i></div>
  <small>${ctx.rotulo} · ${ctx.pos + 1} de ${ctx.total}</small>
  <section class=card data-q="${q.id}"><h2>${esc(q.texto)}</h2>${q.ajuda ? `<p class=aviso>${esc(q.ajuda)}</p>` : ''}${corpo}</section>
  <button class=sec id=pular>Prefiro não responder</button>
  ${ctx.voltar ? '<button class=sec id=voltar>Voltar</button>' : ''}${ctx.extra || ''}`);
  const ops = [...document.querySelectorAll('.op[data-v]')];
  if (q.tipo === 'multi'){
    const marcar = (b, x) => b.setAttribute('aria-pressed', x);
    ops.forEach(b => b.onclick = () => {
      const v = JSON.parse(b.dataset.v), ligar = b.getAttribute('aria-pressed') !== 'true';
      marcar(b, ligar);
      if (ligar && q.exclusivo) ops.forEach(o => { const ov = JSON.parse(o.dataset.v); if (o !== b && (v === q.exclusivo || ov === q.exclusivo)) marcar(o, false); });
    });
    on('continuar', () => { const sel = ops.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => JSON.parse(b.dataset.v)); responder(sel.length ? sel : undefined); });
  } else ops.forEach(b => b.onclick = () => responder(JSON.parse(b.dataset.v)));
  on('csim', () => { const tel = el('ctel').value.replace(/\D/g, ''); if (tel.length < 10 || tel.length > 11) return el('cerro').hidden = false;
    responder('sim', {nome: el('cnome').value.trim().slice(0, 30) || 'Contato', tel}); });
  on('cnao', () => responder('nao'));
  on('ok', () => {
    if (q.tipo === 'numero'){ const n = parseInt(el('num').value, 10); return responder(Number.isFinite(n) && n >= 0 ? Math.min(n, q.max || 999) : undefined); }
    const cep = el('cep').value.replace(/\D/g, ''), bairro = el('bairro').value.replace(/[^\p{L}\s'-]/gu, '').trim().slice(0, 40);
    responder(cep.length === 5 ? {cep5:cep} : bairro ? {bairro} : undefined);
  });
  on('pular', () => responder(undefined));
  on('voltar', ctx.voltar);
}

function triagem(){
  const vs = visiveis(S.etapa);
  if (S.pos >= vs.length) return S.etapa === 'nucleo' ? fimNucleo() : fimComplementar();
  const q = vs[S.pos], comp = S.etapa === 'complementar';
  telaPergunta(q, {pos:S.pos, total:vs.length, rotulo: comp ? 'Perguntas complementares (opcional)' : `Triagem · bloco ${q.bloco}`,
    voltar: S.pos > 0 && (() => { S.pos--; triagem(); }), extra: comp ? '<button class=sec id=pulartudo>Pular as complementares</button>' : ''},
    (v, extra) => {
      if (v === undefined) delete S.resp[q.id]; else S.resp[q.id] = v;
      if (q.tipo === 'contato') S.contato = v === 'sim' ? extra : null;
      S.pos++; store.gravar();
      // vermelho interrompe o núcleo: vai direto para a tela de emergência
      if (!comp && R.regras.some(g => g.nivel === 'vermelho' && cond(g.quando, S.resp))) return fimNucleo();
      triagem();
    });
  on('pulartudo', fimComplementar);
}
function fimNucleo(){ S.nivel = null; aplicar(classificar(R.regras, S.resp, R.obrigatorias_para_verde), 'triagem'); S.etapa = 'resultado'; store.gravar(); resultado(); }
function fimComplementar(){ S.etapa = 'resultado'; S.compFeito = true; S.info = classificar(R.regras, S.resp).info; store.gravar(); resultado(); }
function complementar(){ S.etapa = 'complementar'; S.pos = 0; store.gravar(); triagem(); }

// ---------- resultado ----------
function temaPaciente(n){ // paciente nunca vê vermelho/amarelo vibrantes (Guia de Psicologia das Cores)
  if (n === 'vermelho') return 'crise';
  if (new Date().getHours() < 6) return 'noite';
  if (n === 'verde') return 'normal';
  const tags = S.motivos.map(m => m.tag);
  return tags.includes('fisico') ? 'taquicardia' : tags.includes('rebote') ? 'poscrise' : 'agitacao';
}
const regiao = () => S.resp.q4?.cep5 ? `CEP ${S.resp.q4.cep5}` : S.resp.q4?.bairro || '';
const mapa = termo => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(termo + (regiao() ? ' ' + regiao().replace('CEP ', '') : ' perto de mim'))}`;
function porque(){
  const ms = S.motivos.map(m => `<li>${esc(m.motivo)}${m.orientacao ? `<br><small>${esc(m.orientacao)}</small>` : ''}</li>`).join('') || '<li>Nenhum critério de alerta nas suas respostas.</li>';
  const info = S.info.map(m => `<li><b>${esc(m.motivo)}:</b> ${esc(m.orientacao)}</li>`).join('');
  return `<details class=card id=porque open><summary><b>Por que esta orientação?</b></summary><ul>${ms}</ul>${info ? `<b>Informações para você</b><ul>${info}</ul>` : ''}</details>`;
}
function resultado(){
  if (S.nivel === 'vermelho') return telaVermelho();
  const n = S.nivel, suic = S.motivos.some(m => m.tag === 'suicidio');
  tema(temaPaciente(n));
  const nComp = S.compFeito ? 0 : visiveis('complementar').length;
  const texto = n === 'amarelo'
    ? '<p>Seria bom falar com a equipe do CAPS AD ou da UBS hoje ou amanhã. Neste protótipo, o serviço receberia um aviso para entrar em contato com você.</p><p>Se piorar, ligue 192.</p>'
    : '<p>Suas respostas não mostram sinais de alerta agora. Continue se cuidando: água, comida e sono. Se algo mudar, faça a triagem de novo.</p>';
  $(`<h1 id=nivel data-nivel=${n}>${ROTULO[n]}</h1>
  <div class=card>${texto}${suic ? '<p>Se quiser conversar agora: <a class="btn big" href="tel:188">CVV 188 (24 h, gratuito)</a></p>' : ''}
    <a class="btn big sec" target=_blank rel=noopener href="${mapa('CAPS AD UBS')}">Ver CAPS AD / UBS mais próximos</a></div>
  ${porque()}
  ${nComp ? `<button class=big id=comp>Responder ${nComp} perguntas complementares (opcional)</button>` : ''}
  <button class=big id=mon>${M ? 'Ver monitoramento' : 'Acompanhar com a pulseira (simulado)'}</button>
  <button class=sec id=respirar>Exercício de respiração</button>
  <button class=sec id=painel>Visão do profissional</button>
  <button class=sec id=refazer>Refazer a triagem</button>
  <p class=aviso>Não é diagnóstico. Em dúvida, ligue 192.</p>`);
  on('comp', complementar); on('mon', monitor); on('respirar', respirar); on('painel', painel); on('refazer', () => recomecar(true));
}
// vermelho: tela única, sem escolha de serviço e sem exercício de respiração
function telaVermelho(){
  tema('crise');
  const suic = S.motivos.some(m => m.tag === 'suicidio');
  $(`<h1 id=nivel data-nivel=vermelho>Busque ajuda agora</h1>
  <div class=card><p>Você não está sozinho(a). O que você contou precisa de atendimento agora.</p>
    <a class="btn big" id=samu href="tel:192">Ligar SAMU 192</a>
    ${suic ? '<a class="btn big" id=cvv href="tel:188">Ligar CVV 188 (24 h, gratuito)</a>' : ''}
    <a class="btn big sec" id=upa target=_blank rel=noopener href="${mapa('UPA pronto-socorro')}">UPA / pronto-socorro mais próximo (abre rota)</a>
    <button class="big sec" id=avisar>Avisar meu contato de confiança</button><div id=avisado aria-live=polite></div>
    <p class=aviso>Fique perto de alguém. Não use mais nenhuma substância agora. Se alguém estiver desacordado ou respirando devagar, deite a pessoa de lado e ligue 192.</p></div>
  ${porque()}
  <button class=sec id=painel>Visão do profissional (demonstração)</button>`);
  on('painel', painel);
  on('avisar', () => {
    const c = S.contato, hora = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
    el('avisado').innerHTML = c
      ? `<div class=card><b>PROTÓTIPO: nada foi enviado.</b><br>Para: ${esc(c.nome)} (••••${esc(c.tel.slice(-4))})<br>“Pulso: pedido de ajuda (nível vermelho) às ${hora}${regiao() ? ', região ' + esc(regiao()) : ''}. Por favor, entre em contato agora.”</div>`
      : '<div class=card>Você não cadastrou um contato de confiança. Se puder, ligue para alguém próximo.</div>';
    S.log.unshift({t:new Date().toLocaleString('pt-BR'), origem:'contato', nivel:'vermelho', motivo:'Notificação ao contato de confiança (simulada)'}); store.gravar();
  });
}
function respirar(){
  $(`<h1>Respire com o círculo</h1><div id=resp></div>
  <p style="text-align:center" id=fase aria-live=polite>Inspire…</p><p class=aviso>4 segundos para inspirar, 6 para soltar o ar.</p>
  <button class=big id=voltar>Voltar</button>`);
  let t = 0; clearInterval(window._ri);
  window._ri = setInterval(() => { const e = el('fase'); if (!e) return clearInterval(window._ri); t = (t + 1) % 10; e.textContent = t < 4 ? 'Inspire…' : 'Solte o ar devagar…'; }, 1000);
  on('voltar', resultado);
}
function painel(){
  tema('normal');
  const n = S.nivel || 'verde';
  $(`<h1>Painel do profissional (protótipo)</h1>
  <p class=aviso>Aqui os alertas aparecem em vermelho/laranja para priorização clínica. O paciente vê cores calmas.</p>
  <div class=card><span class="chip ${n}">${{vermelho:'PRIORIDADE MÁXIMA', amarelo:'Contato em até 24 h', verde:'Estável'}[n]}</span>
    <ul>${S.motivos.map(m => `<li><span class="chip ${m.nivel}">${m.nivel}</span> ${esc(m.motivo)}</li>`).join('') || '<li>Sem critérios</li>'}</ul></div>
  <div class=log>${S.log.map(l => `${esc(l.t)} [${l.origem}] <span class="chip ${l.nivel}">${l.nivel}</span> ${esc(l.motivo)}`).join('<br>') || 'Sem registros'}</div>
  <button class=big id=voltar>Voltar</button>`);
  on('voltar', resultado);
}

// ---------- pulseira simulada: roda até o usuário clicar "Parar" ----------
const rnd = a => (Math.random() * 2 - 1) * a;
const CEN = {
  estavel: i => ({fc: 72 + rnd(3), mov: 1 + rnd(.3)}),
  alcool:  i => ({fc: 74 + Math.max(0, i - 12) * 1.6 + rnd(3), mov: 1 + Math.max(0, i - 12) * .12 + rnd(.3)}), // FC e tremor sobem
  recaida: i => (i < 14 ? {fc: 72 + rnd(3), mov: 1 + rnd(.3)} : {fc: 56 + rnd(2), mov: .3 + rnd(.1)})          // queda súbita (sedação)
};
const media = a => a.reduce((s, x) => s + x, 0) / a.length;
const dp = (a, min) => Math.max(Math.sqrt(media(a.map(x => (x - media(a)) ** 2))), min);
function iniciarMon(c){ M = {c, i:0, n:0, fc:[], mov:[], acima:0, ultimaEma:-Infinity, pausado:false, txt:''}; M.timer = setInterval(passo, RAPIDO ? 50 : 500); barra(); }
function pararMon(){ if (!M) return; clearInterval(M.timer); M = null; barra(); S.log.unshift({t:new Date().toLocaleString('pt-BR'), origem:'sensor', nivel:S.nivel || 'verde', motivo:'Monitoramento parado'}); store.gravar(); }
function barra(){
  el('monbar').hidden = !M; el('parconf').hidden = true; el('parar').hidden = false;
  if (M) el('monst').textContent = M.pausado ? 'Monitorando… (pausa para perguntas)' : 'Monitorando…';
}
function monitor(){
  tema(temaPaciente(S.nivel));
  $(`<h1>Pulseira (simulada)</h1>
  <div class=card>Cenário de demonstração:<div class=opc>
    <button class=op data-c=estavel>Estável</button><button class=op data-c=alcool>Abstinência de álcool piorando</button><button class=op data-c=recaida>Recaída (queda da FC)</button></div></div>
  <canvas id=cv width=500 height=120 aria-label="Gráfico da frequência cardíaca"></canvas>
  <div class=card id=st aria-live=polite>${M?.txt || 'Iniciando…'}</div>
  <button class=big id=voltar>Ver minha orientação</button>`);
  document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { M.c = b.dataset.c; M.i = 0; M.acima = 0; });
  on('voltar', resultado);
  if (!M) iniciarMon('estavel');
}
function passo(){
  if (!M || M.pausado) return;
  const cfg = R.sensor, nb = cfg.amostras_linha_base, p = CEN[M.c](M.i++);
  M.n++; M.fc.push(p.fc); M.mov.push(p.mov); if (M.fc.length > 60){ M.fc.shift(); M.mov.shift(); }
  if (!S.base && M.fc.length >= nb){ S.base = {fc:M.fc.slice(0, nb), mov:M.mov.slice(0, nb)}; store.gravar(); }
  let txt = `FC ${p.fc.toFixed(0)} bpm · movimento ${p.mov.toFixed(2)}`;
  if (S.base){
    const zf = (p.fc - media(S.base.fc)) / dp(S.base.fc, cfg.dp_minimo.fc), zm = (p.mov - media(S.base.mov)) / dp(S.base.mov, cfg.dp_minimo.mov);
    txt += ` · desvio da sua linha de base: FC ${zf.toFixed(1)}, movimento ${zm.toFixed(1)}`;
    // desvio em QUALQUER direção: na abstinência de estimulantes e na sedação a FC pode cair
    M.acima = Math.abs(zf) > cfg.desvios_para_disparo || Math.abs(zm) > cfg.desvios_para_disparo ? M.acima + 1 : 0;
    if (M.acima >= cfg.amostras_persistencia){
      M.acima = 0;
      if (M.n - M.ultimaEma >= cfg.intervalo_min_ema_leituras){ M.ultimaEma = M.n; M.pausado = true; barra(); return ema(); }
      txt += ' · mudança detectada (aguardando intervalo mínimo entre perguntas)';
    }
  } else txt += ' · calibrando sua linha de base';
  M.txt = txt; const st = el('st'); if (st) st.textContent = txt; desenhar();
}
function desenhar(){
  const cv = el('cv'); if (!cv || !M) return; const g = cv.getContext('2d');
  g.clearRect(0, 0, 500, 120); g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--pri'); g.lineWidth = 2; g.beginPath();
  M.fc.forEach((v, i) => g.lineTo(i * 500 / 60, 120 - (v - 40) * 120 / 100)); g.stroke();
}
// EMA: sempre as mesmas 4 perguntas, mesmo padrão da triagem
function ema(){ E = {pos:0, r:{}}; tema('taquicardia'); emaQ(); }
function emaQ(){
  const vs = R.ema.filter(q => !q.se || cond(q.se, E.r));
  if (E.pos >= vs.length) return fimEma();
  const q = vs[E.pos];
  telaPergunta(q, {pos:E.pos, total:vs.length, rotulo:'A pulseira notou uma mudança', voltar:false, extra:'<button class=sec id=naoconsigo>Não consigo responder agora</button>'},
    v => { if (v !== undefined) E.r[q.id] = v; E.pos++; emaQ(); });
  on('naoconsigo', semResposta);
}
function fimEma(){
  if (!Object.keys(E.r).length) return semResposta();
  const antes = S.nivel;
  aplicar(classificar(R.regras.concat(R.regras_ema), {...S.resp, ...E.r}), 'EMA');
  posEma(antes);
}
function semResposta(){ // sensor alterado + sem resposta = amarelo, nunca verde
  const antes = S.nivel;
  aplicar({nivel:'amarelo', motivos:[{nivel:'amarelo', motivo:'A pulseira notou uma mudança e não houve resposta: a equipe deve tentar contato.'}]}, 'sensor');
  posEma(antes);
}
function posEma(antes){
  if (ORDEM[S.nivel] > ORDEM[antes || 'verde']){ pararMon(); return resultado(); } // nível subiu: interrompe e mostra o nível
  M.pausado = false; barra(); monitor();
}

// ---------- início, retomada e apagar dados ----------
function consentimento(){
  tema('normal');
  $(`<h1>Pulso</h1>
  <div class=card><b>Isto não é diagnóstico.</b> É uma ferramenta de apoio para decidir quando procurar o CAPS AD, a UBS ou o SAMU. Em emergência, ligue <b>192</b>.</div>
  <div class=card><b>Seus dados (LGPD, art. 11)</b><br>Vamos perguntar sobre uso de substâncias e saúde mental, que são dados sensíveis. Você pode pular qualquer pergunta. Não pedimos texto livre nem sua localização exata.</div>
  <label class="card check"><input type=checkbox id=salvar> <span>Guardar minhas respostas <b>só neste aparelho</b> para continuar depois. <small>Apenas para teste. Nada é enviado. Você pode apagar a qualquer momento.</small></span></label>
  <button class=big id=aceito>Concordo e quero continuar</button>
  <button class=sec id=recuso>Não concordo</button>`);
  on('aceito', () => { S = novoEstado(); S.salvar = el('salvar').checked; store.gravar(); triagem(); });
  on('recuso', () => $('<div class=card>Tudo bem. Se precisar, ligue 192 (SAMU) ou 188 (CVV).</div>'));
}
function telaRetomar(salvo){
  tema('normal');
  $(`<h1>Bem-vindo(a) de volta</h1>
  <div class=card>Há respostas salvas neste aparelho (apenas para teste).</div>
  <button class=big id=continuar>Continuar de onde parei</button>
  <button class=big id=denovo>Começar de novo</button>`);
  const carregar = () => { S = novoEstado(); CAMPOS.forEach(k => { if (salvo[k] !== undefined) S[k] = salvo[k]; }); S.salvar = true; };
  on('continuar', () => { carregar(); S.etapa === 'resultado' && S.nivel ? resultado() : triagem(); });
  on('denovo', () => { carregar(); recomecar(true); });
}
// recomeçar reaproveita o perfil salvo (idade, sexo, região, moradia, contato) e a linha de base
function recomecar(manterPerfil){
  pararMon();
  const velho = S; S = {...novoEstado(), salvar:velho.salvar, base:velho.base, log:velho.log};
  if (manterPerfil){ for (const k of R.perfil) if (velho.resp[k] !== undefined) S.resp[k] = velho.resp[k]; S.pre = Object.keys(S.resp); S.contato = velho.contato; }
  store.gravar(); triagem();
}
function apagar(){
  pararMon(); store.apagar(); S = novoEstado(); tema('normal');
  $(`<div class=card id=apagado>Seus dados foram apagados deste aparelho.</div><button class=big id=inicio>Começar</button>`);
  on('inicio', consentimento);
}

fetch('rules.json').then(r => r.json()).then(j => {
  R = j;
  on('apagar', apagar);
  on('parar', () => { el('parar').hidden = true; el('parconf').hidden = false; });
  on('parSim', () => { pararMon(); resultado(); });
  on('parNao', () => { el('parar').hidden = false; el('parconf').hidden = true; });
  const salvo = store.ler();
  salvo?.v === 1 ? telaRetomar(salvo) : consentimento();
}).catch(() => $('<div class=card>Não foi possível carregar rules.json. Abra por um servidor (veja o README).</div>'));
