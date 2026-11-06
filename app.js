// Pulso — protótipo de classificação de risco (hackathon). Não faz diagnóstico: todo resultado vai para revisão por profissional.
// Toda regra clínica está em rules.json (parâmetros iniciais NÃO validados); este arquivo só interpreta.
// Persistência: só localStorage, só com consentimento, só para teste (LGPD art. 11).
// Premissa: GPS e reconhecimento de atividade vêm da pulseira e/ou do celular (configurável); a pulseira (BLE) envia FC, tremor, sono e vibra. Tudo simulado.
const ORDEM = {verde:0, amarelo:1, vermelho:2};
const ROTULO = {verde:'Risco baixo agora', amarelo:'Procure o CAPS AD ou a UBS em até 24 h', vermelho:'Busque ajuda agora'};
const CHAVE = 'pulso_v2';
const CAMPOS = ['nome','checkinProf','resp','contato','etapa','pos','nivel','motivos','info','log','base','pre','compFeito','tTriagem','revisao','pul','alertaId','locAlerta','locPrevia','telemetria','ultimaEmaResp','ultimoUso','aba','vistos','ultimaQ','avisos'];
const GPS_SIM = {lat:-23.5505, lon:-46.6333}; // coordenadas simuladas
const FONTES = {pulseira:'pulseira', celular:'celular', ambos:'pulseira + celular'};
const fonte = () => FONTES[S.pul.fonte || 'ambos'];
const URLP = new URLSearchParams(location.search);
let T = {}, R, S, E = null, AL = null, ESC = null;

function novoEstado(){
  const agoraReal = Date.now();
  const st = {salvar:false, resp:{}, contato:null, etapa:'nucleo', pos:0, nivel:null, motivos:[], info:[], log:[], base:null, pre:[], compFeito:false,
    tTriagem:null, revisao:{status:'pendente', nivel:null, obs:'', em:null}, alertaId:0, locAlerta:null, locPrevia:false, telemetria:[], ultimaEmaResp:{},
    ultimoUso:null, checkinProf:null, aba:'inicio', vistos:[], ultimaQ:null, avisos:null,
    pul:{ativo:false, cenario:'estavel', con:'wifi', bateria:100, buffer:[], enviados:0, ultimaEma:null, ultimoAlerta:null, i:0,
      vel: URLP.has('rapido') ? 60 : [1, 5, 60].includes(+URLP.get('vel')) ? +URLP.get('vel') : 1,
      t0Real:agoraReal, t0Sim:agoraReal, desloc:0, ativManual:null, fonte:'ambos', silencioAte:null, treino:null, notifDia:null, faseKey:null}};
  if (URLP.has('hora')){ const d = new Date(), h = +URLP.get('hora'); st.pul.desloc = ((h - d.getHours() + 24) % 24) * 60 - d.getMinutes(); }
  return st;
}
const el = id => document.getElementById(id);
const render = (alvo, h) => { el(alvo).innerHTML = h; if (alvo === 'app') window.scrollTo(0, 0); };
const $ = h => render('app', h);
const on = (id, f) => { const e = el(id); if (e) e.onclick = f; };
const tema = t => document.body.dataset.tema = t;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hora = () => new Date(agora()).toLocaleString('pt-BR');
const registrar = (origem, nivel, motivo) => S.log.unshift({t:hora(), origem, nivel:nivel || 'verde', motivo});

// ---------- relógio simulado (aceleração 1x, 5x, 60x; deslocamento para demonstração) ----------
const agora = () => { const p = S.pul; return p.t0Sim + (Date.now() - p.t0Real) * p.vel + p.desloc * 60000; };
const minDesde = t => t == null ? Infinity : (agora() - t) / 60000;
const horaSim = () => new Date(agora()).getHours();
const noite = () => { const c = R.sensor.checkin_sensor, h = horaSim(); return h >= c.noite_inicio_h || h < c.noite_fim_h; };
// horário de sono: nenhum check-in agendado (o paciente pode ajustar; só o profissional libera check-in de madrugada)
const horarioSono = () => S.pul.sono || {ini:R.sensor.checkin_agendado.sono_inicio_h, fim:R.sensor.checkin_agendado.sono_fim_h};
const naJanela = () => { const {ini, fim} = horarioSono(), h = horaSim(); return ini > fim ? h >= ini || h < fim : h >= ini && h < fim; };
const dormindo = () => naJanela() || !!S.pul.sonoSensor; // janela de silêncio OU pulseira indicando sono
const escalaCurta = () => Math.min(S.pul.vel, R.sensor.escalonamento.acelerar_contagens_max); // contagens curtas aceleram no máximo 5x
function mudarVel(v){ const a = agora() - S.pul.desloc * 60000; S.pul.t0Sim = a; S.pul.t0Real = Date.now(); S.pul.vel = v; Pulseira.ligar(); store.gravar(); }
function irParaHora(h){ const d = new Date(agora()); S.pul.desloc += ((h - d.getHours() + 24) % 24) * 60 - d.getMinutes(); }
const duracao = min => min < 60 ? `${Math.max(0, Math.round(min))} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dia${Math.round(min / 1440) > 1 ? 's' : ''}`;

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
// último uso: perguntado UMA vez (q12); o tempo sem usar é sempre agora − carimbo (sobrevive a recarregar e trocar de tela)
const horasSemUso = () => S.ultimoUso ? Math.max(0, (agora() - Date.parse(S.ultimoUso.iso)) / 3600000) : null;
function definirUltimoUso(faixa, ajuste, fonte){
  const h = ajuste?.n > 0 ? ajuste.n * (ajuste.unidade === 'dias' ? 24 : 1) : R.ultimo_uso.horas_da_faixa[faixa];
  if (h === undefined) return;
  S.ultimoUso = {iso:new Date(agora() - h * 3600000).toISOString(), faixa, ajuste: ajuste?.n > 0 ? ajuste : null, fonte};
}
function textoSemUso(){
  const h = horasSemUso(); if (h === null) return 'Último uso não informado';
  const d = Math.floor(h / 24), hh = Math.floor(h % 24);
  return `${d} dia${d === 1 ? '' : 's'} e ${hh} hora${hh === 1 ? '' : 's'} sem usar`;
}
const comTempo = r => { const h = horasSemUso(); return h === null ? {...r} : {...r, h_sem_uso:h}; };
const resp = () => { const b = comTempo(S.resp); return {...derivar(b).v, ...b}; };
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

// ---------- perfil de risco (rules.json/perfis + regimes) ----------
function perfil(){
  const r = resp(), P = R.perfis, sel = [].concat(r.q7 || []), ord = k => P.intensidades[k].ordem;
  const porOrdem = o => Object.keys(P.intensidades).find(k => ord(k) === o);
  let cands = P.classes.filter(c => c.substancias.some(s => sel.includes(s)));
  const semInfo = !cands.length;
  if (semInfo) cands = [P.classes.find(c => c.id === P.classe_sem_informacao)];
  cands = [...cands].sort((a, b) => ord(b.intensidade) - ord(a.intensidade)); // maior risco primeiro
  const classe = cands[0];
  const mods = P.modificadores.filter(m => cond(m.quando, r));
  const horas = horasSemUso();
  const regime = horas === null ? R.regimes.lista[0] : R.regimes.lista.find(g => g.ate_h === null || horas < g.ate_h);
  const agudo = regime.id === 'agudo';
  const checkin = S.checkinProf?.min ?? Math.max(R.sensor.checkin_agendado.minimo_padrao_min, regime.checkin_min ?? P.intensidades[porOrdem(Math.max(0, Math.min(ord(classe.intensidade) + (mods.length ? 1 : 0), 2) + regime.ajuste_intensidade))].checkin_min);
  const intId = porOrdem(Math.max(0, Math.min(ord(classe.intensidade) + (mods.length ? 1 : 0), 2) + regime.ajuste_intensidade));
  const int = P.intensidades[intId], sono = horarioSono();
  const j = classe.janela;
  const fase = !agudo ? {id:regime.id, texto:`${regime.nome}, semana ${Math.floor(horas / 168) + 1}`}
    : horas === null ? {id:'desconhecida', texto:'último uso não informado: por segurança, consideramos a fase de maior risco'}
    : horas < j.inicio_h ? {id:'antes', texto:`a fase de maior risco começa em cerca de ${duracao((j.inicio_h - horas) * 60)}: ${j.rotulo}`}
    : horas <= j.fim_h ? {id:'janela', texto:`dentro da fase de maior risco: ${j.rotulo}`}
    : {id:'depois', texto: classe.depois_janela || 'a fase de maior risco já passou'};
  const nomesDe = c => sel.filter(s => c.substancias.includes(s)).map(s => P.nomes_curtos[s]).join(' e ') || 'a substância';
  const nomes = nomesDe(classe);
  const riscoVital = agudo && classe.risco_vital;
  const foco = agudo ? classe.foco : regime.foco;
  const depressorAgudo = agudo && cands.some(c => c.id === 'depressores');
  const tempo = horas === null ? '' : ` e o último uso foi há cerca de ${duracao(horas * 60)}`;
  const motivos = [
    semInfo ? `${int.frase} porque não sabemos qual substância você usou: por segurança, usamos o acompanhamento mais próximo.`
            : `${int.frase} porque você está parando ${nomes}${tempo}.`,
    !agudo && `Você está na ${regime.nome.toLowerCase()}: check-ins mais espaçados, com foco em ${foco.join(', ')}.`,
    cands.length > 1 && `Você marcou mais de uma substância: vale o acompanhamento da de maior risco (${nomes}).`,
    mods.length && `Reforçamos o acompanhamento porque: ${mods.map(m => m.motivo).join('; ')}.`,
    `Check-in a cada ${duracao(checkin)}${S.checkinProf ? ` (sua equipe pediu um acompanhamento mais próximo${S.checkinProf.motivo ? ': ' + S.checkinProf.motivo : ''}${S.checkinProf.noite ? ', inclusive à noite, por segurança' : ''}; definido pelo profissional que acompanha você)` : ''}${S.checkinProf?.noite ? '.' : `, nunca no seu horário de sono (${sono.ini}h às ${sono.fim}h).`} A pulseira pede um check-in extra quando seus sinais se afastam do seu normal (sensibilidade ${int.sensibilidade}).`,
    riscoVital ? `Prestamos atenção em: ${foco.join(', ')}.` : `O foco é ${foco.join(', ')}.`,
    horas === null && 'Você não informou o último uso: por segurança, consideramos que está na fase de maior risco.'
  ].filter(Boolean);
  return {checkin, classe, cands, intId, int, mods, horas, regime, agudo, fase, motivos, nomes, nomesDe, riscoVital, foco, depressorAgudo,
    ema: agudo ? classe.ema : (classe.ema_recuperacao || regime.ema),
    altoRisco: depressorAgudo && intId === 'intensivo',
    dia: S.tTriagem ? Math.floor(minDesde(S.tTriagem) / 1440) + 1 : 1};
}

