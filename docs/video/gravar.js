// Uso: na raiz do repo, "python -m http.server 8124 --bind 127.0.0.1"; depois "node docs/video/gravar.js docs/video"
// e converta: ffmpeg -i docs/video/bruto.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -r 30 -movflags +faststart docs/video/pulso-demo.mp4
// Grava um vídeo de demonstração do app Pulso: o app real roda num iframe 360x640 (celular),
// com legendas explicativas ao lado. Uso: node gravar.js <saida_dir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || __dirname;
const BASE = 'http://127.0.0.1:8124';
const ESC = 1.5; // escala do celular na tela 1920x1080

const WRAP = `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{width:1920px;height:1080px;overflow:hidden;font-family:"Liberation Sans","DejaVu Sans",sans-serif;
 background:radial-gradient(1200px 900px at 75% 40%,#1d4e6e 0,#0B2545 60%,#071a33 100%);color:#EDF6F9}
#esq{position:absolute;left:120px;top:0;bottom:0;width:980px;display:flex;flex-direction:column;justify-content:center}
.marca{font-size:34px;font-weight:700;letter-spacing:.02em;color:#9fd3dc;display:flex;align-items:center;gap:14px}
.marca i{width:18px;height:18px;border-radius:50%;background:#6B9080;box-shadow:0 0 0 6px #6B908044}
#etapa{margin-top:56px;font-size:24px;color:#9fd3dc;text-transform:uppercase;letter-spacing:.12em;min-height:30px}
#titulo{font-size:64px;line-height:1.1;font-weight:700;margin:14px 0 26px;min-height:70px}
#texto{font-size:34px;line-height:1.45;color:#d6e9ee;max-width:900px;min-height:200px}
#texto b{color:#fff}
.troca{animation:surge .6s ease-out}@keyframes surge{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
#rodape{position:absolute;left:120px;bottom:54px;font-size:21px;color:#8fb3c4;max-width:1000px}
#barra{position:absolute;left:0;bottom:0;height:8px;background:#6B9080;width:0;transition:width .8s}
#tel{position:absolute;right:170px;top:50%;width:${360 * ESC + 28}px;height:${640 * ESC + 28}px;margin-top:-${(640 * ESC + 28) / 2}px;
 border-radius:46px;background:#111;padding:14px;box-shadow:0 30px 80px #0008,0 0 0 2px #3a4a5a inset}
#tel iframe{width:360px;height:640px;border:0;border-radius:28px;transform:scale(${ESC});transform-origin:0 0;background:#F8F9FA}
#toque{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:#ffffff55;border:3px solid #fff;
 pointer-events:none;opacity:0;z-index:9;box-shadow:0 0 18px #0006}
#toque.on{animation:toque .7s ease-out}@keyframes toque{0%{opacity:1;transform:scale(.4)}60%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.3)}}
#capa{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
 background:radial-gradient(1200px 900px at 50% 40%,#1d4e6e 0,#0B2545 60%,#071a33 100%);z-index:20;transition:opacity 1s}
#capa h1{font-size:120px;margin:0;letter-spacing:.02em}#capa p{font-size:40px;color:#cfe6ec;margin:18px 0 0;max-width:1400px;line-height:1.35}
#capa small{display:block;margin-top:48px;font-size:24px;color:#8fb3c4}
</style></head><body>
<div id=esq><div class=marca><i></i>Pulso · como usar o app</div><div id=etapa></div><div id=titulo></div><div id=texto></div></div>
<div id=rodape>Protótipo do 3º Hackathon em Saúde IMT/São Camilo · <b>classificação de risco, não é diagnóstico</b> · pulseira, ligações e dados simulados · parâmetros não validados clinicamente</div>
<div id=tel><iframe id=app src="${BASE}/?rapido&hora=14"></iframe></div>
<div id=toque></div><div id=barra></div>
<div id=capa><h1>Pulso</h1><p>Pulseira de baixo custo + app para quem está parando o uso de álcool e outras substâncias</p>
<small>Demonstração do protótipo · telas reais do app em funcionamento</small></div>
</body></html>`;

