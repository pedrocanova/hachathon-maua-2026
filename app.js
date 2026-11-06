// Pulso — protótipo de triagem de risco (hackathon). Não faz diagnóstico: todo resultado vai para revisão por profissional.
// Toda regra clínica está em rules.json; este arquivo só interpreta.
// Persistência: só localStorage, só com consentimento, só para teste (LGPD art. 11).
const ORDEM = {verde:0, amarelo:1, vermelho:2};
const ROTULO = {verde:'Risco baixo agora', amarelo:'Procure o CAPS AD ou a UBS em até 24 h', vermelho:'Busque ajuda agora'};
const CHAVE = 'pulso_v2';
const CAMPOS = ['resp','contato','etapa','pos','nivel','motivos','info','log','base','pre','compFeito','tTriagem','revisao','pul','alertaId','locAlerta'];
const GPS_SIM = {lat:-23.5505, lon:-46.6333}; // coordenadas simuladas
let R, S = novoEstado(), E = null;

function novoEstado(){
  return {salvar:false, resp:{}, contato:null, etapa:'nucleo', pos:0, nivel:null, motivos:[], info:[], log:[], base:null, pre:[], compFeito:false,
    tTriagem:null, revisao:{status:'pendente', nivel:null, obs:'', em:null}, alertaId:0, locAlerta:null,
    pul:{ativo:false, cenario:'estavel', con:'wifi', bateria:100, buffer:[], enviados:0, ultimaEma:null, i:0, acelerado:new URLSearchParams(location.search).has('rapido')}};
}
const el = id => document.getElementById(id);
const render = (alvo, h) => { el(alvo).innerHTML = h; if (alvo === 'app') window.scrollTo(0, 0); };
const $ = h => render('app', h);
const on = (id, f) => { const e = el(id); if (e) e.onclick = f; };
const tema = t => document.body.dataset.tema = t;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hora = () => new Date().toLocaleString('pt-BR');
const registrar = (origem, nivel, motivo) => S.log.unshift({t:hora(), origem, nivel, motivo});
const escala = () => S.pul.acelerado ? 60 : 1;                       // tempo acelerado: 1 s = 1 min
const minDesde = t => t ? (Date.now() - t) * escala() / 60000 : Infinity;
const duracao = min => min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dia${Math.round(min / 1440) > 1 ? 's' : ''}`;

// ---------- armazenamento (falha em silêncio: o app funciona sem ele) ----------
const store = {
  ler(){ try { return JSON.parse(localStorage.getItem(CHAVE)); } catch { return null; } },
  gravar(){ if (!S.salvar) return; try { const o = {v:2}; CAMPOS.forEach(k => o[k] = S[k]); localStorage.setItem(CHAVE, JSON.stringify(o)); } catch {} },
  apagar(){ try { localStorage.removeItem(CHAVE); localStorage.removeItem('pulso_v1'); } catch {} }
};

// ---------- motor de regras ----------
function escore(nome, r){ return R.escores[nome].reduce((s, k) => s + (typeof r[k] === 'number' ? r[k] : NaN), 0); }
function cond(c, r){
  if (c.algum) return c.algum.some(x => cond(x, r));
  if (c.todos) return c.todos.every(x => cond(x, r));
  let v = c.escore ? escore(c.escore, r) : r[c.q];
  if (v === undefined || v === null || Number.isNaN(v)) return !!c.se_ausente;
  if ('total' in c) return [].concat(v).length === c.total;
  if (c.somente) return [].concat(v).length > 0 && [].concat(v).every(x => c.somente.includes(x));
  const lista = c.conta || (c.conta_grupo && R.grupos[c.conta_grupo]);
  if (lista) v = [].concat(v).filter(x => lista.includes(x)).length;
  if ('eq' in c) return v === c.eq;
  if (c.em) return c.em.includes(v);
  if (c.inclui) return [].concat(v).some(x => c.inclui.includes(x));
  if ('gte' in c) return v >= c.gte;
  if ('lt' in c) return v < c.lt;
  return false;
}
// derivações (rules.json): o que já foi respondido ou é dedutível não é perguntado de novo
function derivar(r){
  const v = {}, ocultas = {};
  for (const d of R.derivacoes){
    const atual = {...v, ...r};
    if (!cond(d.se, atual)) continue;
    if (d.define) for (const [k, x] of Object.entries(d.define)) if (r[k] === undefined) v[k] = x;
    if (d.copia && r[d.copia.para] === undefined) v[d.copia.para] = [].concat(atual[d.copia.de])[0];
    if (d.mapa && r[d.mapa.para] === undefined) v[d.mapa.para] = [...new Set([].concat(atual[d.mapa.de] || []).flatMap(s => d.mapa.valores[s] || []))];
    if (d.oculta_opcao) (ocultas[d.oculta_opcao.q] ||= []).push(d.oculta_opcao.v);
  }
  return {v, ocultas};
}
const resp = () => ({...derivar(S.resp).v, ...S.resp});
function classificar(regras, r, obrig = []){
  let nivel = 'verde'; const motivos = [], info = [];
  for (const g of regras) if (cond(g.quando, r)) (g.nivel === 'info' ? info : motivos).push(g);
  for (const m of motivos) if (ORDEM[m.nivel] > ORDEM[nivel]) nivel = m.nivel;
  const faltam = obrig.filter(o => (!o.se || cond(o.se, r)) && r[o.q] === undefined);
  if (faltam.length){ // falha segura: resposta ausente nunca resulta em verde
    if (nivel === 'verde') nivel = 'amarelo';
    motivos.push({nivel:'amarelo', motivo:`Dados incompletos: a pergunta ${faltam.map(o => o.q.slice(1)).join(', ')} ficou sem resposta. Sem isso não dá para dizer que o risco é baixo.`});
  }
  return {nivel, motivos, info};
}
// sensor/EMA/SOS só SOBEM o nível; baixar só com nova triagem ou revisão do profissional
function aplicar(res, origem){
  const podeBaixar = origem === 'triagem' || origem === 'profissional';
  if (!podeBaixar && S.nivel && ORDEM[res.nivel] < ORDEM[S.nivel]) res = {...res, nivel:S.nivel, motivos:S.motivos.concat(res.motivos)};
  const vistos = new Set();
  S.motivos = res.motivos.filter(m => !vistos.has(m.motivo) && vistos.add(m.motivo));
  if (origem !== 'profissional') S.motivos.sort((a, b) => ORDEM[b.nivel] - ORDEM[a.nivel]);
  if (S.nivel !== res.nivel || origem === 'triagem') S.revisao = {status:'pendente', nivel:null, obs:'', em:null};
  S.nivel = res.nivel; if (origem === 'triagem') S.info = res.info;
  registrar(origem, S.nivel, S.motivos[0]?.motivo || 'Sem critérios de alerta');
  store.gravar();
}

// ---------- perfil de risco (rules.json/perfis) ----------
function perfil(){
  const r = resp(), P = R.perfis, sel = [].concat(r.q7 || []), ord = k => P.intensidades[k].ordem;
  let cands = P.classes.filter(c => c.substancias.some(s => sel.includes(s)));
  const semInfo = !cands.length;
  if (semInfo) cands = [P.classes.find(c => c.id === P.classe_sem_informacao)];
  const classe = cands.reduce((a, b) => ord(b.intensidade) > ord(a.intensidade) ? b : a);
  const mods = P.modificadores.filter(m => cond(m.quando, r));
  let intId = classe.intensidade;
  if (mods.length) intId = Object.keys(P.intensidades).find(k => ord(k) === Math.min(ord(intId) + 1, 2));
  const int = P.intensidades[intId];
  const h0 = P.horas_desde_q12[r.q12];
  const horas = h0 === undefined ? null : h0 + minDesde(S.tTriagem || Date.now()) / 60;
  const j = classe.janela;
  const fase = horas === null ? {id:'desconhecida', texto:'último uso não informado: por segurança, consideramos a fase de maior risco'}
    : horas < j.inicio_h ? {id:'antes', texto:`a fase de maior risco começa em cerca de ${duracao((j.inicio_h - horas) * 60)}: ${j.rotulo}`}
    : horas <= j.fim_h ? {id:'janela', texto:`dentro da fase de maior risco: ${j.rotulo}`}
    : {id:'depois', texto: classe.depois_janela || 'a fase de maior risco já passou'};
  const nomes = sel.filter(s => classe.substancias.includes(s)).map(s => P.nomes_curtos[s]).join(' e ') || 'a substância';
  const tempo = horas === null ? '' : ` e o último uso foi há cerca de ${duracao(horas * 60)}`;
  const motivos = [
    semInfo ? `${int.frase} porque não sabemos qual substância você usou: por segurança, usamos o acompanhamento mais próximo.`
            : `${int.frase} porque você está parando ${nomes}${tempo}.`,
    cands.length > 1 && `Você marcou mais de uma substância: vale o acompanhamento da de maior risco (${nomes}).`,
    mods.length && `Reforçamos o acompanhamento porque: ${mods.map(m => m.motivo).join('; ')}.`,
    `Check-in a cada ${duracao(int.checkin_min)}. A pulseira chama um check-in extra quando seus sinais se afastam do seu normal (sensibilidade ${int.sensibilidade}).`,
    classe.risco_vital ? `Prestamos atenção em: ${classe.foco.join(', ')}.` : `Para ${nomes}, o foco é ${classe.foco.join(', ')}.`,
    horas === null && 'Você não informou o último uso: por segurança, consideramos que está na fase de maior risco.'
  ].filter(Boolean);
  return {classe, intId, int, mods, horas, fase, motivos, nomes};
}

// ---------- perguntas ----------
function faseDe(q, r){ return q.nucleo_se ? (cond(q.nucleo_se, r) ? 'nucleo' : 'complementar') : q.fase; }
function visiveis(etapa){
  const r = resp(), der = derivar(S.resp).v;
  return R.triagem.filter(q => faseDe(q, r) === etapa && (!q.se || cond(q.se, r)) && !S.pre.includes(q.id) && der[q.id] === undefined);
}
function opcoes(q){
  if (q.tipo === 'simnao') return [{v:'sim', l:'Sim'}, {v:'nao', l:'Não'}];
  if (q.tipo === 'escala010') return [...Array(11).keys()].map(i => ({v:i, l:String(i)}));
  if (q.opcoes_de){ const src = R.triagem.find(x => x.id === q.opcoes_de), sel = [].concat(S.resp[q.opcoes_de] || []); return src.opcoes.filter(o => sel.includes(o.v)); }
  const ocultas = q.ema ? [] : derivar(S.resp).ocultas[q.id] || [];
  return (q.opcoes || []).filter(o => !ocultas.includes(o.v));
}
const botao = o => `<button class=op data-v='${esc(JSON.stringify(o.v))}' aria-pressed=false>${esc(o.l)}</button>`;
// mesmo padrão visual para triagem e EMA: uma pergunta por tela, botões grandes, barra de progresso
function telaPergunta(q, ctx, responder){
  const alvo = ctx.alvo || 'app';
  let corpo;
  if (q.tipo === 'contato') corpo = `<label>Nome ou apelido<input id=cnome maxlength=30 autocomplete=off value="${esc(S.contato?.nome)}"></label>
    <label>Telefone com DDD<input id=ctel inputmode=numeric maxlength=15 autocomplete=off value="${esc(S.contato?.tel)}"></label>
    <p id=cerro class=aviso hidden>Digite um telefone com DDD (10 ou 11 números).</p>
    <div class=opc><button class=op id=csim>Sim, salvar contato</button><button class=op id=cnao>Não tenho</button></div>`;
  else if (q.tipo === 'regiao') corpo = `<label>CEP (só os 5 primeiros números)<input id=cep inputmode=numeric maxlength=5></label>
    <label>ou bairro<input id=bairro maxlength=40 autocomplete=off></label><div class=opc><button class=op id=ok>Continuar</button></div>`;
  else if (q.tipo === 'numero') corpo = `<input id=num type=number inputmode=numeric min=0 max=${q.max || 999}><div class=opc><button class=op id=ok>Continuar</button></div>`;
  else corpo = `<div class="opc${q.tipo === 'escala010' ? ' grade' : ''}">${opcoes(q).map(botao).join('')}</div>${q.tipo === 'multi' ? '<button class=big data-acao=continuar>Continuar</button>' : ''}`;
  render(alvo, `<div class=bar role=progressbar aria-valuemin=0 aria-valuemax=${ctx.total} aria-valuenow=${ctx.pos}><i style="width:${100 * ctx.pos / ctx.total}%"></i></div>
  <small>${ctx.rotulo} · ${ctx.pos + 1} de ${ctx.total}</small>
  <section class=card data-q="${q.id}"><h2>${esc(q.texto)}</h2>${q.ajuda ? `<p class=aviso>${esc(q.ajuda)}</p>` : ''}${corpo}</section>
  <button class=sec data-acao=pular>Prefiro não responder</button>
  ${ctx.voltar ? '<button class=sec data-acao=voltar>Voltar</button>' : ''}${ctx.extra || ''}`);
  const raiz = el(alvo), f = s => raiz.querySelector(s), ops = [...raiz.querySelectorAll('.op[data-v]')];
  const marcado = b => b.getAttribute('aria-pressed') === 'true';
  if (q.tipo === 'multi'){
    ops.forEach(b => b.onclick = () => {
      const v = JSON.parse(b.dataset.v), ligar = !marcado(b);
      b.setAttribute('aria-pressed', ligar);
      if (ligar && q.exclusivo) ops.forEach(o => { if (o !== b && (v === q.exclusivo || JSON.parse(o.dataset.v) === q.exclusivo)) o.setAttribute('aria-pressed', false); });
    });
    f('[data-acao=continuar]').onclick = () => { const sel = ops.filter(marcado).map(b => JSON.parse(b.dataset.v)); responder(sel.length ? sel : undefined); };
  } else ops.forEach(b => b.onclick = () => responder(JSON.parse(b.dataset.v)));
  if (f('#csim')) f('#csim').onclick = () => { const tel = f('#ctel').value.replace(/\D/g, ''); if (tel.length < 10 || tel.length > 11) return f('#cerro').hidden = false;
    responder('sim', {nome: f('#cnome').value.trim().slice(0, 30) || 'Contato', tel}); };
  if (f('#cnao')) f('#cnao').onclick = () => responder('nao');
  if (f('#ok')) f('#ok').onclick = () => {
    if (q.tipo === 'numero'){ const n = parseInt(f('#num').value, 10); return responder(Number.isFinite(n) && n >= 0 ? Math.min(n, q.max || 999) : undefined); }
    const cep = f('#cep').value.replace(/\D/g, ''), bairro = f('#bairro').value.replace(/[^\p{L}\s'-]/gu, '').trim().slice(0, 40);
    responder(cep.length === 5 ? {cep5:cep} : bairro ? {bairro} : undefined);
  };
  f('[data-acao=pular]').onclick = () => responder(undefined);
  if (ctx.voltar) f('[data-acao=voltar]').onclick = ctx.voltar;
}

function triagem(){
  const vs = visiveis(S.etapa);
  if (S.pos >= vs.length) return S.etapa === 'nucleo' ? fimNucleo() : fimComplementar();
  const q = vs[S.pos], comp = S.etapa === 'complementar';
  tema('normal');
  telaPergunta(q, {pos:S.pos, total:vs.length, rotulo: comp ? 'Perguntas complementares (opcional)' : `Triagem de risco · bloco ${q.bloco}`,
    voltar: S.pos > 0 && (() => { S.pos--; triagem(); }), extra: comp ? '<button class=sec id=pulartudo>Pular as complementares</button>' : ''},
    (v, extra) => {
      if (v === undefined) delete S.resp[q.id]; else S.resp[q.id] = v;
      if (q.tipo === 'contato') S.contato = v === 'sim' ? extra : null;
      S.pos++; store.gravar();
      // vermelho interrompe o núcleo: vai direto para a tela de emergência
      if (!comp && R.regras.some(g => g.nivel === 'vermelho' && cond(g.quando, resp()))) return fimNucleo();
      triagem();
    });
  on('pulartudo', fimComplementar);
}
function fimNucleo(){
  S.nivel = null; S.tTriagem = Date.now(); S.pul.ultimaEma = Date.now(); // o 1º check-in não repete o que acabou de ser respondido
  aplicar(classificar(R.regras, resp(), R.obrigatorias_para_verde), 'triagem');
  S.etapa = 'resultado'; store.gravar();
  S.nivel === 'vermelho' ? telaVermelho(true) : resultado();
}
function fimComplementar(){ S.etapa = 'resultado'; S.compFeito = true; S.info = classificar(R.regras, resp()).info; store.gravar(); resultado(); }
function complementar(){ S.etapa = 'complementar'; S.pos = 0; store.gravar(); triagem(); }

// ---------- resultado ----------
function temaPaciente(n){ // paciente nunca vê vermelho/amarelo vibrantes (Guia de Psicologia das Cores)
  if (n === 'vermelho') return 'crise';
  if (new Date().getHours() < 6) return 'noite';
  if (S.log.some(l => l.nivel === 'vermelho')) return 'poscrise';
  if (S.motivos.some(m => m.tag === 'rebote')) return 'poscrise';
  return n ? perfil().classe.tema : 'normal';
}
const regiao = () => S.resp.q4?.cep5 ? `CEP ${S.resp.q4.cep5}` : S.resp.q4?.bairro || '';
const mapa = termo => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(termo + (regiao() ? ' ' + regiao().replace('CEP ', '') : ' perto de mim'))}`;
const statusRevisao = () => S.revisao.status === 'revisado'
  ? `<p class=aviso id=revisao data-status=revisado>Revisado por profissional (${esc(S.revisao.em)}).${S.revisao.obs ? ' Observação: ' + esc(S.revisao.obs) : ''}</p>`
  : '<p class=aviso id=revisao data-status=pendente>Resultado de triagem de risco, pendente de revisão por profissional.</p>';