// ---------- orientação proativa: "Hoje e nos próximos dias" ----------
function itemOrientacao(classeId, horas){
  const its = R.orientacao.itens.filter(i => i.classe === classeId), h = horas ?? 0; // sem q12: primeira faixa (fase de maior risco)
  return its.find(i => h >= i.faixa_h[0] && (i.faixa_h[1] === null || h < i.faixa_h[1])) || its[0];
}
function adaptacoes(){
  const r = resp(), u = S.ultimaEmaResp || {}, A = R.orientacao.adaptacoes, out = [];
  const sono = u.e_sono ?? r.q21, fissura = u.q22 ?? r.q22;
  if (['pouco', 'quase_nao'].includes(sono)) out.push(['sono_ruim', A.sono_ruim]);
  if (typeof fissura === 'number' && fissura >= 7) out.push(['fissura_alta', A.fissura_alta]);
  if (S.nivel === 'amarelo') out.push(['amarelo', A.amarelo]);
  return out;
}
function cartaoOrientacao(pf){
  const itens = pf.cands.map(c => ({c, it:itemOrientacao(c.id, pf.horas)})).filter(x => x.it);
  const multi = itens.length > 1, pre = x => multi ? `${pf.nomesDe(x.c)}: ` : '';
  const lista = k => itens.flatMap(x => x.it[k].map(t => `<li>${esc(pre(x) + t)}</li>`)).join('');
  const procure = [...new Set(itens.flatMap(x => x.it.procure))].map(t => `<li>${esc(t)}</li>`).join(''); // perfil de maior risco primeiro
  const ad = adaptacoes();
  return `<section class=card id=orientacao data-itens="${itens.map(x => x.it.id).join(',')}">
    <h2>Hoje e nos próximos dias</h2><p class=aviso>${esc(R.orientacao.aviso)}</p>
    ${ad.length ? `<ul id=adaptacoes>${ad.map(([k, a]) => `<li data-adapt=${k}><b>${esc(a.texto)}</b></li>`).join('')}</ul>` : ''}
    <p class=passo id=passohoje><b>${esc(T.passo_hoje)}:</b> ${esc(itens[0]?.it.ajuda[0] || '')}</p>
    <h3>Hoje você pode sentir…</h3><ul>${lista('hoje')}</ul>
    <h3>Nos próximos dias pode acontecer…</h3><ul>${lista('proximos')}</ul>
    <h3>O que ajuda agora</h3><ul>${lista('ajuda')}</ul>
    <button class=sec data-acao=respirar>Respiração guiada</button>
    <div id=procure class=procure><h3>Procure ajuda se…</h3><ul>${procure}</ul>
      <a class="btn sec" target=_blank rel=noopener href="${mapa('CAPS AD UBS')}">CAPS AD / UBS mais próximos</a>
      <button data-acao=ligar192>SAMU 192</button></div>
    <small>Fonte: ${esc(itens.map(x => x.it.fonte).join(' · '))}. Revisão clínica: pendente.</small></section>`;
}
function ligarCartao(raiz){
  raiz.querySelectorAll('[data-acao=respirar]').forEach(b => b.onclick = () => ir('respirar'));
  raiz.querySelectorAll('[data-acao=ligar192]').forEach(b => b.onclick = ligacaoManual);
}
// notificação simulada: início do dia e mudança de fase
function toast(t){ const e = el('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => e.hidden = true, 6000); registrar('notificação', S.nivel, t); }
function verificarNotificacoes(pf){
  const d = new Date(agora()), dia = d.toDateString();
  if (d.getHours() >= (S.pul.notifH ?? R.sensor.notificacao_diaria_h) && S.pul.notifDia !== dia){ S.pul.notifDia = dia; toast('Bom dia. Veja o que esperar hoje no cartão "Hoje e nos próximos dias".'); }
  const chave = pf.regime.id + '|' + pf.cands.map(c => itemOrientacao(c.id, pf.horas)?.id).join(',');
  if (S.pul.faseKey && S.pul.faseKey !== chave){
    S.pul.faseKey = chave; toast(`Nova fase do acompanhamento: ${pf.fase.texto}. O cartão "Hoje e nos próximos dias" foi atualizado.`);
    renderAba();
  } else S.pul.faseKey = chave;
}

// ---------- perguntas ----------
function faseDe(q, r){ return q.nucleo_se ? (cond(q.nucleo_se, r) ? 'nucleo' : 'complementar') : q.fase; }
function visiveis(etapa){
  const r = resp(), der = derivar(comTempo(S.resp)).v;
  return R.triagem.filter(q => faseDe(q, r) === etapa && (!q.se || cond(q.se, r)) && !S.pre.includes(q.id) && der[q.id] === undefined);
}
function opcoes(q){
  if (q.tipo === 'simnao') return [{v:'sim', l:'Sim'}, {v:'nao', l:'Não'}];
  if (q.tipo === 'escala010') return [...Array(11).keys()].map(i => ({v:i, l:String(i)}));
  if (q.opcoes_de){ const src = R.triagem.find(x => x.id === q.opcoes_de), sel = [].concat(S.resp[q.opcoes_de] || []); return src.opcoes.filter(o => sel.includes(o.v)); }
  const ocultas = q.ema ? [] : derivar(comTempo(S.resp)).ocultas[q.id] || [];
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
  else if (q.tipo === 'ultimo_uso') corpo = `<div class=ajuste><label>Se souber, há quantas<input id=ajn type=number inputmode=numeric min=1 max=999></label>
    <label>horas ou dias?<select id=aju><option value=horas>horas</option><option value=dias>dias</option></select></label></div>
    <div class=opc>${opcoes(q).map(botao).join('')}</div>`;
  else if (q.tipo === 'numero') corpo = `<input id=num type=number inputmode=numeric min=0 max=${q.max || 999}><div class=opc><button class=op id=ok>Continuar</button></div>`;
  else corpo = `<div class="opc${q.tipo === 'escala010' ? ' grade' : ''}">${opcoes(q).map(botao).join('')}</div>${q.tipo === 'multi' ? '<button class=big data-acao=continuar>Continuar</button>' : ''}`;
  render(alvo, `<div class=bar role=progressbar aria-valuemin=0 aria-valuemax=${ctx.total} aria-valuenow=${ctx.pos}><i style="width:${100 * ctx.pos / ctx.total}%"></i></div>
  <small>${ctx.rotulo} · ${ctx.pos + 1} de ${ctx.total}</small>
  ${ctx.intro ? `<p class=transicao>${esc(ctx.intro)}</p>` : ''}<section class=card data-q="${q.id}"><h2>${esc(q.texto)}</h2>${q.ajuda ? `<p class=aviso>${esc(q.ajuda)}</p>` : ''}${corpo}</section>
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
  } else ops.forEach(b => b.onclick = () => responder(JSON.parse(b.dataset.v),
    q.tipo === 'ultimo_uso' ? {n:Math.min(Math.max(parseInt(f('#ajn').value, 10) || 0, 0), 999), unidade:f('#aju').value} : undefined));
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
  const intro = !comp && (S.pos === 0 || vs[S.pos - 1].bloco !== q.bloco) ? T.transicoes?.[q.bloco] : '';
  telaPergunta(q, {intro, pos:S.pos, total:vs.length, rotulo: comp ? 'Perguntas complementares (opcional)' : `Triagem · bloco ${q.bloco}`,
    voltar: S.pos > 0 && (() => { S.pos--; triagem(); }), extra: comp ? '<button class=sec id=pulartudo>Pular as complementares</button>' : ''},
    (v, extra) => {
      if (v === undefined) delete S.resp[q.id]; else S.resp[q.id] = v;
      if (q.tipo === 'contato') S.contato = v === 'sim' ? extra : null;
      if (q.tipo === 'ultimo_uso'){ S.ultimoUso = null; if (v !== undefined) definirUltimoUso(v, extra, 'triagem'); }
      S.pos++; S.ultimaQ = q.id; store.gravar();
      // critério vermelho NOVO interrompe o núcleo e vai para a tela de ajuda (sem ligar sozinho para o 192)
      if (!comp && R.regras.some(g => g.nivel === 'vermelho' && !S.vistos.includes(g.motivo) && cond(g.quando, resp()))) return fimNucleo();
      triagem();
    });
  on('pulartudo', fimComplementar);
}
function fimNucleo(){
  const fora = S.motivos.filter(m => m.nivel === 'vermelho' && !R.regras.some(g => g.motivo === m.motivo)); // ex.: SOS durante a triagem
  S.nivel = null; S.tTriagem = agora(); S.pul.ultimaEma = agora(); // o 1º check-in não repete o que acabou de ser respondido
  const res = classificar(R.regras, resp(), R.obrigatorias_para_verde);
  if (fora.length){ res.nivel = 'vermelho'; res.motivos = fora.concat(res.motivos); }
  aplicar(res, 'triagem');
  S.etapa = 'resultado'; S.aba = 'inicio'; store.gravar();
  const novoVermelho = S.motivos.some(m => m.nivel === 'vermelho' && !S.vistos.includes(m.motivo));
  novoVermelho ? telaVermelho(true, () => ir('inicio'), 'triagem') : ir('inicio');
}
// tela de ajuda vinda da triagem: corrigir um toque errado ou continuar as perguntas
function corrigirResposta(){
  const q = S.ultimaQ; delete S.resp[q]; if (q === 'q12') S.ultimoUso = null;
  S.etapa = 'nucleo'; S.nivel = null; S.motivos = [];
  registrar('paciente', 'verde', `Corrigiu a resposta da pergunta ${q.slice(1)} (toque errado). O alerta anterior continua no histórico.`);
  S.pos = Math.max(0, visiveis('nucleo').findIndex(x => x.id === q)); store.gravar(); triagem();
}
function continuarTriagem(){
  S.vistos = [...new Set(S.vistos.concat(S.motivos.filter(m => m.nivel === 'vermelho').map(m => m.motivo)))];
  S.etapa = 'nucleo'; store.gravar(); triagem();
}
function fimComplementar(){ S.etapa = 'resultado'; S.compFeito = true; S.info = classificar(R.regras, resp()).info; store.gravar(); ir('inicio'); }
function complementar(){ S.etapa = 'complementar'; S.pos = 0; store.gravar(); triagem(); }

// ---------- resultado ----------
function temaPaciente(n){ // paciente nunca vê vermelho/amarelo vibrantes (Guia de Psicologia das Cores; escolha de design, sem efeito fisiológico comprovado)
  if (n === 'vermelho') return 'crise';
  if (noite()) return 'noite';
  if (S.log.some(l => l.nivel === 'vermelho') || S.motivos.some(m => m.tag === 'rebote')) return 'poscrise';
  return n ? perfil().classe.tema : 'normal';
}
const regiao = () => S.resp.q4?.cep5 ? `CEP ${S.resp.q4.cep5}` : S.resp.q4?.bairro || '';
const mapa = termo => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(termo + (regiao() ? ' ' + regiao().replace('CEP ', '') : ' perto de mim'))}`;
const statusRevisao = () => S.revisao.status === 'revisado'
  ? `<p class=aviso id=revisao data-status=revisado>Revisado por profissional (${esc(S.revisao.em)}).${S.revisao.obs ? ' Observação: ' + esc(S.revisao.obs) : ''}</p>`
  : '<p class=aviso id=revisao data-status=pendente>Classificação de risco pendente de revisão por profissional.</p>';
function porque(){
  const ms = S.motivos.map(m => `<li>${esc(m.motivo)}${m.orientacao ? `<br><small>${esc(m.orientacao)}</small>` : ''}</li>`).join('') || '<li>Nenhum critério de alerta nas suas respostas.</li>';
  const info = S.info.map(m => `<li><b>${esc(m.motivo)}:</b> ${esc(m.orientacao)}</li>`).join('');
  return `<details class=card id=porque><summary><b>Por que esta orientação?</b></summary><ul>${ms}</ul>${info ? `<b>Informações para você</b><ul>${info}</ul>` : ''}</details>`;
}
// ---------- navegação por abas: uma função principal por tela ----------
const ABAS = [['inicio', '⌂', 'Início'], ['pulseira', '♡', 'Pulseira'], ['respirar', '◯', 'Respirar'], ['hoje', '☼︎', 'Hoje'], ['apoio', '☎︎', 'Apoio']];
const TELAS = {inicio:() => inicio(), pulseira:() => abaPulseira(), respirar:() => respirar(), hoje:() => abaHoje(), apoio:() => abaApoio(),
  dados:() => abaDados(), demo:() => telaDemo(), painel:() => painel(), resumo:() => telaResumo()};
function ir(aba){
  if (S.etapa !== 'resultado') return triagem();
  S.aba = TELAS[aba] ? aba : 'inicio'; document.body.dataset.modo = ''; voltarVermelho = null; clearInterval(window._ri);
  store.gravar(); TELAS[S.aba](); barra();
}
const resultado = () => ir('inicio');
const renderAba = () => { if (S.etapa === 'resultado' && document.body.dataset.modo !== 'alerta' && ['inicio', 'hoje', 'pulseira'].includes(S.aba) && el('app').dataset.aba === S.aba) TELAS[S.aba](); };
const linhaPulseira = () => S.pul.ativo ? `Pulseira: monitorando · ${Math.round(Pulseira.fc.at(-1) || 0) || '–'} bpm · bateria ${Math.round(S.pul.bateria)}%` : 'Pulseira: parada (ligue na aba Pulseira)';
function inicio(){
  const n = S.nivel || 'verde', pf = perfil(), suic = S.motivos.some(m => m.tag === 'suicidio');
  tema(temaPaciente(S.nivel));
  const presencial = S.motivos.some(m => m.encaminhar === 'presencial');
  const nComp = S.compFeito ? 0 : visiveis('complementar').length;
  const hs = horaSim(), saud = T.saudacao[hs < 12 && hs >= 5 ? 'manha' : hs < 18 && hs >= 12 ? 'tarde' : 'noite'];
  const posCrise = S.log.some(l => l.nivel === 'vermelho') && S.nivel !== 'vermelho';
  $(`<p class=saudacao id=saudacao>${esc(saud)}${S.nome ? ', ' + esc(S.nome) : ''}.</p>
  ${posCrise ? `<p class="card acolhe" id=poscrise>${esc(T.poscrise)}</p>` : ''}
  <small>Classificação de risco</small><h1 id=nivel data-nivel=${n}>${ROTULO[n]}</h1>${statusRevisao()}
  ${n === 'vermelho' ? '<button class=big id=abrirajuda>Abrir a tela de ajuda</button>' : ''}
  ${suic ? '<a class="btn big sec" href="tel:188">Conversar com o CVV 188 (24 h, gratuito)</a>' : ''}
  ${presencial ? '<p class=card id=presencial><b>Parar em casa, sem acompanhamento, não é indicado.</b> Procure avaliação presencial no CAPS AD, na UBS ou no pronto-socorro.</p>' : ''}
  ${pf.altoRisco ? `<p id=altorisco><b>${esc(R.regimes.alto_risco_agudo)}</b></p>` : ''}
  <div class=card id=painelinicio>
    <p class=destaque><span id=semuso data-semuso>${textoSemUso()}</span></p>
    <p><span id=dia>Dia ${pf.dia} de acompanhamento · ${esc(pf.regime.nome)}</span><br><small id=fasetxt>${esc(pf.fase.texto)}</small></p>
    <p>Próximo check-in <b id=prox></b></p>
    <p id=pulslinha>${linhaPulseira()}</p>
  </div>
  <button class=big id=checkin>Fazer check-in agora</button>
  <div class=card id=treino></div>
  <div class=duas><button class=sec id=useidenovo>Usei de novo</button><button class=sec id=corrigiruso>${S.ultimoUso ? 'Corrigir a data do último uso' : 'Informar o último uso'}</button></div>
  ${porque()}
  <details class=card id=perfil data-perfil=${pf.classe.id} data-intensidade=${pf.intId} data-regime=${pf.regime.id}><summary><b>Seu acompanhamento: ${pf.int.rotulo.toLowerCase()}</b></summary><ul>${pf.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>
  ${nComp ? `<button class=sec id=comp>Responder ${nComp} perguntas complementares (opcional)</button>` : ''}
  <p class=aviso>Classificação de risco, não é diagnóstico.</p>`);
  el('app').dataset.aba = 'inicio';
  on('abrirajuda', () => telaVermelho(false, () => ir('inicio')));
  on('checkin', () => { if (!E) abrirEma('paciente'); });
  on('useidenovo', confirmarUso); on('corrigiruso', corrigirUso); on('comp', complementar);
  atualizarTreino(pf); hud(pf, {fc:Math.round(Pulseira.fc.at(-1) || 0), mov:Pulseira.mov.at(-1) || 0});
}
// "Usei de novo": sem julgamento; reinicia o carimbo; nunca dispara vermelho sozinho
function confirmarUso(){
  $(`<h1>Você usou de novo?</h1><div class=card><p>Tudo bem contar. Isso ajuda a ajustar o seu acompanhamento.</p></div>
  <button class=big id=usosim>Sim, usei</button><button class="big sec" id=usonao>Cancelar</button>`);
  on('usosim', useiDeNovo); on('usonao', () => ir('inicio'));
}
function useiDeNovo(){
  const U = R.ultimo_uso.usei_de_novo, antes = horasSemUso(), antesTxt = textoSemUso();
  const opi = [].concat(S.resp.q7 || []).includes('opioides');
  S.ultimoUso = {iso:new Date(agora()).toISOString(), faixa:'menos_6h', ajuste:null, fonte:'usei_de_novo'}; S.resp.q12 = 'menos_6h';
  registrar('paciente', S.nivel, `Contou que usou de novo (antes: ${antesTxt}). Contador reiniciado.`);
  if (antes !== null && antes >= U.amarelo_se_h_gte) aplicar({nivel:'amarelo', motivos:[{nivel:'amarelo', motivo:U.motivo_amarelo}]}, 'paciente');
  store.gravar();
  $(`<div class=acolhe id=acolhe><h1>${esc(T.recaida.acolhe)}</h1>
    ${antes !== null ? `<p id=conquista>${esc(T.recaida.conquista.replace('{tempo}', antesTxt.replace(' sem usar', '')))}</p>` : ''}</div>
    ${opi ? `<p class=card id=tolerancia>${esc(U.opioides)}</p>` : ''}
    <p>${esc(T.recaida.opcoes)}</p>
    <a class="btn big" target=_blank rel=noopener href="${mapa('CAPS AD UBS')}">Falar com o CAPS AD ou a UBS</a>
    <button class="big sec" id=respirarrec>Respirar um pouco</button>
  <button class="big sec" id=voltarinicio>Voltar ao início</button>`);
  on('voltarinicio', () => ir('inicio')); on('respirarrec', () => ir('respirar'));
}
function corrigirUso(){
  const q = R.triagem.find(x => x.id === 'q12');
  telaPergunta(q, {pos:0, total:1, rotulo:'Último uso', voltar:() => ir('inicio')}, (v, extra) => {
    if (v !== undefined){ S.resp.q12 = v; definirUltimoUso(v, extra, 'correcao'); registrar('paciente', S.nivel, `Último uso informado ou corrigido: ${textoSemUso()}`); store.gravar(); }
    ir('inicio');
  });
}
function abaHoje(){
  const pf = perfil(), c = pf.classe;
  tema(temaPaciente(S.nivel));
  const conteudos = c.conteudos.map(k => R.conteudos[k]).map(x => `<p><b>${esc(x.titulo)}:</b> ${esc(x.texto)}</p>`).join('');
  $(`${cartaoOrientacao(pf)}<details class=card id=foco><summary><b>${pf.riscoVital ? 'Fique atento(a) a' : 'Foco'}:</b> ${esc(pf.foco.join(', '))}</summary><ul>${c.psicoeducacao.map(p => `<li>${esc(p)}</li>`).join('')}</ul>${conteudos}</details>`);
  el('app').dataset.aba = 'hoje'; ligarCartao(el('app'));
}
function abaApoio(){
  tema(temaPaciente(S.nivel));
  $(`<h1>Apoio</h1>
  <div class=card><b>Perto de você${regiao() ? ` (${esc(regiao())})` : ''}</b>
    <a class="btn big" id=mapacaps target=_blank rel=noopener href="${mapa('CAPS AD UBS')}">CAPS AD e UBS mais próximos</a>
    <a class="btn big sec" target=_blank rel=noopener href="${mapa('ONG grupo de apoio dependência química')}">ONGs e grupos de apoio</a></div>
  <div class=card id=contatoapoio><b>Contato de confiança</b><p>${S.contato ? `${esc(S.contato.nome)} (••••${esc(S.contato.tel.slice(-4))})` : 'Nenhum cadastrado. Dá para cadastrar ao refazer a triagem (Perfil e dados).'}</p></div>
  <div class=card><b>Telefones</b><button class="big sec" id=samu>SAMU 192 (emergência)</button><a class="btn big sec" href="tel:188">CVV 188 (conversar, 24 h, gratuito)</a></div>`);
  el('app').dataset.aba = 'apoio'; on('samu', ligacaoManual);
}
function abaDados(){
  tema('normal');
  $(`<h1>Perfil e dados</h1>
  <div class=card><b>Consentimentos</b><p>${S.salvar ? 'Seus dados ficam só neste aparelho, até você encerrar a sessão.' : 'Seus dados não estão sendo guardados: somem ao fechar.'}</p>
    <label class=check><input type=checkbox id=locprevia ${S.locPrevia ? 'checked' : ''}> <span>Em alerta vermelho, já compartilhar minha localização com meu contato e o CAPS (consentimento separado; pode desligar quando quiser).</span></label></div>
  <div class=card id=sono><b>Meu horário de sono</b><p class=aviso>Nenhum check-in agendado acontece nesse horário.</p>
    <div class=duas><label>Durmo às (h)<input id=sonoini type=number min=0 max=23 value=${horarioSono().ini}></label><label>Acordo às (h)<input id=sonofim type=number min=0 max=23 value=${horarioSono().fim}></label></div></div>
  <button class=sec id=pausar>${minDesde(S.pul.pausaAte) < 0 ? 'Retomar check-ins programados' : 'Pausar check-ins programados por 24 h'}</button>
  <p class=aviso>A pausa não desliga o SOS nem os alertas de segurança da pulseira.</p>
  <button class=big id=resumo>Resumo para revisão clínica</button>
  <button class=sec id=refazer>Refazer a triagem</button>
  <button class=sec id=encerrar>Encerrar sessão e apagar dados</button>
  <button class=sec id=abrirdemo>Modo demonstração</button>`);
  el('app').dataset.aba = 'dados';
  el('locprevia').onchange = e => { S.locPrevia = e.target.checked; registrar('paciente', S.nivel, S.locPrevia ? 'Consentiu compartilhar localização em alertas vermelhos' : 'Retirou o consentimento de localização em alertas'); store.gravar(); };
  const sono = () => { const h = x => Math.max(0, Math.min(23, parseInt(el(x).value, 10) || 0)); S.pul.sono = {ini:h('sonoini'), fim:h('sonofim')}; registrar('paciente', S.nivel, `Horário de sono: ${S.pul.sono.ini}h às ${S.pul.sono.fim}h`); store.gravar(); };
  el('sonoini').onchange = sono; el('sonofim').onchange = sono;
  on('pausar', () => { const p = minDesde(S.pul.pausaAte) < 0; S.pul.pausaAte = p ? null : agora() + 1440 * 60000; registrar('paciente', S.nivel, p ? 'Check-ins programados retomados' : 'Check-ins programados pausados por 24 h (SOS e alertas de segurança continuam)'); store.gravar(); abaDados(); });
  on('resumo', () => ir('resumo')); on('refazer', recomecar); on('encerrar', telaEncerrar); on('abrirdemo', () => ir('demo'));
}
// vermelho: tela inteira (esconde a navegação), sem exercício de respiração. A ligação ao 192 depende da origem (rules.json/sensor.escalonamento.por_origem)
let voltarVermelho = null;
function telaVermelho(novoAlerta, voltar, origem = 'alerta'){
  if (novoAlerta){ S.alertaId++; store.gravar(); escalar(origem); }
  voltarVermelho = voltar || (() => ir(S.aba));
  document.body.dataset.modo = 'alerta'; el('app').dataset.aba = ''; barra();
  tema('crise');
  const suic = S.motivos.some(m => m.tag === 'suicidio'), locOk = S.locAlerta === S.alertaId;
  const tri = S.avisos?.alertaId === S.alertaId && S.avisos.origem === 'triagem' && S.ultimaQ;
  const resta = tri && S.pos < visiveis('nucleo').length;
  $(`<h1 id=nivel data-nivel=vermelho>Busque ajuda agora</h1>
  <div class=card><p>Você não está sozinho(a). O que você contou precisa de atenção agora.</p>
    <button class=big id=samu>Ligar SAMU 192</button>
    ${suic ? '<a class="btn big" id=cvv href="tel:188">Ligar CVV 188 (24 h, gratuito)</a>' : ''}
    <a class="btn big sec" id=upa target=_blank rel=noopener href="${mapa('UPA pronto-socorro')}">UPA / pronto-socorro mais próximo (abre rota)</a>
    <p class=aviso>Fique perto de alguém. Não use mais nenhuma substância agora. Se alguém estiver desacordado ou respirando devagar, deite a pessoa de lado e ligue 192.</p></div>
  ${avisosHtml()}
  ${tri ? `<div class=card id=revertriagem><button class=sec id=corrigirresp>Toquei errado: voltar à pergunta</button>${resta ? '<button class=sec id=continuartriagem>Continuar as perguntas</button>' : ''}</div>` : ''}
  <div class=card id=locbox>${locOk || S.locPrevia ? locTexto()
    : `<b>Compartilhar sua localização?</b><p class=aviso>Só neste alerta, com o seu contato de confiança e o CAPS. Fora de alertas, a localização nunca é compartilhada. O SAMU 192 recebe só a ligação de voz.</p>
       <button id=locsim>Sim, compartilhar neste alerta</button><button class=sec id=locnao>Agora não</button>`}</div>
  ${porque()}${statusRevisao()}
  <button class="big sec" id=voltarajuda>Voltar</button>`);
  on('samu', ligacaoManual); ligarAvisos(); on('corrigirresp', corrigirResposta); on('continuartriagem', continuarTriagem);
  on('voltarajuda', () => { registrar('paciente', S.nivel, 'Saiu da tela de ajuda (o alerta continua registrado)'); store.gravar(); const v = voltarVermelho; voltarVermelho = null; document.body.dataset.modo = ''; v(); barra(); });
  on('locsim', () => { S.locAlerta = S.alertaId; registrar('paciente', 'vermelho', 'Localização compartilhada neste alerta (consentimento)'); store.gravar(); el('locbox').innerHTML = locTexto(); });
  on('locnao', () => { el('locbox').innerHTML = '<p class=aviso>Tudo bem. Sua localização não foi compartilhada.</p>'; });
}
function avisosHtml(){
  const a = S.avisos; if (!a || a.alertaId !== S.alertaId) return '';
  const c = a.contato === 'avisado' ? `<li class=feito id=av-contato>Seu contato de confiança foi avisado.<div class=aviso>${mensagemContato(a.tel)}</div></li>`
    : a.contato === 'oferecido' ? `<li class=pendente id=av-contato>Seu contato ainda não foi avisado. <button class=sec id=avisar>Avisar ${esc(S.contato?.nome || 'meu contato')}</button></li>`
    : '<li class=pendente id=av-contato>Sem contato de confiança cadastrado.</li>';
  return `<div class=card id=avisos><b>O que já foi feito</b><ol class=tl><li class=feito id=av-caps>O painel do CAPS recebeu o alerta (simulado).</li>${c}
    <li class=pendente id=av-192>${a.ligacao === 'contagem' ? 'Ligação ao SAMU 192 em contagem, com opção de cancelar.' : 'O SAMU 192 só é chamado se você tocar em "Ligar SAMU 192".'}</li></ol></div>`;
}
function ligarAvisos(){
  on('avisar', () => { S.avisos.contato = 'avisado'; registrar('contato', 'vermelho', 'Aviso ao contato de confiança (simulado, a pedido do paciente)'); store.gravar(); el('avisos').outerHTML = avisosHtml(); ligarAvisos(); });
}
const coords = () => `${GPS_SIM.lat.toFixed(4)}, ${GPS_SIM.lon.toFixed(4)}`;
const locTexto = () => `<p id=loc><b>Localização compartilhada neste alerta (simulada, GPS: ${fonte()}):</b> ${coords()}</p>`;
const locLiberada = () => S.locPrevia || S.locAlerta === S.alertaId;

// ---------- escalonamento: contato + CAPS em paralelo, ligação ao 192 após contagem ----------
function telemetria(origem){
  const fc = Pulseira.fc.slice(-12).map(Math.round), mov = Pulseira.mov.slice(-12), pf = perfil();
  return {t:hora(), origem, nivel:S.nivel, perfil:`${pf.classe.id} (${pf.intId}, ${pf.regime.nome.toLowerCase()})`, fc,
    tremor: mov.length ? +(mov.reduce((s, x) => s + x, 0) / mov.length).toFixed(2) : null, coords: locLiberada() ? coords() : null, fonte_gps: fonte()};
}
function mensagemContato(tel){
  const c = S.contato;
  if (!c) return 'Sem contato de confiança cadastrado. O painel do CAPS recebeu o alerta.';
  return `<b>PROTÓTIPO: nada foi enviado.</b>${S.pul.con === 'offline' ? ' (sem conexão: seria enviado ao reconectar)' : ''}<br>Para: ${esc(c.nome)} (••••${esc(c.tel.slice(-4))})<br>
    “Pulso: alerta vermelho às ${esc(tel.t)}${regiao() ? ', região ' + esc(regiao()) : ''}. FC recente: ${tel.fc.length ? tel.fc.join(', ') + ' bpm' : 'sem leituras'}; tremor: ${tel.tremor ?? '–'}; acompanhamento: ${esc(tel.perfil)}; localização: ${tel.coords || 'não compartilhada'}. Por favor, entre em contato agora.”`;
}
function escalar(origem){
  const cfg = R.sensor.escalonamento.por_origem[origem] || {contato:'oferecer', ligacao:'botao'};
  const tel = telemetria(origem);
  S.telemetria.unshift(tel); S.telemetria = S.telemetria.slice(0, 20);
  const contato = !S.contato ? 'sem' : cfg.contato === 'automatico' ? 'avisado' : 'oferecido';
  S.avisos = {alertaId:S.alertaId, origem, contato, ligacao:cfg.ligacao, tel};
  registrar('escalonamento', 'vermelho', `Alerta (${origem}): painel do CAPS avisado${contato === 'avisado' ? ' e contato de confiança avisado' : ''}; SAMU 192 ${cfg.ligacao === 'contagem' ? 'em contagem, com "Cancelar"' : 'só se a pessoa tocar em "Ligar"'}`);
  store.gravar();
  if (cfg.ligacao !== 'contagem' || (ESC && ESC.estado === 'contagem')) return;
  ESC = {origem, inicio:Date.now(), estado:'contagem', tel};
  desenharEscala(); clearInterval(escalar.t); escalar.t = setInterval(tickEscala, 150);
}
const restanteLig = () => R.sensor.escalonamento.contagem_ligacao_s - (Date.now() - ESC.inicio) / 1000 * escalaCurta();
function tickEscala(){
  if (!ESC || ESC.estado !== 'contagem') return clearInterval(escalar.t);
  const r = restanteLig(); if (r <= 0) return ligar192('automática ao fim da contagem');
  const e = el('esccont'); if (e) e.textContent = `${Math.ceil(r)} s`;
}
function ligacaoManual(){ if (ESC?.estado === 'contagem') return ligar192('confirmada pelo paciente'); clearInterval(escalar.t); ESC = {origem:'manual', estado:'confirmar', inicio:Date.now()}; desenharEscala(); }
function ligar192(como){ clearInterval(escalar.t); ESC.estado = 'ligando'; registrar('escalonamento', 'vermelho', `Ligação ao SAMU 192 (simulada, ${como}). O 192 recebe só voz.`); store.gravar(); desenharEscala(); }
function cancelarLigacao(){ clearInterval(escalar.t); ESC.estado = 'cancelada'; registrar('escalonamento', 'vermelho', 'Ligação ao 192 cancelada pelo paciente (estou bem); o alerta continua registrado'); store.gravar(); desenharEscala(); }
function fecharEscala(){ clearInterval(escalar.t); ESC = null; el('escala').hidden = true; render('escala', ''); barra(); }
function desenharEscala(){
  const e = el('escala'); e.hidden = false; e.dataset.estado = ESC.estado; barra();
  const t192 = {contagem:`Ligação para o SAMU 192 em <b id=esccont>${Math.ceil(restanteLig())} s</b> (simulada).`, ligando:'Ligação para o SAMU 192 feita (simulada).',
    cancelada:'Ligação para o SAMU 192 cancelada por você.', confirmar:''}[ESC.estado];
  if (ESC.estado === 'confirmar') return render('escala', `<div class=tela><h1>Ligar para o SAMU 192?</h1><p>Ligação simulada nesta demonstração. O 192 recebe só a sua voz.</p>
    <button class=big id=ligaragora>Sim, ligar agora</button><button class="big sec" id=fecharescala>Cancelar</button></div>`), on('ligaragora', () => ligar192('confirmada pelo paciente')), on('fecharescala', fecharEscala);
  render('escala', `<div class=tela><h1>${ESC.estado === 'ligando' ? 'Ligando para o SAMU 192… (simulado)' : 'Estamos acionando ajuda'}</h1>
    ${ESC.estado === 'ligando' ? '<p class=destaque>Diga seu nome, onde você está e o que está sentindo.</p>' : ''}
    <ol class=tl>
      <li class=feito id=tl-contato><b>Agora:</b> ${S.contato ? 'contato de confiança avisado' : 'sem contato de confiança cadastrado'}.<div class=aviso>${mensagemContato(ESC.tel)}</div></li>
      <li class=feito id=tl-caps><b>Agora:</b> o painel do CAPS recebeu o alerta com a telemetria (FC, tremor, perfil${ESC.tel.coords ? ', localização' : ''}). Simulado.</li>
      <li class="${ESC.estado === 'contagem' ? 'pendente' : 'feito'}" id=tl-192>${t192} O 192 recebe só a sua voz; a telemetria não vai para o SAMU.</li>
    </ol>
    ${ESC.estado === 'contagem' ? '<button class=big id=ligaragora>Ligar agora para o 192</button><button class="big sec" id=cancelarligacao>Cancelar (estou bem)</button>'
      : `${ESC.estado === 'cancelada' ? '<p>O alerta continua registrado e seu contato já foi avisado.</p>' : ''}<button class=big id=fecharescala>Fechar</button>`}</div>`);
  on('ligaragora', () => ligar192('confirmada pelo paciente')); on('cancelarligacao', cancelarLigacao); on('fecharescala', fecharEscala);
  (el('ligaragora') || el('fecharescala'))?.focus();
}

// ---------- SOS: confirmação na barra (some sozinha em 10 s) ----------
let sosTimer = null;
function pedirSos(){ el('sos').hidden = el('engrenagem').hidden = true; el('sosconf').hidden = false; clearTimeout(sosTimer); sosTimer = setTimeout(cancelarSos, 10000); }
function cancelarSos(){ clearTimeout(sosTimer); el('sos').hidden = el('engrenagem').hidden = false; el('sosconf').hidden = true; }
function telaAtual(){ return S.etapa === 'resultado' ? (() => ir(S.aba)) : triagem; } // para onde o "Voltar" da tela de ajuda leva
function crise(motivo, origem){
  const voltar = document.body.dataset.modo === 'alerta' && voltarVermelho ? voltarVermelho : telaAtual();
  S.vistos = [...new Set(S.vistos.concat(motivo))]; // o SOS na triagem não some ao terminar as perguntas
  aplicar({nivel:'vermelho', motivos:[{nivel:'vermelho', motivo}]}, origem);
  fecharEma(); fecharAlerta(); telaVermelho(true, voltar, origem);
}
function sos(){ cancelarSos(); crise('Você pediu ajuda pelo botão SOS.', 'SOS'); }
function respirar(){
  tema(temaPaciente(S.nivel));
  $(`<h1>Respire com o círculo</h1><div id=resp></div>
  <p class=destaque style="text-align:center" id=fase aria-live=polite>Inspire…</p><p class=aviso style="text-align:center">4 segundos para inspirar, 6 para soltar o ar.</p>`);
  el('app').dataset.aba = 'respirar';
  let t = 0; clearInterval(window._ri);
  window._ri = setInterval(() => { const e = el('fase'); if (!e) return clearInterval(window._ri); t = (t + 1) % 10; e.textContent = t < 4 ? 'Inspire…' : 'Solte o ar devagar…'; }, 1000);
}

// ---------- resumo para revisão clínica ----------
function rotuloOpcao(id, v){ const q = R.triagem.find(x => x.id === id); return [].concat(v ?? []).map(x => q?.opcoes?.find(o => o.v === x)?.l ?? x); }
function resumo(){
  const r = resp(), pf = perfil();
  return {documento:'Resumo para revisão clínica', aviso:R._meta.aviso, observacao:'Classificação de risco. Não é diagnóstico.', gerado_em:new Date().toISOString(),
    status_revisao:S.revisao.status, revisao:S.revisao, nivel:S.nivel,
    perfil:{classe:pf.classe.id, intensidade:pf.intId, regime:pf.regime.id, dia_acompanhamento:pf.dia, modificadores:pf.mods.map(m => m.motivo), fase:pf.fase.texto,
      horas_desde_ultimo_uso_estimadas: pf.horas === null ? null : Math.round(pf.horas), checkin_min:pf.checkin, checkin_definido_por:S.checkinProf ? 'profissional' : 'perfil'},
    substancias:rotuloOpcao('q7', r.q7), ultima_dose:rotuloOpcao('q12', r.q12)[0] ?? null,
    ultimo_uso: S.ultimoUso ? {...S.ultimoUso, tempo_sem_usar:textoSemUso()} : null, idade:rotuloOpcao('q1', r.q1)[0] ?? null,
    criterios:S.motivos.map(m => ({nivel:m.nivel, motivo:m.motivo})), orientacoes:S.info.map(m => m.motivo),
    contato_de_confianca: S.contato ? 'cadastrado' : 'não cadastrado', alertas_telemetria:S.telemetria, historico:S.log, respostas:r};
}
function telaResumo(voltar = () => ir('dados')){
  tema('normal');
  const o = resumo(), json = JSON.stringify(o, null, 2);
  $(`<h1>Resumo para revisão clínica</h1><p class=aviso>Classificação de risco, não é diagnóstico. Status: <b id=status>${o.status_revisao === 'pendente' ? 'pendente de revisão' : 'revisado'}</b></p>
  <div class=card><p><b>Nível:</b> ${o.nivel} · <b>Perfil:</b> ${o.perfil.classe} (${o.perfil.intensidade}, ${o.perfil.regime})</p>
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

// ---------- painel do profissional / CAPS (simulado) ----------
const FICTICIOS = [{nome:'Paciente exemplo B (fictício)', nivel:'amarelo', status:'revisado'}, {nome:'Paciente exemplo C (fictício)', nivel:'verde', status:'pendente'}];
function painel(){
  tema('normal');
  const n = S.nivel || 'verde', linha = p => `<tr><td>${esc(p.nome)}</td><td><span class="chip ${p.nivel}">${p.nivel}</span></td><td>${p.status}</td></tr>`;
  $(`<h1>Painel do CAPS (simulado)</h1>
  <p class=aviso>Aqui os alertas aparecem em vermelho/laranja para priorização. O paciente vê cores calmas. Os níveis são classificação de risco e dependem da sua revisão.</p>
  <div class=tab><table><tr><th>Paciente</th><th>Nível</th><th>Revisão</th></tr>${linha({nome:'Esta sessão', nivel:n, status:S.revisao.status})}${FICTICIOS.map(linha).join('')}</table></div>
  <div class=card id=telemetria><b>Alertas recebidos (telemetria)</b><p class=aviso>A telemetria vai ao contato de confiança e ao CAPS. O SAMU 192 recebe só a ligação de voz.</p>
    <ul>${S.telemetria.map(t => `<li>${esc(t.t)} · ${esc(t.origem)} · FC ${t.fc.join(', ') || '–'} · tremor ${t.tremor ?? '–'} · ${esc(t.perfil)} · ${t.coords ? 'localização ' + t.coords : 'localização não compartilhada'}</li>`).join('') || '<li>Nenhum alerta</li>'}</ul></div>
  <div class=card id=revisar><b>Esta sessão: confirmar ou ajustar nível</b>
    <ul>${S.motivos.map(m => `<li><span class="chip ${m.nivel}">${m.nivel}</span> ${esc(m.motivo)}</li>`).join('') || '<li>Sem critérios</li>'}</ul>
    <label>Nível após revisão<select id=profnivel>${['vermelho','amarelo','verde'].map(x => `<option ${x === n ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Observação curta<input id=profobs maxlength=140 autocomplete=off></label>
    <button id=profok>Confirmar ou ajustar nível</button><p id=profmsg class=aviso aria-live=polite></p></div>
  <div class=card id=checkinprof><b>Check-in agendado (decisão do profissional)</b><p class=aviso>Padrão do perfil: a cada ${duracao(perfil().int.checkin_min)}, nunca no horário de sono do paciente. Um intervalo mais curto ou check-in de madrugada deve ser decidido por quem acompanha o caso.</p>
    <label>Intervalo<select id=profintervalo><option value="">Padrão do perfil</option>${R.sensor.checkin_agendado.opcoes_profissional_min.map(m => `<option value=${m} ${S.checkinProf?.min === m ? 'selected' : ''}>a cada ${duracao(m)}</option>`).join('')}</select></label>
    <label class=check><input type=checkbox id=profnoite ${S.checkinProf?.noite ? 'checked' : ''}> <span>Também no horário de sono (pode acordar o paciente)</span></label>
    <label>Profissional (simulado)<input id=profnome maxlength=40 autocomplete=off value="${esc(S.checkinProf?.prof || 'Equipe do CAPS AD')}"></label>
    <label>Motivo clínico (curto)<input id=profmotivo maxlength=120 autocomplete=off value="${esc(S.checkinProf?.motivo || '')}" placeholder="ex.: primeiras 72 h após convulsão"></label>
    <button id=profcheckinok>Salvar intervalo</button></div>
  <div class=log>${S.log.map(l => `${esc(l.t)} [${esc(l.origem)}] <span class="chip ${l.nivel}">${l.nivel}</span> ${esc(l.motivo)}`).join('<br>') || 'Sem registros'}</div>
  <button class=sec id=resumo>Resumo para revisão clínica</button><button class=big id=voltar>Voltar ao modo demonstração</button>`);
  on('profok', () => {
    const novo = el('profnivel').value, obs = el('profobs').value.trim().slice(0, 140), acao = novo === S.nivel ? 'confirmado' : 'ajustado';
    aplicar({nivel:novo, motivos:[{nivel:novo, motivo:`Nível ${acao} por profissional${obs ? ': ' + obs : ''}.`}, ...S.motivos]}, 'profissional');
    S.revisao = {status:'revisado', nivel:novo, obs, em:hora()}; store.gravar(); painel();
  });
  on('profcheckinok', () => {
    const m = +el('profintervalo').value, noite = el('profnoite').checked;
    const prof = el('profnome').value.trim().slice(0, 40) || 'Equipe do CAPS AD', motivo = el('profmotivo').value.trim().slice(0, 120);
    S.checkinProf = m || noite ? {min: m || perfil().checkin, noite, prof, motivo, em:hora()} : null;
    registrar('profissional', S.nivel, S.checkinProf ? `Plano de acompanhamento definido pelo profissional (${prof}, ${hora()}): check-in a cada ${duracao(S.checkinProf.min)}${noite ? ', inclusive no horário de sono' : ', fora do horário de sono'}${motivo ? '. Motivo: ' + motivo : ''}` : 'Check-in voltou ao padrão do perfil');
    store.gravar(); painel();
  });
  on('resumo', () => telaResumo(painel));
  on('voltar', () => ir('demo'));
}

// ---------- pulseira simulada: serviço independente das telas ----------
const rnd = a => (Math.random() * 2 - 1) * a;
const sobe = (i, passo, teto) => Math.min(Math.max(0, i - 12) * passo, teto);
const PARADO = {ativ:'parado', cad:0, cv:0, vel:0};
const CEN = {
  estavel:   i => ({fc: 72 + rnd(3), mov: 1 + rnd(.3), ...PARADO}),
  alcool:    i => ({fc: 74 + sobe(i, 1.6, 45) + rnd(3), mov: 1 + sobe(i, .12, 3) + rnd(.3), ...PARADO}),            // FC e tremor sobem em repouso
  recaida:   i => (i < 14 ? {fc: 72 + rnd(3), mov: 1 + rnd(.3)} : {fc: 56 + rnd(2), mov: .3 + rnd(.1)}),                // queda súbita (sedação)
  opioide:   i => ({fc: 74 + sobe(i, 1.0, 30) + rnd(3), mov: 1 + sobe(i, .08, 2) + rnd(.5), ...PARADO}),
  corrida:   i => ({fc: 74 + sobe(i, 6, 80) + rnd(3), mov: 1 + sobe(i, .5, 3) + rnd(.3), ativ: i > 12 ? 'correndo' : 'parado', cad: i > 12 ? 162 + rnd(3) : 0, cv: .04, vel: i > 12 ? 11 : 0}), // falso positivo
  academia:  i => ({fc: 74 + sobe(i, 5, 60) + rnd(3), mov: 1 + rnd(.3), ...PARADO}),                                     // musculação/bicicleta parada: FC sobe sem passos
  crise_repouso:  i => ({fc: 74 + sobe(i, 3, 50) + rnd(3), mov: 1 + sobe(i, .2, 2) + rnd(.3), ...PARADO}),
  crise_veiculo:  i => ({fc: 74 + sobe(i, 3, 50) + rnd(3), mov: 1.3 + rnd(.4), ativ:'veiculo', cad:0, cv:0, vel:45}),        // velocidade de GPS não descarta
  crise_madrugada:i => ({fc: 74 + sobe(i, 3, 50) + rnd(3), mov: 1 + sobe(i, .2, 2) + rnd(.3), ...PARADO})
};
const CENARIOS = {estavel:'Estável', alcool:'Abstinência de álcool piorando', recaida:'Recaída (queda da FC)', opioide:'Abstinência de opioide',
  corrida:'Corrida (falso positivo)', academia:'Musculação/bicicleta parada', crise_repouso:'Crise em repouso', crise_veiculo:'Crise em veículo', crise_madrugada:'Crise de madrugada'};
const CONEXOES = {wifi:'Wi-Fi', dados:'Dados móveis do celular', offline:'Sem conexão'};
const ATIVIDADES = {parado:'parado', andando:'andando', correndo:'correndo', veiculo:'em veículo'};
const MANUAL = {parado:PARADO, andando:{ativ:'andando', cad:105, cv:.06, vel:5}, correndo:{ativ:'correndo', cad:160, cv:.05, vel:11}, veiculo:{ativ:'veiculo', cad:0, cv:0, vel:45}};
const media = a => a.reduce((s, x) => s + x, 0) / a.length;
const dp = (a, min) => Math.max(Math.sqrt(media(a.map(x => (x - media(a)) ** 2))), min);
const treinoAtivo = () => !!S.pul.treino && agora() < S.pul.treino.tolerFim;
function ehExercicio(p){ // velocidade de GPS sozinha nunca basta: exige passos ritmados andando/correndo
  const a = R.sensor.atividade;
  return a.exercicio_se.includes(p.ativ) && p.cad >= a.cadencia_min_passos_min && p.cv <= a.variacao_max_cadencia;
}
const Pulseira = {
  timer:null, n:0, fc:[], mov:[], acima:0, txt:'', aviso:'', atividade:PARADO, descarte:null,
  iniciar(){ S.pul.ativo = true; S.pul.ultimaEma ??= agora(); registrar('pulseira', S.nivel, 'Monitoramento iniciado'); store.gravar(); this.ligar(); },
  ligar(){ clearInterval(this.timer); this.timer = null; if (S.pul.ativo) this.timer = setInterval(() => this.passo(), Math.max(50, 500 / S.pul.vel)); barra(); },
  parar(motivo = 'Monitoramento parado pela pessoa'){
    clearInterval(this.timer); this.timer = null;
    if (S.pul.ativo){ S.pul.ativo = false; registrar('pulseira', S.nivel, motivo); store.gravar(); }
    barra();
  },
  descartar(motivo){ if (this.descarte !== motivo){ this.descarte = motivo; registrar('filtro', S.nivel, 'Desvio descartado: ' + motivo); } this.aviso = 'Desvio descartado: ' + motivo; },
  passo(){
    try {
      const cfg = R.sensor, nb = cfg.amostras_linha_base, pf = perfil();
      const p = {...PARADO, ...CEN[S.pul.cenario](S.pul.i++)}, ativ = S.pul.ativManual ? MANUAL[S.pul.ativManual] : {ativ:p.ativ, cad:p.cad, cv:p.cv, vel:p.vel};
      Object.assign(p, ativ); this.atividade = ativ;
      this.n++; this.fc.push(p.fc); this.mov.push(p.mov); if (this.fc.length > 60){ this.fc.shift(); this.mov.shift(); }
      if (!S.base && this.fc.length >= nb) S.base = {fc:this.fc.slice(-nb), mov:this.mov.slice(-nb)};
      const leitura = {t:agora(), fc:Math.round(p.fc), mov:+p.mov.toFixed(2)};
      if (S.pul.con === 'offline'){ S.pul.buffer.push(leitura); if (S.pul.buffer.length > 500) S.pul.buffer.shift(); }
      else { if (S.pul.buffer.length){ this.aviso = `Conexão de volta: ${S.pul.buffer.length} leituras guardadas foram enviadas.`; S.pul.enviados += S.pul.buffer.length; S.pul.buffer = []; } S.pul.enviados++; }
      S.pul.bateria = Math.max(5, S.pul.bateria - 0.0005 * S.pul.vel);
      if (S.pul.treino && !treinoAtivo()){ S.pul.treino = null; registrar('treino', S.nivel, 'Modo Treino terminou: gatilhos de FC reativados'); toast('Modo Treino terminou. O monitoramento completo voltou.'); atualizarTreino(pf); }
      let txt = '';
      if (S.base){
        const k = pf.int.desvios_para_disparo;
        const zf = (p.fc - media(S.base.fc)) / dp(S.base.fc, cfg.dp_minimo.fc), zm = (p.mov - media(S.base.mov)) / dp(S.base.mov, cfg.dp_minimo.mov);
        txt = `Desvio do seu normal: FC ${zf.toFixed(1)}, movimento ${zm.toFixed(1)} (limite ${k})`;
        // desvio em QUALQUER direção: na abstinência de estimulantes e na sedação a FC pode cair
        let fcAlto = Math.abs(zf) > k, movAlto = Math.abs(zm) > k;
        if (fcAlto || movAlto){
          if (ehExercicio(p)){ this.descartar(`${ATIVIDADES[p.ativ]} com passos ritmados (${Math.round(p.cad)}/min): considerado exercício`); fcAlto = movAlto = false; }
          else if (treinoAtivo()){
            if (fcAlto) this.descartar('Modo Treino ativo: gatilho de FC suspenso');
            fcAlto = false; if (p.ativ !== 'parado') movAlto = false; // tremor em repouso nunca é suspenso
          }
          else if (minDesde(S.pul.silencioAte) < 0){ this.descartar('você disse que está bem (alertas em pausa)'); fcAlto = movAlto = false; }
          else if (fcAlto && p.ativ === 'veiculo' && this.descarte !== 'veiculo'){ this.descarte = 'veiculo'; registrar('filtro', S.nivel, 'FC alta em veículo: NÃO descartado (velocidade de GPS sozinha não indica exercício)'); }
        } else this.descarte = null;
        this.acima = fcAlto || movAlto ? this.acima + 1 : 0;
        if (this.acima >= cfg.amostras_persistencia){
          this.acima = 0;
          const zmax = Math.max(Math.abs(zf), Math.abs(zm)); this.z = zmax; const grave = zmax >= k * cfg.checkin_agendado.sensor_mult_vermelho;
          const cs = cfg.checkin_sensor, dis = S.pul.dispensa; // depois de "Estou bem": só alerta de novo se piorar
          if (dis && minDesde(dis.t) < cs.reavaliar_min && zmax < dis.z + cs.piora_desvios){
            if (!dis.registrado){ dis.registrado = true; registrar('pulseira', S.nivel, 'Mudança parecida com a anterior (você disse que estava bem): registrada, sem novo alerta'); store.gravar(); }
            this.aviso = 'Mudança parecida com a anterior: registrada, sem novo alerta.';
          } else if (!grave && dormindo()){ if (minDesde(S.pul.ultimoRegNoite) >= cfg.intervalo_min_alerta_min){ // registro sem alarme não bloqueia alerta grave
            S.pul.ultimoRegNoite = agora(); registrar('pulseira', 'amarelo', 'Mudança leve nos sinais durante o sono: registrada sem alarme; CAPS/UBS pode contatar de manhã');
            aplicar({nivel:'amarelo', motivos:[{nivel:'amarelo', motivo:T.noite_anomalia}]}, 'pulseira'); }
          } else if (podeAlerta() && minDesde(S.pul.ultimoAlerta) >= cfg.intervalo_min_alerta_min) abrirAlertaSensor(fcAlto ? (zf < 0 ? 'FC abaixo do seu normal' : 'FC acima do seu normal') : 'tremor/movimento em repouso', zmax);
          else this.aviso = 'A pulseira notou uma mudança. Novo check-in só depois do intervalo mínimo.';
        }
      } else txt = 'Calibrando o seu normal (linha de base)…';
      const ag = R.sensor.checkin_agendado, dia = new Date(agora()).toDateString();
      if (S.pul.agDia !== dia){ S.pul.agDia = dia; S.pul.agN = 0; }
      if (podeEma() && minDesde(S.pul.ultimaEma) >= pf.checkin && (!dormindo() || S.checkinProf?.noite) && !(minDesde(S.pul.pausaAte) < 0)
          && S.pul.agN < (S.checkinProf?.limite ?? ag.limite_diario) && minDesde(S.pul.ultimoAlerta) >= ag.intervalo_min_entre_prompts_min){ S.pul.agN++; abrirEma('check-in'); } // não acorda o paciente
      verificarNotificacoes(pf);
      this.txt = txt; hud(pf, leitura);
      if (this.n % 20 === 0) store.gravar();
    } catch (e) { console.error(e); } // uma leitura com erro nunca derruba o serviço
  }
};
const podeEma = () => !E && !AL && !ESC && S.etapa === 'resultado';
const podeAlerta = () => !AL && !ESC && S.etapa === 'resultado';
function barra(){
  const sessao = !!el('app').dataset.sessao, alerta = document.body.dataset.modo === 'alerta';
  el('topo').hidden = !sessao; // SOS sempre visível durante a sessão
  el('nav').hidden = !sessao || S.etapa !== 'resultado' || alerta || !!E || !!AL || !!ESC; // alerta e check-in tomam a tela inteira
  el('nav').querySelectorAll('[data-aba]').forEach(b => b.setAttribute('aria-current', b.dataset.aba === S.aba && !alerta ? 'page' : 'false'));
}
function hud(pf, l){
  const prox = Math.max(0, pf.checkin - minDesde(S.pul.ultimaEma)), a = Pulseira.atividade;
  const set = (id, t) => { const e = el(id); if (e) e.textContent = t; };
  set('fc', l.fc); set('mov', (+l.mov).toFixed(2)); set('st', Pulseira.txt); set('n', Pulseira.n); if (el('hud')) el('hud').dataset.n = Pulseira.n;
  set('fontegps', fonte()); set('fonteativ', fonte()); set('con', CONEXOES[S.pul.con]); set('bat', Math.round(S.pul.bateria) + '%');
  set('ativ', `${ATIVIDADES[a.ativ]}${a.cad ? ` · ${Math.round(a.cad)} passos/min${a.cv <= R.sensor.atividade.variacao_max_cadencia ? ', ritmado' : ''}` : ''}${a.vel ? ` · ${a.vel} km/h (GPS)` : ''}`);
  set('buf', S.pul.con === 'offline' ? `${S.pul.buffer.length} leituras guardadas (envio ao reconectar)` : Pulseira.aviso || `${S.pul.enviados} leituras enviadas`);
  const adia = !S.checkinProf?.noite && (dormindo() || (new Date(agora() + prox * 60000).getHours() - horarioSono().ini + 24) % 24 < (horarioSono().fim - horarioSono().ini + 24) % 24);
  set('prox', E ? 'agora' : adia ? `às ${horarioSono().fim}h, depois do seu horário de sono` : `em ${duracao(prox)}`); set('fasetxt', pf.fase.texto); set('relogio', new Date(agora()).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}));
  set('dia', `Dia ${pf.dia} de acompanhamento · ${pf.regime.nome}`); set('pulslinha', linhaPulseira());
  if (treinoAtivo()) atualizarTreino(pf);
  desenhar();
}
function desenhar(){
  const cv = el('cv'); if (!cv) return; const g = cv.getContext('2d');
  g.clearRect(0, 0, 500, 120); g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--pri'); g.lineWidth = 2; g.beginPath();
  Pulseira.fc.forEach((v, i) => g.lineTo(i * 500 / 60, 120 - (v - 40) * 120 / 120)); g.stroke();
}
// ---------- Modo Treino: suspende só gatilhos de FC ----------
function cartaoTreino(pf){
  const t = R.sensor.treino;
  if (treinoAtivo()){
    const restaFim = minDesde(S.pul.treino.fim) * -1, restaTol = minDesde(S.pul.treino.tolerFim) * -1;
    return `<b>Modo Treino ativo</b><p id=treinost>${restaFim > 0 ? `Termina em ${duracao(restaFim)}` : `Tolerância: o monitoramento completo volta em ${duracao(restaTol)}`}.
      Só os alertas de frequência cardíaca estão pausados. SOS, check-ins e tremor em repouso continuam valendo.</p><button class=sec id=treinofim>Encerrar agora</button>`;
  }
  if (pf.depressorAgudo) return `<p id=treinobloqueado><b>Nesta fase, a orientação é descansar.</b> O Modo Treino fica disponível depois da fase aguda.</p>`;
  const seguro = pf.intId === 'leve' && (S.nivel || 'verde') === 'verde';
  return `${seguro ? '<p id=sugestaotreino>Vai se exercitar? Ative o Modo Treino para a pulseira não confundir exercício com crise.</p>' : ''}
    <b>Vou treinar / fazer atividade física</b><div class=opc>${t.opcoes_min.map(m => `<button class=op data-treino=${m}>${duracao(m)}</button>`).join('')}</div>`;
}
function atualizarTreino(pf){
  const c = el('treino'); if (!c) return;
  const html = cartaoTreino(pf); if (c.dataset.html === html) return; c.dataset.html = html; c.innerHTML = html;
  c.querySelectorAll('[data-treino]').forEach(b => b.onclick = () => {
    const t = R.sensor.treino, m = Math.min(+b.dataset.treino, t.max_min);
    S.pul.treino = {inicio:agora(), fim:agora() + m * 60000, tolerFim:agora() + (m + t.tolerancia_min) * 60000};
    registrar('treino', S.nivel, `Modo Treino ativado por ${duracao(m)} (+${t.tolerancia_min} min de tolerância)`); store.gravar(); atualizarTreino(perfil());
  });
  on('treinofim', () => { S.pul.treino = null; registrar('treino', S.nivel, 'Modo Treino encerrado pela pessoa'); store.gravar(); atualizarTreino(perfil()); });
}
// ---------- aba Pulseira: monitoramento ao vivo; o serviço continua ao trocar de aba ----------
function monitor(){ if (!S.pul.ativo) Pulseira.iniciar(); ir('pulseira'); }
function abaPulseira(){
  const pf = perfil(), c = pf.classe, at = S.pul.ativo;
  tema(temaPaciente(S.nivel));
  const hist = S.log.filter(l => ['pulseira', 'filtro', 'treino', 'check-in'].includes(l.origem)).slice(0, 5);
  $(`<h1>Pulseira</h1>
  <div class=card id=hud data-perfil=${c.id} data-intensidade=${pf.intId} data-checkin=${pf.checkin} data-risco-vital=${pf.riscoVital} data-regime=${pf.regime.id}>
    <p class=destaque id=pulsestado>${at ? 'Monitorando' : 'Parada'}</p>
    ${at ? `<button class="big sec" id=parar>Parar o monitoramento</button><div id=parconf hidden><b>Parar o monitoramento?</b><div class=duas><button id=parSim>Sim, parar</button><button class=sec id=parNao>Continuar</button></div></div>`
         : '<button class=big id=mon>Começar o monitoramento</button>'}
  </div>
  <div class="card vivo"><div><small>Frequência cardíaca</small><b class=num><span id=fc>–</span> bpm</b></div><div><small>Movimento / tremor</small><b class=num id=mov>–</b></div>
    <canvas id=cv width=500 height=120 aria-label="Gráfico da frequência cardíaca"></canvas><p class=aviso id=st></p><small>Leituras: <span id=n>0</span> · hora: <span id=relogio></span></small></div>
  <div class=card id=disp><b>Pulseira (Bluetooth)</b>: ${at ? 'conectada' : 'desligada'} · bateria <span id=bat></span><br>
    <b>Celular</b>: <span id=con></span><br>Atividade (<span id=fonteativ></span>): <span id=ativ></span><br>
    GPS (<span id=fontegps></span>): <span id=gps>localização não compartilhada (só em alerta vermelho ou SOS, com sua permissão)</span><br><small id=buf></small></div>
  <details class=card id=hist><summary>Histórico recente</summary><ul>${hist.map(l => `<li>${esc(l.t)} · ${esc(l.motivo)}</li>`).join('') || '<li>Nada ainda</li>'}</ul></details>`);
  el('app').dataset.aba = 'pulseira';
  on('mon', () => { Pulseira.iniciar(); abaPulseira(); });
  on('parar', () => { el('parar').hidden = true; el('parconf').hidden = false; });
  on('parNao', () => { el('parar').hidden = false; el('parconf').hidden = true; });
  on('parSim', () => { Pulseira.parar(); abaPulseira(); });
  hud(pf, {fc:Math.round(Pulseira.fc.at(-1) || 0), mov:Pulseira.mov.at(-1) || 0});
}
function telaDemo(){
  tema('normal');
  $(`<h1>Modo demonstração</h1><p class=aviso>Para a apresentação, fora da vista do paciente. Troca cenário, atividade, conexão e tempo sem parar o monitoramento.</p>
  ${S.pul.ativo ? '' : '<p class=card>A pulseira está parada: comece o monitoramento na aba Pulseira.</p>'}
  <p>Cenário:</p><div class=opc>${Object.entries(CENARIOS).map(([k, l]) => `<button class=op data-c=${k} aria-pressed=${S.pul.cenario === k}>${l}</button>`).join('')}</div>
  <p>GPS e reconhecimento de atividade vêm de:</p><div class=opc>${Object.entries(FONTES).map(([k, l]) => `<button class=op data-fonte=${k} aria-pressed=${(S.pul.fonte || 'ambos') === k}>${l}</button>`).join('')}</div>
  <p>Atividade detectada:</p><div class=opc>${[['', 'Automática (do cenário)'], ...Object.entries(ATIVIDADES)].map(([k, l]) => `<button class=op data-ativ="${k}" aria-pressed=${(S.pul.ativManual || '') === k}>${l}</button>`).join('')}</div>
  <p>Conexão:</p><div class=opc>${Object.entries(CONEXOES).map(([k, l]) => `<button class=op data-con=${k} aria-pressed=${S.pul.con === k}>${l}</button>`).join('')}</div>
  <p>Velocidade do tempo:</p><div class=opc>${[1, 5, 60].map(v => `<button class=op data-vel=${v} aria-pressed=${S.pul.vel === v}>${v}x${v === 60 ? ' (1 s = 1 min)' : ''}</button>`).join('')}</div>
  <p class=aviso>Contagens curtas (check-in de segurança e ligação) aceleram no máximo 5x.</p>
  <div class=duas><button class=sec id=avancar15>Avançar 15 min</button><button class=sec id=avancardia>Avançar 1 dia</button></div>
  <label>Notificação diária às (h)<input id=notifh type=number min=0 max=23 value=${S.pul.notifH ?? R.sensor.notificacao_diaria_h}></label>
  <label class=check><input type=checkbox id=sonosensor ${S.pul.sonoSensor ? 'checked' : ''}> <span>Pulseira indica que a pessoa está dormindo</span></label>
  <button class=big id=painel>Visão do profissional (CAPS)</button>`);
  el('sonosensor').onchange = e => { S.pul.sonoSensor = e.target.checked; registrar('demo', S.nivel, e.target.checked ? 'Pulseira indica sono' : 'Pulseira indica acordado'); store.gravar(); };
  el('app').dataset.aba = 'demo';
  document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    S.pul.cenario = b.dataset.c; S.pul.i = 0; Pulseira.acima = 0; S.pul.dispensa = S.pul.silencioAte = S.pul.ultimoAlerta = null; /* demo: nova situação, pode alertar de novo */ if (b.dataset.c === 'crise_madrugada') irParaHora(3);
    registrar('demo', S.nivel, 'Cenário: ' + CENARIOS[b.dataset.c]); store.gravar(); marcar('[data-c]', b);
  });
  document.querySelectorAll('[data-ativ]').forEach(b => b.onclick = () => { S.pul.ativManual = b.dataset.ativ || null; store.gravar(); marcar('[data-ativ]', b); });
  document.querySelectorAll('[data-fonte]').forEach(b => b.onclick = () => { S.pul.fonte = b.dataset.fonte; registrar('demo', S.nivel, 'Fonte de GPS e atividade: ' + fonte()); store.gravar(); marcar('[data-fonte]', b); });
  document.querySelectorAll('[data-con]').forEach(b => b.onclick = () => { S.pul.con = b.dataset.con; store.gravar(); marcar('[data-con]', b); });
  document.querySelectorAll('[data-vel]').forEach(b => b.onclick = () => { mudarVel(+b.dataset.vel); marcar('[data-vel]', b); });
  on('avancar15', () => { S.pul.desloc += 15; store.gravar(); });
  on('avancardia', () => { S.pul.desloc += 1440; store.gravar(); });
  el('notifh').onchange = e => { S.pul.notifH = Math.max(0, Math.min(23, +e.target.value)); S.pul.notifDia = null; store.gravar(); };
  on('painel', () => ir('painel'));
}
const marcar = (sel, b) => document.querySelectorAll(sel).forEach(x => x.setAttribute('aria-pressed', x === b));

// ---------- check-in de segurança (anomalia só de sensor): tela cheia, vibração, som, timeout ----------
function bip(){ try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 660; g.gain.value = .08; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .4); } catch {} }
function abrirAlertaSensor(motivo, z = 0){
  const c = R.sensor.checkin_sensor;
  AL = {inicio:Date.now(), timeout: noite() ? c.timeout_noite_s : c.timeout_dia_s, motivo};
  S.pul.ultimoAlerta = agora();
  registrar('pulseira', S.nivel, `Check-in de segurança: ${motivo} (sem resposta em ${AL.timeout} s = crise)`); store.gravar();
  try { navigator.vibrate?.([400, 200, 400]); } catch {}
  bip();
  render('alerta', `<div class=tela><p class=aviso>A pulseira está vibrando.</p><h1>A pulseira notou uma mudança nos seus sinais</h1><p>${esc(motivo)}.</p>
    <p>Se não houver resposta em <b id=alcont>${AL.timeout} s</b>, vamos acionar ajuda.</p>
    <button class=big id=estoubem>Estou bem / fazendo exercício</button><button class="big sec" id=precisoajuda>Preciso de ajuda</button></div>`);
  const e = el('alerta'); e.hidden = false; e.dataset.timeout = AL.timeout; barra(); el('estoubem').focus();
  on('estoubem', () => { const m = Math.max(c.silenciar_min, perfil().int.cooldown_min); S.pul.silencioAte = agora() + m * 60000; S.pul.dispensa = {t:agora(), z:Math.max(z, Pulseira.z || 0)};
    registrar('pulseira', S.nivel, `Paciente disse que está bem: alertas da pulseira silenciados por ${duracao(m)}; nas próximas ${duracao(c.reavaliar_min)}, novo alerta só se piorar`); store.gravar(); fecharAlerta(); });
  on('precisoajuda', () => crise('Você pediu ajuda no check-in da pulseira.', 'pulseira'));
  AL.timer = setInterval(() => {
    if (!AL) return;
    const r = AL.timeout - (Date.now() - AL.inicio) / 1000 * escalaCurta();
    if (r <= 0) return crise('Check-in de segurança sem resposta: por segurança, tratamos como crise aguda.', 'timeout');
    const x = el('alcont'); if (x) x.textContent = `${Math.ceil(r)} s`;
  }, 150);
}
function fecharAlerta(){ if (AL) clearInterval(AL.timer); AL = null; el('alerta').hidden = true; render('alerta', ''); barra(); }

