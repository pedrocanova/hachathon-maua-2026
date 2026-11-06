// Protótipo de triagem — esboço do hackathon. Não é diagnóstico.
// Dados ficam apenas na memória da aba (minimização LGPD): nada é salvo ou enviado.
const ORDEM = {verde:0, amarelo:1, vermelho:2};
const ROTULO = {verde:'Estável', amarelo:'Precisa de apoio em até 24 h', vermelho:'Busque ajuda agora'};
let R, S = {resp:{}, nivel:null, motivos:[], log:[], sim:null};
const $ = h => (document.getElementById('app').innerHTML = h);
const tema = t => document.body.dataset.tema = t;

// ---------- motor de regras (lê rules.json) ----------
function escore(nome, r){ return R.escores[nome].reduce((s,k)=> s + (r[k] ?? 0), 0); }
function cond(c, r){
  if (c.algum) return c.algum.some(x => cond(x, r));
  if (c.todos) return c.todos.every(x => cond(x, r));
  const v = c.escore ? escore(c.escore, r) : r[c.q];
  if (v === undefined || v === null) return false;
  if ('eq' in c) return v === c.eq;
  if (c.em) return c.em.includes(v);
  if (c.inclui) return [].concat(v).some(x => c.inclui.includes(x));
  if ('gte' in c) return v >= c.gte;
  if ('lt' in c) return v < c.lt;
  return false;
}
function classificar(regras, r, obrigatorias=[]){
  let nivel='verde', motivos=[];
  for (const g of regras) if (cond(g.quando, r)) {
    motivos.push(g); if (ORDEM[g.nivel] > ORDEM[nivel]) nivel = g.nivel;
  }
  const faltam = obrigatorias.filter(k => r[k] === undefined);
  if (faltam.length && nivel === 'verde') { // falhar para o lado seguro
    nivel = 'amarelo'; motivos.push({nivel:'amarelo', motivo:'Dados incompletos ('+faltam.join(', ')+'): sem dados, nunca classificamos como estável.'});
  }
  return {nivel, motivos: motivos.filter(m => m.nivel === nivel).concat(motivos.filter(m => m.nivel !== nivel))};
}
// nunca rebaixa sozinho: o nível só sobe dentro de um episódio
function aplicar(res, origem){
  // após a triagem, sensor/EMA só podem SUBIR o nível; rebaixar exige nova triagem
  if (origem !== 'triagem' && S.nivel && ORDEM[res.nivel] < ORDEM[S.nivel])
    res = {nivel:S.nivel, motivos:S.motivos.concat(res.motivos)};
  S.nivel = res.nivel; S.motivos = res.motivos;
  S.log.unshift({t:new Date().toLocaleTimeString('pt-BR'), origem, nivel:res.nivel, motivo:res.motivos[0]?.motivo || 'Sem critérios de alerta'});
}