function porque(){
  const ms = S.motivos.map(m => `<li>${esc(m.motivo)}${m.orientacao ? `<br><small>${esc(m.orientacao)}</small>` : ''}</li>`).join('') || '<li>Nenhum critério de alerta nas suas respostas.</li>';
  const info = S.info.map(m => `<li><b>${esc(m.motivo)}:</b> ${esc(m.orientacao)}</li>`).join('');
  return `<details class=card id=porque open><summary><b>Por que esta orientação?</b></summary><ul>${ms}</ul>${info ? `<b>Informações para você</b><ul>${info}</ul>` : ''}</details>`;
}
function resultado(){
  if (S.nivel === 'vermelho') return telaVermelho(false);
  const n = S.nivel, suic = S.motivos.some(m => m.tag === 'suicidio'), pf = perfil();
  tema(temaPaciente(n));
  const nComp = S.compFeito ? 0 : visiveis('complementar').length;
  const texto = n === 'amarelo'
    ? '<p>Seria bom falar com a equipe do CAPS AD ou da UBS hoje ou amanhã. Neste protótipo, o serviço receberia um aviso para entrar em contato com você.</p><p>Se piorar, toque em SOS ou ligue 192.</p>'
    : '<p>Suas respostas não mostram sinais de alerta agora. Continue se cuidando: água, comida e sono.</p>';
  $(`<small>Resultado da triagem de risco</small><h1 id=nivel data-nivel=${n}>${ROTULO[n]}</h1>${statusRevisao()}
  <div class=card>${texto}${suic ? '<p>Se quiser conversar agora: <a class="btn big" href="tel:188">CVV 188 (24 h, gratuito)</a></p>' : ''}
    <a class="btn big sec" target=_blank rel=noopener href="${mapa('CAPS AD UBS')}">Ver CAPS AD / UBS mais próximos</a></div>
  ${porque()}
  <div class=card id=perfil data-perfil=${pf.classe.id} data-intensidade=${pf.intId}><b>Seu acompanhamento: ${pf.int.rotulo.toLowerCase()}</b><ul>${pf.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
  <button class=big id=mon>${S.pul.ativo ? 'Ver acompanhamento' : 'Começar acompanhamento com a pulseira'}</button>
  ${nComp ? `<button class="big sec" id=comp>Responder ${nComp} perguntas complementares (opcional)</button>` : ''}
  <button class=sec id=respirar>Exercício de respiração</button>
  <button class=sec id=resumo>Resumo para revisão clínica</button>
  <button class=sec id=painel>Visão do profissional</button>
  <button class=sec id=refazer>Refazer a triagem</button>
  <p class=aviso>Triagem de risco, não é diagnóstico. Em dúvida, ligue 192.</p>`);
  on('comp', complementar); on('mon', monitor); on('respirar', respirar); on('painel', painel); on('resumo', () => telaResumo(resultado)); on('refazer', recomecar);
}
// vermelho: tela única, sem escolha de serviço e sem exercício de respiração
function telaVermelho(novoAlerta){
  if (novoAlerta){ S.alertaId++; store.gravar(); }
  tema('crise');
  const suic = S.motivos.some(m => m.tag === 'suicidio'), locOk = S.locAlerta === S.alertaId;
  $(`<h1 id=nivel data-nivel=vermelho>Busque ajuda agora</h1>
  <div class=card><p>Você não está sozinho(a). O que você contou precisa de atendimento agora.</p>
    <a class="btn big" id=samu href="tel:192">Ligar SAMU 192</a>
    ${suic ? '<a class="btn big" id=cvv href="tel:188">Ligar CVV 188 (24 h, gratuito)</a>' : ''}
    <a class="btn big sec" id=upa target=_blank rel=noopener href="${mapa('UPA pronto-socorro')}">UPA / pronto-socorro mais próximo (abre rota)</a>
    <button class="big sec" id=avisar>Avisar meu contato de confiança</button><div id=avisado aria-live=polite></div>
    <p class=aviso>Fique perto de alguém. Não use mais nenhuma substância agora. Se alguém estiver desacordado ou respirando devagar, deite a pessoa de lado e ligue 192.</p></div>
  <div class=card id=locbox>${locOk ? locTexto()
    : `<b>Compartilhar sua localização?</b><p class=aviso>Só neste alerta, com o seu contato de confiança e o serviço de saúde. Fora de alertas, a localização nunca é compartilhada.</p>
       <button id=locsim>Sim, compartilhar neste alerta</button><button class=sec id=locnao>Agora não</button>`}</div>
  ${porque()}${statusRevisao()}
  ${S.pul.ativo ? '<button class=sec id=mon>Voltar ao acompanhamento</button>' : ''}
  <button class=sec id=painel>Visão do profissional (demonstração)</button>`);
  on('painel', painel); on('mon', monitor);
  on('locsim', () => { S.locAlerta = S.alertaId; registrar('paciente', 'vermelho', 'Localização compartilhada neste alerta (consentimento)'); store.gravar(); el('locbox').innerHTML = locTexto(); });
  on('locnao', () => { el('locbox').innerHTML = '<p class=aviso>Tudo bem. Sua localização não foi compartilhada.</p>'; });
  on('avisar', () => {
    const c = S.contato, hh = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}), loc = S.locAlerta === S.alertaId;
    el('avisado').innerHTML = c
      ? `<div class=card><b>PROTÓTIPO: nada foi enviado.</b>${S.pul.con === 'offline' ? ' (sem conexão: seria enviado ao reconectar)' : ''}<br>Para: ${esc(c.nome)} (••••${esc(c.tel.slice(-4))})<br>“Pulso: pedido de ajuda (nível vermelho) às ${hh}${regiao() ? ', região ' + esc(regiao()) : ''}${loc ? `, localização ${coords()}` : ''}. Por favor, entre em contato agora.”</div>`
      : '<div class=card>Você não cadastrou um contato de confiança. Se puder, ligue para alguém próximo.</div>';
    registrar('contato', 'vermelho', 'Aviso ao contato de confiança (simulado)'); store.gravar();
  });
}
const coords = () => `${GPS_SIM.lat.toFixed(4)}, ${GPS_SIM.lon.toFixed(4)}`;
const locTexto = () => `<p id=loc><b>Localização compartilhada neste alerta (simulada):</b> ${coords()}</p>`;
function sos(){
  aplicar({nivel:'vermelho', motivos:[{nivel:'vermelho', motivo:'Você pediu ajuda pelo botão SOS.'}]}, 'SOS');
  fecharEma(); telaVermelho(true);
}
function respirar(){
  $(`<h1>Respire com o círculo</h1><div id=resp></div>
  <p style="text-align:center" id=fase aria-live=polite>Inspire…</p><p class=aviso>4 segundos para inspirar, 6 para soltar o ar.</p>
  <button class=big id=voltar>Voltar</button>`);
  let t = 0; clearInterval(window._ri);
  window._ri = setInterval(() => { const e = el('fase'); if (!e) return clearInterval(window._ri); t = (t + 1) % 10; e.textContent = t < 4 ? 'Inspire…' : 'Solte o ar devagar…'; }, 1000);
  on('voltar', resultado);
}