// EMA: painel sobreposto; o monitoramento continua rodando por baixo
function abrirEma(origem){
  const pf = perfil();
  S.pul.ultimaEma = agora();
  E = {origem, pos:0, r:{}, itens:pf.ema.map(k => ({...R.ema_itens[k], ema:true}))};
  registrar('check-in', S.nivel, `Check-in aberto (${origem})`); store.gravar();
  el('ema').hidden = false; barra(); emaQ();
}
function emaQ(){
  if (E.pos >= E.itens.length) return fimEma();
  const q = E.itens[E.pos];
  telaPergunta(q, {alvo:'emacorpo', pos:E.pos, total:E.itens.length, rotulo:'Check-in', voltar:false,
    extra:`${E.origem === 'check-in' ? `<button class=sec id=adiar>${esc(T.checkin_adiar)}</button>` : ''}<button class=sec id=naoconsigo>Não consigo responder agora</button>`},
    v => {
      if (v !== undefined) E.r[q.id] = v; E.pos++;
      // sinal vermelho na EMA (confusão, alucinação, respiração, se ferir) interrompe na hora, como na triagem
      if (R.regras.concat(R.regras_ema).some(g => g.nivel === 'vermelho' && cond(g.quando, {...resp(), ...E.r}))) return fimEma();
      emaQ();
    });
  on('naoconsigo', semResposta);
  on('adiar', () => { S.pul.ultimaEma = agora() - Math.max(0, perfil().checkin - 60) * 60000; registrar('check-in', S.nivel, 'Check-in adiado em 1 h pela pessoa'); store.gravar(); fecharEma(); renderAba(); });
}
function fecharEma(){ E = null; el('ema').hidden = true; render('emacorpo', ''); barra(); }
function fimEma(){
  if (!Object.keys(E.r).length) return semResposta();
  const antes = S.nivel;
  S.ultimaEmaResp = E.r; const fissura = E.r.q22 >= 7;
  aplicar(classificar(R.regras.concat(R.regras_ema), {...resp(), ...E.r}), 'check-in');
  fecharEma(); if (fissura && S.nivel !== 'vermelho') return telaFissura(); posReclass(antes);
}
function telaFissura(){
  tema('agitacao'); const F = T.fissura;
  $(`<div class=acolhe id=fissura><h1>${esc(F.titulo)}</h1><p>${esc(F.texto)}</p><p><b>${esc(F.passo)}</b></p></div>
  <button class=big id=fisresp>Respirar agora</button>
  <p class=card>Falar com alguém: ${S.contato ? `${esc(S.contato.nome)} (••••${esc(S.contato.tel.slice(-4))}) ou ` : ''}CVV 188 (24 h, gratuito).</p>
  <a class="btn big sec" href="tel:188">Ligar CVV 188</a><button class="big sec" id=fisvoltar>Voltar</button>`);
  on('fisresp', () => ir('respirar')); on('fisvoltar', () => ir(S.aba));
}
function semResposta(){ // check-in agendado sem resposta = amarelo (contato do CAPS), nunca verde
  const antes = S.nivel;
  aplicar({nivel:'amarelo', motivos:[{nivel:'amarelo', motivo:'Houve um check-in sem resposta: a equipe deve tentar contato.'}]}, 'check-in');
  fecharEma(); posReclass(antes);
}
function posReclass(antes){
  if (S.nivel === 'vermelho' && antes !== 'vermelho') return telaVermelho(true, () => ir(S.aba), 'check-in');
  renderAba();
}