// ---------- telas ----------
function consentimento(){
  tema('normal');
  $(`<h1>Pulso</h1>
  <div class="card"><b>Isto não é diagnóstico.</b> É uma ferramenta de apoio que ajuda a decidir quando procurar o CAPS, a UBS ou o SAMU. Em emergência, ligue <b>192</b>.</div>
  <div class="card"><b>Seus dados (LGPD, art. 11)</b><br>Vamos perguntar sobre uso de substâncias e saúde mental, que são dados sensíveis. Neste protótipo as respostas ficam só neste aparelho e são apagadas ao fechar a página. Você pode pular qualquer pergunta.</div>
  <button class="big" onclick="iniciar()">Concordo e quero continuar</button>
  <button class="sec" onclick="$('<div class=card>Tudo bem. Se precisar, ligue 192 (SAMU) ou 188 (CVV).</div>')">Não concordo</button>`);
}
let fila, pos;
function iniciar(){ S.resp = {}; pos = 0; pergunta(); }
function visiveis(){ return R.triagem.filter(q => !q.se || cond(q.se, S.resp)); }
function campo(q, onAns){
  window._ans = v => onAns(v);
  const b = (v,l) => `<button onclick='_ans(${JSON.stringify(v)})'>${l}</button>`;
  switch(q.tipo){
    case 'simnao': return b('sim','Sim') + b('nao','Não');
    case 'opcao': return q.opcoes.map(o => b(o, o.replace(/_/g,' '))).join('');
    case 'escala03': return ['0 nada','1 leve','2 moderado','3 forte'].map((l,i)=>b(i,l)).join('');
    case 'escala010': return [...Array(11).keys()].map(i=>b(i,i)).join('');
    case 'numero': return `<input type=number id=num min=0 max=120> <button onclick="_ans(+num.value||undefined)">OK</button>`;
    case 'multi': window._sel = new Set();
      return q.opcoes.map(o=>`<button class=sec onclick="_sel.has('${o}')?_sel.delete('${o}'):_sel.add('${o}');this.classList.toggle('sec')">${o.replace(/_/g,' ')}</button>`).join('')
        + `<br><button onclick="_ans([..._sel])">Continuar</button>`;
  }
}
function pergunta(){
  const vs = visiveis();
  if (pos >= vs.length) return resultado('triagem');
  const q = vs[pos];
  $(`<div class=bar><i style="width:${100*pos/vs.length}%"></i></div>
  <small>Bloco ${q.bloco} · ${pos+1} de ${vs.length}</small>
  <div class=card><h2>${q.texto}</h2><div class=opc>${campo(q, v => { if (v!==undefined) S.resp[q.id]=v; pos++; pergunta(); })}</div></div>
  <button class=sec onclick="pos++;pergunta()">Prefiro não responder</button>
  ${pos ? '<button class=sec onclick="pos--;pergunta()">Voltar</button>' : ''}`);
}
function resultado(origem, res){
  if (origem === 'triagem') { S.nivel = null; aplicar(classificar(R.regras, S.resp, R.obrigatorias_para_verde), 'triagem'); }
  const n = S.nivel, motivos = S.motivos.map(m=>`<li>${m.motivo}</li>`).join('') || '<li>Nenhum critério de alerta nas respostas.</li>';
  const noite = new Date().getHours() < 6;
  const fisico = S.motivos.some(m => /tremor|suor|físic|janela/i.test(m.motivo));
  tema(n==='vermelho' ? 'crise' : noite ? 'noite' : n==='amarelo' ? (fisico ? 'taquicardia' : 'agitacao') : 'normal');
  const mapa = `<button onclick="window.open('https://www.google.com/maps/search/CAPS+AD+perto+de+mim')">Ver CAPS AD / UBS mais próximos</button>`;
  const acao = {
    vermelho: `<p>Você não está sozinho(a). Isso precisa de atendimento agora.</p>
      <button class=big onclick="location.href='tel:192'">Ligar para o SAMU 192</button>
      <button class=big onclick="alert('Protótipo: enviaria SMS ao contato de emergência')">Avisar meu contato de emergência</button>
      ${S.motivos.some(m=>/suic|ferir/i.test(m.motivo)) ? '<button class=big onclick="location.href=\'tel:188\'">CVV 188 (24 h)</button>' : ''}
      <p class=aviso>Fique perto de alguém. Não use mais nenhuma substância. Se a pessoa estiver desacordada ou respirando devagar, deite-a de lado.</p>`,
    amarelo: `<p>Seria bom falar com a equipe do CAPS AD ou da UBS hoje ou amanhã. Em protótipo, o serviço receberia um aviso para entrar em contato.</p>${mapa}
      <button onclick="respirar()">Exercício de respiração</button>`,
    verde: `<p>Seus sinais estão estáveis. Continue cuidando de você: água, alimentação, sono.</p>
      <button onclick="respirar()">Exercício de respiração</button>${mapa}`
  }[n];
  $(`<h1>${ROTULO[n]}</h1><div class=card>${acao}</div>
  <div class=card><b>Por que esta orientação?</b><ul>${motivos}</ul></div>
  <button onclick="monitor()">Acompanhamento com a pulseira (simulado)</button>
  <button class=sec onclick="painel()">Visão do profissional</button>
  <p class=aviso>Não é diagnóstico. Em dúvida, ligue 192.</p>`);
}
function respirar(){
  $(`<h1>Respire com o círculo</h1><div id=resp></div>
  <p style="text-align:center" id=fase>Inspire…</p><p class=aviso>4 segundos para inspirar, 6 para soltar o ar.</p>
  <button onclick="resultado()">Voltar</button>`);
  let t=0; clearInterval(window._ri); window._ri = setInterval(()=>{ const e=document.getElementById('fase'); if(!e) return clearInterval(window._ri); t=(t+1)%10; e.textContent = t<4 ? 'Inspire…' : 'Solte o ar devagar…'; }, 1000);
}