// ---------- resumo para revisão clínica ----------
function rotuloOpcao(id, v){ const q = R.triagem.find(x => x.id === id); return [].concat(v ?? []).map(x => q?.opcoes?.find(o => o.v === x)?.l ?? x); }
function resumo(){
  const r = resp(), pf = perfil();
  return {documento:'Resumo para revisão clínica', aviso:R._meta.aviso, observacao:'Triagem de risco. Não é diagnóstico.', gerado_em:new Date().toISOString(),
    status_revisao:S.revisao.status, revisao:S.revisao, nivel:S.nivel,
    perfil:{classe:pf.classe.id, intensidade:pf.intId, modificadores:pf.mods.map(m => m.motivo), fase:pf.fase.texto,
      horas_desde_ultimo_uso_estimadas: pf.horas === null ? null : Math.round(pf.horas), checkin_min:pf.int.checkin_min},
    substancias:rotuloOpcao('q7', r.q7), ultima_dose:rotuloOpcao('q12', r.q12)[0] ?? null, idade:rotuloOpcao('q1', r.q1)[0] ?? null,
    criterios:S.motivos.map(m => ({nivel:m.nivel, motivo:m.motivo})), orientacoes:S.info.map(m => m.motivo),
    contato_de_confianca: S.contato ? 'cadastrado' : 'não cadastrado', historico:S.log, respostas:r};
}
function telaResumo(voltar){
  tema('normal');
  const o = resumo(), json = JSON.stringify(o, null, 2);
  $(`<h1>Resumo para revisão clínica</h1><p class=aviso>Triagem de risco, não é diagnóstico. Status: <b id=status>${o.status_revisao === 'pendente' ? 'pendente de revisão' : 'revisado'}</b></p>
  <div class=card><p><b>Nível:</b> ${o.nivel} · <b>Perfil:</b> ${o.perfil.classe} (${o.perfil.intensidade})</p>
  <p><b>Substâncias:</b> ${esc(o.substancias.join('; ') || 'não informado')}<br><b>Último uso:</b> ${esc(o.ultima_dose || 'não informado')}<br><b>Fase:</b> ${esc(o.perfil.fase)}</p>
  <b>Critérios que dispararam</b><ul>${o.criterios.map(c => `<li>[${c.nivel}] ${esc(c.motivo)}</li>`).join('') || '<li>Nenhum</li>'}</ul>
  <b>Histórico do acompanhamento</b><ul>${o.historico.slice(0, 30).map(l => `<li>${esc(l.t)} · ${esc(l.origem)} · ${l.nivel} · ${esc(l.motivo)}</li>`).join('')}</ul></div>
  <details class=card><summary>JSON</summary><pre id=json>${esc(json)}</pre></details>
  <button id=imprimir>Imprimir</button><button id=baixar>Baixar JSON</button>
  <button class="big sec" id=voltar>Voltar</button>`);
  on('imprimir', () => window.print());
  on('baixar', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], {type:'application/json'})); a.download = 'pulso-resumo.json'; a.click(); });
  on('voltar', voltar);
}