const legendas = [];
let t0 = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  await page.route(BASE + '/__video.html', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: WRAP }));
  t0 = Date.now();
  await page.goto(BASE + '/__video.html');
  const fr = page.frameLocator('#app');
  const frame = () => page.frame({ url: /\?rapido/ });
  await fr.locator('#aceito').waitFor();

  let passo = 0; const TOTAL = 13;
  async function legenda(titulo, texto, etapa = true) {
    if (etapa) passo++;
    legendas.push({ t: (Date.now() - t0) / 1000, titulo, texto: texto.replace(/<[^>]+>/g, '') });
    await page.evaluate(([e, ti, tx, p]) => {
      for (const [id, v] of [['etapa', e], ['titulo', ti], ['texto', tx]]) {
        const n = document.getElementById(id); n.innerHTML = v; n.classList.remove('troca'); void n.offsetWidth; n.classList.add('troca');
      }
      document.getElementById('barra').style.width = (p * 100) + '%';
    }, [etapa ? `Passo ${passo} de ${TOTAL}` : '', titulo, texto, passo / TOTAL]);
  }
  async function mostrar(sel) {
    const l = fr.locator(sel).first();
    await l.waitFor({ state: 'visible' });
    await l.evaluate(e => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(450);
    return l;
  }
  async function tocar(sel, pausa = 700) {
    const l = await mostrar(sel);
    const b = await l.boundingBox();
    if (b) await page.evaluate(([x, y]) => { const t = document.getElementById('toque'); t.style.left = x + 'px'; t.style.top = y + 'px'; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on'); }, [b.x + b.width / 2, b.y + b.height / 2]);
    await sleep(250);
    await l.click();
    await sleep(pausa);
  }
  async function digitar(sel, txt) { await tocar(sel, 200); await fr.locator(sel).pressSequentially(txt, { delay: 90 }); await sleep(300); }
  async function rolar(px, ms = 1200) { await frame().evaluate(px => scrollBy({ top: px, behavior: 'smooth' }), px); await sleep(ms); }
  async function topo() { await frame().evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await sleep(600); }
  const aba = k => tocar(`#nav [data-aba=${k}]`, 900);

  // ---------- capa ----------
  await sleep(3200);
  await page.evaluate(() => { const c = document.getElementById('capa'); c.style.opacity = 0; setTimeout(() => c.remove(), 1100); });
  await sleep(900);

  // ---------- 1. acolhimento ----------
  await legenda('Acolhimento', 'A primeira tela recebe a pessoa pelo nome e pede <b>consentimento explícito</b> (LGPD art. 11). Os dados ficam <b>só neste aparelho</b>, apenas para teste.');
  await sleep(1800);
  await digitar('#nome', 'Lu');
  await tocar('#salvar', 600);
  await tocar('#aceito', 1200);

  // ---------- 2. triagem ----------
  await legenda('Triagem guiada', 'Uma pergunta por vez, toques grandes e sempre a opção <b>"Prefiro não responder"</b>. Base: ASSIST, PAWSS, CIWA-Ar, COWS, PHQ-2 e C-SSRS.');
  const v = x => JSON.stringify(x);
  const RESP = { q1: '30_44', q2: 'masculino', q6: { nome: 'Ana', tel: '11987654321' }, q7: ['alcool'], q9: '1_2sem', q11: 'ate_2', q12: '1_3d',
    q14: 'nao', q16: 'nao', q17: 'nao', q20: ['nenhum'], q21: 'normal', q22: 3, q23: ['nenhum'], q26: 0, q27: 0, q28: 'nao', q29: 'nao', q32: 'nao' };
  const notas = {
    q6: ['Contato de confiança', 'Um contato de confiança (aqui, <b>Ana</b>) pode ser avisado em momentos de risco, sempre de forma transparente para a pessoa.'],
    q7: ['Substância', 'Exemplo da demonstração: uma pessoa parando o <b>álcool</b>. A classe da substância define a intensidade do acompanhamento.'],
    q12: ['Último uso', 'O último uso é perguntado <b>uma única vez</b>. O app guarda a data e calcula sozinho o tempo sem usar e a fase da abstinência.'],
    q20: ['Sinais de alerta', 'Confusão, alucinações, febre ou convulsão recente são critérios vermelhos: <b>um só basta</b> para interromper a triagem e oferecer ajuda imediata.'],
    q29: ['Segurança', 'Perguntas de rastreio de risco (C-SSRS). Nada já respondido ou dedutível é perguntado de novo.'],
  };
  for (let i = 0; i < 60; i++) {
    if (await fr.locator('#nivel').count()) break;
    const card = fr.locator('section[data-q]');
    await card.waitFor();
    const q = await card.getAttribute('data-q');
    if (notas[q]) await legenda(notas[q][0], notas[q][1], false);
    await sleep(500);
    const r = RESP[q];
    if (r === undefined) await tocar('[data-acao=pular]', 700);
    else if (q === 'q6') { await digitar('#cnome', r.nome); await digitar('#ctel', r.tel); await tocar('#csim', 900); }
    else if (Array.isArray(r)) { for (const x of r) await tocar(`.op[data-v='${v(x)}']`, 350); await tocar('[data-acao=continuar]', 900); }
    else await tocar(`.op[data-v='${v(r)}']`, 900);
  }

  // ---------- 3. resultado / início ----------
  await legenda('Perfil de risco e Início', 'Saudação pelo nome, nível em <b>cor calma</b> (o paciente nunca vê vermelho vibrante), <b>tempo sem usar</b> calculado pela data do último uso e o próximo check-in.');
  await topo(); await sleep(2500);
  await rolar(380, 2200); await rolar(380, 2200); await rolar(420, 2200);
  await topo();

  // ---------- 4. hoje ----------
  await aba('hoje');
  await legenda('Hoje e nos próximos dias', 'O que a pessoa pode sentir na fase atual, <b>"um passo pequeno para hoje"</b>, o que ajuda agora e, sempre, <b>quando procurar ajuda</b> (CAPS/UBS e SAMU).');
  await sleep(2400); await rolar(420, 2200); await rolar(420, 2200); await rolar(420, 2000);

  // ---------- 5. respirar ----------
  await aba('respirar');
  await legenda('Respirar', 'Respiração guiada: o círculo cresce enquanto a pessoa inspira (4 s) e diminui enquanto solta o ar (6 s).');
  await sleep(6000);

  // ---------- 6. pulseira ----------
  await aba('pulseira');
  await legenda('Pulseira', 'A pulseira (simulada, via Bluetooth) mede <b>frequência cardíaca, tremor/movimento e sono</b>. O alerta dispara por desvio da linha de base <b>da própria pessoa</b>.');
  await sleep(1500);
  await tocar('#mon', 1500);
  await sleep(4000); await rolar(350, 2500); await topo();
  await aba('apoio');
  await legenda('Apoio', 'CAPS AD, UBS e ONGs próximos, o contato de confiança, <b>SAMU 192</b> e <b>CVV 188</b>. A pulseira continua monitorando ao trocar de aba.');
  await sleep(2500); await rolar(400, 2200); await rolar(400, 2000); await topo();

  // ---------- 7. corrida (falso positivo) ----------
  await legenda('Exercício não é crise', 'No <b>Modo demonstração</b>, simulamos uma corrida: a FC sobe, mas os passos ritmados indicam exercício e <b>não há alerta</b>. Velocidade de GPS sozinha nunca basta.');
  await tocar('#engrenagem', 900); await tocar('#abrirdemo', 1000);
  await tocar('[data-c=corrida]', 900);
  await aba('pulseira');
  await sleep(6500);

  // ---------- 8. crise em repouso ----------
  await legenda('Check-in de segurança', 'Agora uma <b>crise em repouso</b>: FC e tremor alterados sem atividade. O app abre um check-in em tela cheia, com vibração e som.');
  await tocar('#engrenagem', 900); await tocar('#abrirdemo', 900);
  await tocar('[data-c=crise_repouso]', 400);
  await fr.locator('#alerta').waitFor({ state: 'visible', timeout: 20000 });
  await sleep(2200);
  await legenda('Check-in de segurança', 'A pessoa responde <b>"Estou bem"</b> ou <b>"Preciso de ajuda"</b>. Sem resposta em 45 s (de dia) ou 90 s (à noite), o caso é tratado como crise aguda.', false);
  await sleep(2200);
  await tocar('#precisoajuda', 300);
  // bastidor da demo: a crise simulada termina (equivale a escolher "Estável" no Modo demonstração)
  await frame().evaluate(() => { S.pul.cenario = 'estavel'; S.pul.i = 0; Pulseira.acima = 0; });
  await sleep(1200);

  // ---------- 9. tela de ajuda ----------
  await legenda('Pedido de ajuda', 'O painel do CAPS recebe o alerta com a telemetria e o contato de confiança é avisado. <b>O SAMU 192 só é chamado se a pessoa tocar</b>, com confirmação.');
  await sleep(3000); await rolar(400, 2500); await rolar(400, 2500);
  await tocar('#voltarajuda', 400);

  // ---------- 10. recaída ----------
  await aba('inicio');
  await legenda('Usei de novo', 'Recaída é tratada com acolhimento, sem julgamento: <b>"Obrigado por contar. Isso não apaga o que você já fez."</b> Recaída sozinha nunca aciona o SAMU.');
  await tocar('#useidenovo', 1500);
  await tocar('#usosim', 1500);
  await sleep(3500); await rolar(350, 2200);
  await tocar('#voltarinicio', 1200);

  // ---------- 11. profissional ----------
  await legenda('Visão do profissional (CAPS)', 'A equipe vê alertas e telemetria, <b>confirma ou ajusta o nível</b> e define o plano de check-ins (intervalo, madrugada e motivo clínico).');
  await tocar('#engrenagem', 900); await tocar('#abrirdemo', 900);
  await tocar('#painel', 1500);
  await sleep(2500); await rolar(400, 2200); await rolar(400, 2200); await rolar(450, 2200); await rolar(450, 2200);

  // ---------- 12. fechamento ----------
  await legenda('Revisão humana sempre', 'O Pulso faz <b>classificação de risco, não diagnóstico</b>. Toda regra clínica está em <b>rules.json</b>, auditável, e todo resultado aguarda revisão de um profissional.');
  await topo(); await sleep(6000);
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'capa'; c.style.opacity = 0;
    c.innerHTML = '<h1>Pulso</h1><p>Triagem acolhedora · pulseira que distingue exercício de crise · ajuda sem ligação automática · revisão por profissional</p><small>Repositório: hachathon-maua-2026 · roteiro em docs/demo.md · protótipo, não validado clinicamente</small>';
    document.body.appendChild(c); requestAnimationFrame(() => c.style.opacity = 1);
  });
  await sleep(5000);

  await ctx.close(); // finaliza o vídeo
  const vid = await page.video().path();
  fs.renameSync(vid, path.join(OUT, 'bruto.webm'));
  fs.writeFileSync(path.join(OUT, 'legendas.json'), JSON.stringify({ legendas, duracao: (Date.now() - t0) / 1000 }, null, 1));
  await browser.close();
  if (erros.length) console.error('Erros na página:', erros);
  console.log('ok', (Date.now() - t0) / 1000, 's');
})().catch(e => { console.error(e); process.exit(1); });