// ---------- simulador de pulseira ----------
const CEN = {
  estavel:  i => ({fc: 72 + rnd(3), mov: 1 + rnd(.3)}),
  alcool:   i => ({fc: 74 + Math.max(0,i-12)*1.6 + rnd(3), mov: 1 + Math.max(0,i-12)*.12 + rnd(.3)}), // FC e tremor sobem
  recaida:  i => ({fc: i<14 ? 78 + rnd(3) : 58 + rnd(2), mov: i<14 ? 1.2 + rnd(.3) : .3 + rnd(.1)})   // queda súbita (sedação)
};
function rnd(a){ return (Math.random()*2-1)*a; }
function monitor(){
  clearInterval(S.sim?.timer);
  $(`<h1>Pulseira (simulada)</h1>
  <div class=card>Cenário: <button onclick="sim('estavel')">Estável</button><button onclick="sim('alcool')">Abstinência de álcool piorando</button><button onclick="sim('recaida')">Recaída</button></div>
  <canvas id=cv width=500 height=120></canvas>
  <div class=card id=st>Escolha um cenário. As primeiras ${R.sensor.amostras_linha_base} leituras formam a sua linha de base.</div>
  <button class=sec onclick="clearInterval(S.sim.timer);resultado()">Voltar</button>`);
}
function sim(c){
  clearInterval(S.sim?.timer);
  S.sim = {c, i:0, fc:[], mov:[], acima:0};
  S.sim.timer = setInterval(passo, 500);
}
const media = a => a.reduce((s,x)=>s+x,0)/a.length;
const dp = a => { const m=media(a); return Math.sqrt(media(a.map(x=>(x-m)**2)))||1; };
function passo(){
  const s=S.sim, p=CEN[s.c](s.i++), cfg=R.sensor, nb=cfg.amostras_linha_base;
  s.fc.push(p.fc); s.mov.push(p.mov);
  let txt = `FC ${p.fc.toFixed(0)} bpm · movimento ${p.mov.toFixed(2)}`;
  if (s.i > nb){
    const bf=s.fc.slice(0,nb), bm=s.mov.slice(0,nb);
    const zf=(p.fc-media(bf))/dp(bf), zm=(p.mov-media(bm))/dp(bm);
    txt += ` · desvio da linha de base: FC ${zf.toFixed(1)}, mov ${zm.toFixed(1)}`;
    // desvio em qualquer direção: em estimulantes/opioides a FC pode CAIR
    s.acima = (Math.abs(zf) > cfg.desvios_para_disparo || Math.abs(zm) > cfg.desvios_para_disparo) ? s.acima+1 : 0;
    if (s.acima >= cfg.amostras_persistencia){ clearInterval(s.timer); return ema(); }
  } else txt += ' · calibrando linha de base';
  document.getElementById('st').textContent = txt; desenhar();
}
function desenhar(){
  const cv=document.getElementById('cv'); if(!cv) return; const g=cv.getContext('2d'), a=S.sim.fc.slice(-60);
  g.clearRect(0,0,500,120); g.strokeStyle=getComputedStyle(document.body).getPropertyValue('--pri'); g.lineWidth=2; g.beginPath();
  a.forEach((v,i)=> g.lineTo(i*500/60, 120-(v-40)*120/100)); g.stroke();
}
let ePos, eResp;
function ema(){ ePos=0; eResp={}; tema('taquicardia'); emaQ(); }
function emaQ(){
  const vs = R.ema.filter(q => !q.se || cond(q.se, eResp));
  if (ePos >= vs.length){ aplicar(classificar(R.regras_ema, eResp), 'EMA'); return resultado(); }
  const q=vs[ePos];
  $(`<small>A pulseira notou uma mudança. Pergunta ${ePos+1} de ${vs.length}</small>
  <div class=card><h2>${q.texto}</h2><div class=opc>${campo(q, v => { eResp[q.id]=v; ePos++; emaQ(); })}</div></div>
  <button class=sec onclick="semResposta()">Não consigo responder agora</button>`);
}
function semResposta(){ // falha segura: sensor alterado + sem resposta = amarelo, nunca verde
  aplicar({nivel: ORDEM[S.nivel]>=1 ? S.nivel : 'amarelo', motivos:[{nivel:'amarelo', motivo:'Pulseira detectou mudança e não houve resposta: equipe deve tentar contato.'}]}, 'sensor');
  resultado();
}
function painel(){
  tema('normal');
  $(`<h1>Painel do profissional (protótipo)</h1><p class=aviso>Aqui os níveis aparecem em vermelho/laranja para priorização clínica; o paciente vê cores calmantes.</p>
  <div class=log>${S.log.map(l=>`${l.t} [${l.origem}] <span class="chip ${l.nivel}">${l.nivel}</span> ${l.motivo}`).join('<br>')||'Sem registros'}</div>
  <button onclick="resultado()">Voltar</button>`);
}

fetch('rules.json').then(r=>r.json()).then(j=>{ R=j; consentimento(); })
  .catch(()=>$('<div class=card>Não foi possível carregar rules.json. Abra via servidor: <code>python3 -m http.server</code></div>'));