// ---------- painel do profissional (simulado) ----------
const FICTICIOS = [{nome:'Paciente exemplo B (fictício)', nivel:'amarelo', status:'revisado'}, {nome:'Paciente exemplo C (fictício)', nivel:'verde', status:'pendente'}];
function painel(){
  tema('normal');
  const n = S.nivel || 'verde', linha = p => `<tr><td>${esc(p.nome)}</td><td><span class="chip ${p.nivel}">${p.nivel}</span></td><td>${p.status}</td></tr>`;
  $(`<h1>Painel do profissional (simulado)</h1>
  <p class=aviso>Aqui os alertas aparecem em vermelho/laranja para priorização. O paciente vê cores calmas. Os níveis são resultado de triagem de risco e dependem da sua revisão.</p>
  <div class=tab><table><tr><th>Paciente</th><th>Nível</th><th>Revisão</th></tr>${linha({nome:'Esta sessão', nivel:n, status:S.revisao.status})}${FICTICIOS.map(linha).join('')}</table></div>
  <div class=card id=revisar><b>Esta sessão: confirmar ou ajustar nível</b>
    <ul>${S.motivos.map(m => `<li><span class="chip ${m.nivel}">${m.nivel}</span> ${esc(m.motivo)}</li>`).join('') || '<li>Sem critérios</li>'}</ul>
    <label>Nível após revisão<select id=profnivel>${['vermelho','amarelo','verde'].map(x => `<option ${x === n ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Observação curta<input id=profobs maxlength=140 autocomplete=off></label>
    <button id=profok>Confirmar ou ajustar nível</button><p id=profmsg class=aviso aria-live=polite></p></div>
  <div class=log>${S.log.map(l => `${esc(l.t)} [${esc(l.origem)}] <span class="chip ${l.nivel}">${l.nivel}</span> ${esc(l.motivo)}`).join('<br>') || 'Sem registros'}</div>
  <button class=sec id=resumo>Resumo para revisão clínica</button><button class=big id=voltar>Voltar</button>`);
  on('profok', () => {
    const novo = el('profnivel').value, obs = el('profobs').value.trim().slice(0, 140), acao = novo === S.nivel ? 'confirmado' : 'ajustado';
    aplicar({nivel:novo, motivos:[{nivel:novo, motivo:`Nível ${acao} por profissional${obs ? ': ' + obs : ''}.`}, ...S.motivos]}, 'profissional');
    S.revisao = {status:'revisado', nivel:novo, obs, em:hora()}; store.gravar(); painel();
  });
  on('resumo', () => telaResumo(painel));
  on('voltar', () => S.pul.ativo ? monitor() : resultado());
}

// ---------- pulseira simulada: serviço independente das telas ----------
const rnd = a => (Math.random() * 2 - 1) * a;
const CEN = {
  estavel: i => ({fc: 72 + rnd(3), mov: 1 + rnd(.3)}),
  alcool:  i => ({fc: 74 + Math.min(Math.max(0, i - 12) * 1.6, 45) + rnd(3), mov: 1 + Math.min(Math.max(0, i - 12) * .12, 3) + rnd(.3)}), // FC e tremor sobem
  recaida: i => (i < 14 ? {fc: 72 + rnd(3), mov: 1 + rnd(.3)} : {fc: 56 + rnd(2), mov: .3 + rnd(.1)}),                                      // queda súbita (sedação)
  opioide: i => ({fc: 74 + Math.min(Math.max(0, i - 12) * 1.0, 30) + rnd(3), mov: 1 + Math.min(Math.max(0, i - 12) * .08, 2) + rnd(.5)})   // inquietação, FC sobe
};
const CENARIOS = {estavel:'Estável', alcool:'Abstinência de álcool piorando', recaida:'Recaída (queda da FC)', opioide:'Abstinência de opioide'};
const CONEXOES = {wifi:'Wi-Fi', dados:'Dados móveis da pulseira', offline:'Sem conexão'};
const media = a => a.reduce((s, x) => s + x, 0) / a.length;
const dp = (a, min) => Math.max(Math.sqrt(media(a.map(x => (x - media(a)) ** 2))), min);
const Pulseira = {
  timer:null, n:0, fc:[], mov:[], acima:0, txt:'', aviso:'',
  iniciar(){ S.pul.ativo = true; S.pul.ultimaEma ||= Date.now(); registrar('pulseira', S.nivel || 'verde', 'Monitoramento iniciado'); store.gravar(); this.ligar(); },
  ligar(){ clearInterval(this.timer); this.timer = setInterval(() => this.passo(), S.pul.acelerado ? 50 : 500); barra(); },
  parar(motivo = 'Monitoramento parado pelo usuário'){
    clearInterval(this.timer); this.timer = null;
    if (S.pul.ativo){ S.pul.ativo = false; registrar('pulseira', S.nivel || 'verde', motivo); store.gravar(); }
    barra();
  },
  passo(){
    try {
      const cfg = R.sensor, nb = cfg.amostras_linha_base, pf = perfil(), p = CEN[S.pul.cenario](S.pul.i++);
      this.n++; this.fc.push(p.fc); this.mov.push(p.mov); if (this.fc.length > 60){ this.fc.shift(); this.mov.shift(); }
      if (!S.base && this.fc.length >= nb) S.base = {fc:this.fc.slice(-nb), mov:this.mov.slice(-nb)};
      const leitura = {t:Date.now(), fc:Math.round(p.fc), mov:+p.mov.toFixed(2)};
      if (S.pul.con === 'offline'){ S.pul.buffer.push(leitura); if (S.pul.buffer.length > 500) S.pul.buffer.shift(); }
      else { if (S.pul.buffer.length){ this.aviso = `Conexão de volta: ${S.pul.buffer.length} leituras guardadas foram enviadas.`; S.pul.enviados += S.pul.buffer.length; S.pul.buffer = []; } S.pul.enviados++; }
      S.pul.bateria = Math.max(5, S.pul.bateria - 0.0005 * escala());
      let txt = '';
      if (S.base){
        const zf = (p.fc - media(S.base.fc)) / dp(S.base.fc, cfg.dp_minimo.fc), zm = (p.mov - media(S.base.mov)) / dp(S.base.mov, cfg.dp_minimo.mov);
        txt = `Desvio do seu normal: FC ${zf.toFixed(1)}, movimento ${zm.toFixed(1)} (limite ${pf.int.desvios_para_disparo})`;
        // desvio em QUALQUER direção: na abstinência de estimulantes e na sedação a FC pode cair
        this.acima = Math.abs(zf) > pf.int.desvios_para_disparo || Math.abs(zm) > pf.int.desvios_para_disparo ? this.acima + 1 : 0;
        if (this.acima >= cfg.amostras_persistencia){
          this.acima = 0;
          if (podeEma() && minDesde(S.pul.ultimaEma) >= pf.int.cooldown_min) abrirEma('pulseira');
          else this.aviso = 'A pulseira notou uma mudança. Próxima pergunta só depois do intervalo mínimo.';
        }
      } else txt = 'Calibrando o seu normal (linha de base)…';
      if (podeEma() && minDesde(S.pul.ultimaEma) >= pf.int.checkin_min) abrirEma('check-in');
      this.txt = txt; hud(pf, leitura);
      if (this.n % 20 === 0) store.gravar();
    } catch (e) { console.error(e); } // uma leitura com erro nunca derruba o serviço
  }
};
const podeEma = () => !E && S.etapa === 'resultado';
function barra(){
  el('barra').hidden = !el('app').dataset.sessao; // SOS e "Encerrar sessão" sempre visíveis durante a sessão
  el('monwrap').hidden = !S.pul.ativo; el('parconf').hidden = true; el('parar').hidden = false;
  el('monst').textContent = E ? 'Monitorando… (check-in aberto)' : 'Monitorando…';
}
function hud(pf, l){
  if (!el('hud')) return;
  const prox = Math.max(0, pf.int.checkin_min - minDesde(S.pul.ultimaEma));
  el('fc').textContent = l.fc; el('mov').textContent = l.mov.toFixed(2); el('st').textContent = Pulseira.txt;
  el('n').textContent = Pulseira.n; el('hud').dataset.n = Pulseira.n;
  el('con').textContent = CONEXOES[S.pul.con]; el('bat').textContent = Math.round(S.pul.bateria) + '%';
  el('buf').textContent = S.pul.con === 'offline' ? `${S.pul.buffer.length} leituras guardadas na pulseira (envio ao reconectar)` : Pulseira.aviso || `${S.pul.enviados} leituras enviadas`;
  el('prox').textContent = E ? 'agora' : `em ${duracao(prox)}`;
  el('fasetxt').textContent = pf.fase.texto;
  el('desde').textContent = pf.horas === null ? 'Último uso não informado' : `Cerca de ${duracao(pf.horas * 60)} desde o último uso`;
  el('nivelmon').textContent = ROTULO[S.nivel || 'verde']; el('nivelmon').dataset.nivel = S.nivel || 'verde';
  desenhar();
}
function desenhar(){
  const cv = el('cv'); if (!cv) return; const g = cv.getContext('2d');
  g.clearRect(0, 0, 500, 120); g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--pri'); g.lineWidth = 2; g.beginPath();
  Pulseira.fc.forEach((v, i) => g.lineTo(i * 500 / 60, 120 - (v - 40) * 120 / 100)); g.stroke();
}
// tela de monitoramento: personalizada pelo perfil de risco
function monitor(){
  if (!S.pul.ativo) Pulseira.iniciar();
  const pf = perfil(), c = pf.classe;
  tema(temaPaciente(S.nivel));
  const conteudos = c.conteudos.map(k => R.conteudos[k]).map(x => `<p><b>${esc(x.titulo)}:</b> ${esc(x.texto)}</p>`).join('');
  $(`<h1>Acompanhamento</h1>
  <div class=card id=hud data-perfil=${c.id} data-intensidade=${pf.intId} data-checkin=${pf.int.checkin_min} data-risco-vital=${c.risco_vital}>
    <small>Nível atual (triagem de risco)</small><p class=destaque id=nivelmon data-nivel=${S.nivel || 'verde'}>${ROTULO[S.nivel || 'verde']}</p>
    <p><b id=desde></b><br><span id=fasetxt></span></p>
    <p><b>${esc(pf.int.rotulo)}</b> · próximo check-in <b id=prox></b> <span id=intervalo>(a cada ${duracao(pf.int.checkin_min)})</span></p>
    <details><summary>Por que este acompanhamento?</summary><ul id=motivosperfil>${pf.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>
  </div>
  <div class="card vivo"><div><small>Frequência cardíaca</small><b class=num><span id=fc>–</span> bpm</b></div><div><small>Movimento</small><b class=num id=mov>–</b></div>
    <canvas id=cv width=500 height=120 aria-label="Gráfico da frequência cardíaca"></canvas><p class=aviso id=st aria-live=polite></p><small>Leituras nesta sessão: <span id=n>0</span></small></div>
  <div class=card id=disp><b>Pulseira</b><br>Conexão: <span id=con></span> · Bateria: <span id=bat></span><br>
    GPS: <span id=gps>ativo · localização não compartilhada (só em alerta vermelho ou SOS, com sua permissão)</span><br><small id=buf></small></div>
  <div class=card id=foco><b>${c.risco_vital ? 'Fique atento(a) a' : 'Foco'}:</b> ${esc(c.foco.join(', '))}<ul>${c.psicoeducacao.map(p => `<li>${esc(p)}</li>`).join('')}</ul>${conteudos}</div>
  <button class=big id=checkin>Fazer check-in agora</button>
  <details class=card id=demo><summary>Modo demonstração</summary>
    <p class=aviso>Troca o cenário e a conexão sem parar o monitoramento.</p>
    <div class=opc>${Object.entries(CENARIOS).map(([k, l]) => `<button class=op data-c=${k} aria-pressed=${S.pul.cenario === k}>${l}</button>`).join('')}</div>
    <p>Conexão:</p><div class=opc>${Object.entries(CONEXOES).map(([k, l]) => `<button class=op data-con=${k} aria-pressed=${S.pul.con === k}>${l}</button>`).join('')}</div>
    <label class=check><input type=checkbox id=acel ${S.pul.acelerado ? 'checked' : ''}> Tempo acelerado (1 s = 1 min)</label></details>
  <button class=sec id=verres>Ver minha orientação</button><button class=sec id=resumo>Resumo para revisão clínica</button><button class=sec id=painel>Visão do profissional</button>`);
  document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { S.pul.cenario = b.dataset.c; S.pul.i = 0; Pulseira.acima = 0; registrar('demo', S.nivel, 'Cenário: ' + CENARIOS[b.dataset.c]); store.gravar(); marcar('[data-c]', b); });
  document.querySelectorAll('[data-con]').forEach(b => b.onclick = () => { S.pul.con = b.dataset.con; store.gravar(); marcar('[data-con]', b); });
  el('acel').onchange = e => { S.pul.acelerado = e.target.checked; store.gravar(); Pulseira.ligar(); };
  on('checkin', () => { if (!E) abrirEma('paciente'); });
  on('verres', resultado); on('resumo', () => telaResumo(monitor)); on('painel', painel);
  hud(pf, {fc:Math.round(Pulseira.fc.at(-1) || 0), mov:Pulseira.mov.at(-1) || 0});
}
const marcar = (sel, b) => document.querySelectorAll(sel).forEach(x => x.setAttribute('aria-pressed', x === b));

// EMA: painel sobreposto; o monitoramento continua rodando por baixo
function abrirEma(origem){
  const pf = perfil();
  S.pul.ultimaEma = Date.now();
  E = {origem, pos:0, r:{}, itens:pf.classe.ema.map(k => ({...R.ema_itens[k], ema:true}))};
  registrar('check-in', S.nivel || 'verde', `Check-in aberto (${origem})`); store.gravar();
  el('ema').hidden = false; barra(); emaQ();
}
function emaQ(){
  if (E.pos >= E.itens.length) return fimEma();
  const q = E.itens[E.pos];
  telaPergunta(q, {alvo:'emacorpo', pos:E.pos, total:E.itens.length, rotulo: E.origem === 'pulseira' ? 'A pulseira notou uma mudança' : 'Check-in', voltar:false,
    extra:'<button class=sec id=naoconsigo>Não consigo responder agora</button>'},
    v => { if (v !== undefined) E.r[q.id] = v; E.pos++; emaQ(); });
  on('naoconsigo', semResposta);
}
function fecharEma(){ E = null; el('ema').hidden = true; render('emacorpo', ''); barra(); }
function fimEma(){
  if (!Object.keys(E.r).length) return semResposta();
  const antes = S.nivel;
  aplicar(classificar(R.regras.concat(R.regras_ema), {...resp(), ...E.r}), 'check-in');
  fecharEma(); posReclass(antes);
}
function semResposta(){ // mudança + sem resposta = amarelo, nunca verde
  const antes = S.nivel;
  aplicar({nivel:'amarelo', motivos:[{nivel:'amarelo', motivo:'Houve um check-in sem resposta: a equipe deve tentar contato.'}]}, 'check-in');
  fecharEma(); posReclass(antes);
}
function posReclass(antes){
  if (S.nivel === 'vermelho' && antes !== 'vermelho') return telaVermelho(true);
  if (el('hud')) monitor();
}

// ---------- consentimento, sessão ----------
function consentimento(msg = ''){
  tema('normal');
  $(`${msg}<h1>Pulso</h1>
  <div class=card><b>Triagem de risco, não é diagnóstico.</b> Ajuda a decidir quando procurar o CAPS AD, a UBS ou o SAMU. Todo resultado passa por revisão por profissional. Em emergência, ligue <b>192</b>.</div>
  <div class=card><b>Seus dados (LGPD, art. 11)</b><br>Vamos perguntar sobre uso de substâncias e saúde mental, que são dados sensíveis. Você pode pular qualquer pergunta. Não pedimos texto livre nem sua localização exata.</div>
  <label class="card check"><input type=checkbox id=salvar> <span>Guardar meus dados <b>só neste aparelho</b> até eu tocar em "Encerrar sessão". <small>Apenas para teste. Nada é enviado.</small></span></label>
  <button class=big id=aceito>Concordo e quero começar</button>
  <button class=sec id=recuso>Não concordo</button>`);
  on('aceito', () => { S = novoEstado(); S.salvar = el('salvar').checked; el('app').dataset.sessao = 1; store.gravar(); barra(); triagem(); });
  on('recuso', () => $('<div class=card>Tudo bem. Se precisar, ligue 192 (SAMU) ou 188 (CVV).</div>'));
}
// refazer a triagem reaproveita o perfil (idade, sexo, região, moradia, contato) e a linha de base; a pulseira continua
function recomecar(){
  const velho = S;
  S = {...novoEstado(), salvar:velho.salvar, base:velho.base, log:velho.log, pul:velho.pul, alertaId:velho.alertaId};
  for (const k of R.perfil) if (velho.resp[k] !== undefined) S.resp[k] = velho.resp[k];
  S.pre = Object.keys(S.resp); S.contato = velho.contato;
  store.gravar(); triagem();
}
function telaEncerrar(){
  const volta = S.nivel === 'vermelho' ? () => telaVermelho(false) : S.pul.ativo ? monitor : S.etapa === 'resultado' ? resultado : triagem;
  tema('normal');
  $(`<h1>Encerrar sessão</h1><div class=card>Isso para a pulseira e apaga deste aparelho todas as respostas, o contato de confiança, a linha de base e o histórico.</div>
  ${S.nivel ? '<button class="big sec" id=exportar>Antes, ver e exportar o resumo</button>' : ''}
  <button class=big id=encerrarok>Encerrar e apagar tudo</button><button class=sec id=cancelar>Cancelar</button>`);
  on('exportar', () => telaResumo(telaEncerrar)); on('cancelar', volta);
  on('encerrarok', () => {
    Pulseira.parar('Sessão encerrada'); fecharEma(); store.apagar(); S = novoEstado(); delete el('app').dataset.sessao; Pulseira.fc = []; Pulseira.mov = []; Pulseira.n = 0;
    barra(); consentimento('<div class=card id=encerrada>Sessão encerrada. Seus dados foram apagados deste aparelho.</div>');
  });
}

fetch('rules.json').then(r => r.json()).then(j => {
  R = j;
  on('sos', sos); on('encerrar', telaEncerrar);
  on('parar', () => { el('parar').hidden = true; el('parconf').hidden = false; });
  on('parSim', () => { Pulseira.parar(); el('hud') ? resultado() : barra(); });
  on('parNao', () => { el('parar').hidden = false; el('parconf').hidden = true; });
  const salvo = store.ler();
  if (salvo?.v !== 2) return consentimento();
  CAMPOS.forEach(k => { if (salvo[k] !== undefined) S[k] = salvo[k]; });
  S.salvar = true; el('app').dataset.sessao = 1;
  if (S.pul.ativo) Pulseira.ligar(); // a pulseira continua depois de recarregar, até "Parar" ou "Encerrar sessão"
  barra();
  if (S.etapa !== 'resultado') return triagem();
  S.nivel === 'vermelho' ? telaVermelho(false) : S.pul.ativo ? monitor() : resultado();
}).catch(e => { console.error(e); $('<div class=card>Não foi possível carregar rules.json. Abra por um servidor (veja o README).</div>'); });