// ---------- consentimento, sessão ----------
function consentimento(msg = ''){
  tema('normal');
  const B = T.boas_vindas;
  $(`${msg}<div class=acolhe><h1>${esc(B.titulo)}</h1>${B.frases.map(f => `<p>${esc(f)}</p>`).join('')}
    <label>${esc(B.pergunta_nome)}<input id=nome maxlength=30 autocomplete=off></label></div>
  <div class=card><b>Classificação de risco, não é diagnóstico.</b> Ajuda a decidir quando procurar o CAPS AD, a UBS ou o SAMU. Todo resultado passa por revisão por profissional. Em emergência, ligue <b>192</b>.</div>
  <div class=card><b>Seus dados (LGPD, art. 11)</b><br>Vamos perguntar sobre uso de substâncias e saúde mental, que são dados sensíveis. Você pode pular qualquer pergunta. Não pedimos texto livre nem sua localização exata.</div>
  <label class="card check"><input type=checkbox id=salvar> <span>Guardar meus dados <b>só neste aparelho</b> até eu tocar em "Encerrar sessão". <small>Apenas para teste. Nada é enviado.</small></span></label>
  <button class=big id=aceito>Concordo e quero começar</button>
  <button class=sec id=recuso>Não concordo</button>`);
  on('aceito', () => { const nome = el('nome').value.replace(/[^\p{L}\s'-]/gu, '').trim().slice(0, 30); S = novoEstado(); S.nome = nome; S.salvar = el('salvar').checked; el('app').dataset.sessao = 1; store.gravar(); barra(); triagem(); });
  on('recuso', () => $('<div class=card>Tudo bem. Se precisar, ligue 192 (SAMU) ou 188 (CVV).</div>'));
}
// refazer a triagem reaproveita o perfil (idade, sexo, região, moradia, contato) e a linha de base; a pulseira continua
function recomecar(){
  const velho = S;
  S = {...novoEstado(), salvar:velho.salvar, base:velho.base, log:velho.log, pul:velho.pul, alertaId:velho.alertaId, locPrevia:velho.locPrevia, telemetria:velho.telemetria, ultimoUso:velho.ultimoUso};
  for (const k of R.perfil.concat(velho.ultimoUso ? ['q12'] : [])) if (velho.resp[k] !== undefined) S.resp[k] = velho.resp[k]; // o último uso não é perguntado de novo
  S.pre = Object.keys(S.resp); S.contato = velho.contato;
  store.gravar(); triagem();
}
function telaEncerrar(){
  const volta = S.etapa === 'resultado' ? () => ir('dados') : triagem;
  tema('normal');
  $(`<h1>Encerrar sessão</h1><div class=card>Isso para a pulseira e apaga deste aparelho todas as respostas, o contato de confiança, a linha de base e o histórico.</div>
  ${S.nivel ? '<button class="big sec" id=exportar>Antes, ver e exportar o resumo</button>' : ''}
  <button class=big id=encerrarok>Encerrar e apagar tudo</button><button class=sec id=cancelar>Cancelar</button>`);
  on('exportar', () => telaResumo(telaEncerrar)); on('cancelar', volta);
  document.body.dataset.modo = '';
  on('encerrarok', () => {
    Pulseira.parar('Sessão encerrada'); fecharEma(); fecharAlerta(); if (ESC) fecharEscala(); cancelarSos(); voltarVermelho = null;
    store.apagar(); S = novoEstado(); delete el('app').dataset.sessao; Pulseira.fc = []; Pulseira.mov = []; Pulseira.n = 0; document.body.dataset.modo = '';
    barra(); consentimento('<div class=card id=encerrada>Sessão encerrada. Seus dados foram apagados deste aparelho.</div>');
  });
}

S = {pul:{t0Real:Date.now(), t0Sim:Date.now(), vel:1, desloc:0}}; // relógio provisório até carregar as regras
Promise.all(['rules.json', 'textos.json'].map(f => fetch(f).then(r => r.json()))).then(([j, t]) => {
  R = j; T = t; S = novoEstado();
  on('sos', pedirSos); on('sosSim', sos); on('sosNao', cancelarSos); on('engrenagem', () => S.etapa === 'resultado' ? ir('dados') : telaEncerrar());
  el('nav').innerHTML = ABAS.map(([k, i, l]) => `<button data-aba=${k}><span aria-hidden=true>${i}</span>${l}</button>`).join('');
  el('nav').querySelectorAll('[data-aba]').forEach(b => b.onclick = () => ir(b.dataset.aba));
  setInterval(() => document.querySelectorAll('[data-semuso]').forEach(e => { e.textContent = textoSemUso(); }), 1000); // tempo sem usar sempre do carimbo
  const salvo = store.ler();
  if (salvo?.v !== 2) return consentimento();
  CAMPOS.forEach(k => { if (salvo[k] !== undefined) S[k] = k === 'pul' ? {...S.pul, ...salvo.pul} : salvo[k]; });
  S.salvar = true; el('app').dataset.sessao = 1;
  if (S.pul.ativo) Pulseira.ligar(); // a pulseira continua depois de recarregar, até "Parar" ou "Encerrar sessão"
  barra();
  if (S.etapa !== 'resultado') return triagem();
  ir(S.aba || 'inicio');
}).catch(e => { console.error(e); $('<div class=card>Não foi possível carregar rules.json. Abra por um servidor (veja o README).</div>'); });
