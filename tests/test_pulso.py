"""Testes Playwright (Python) do protótipo Pulso.
Rodar:  python -m pytest tests  (usa o Edge instalado; PW_CHANNEL=chromium para o Chromium do Playwright)
Os testes usam ?rapido (60x; contagens curtas no máximo 5x) e ?hora=14 (dia) para serem determinísticos.
"""
import colorsys, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright, expect

RAIZ = Path(__file__).resolve().parent.parent
PORTA = 8123
BASE = f"http://localhost:{PORTA}"
DIA = "/?rapido&hora=14"
NOITE = "/?rapido&hora=23"
CONTATO = {"nome": "Ana", "tel": "11987654321"}

VERDE = dict(q1="30_44", q2="masculino", q6="nao", q7=["cocaina"], q12="mais_1sem", q13=["cheira"], q16="nao", q17="nao",
             q20=["nenhum"], q21="normal", q22=2, q26=0, q27=0, q28="nao", q29="nao", q32="nao")
ALCOOL = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["alcool"], "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"], "q12": "1_3d"}
TABACO = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["tabaco"], "q12": "1_3d", "q22": 3, "q6": CONTATO}
OPIOIDE = {**VERDE, "q7": ["opioides"], "q13": ["engole"], "q14": "nao", "q12": "1_3d", "q6": CONTATO}
PIOR = {**VERDE, "q2": "feminino", "q3": "nao", "q7": ["alcool", "opioides", "cocaina"], "q9": "menos", "q11": "ate_2", "q14": "nao",
        "q23": ["nenhum"], "q29": "sim", "q30": "nao", "q31": "nao"}


@pytest.fixture(scope="session")
def servidor():
    p = subprocess.Popen([sys.executable, "-m", "http.server", str(PORTA), "--bind", "127.0.0.1"], cwd=RAIZ,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen(BASE + "/rules.json"); break
        except Exception: time.sleep(0.1)
    yield
    p.terminate()


@pytest.fixture(scope="session")
def navegador(servidor):
    canal = os.environ.get("PW_CHANNEL", "msedge")
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel=None if canal == "chromium" else canal)
        yield b
        b.close()


@pytest.fixture
def page(navegador):
    ctx = navegador.new_context(base_url=BASE)
    pg = ctx.new_page()
    yield pg
    ctx.close()


def v(x): return json.dumps(x, ensure_ascii=False)


def iniciar(page, url=DIA, salvar=False):
    page.goto(url)
    if salvar: page.check("#salvar")
    page.click("#aceito")


def responder(page, resp, ate=None):
    """Responde a triagem até o resultado (ou até a pergunta `ate`). Sem resposta no mapa = 'Prefiro não responder'."""
    vistas = []
    for _ in range(60):
        if page.locator("#app #nivel").count(): break
        card = page.locator("#app section[data-q]")
        expect(card).to_have_count(1)
        q = card.get_attribute("data-q")
        if q == ate: break
        vistas.append(q)
        r = resp.get(q)
        if r is None: page.click("#app [data-acao=pular]")
        elif q == "q6" and isinstance(r, dict):
            page.fill("#cnome", r["nome"]); page.fill("#ctel", r["tel"]); page.click("#csim")
        elif q == "q6": page.click("#cnao")
        elif isinstance(r, list):
            for x in r: page.click(f"#app .op[data-v='{v(x)}']")
            page.click("#app [data-acao=continuar]")
        else: page.click(f"#app .op[data-v='{v(r)}']")
    return vistas


def ema_benigna(page):
    """Responde o check-in (EMA) aberto com respostas tranquilas; devolve os ids das perguntas."""
    ids = []
    expect(page.locator("#ema")).to_be_visible()
    for _ in range(8):
        if page.locator("#ema").is_hidden(): break
        q = page.locator("#emacorpo section[data-q]").get_attribute("data-q"); ids.append(q)
        if page.locator("#emacorpo [data-acao=continuar]").count():
            page.click("#emacorpo .op[data-v='\"nenhum\"']"); page.click("#emacorpo [data-acao=continuar]")
        elif page.locator("#emacorpo .op[data-v='2']").count(): page.click("#emacorpo .op[data-v='2']")
        elif page.locator("#emacorpo .op[data-v='\"nao\"']").count(): page.click("#emacorpo .op[data-v='\"nao\"']")
        else: page.locator("#emacorpo .op").first.click()
    expect(page.locator("#ema")).to_be_hidden()
    return ids


def fechar_escala(page):
    if page.locator("#cancelarligacao").count(): page.click("#cancelarligacao")
    page.click("#fecharescala")
    expect(page.locator("#escala")).to_be_hidden()


def cenario(page, c):
    if page.locator("#demo").get_attribute("open") is None: page.click("#demo summary")
    page.click(f"[data-c={c}]")


def nivel(page): return page.locator("#app #nivel").get_attribute("data-nivel")
def leituras(page): return page.evaluate("Pulseira.n")
def ativo(page): return page.evaluate("S.pul.ativo && !!Pulseira.timer")
def log(page): return page.evaluate("S.log.map(l => l.motivo).join(' | ')")


# ---------- convulsão: sem pergunta repetida ----------
def test_q16_nao_esconde_convulsao_hoje(page):
    iniciar(page)
    vistas = responder(page, VERDE, ate="q20")
    assert "q16_24h" not in vistas
    expect(page.locator(".op[data-v='\"convulsao_hoje\"']")).to_have_count(0)
    for crit in ["confusao", "alucinacao", "respiracao"]:
        expect(page.locator(f".op[data-v='\"{crit}\"']")).to_have_count(1)


def test_q16_sim_pergunta_24h(page):
    iniciar(page)
    vistas = responder(page, {**VERDE, "q16": "sim", "q16_24h": "sim"})
    assert vistas[-1] == "q16_24h" and nivel(page) == "vermelho"


def test_q16_sem_resposta_mantem_opcao_na_q20(page):
    iniciar(page)
    responder(page, {k: x for k, x in VERDE.items() if k != "q16"}, ate="q20")
    expect(page.locator(".op[data-v='\"convulsao_hoje\"']")).to_have_count(1)


# ---------- vermelho direto + d) escalonamento ----------
@pytest.mark.parametrize("extra,ultima,suicidio", [
    ({"q29": "sim", "q30": "sim"}, "q30", True),
    ({"q29": "sim", "q30": "nao", "q31": "sim"}, "q31", True),
    ({"q32": "sim"}, "q32", True),
    ({"q20": ["confusao"]}, "q20", False),
    ({"q16": None, "q20": ["convulsao_hoje"]}, "q20", False),
], ids=["Q30", "Q31", "Q32", "Q20-confusao", "Q20-convulsao"])
def test_vermelho_direto(page, extra, ultima, suicidio):
    iniciar(page)
    vistas = responder(page, {**VERDE, **extra})
    assert vistas[-1] == ultima and nivel(page) == "vermelho"
    expect(page.locator("#escala")).to_have_attribute("data-estado", "contagem")   # escalonamento começa sozinho
    fechar_escala(page)
    expect(page.locator("#samu")).to_be_visible(); expect(page.locator("#upa")).to_be_visible()
    expect(page.locator("#cvv")).to_have_count(1 if suicidio else 0)
    expect(page.locator("#respirar")).to_have_count(0)
    expect(page.locator("body")).to_have_attribute("data-tema", "crise")


def test_escalonamento_contato_e_192_em_paralelo_e_cancelar(page):
    iniciar(page)
    responder(page, {**VERDE, "q6": CONTATO, "q32": "sim"})
    esc = page.locator("#escala")
    expect(esc).to_have_attribute("data-estado", "contagem")
    expect(page.locator("#tl-contato")).to_have_class("feito")                     # contato já avisado, sem esperar
    expect(page.locator("#tl-contato")).to_contain_text("Ana"); expect(page.locator("#tl-contato")).to_contain_text("PROTÓTIPO")
    expect(page.locator("#tl-contato")).not_to_contain_text("11987654321")
    expect(page.locator("#tl-caps")).to_have_class("feito")
    expect(page.locator("#tl-192")).to_have_class("pendente")
    expect(page.locator("#tl-192")).to_contain_text("só a sua voz")
    page.click("#cancelarligacao")
    expect(esc).to_have_attribute("data-estado", "cancelada")
    assert "cancelada" in log(page) and "Ligação ao SAMU 192 (simulada" not in log(page)
    page.wait_for_timeout(5000)
    expect(esc).to_have_attribute("data-estado", "cancelada")                     # não liga depois de cancelar


def test_escalonamento_liga_ao_fim_da_contagem(page):
    iniciar(page)
    responder(page, {**VERDE, "q32": "sim"})
    expect(page.locator("#escala")).to_have_attribute("data-estado", "ligando", timeout=8000)  # 20 s a 5x = 4 s
    expect(page.locator("#escala")).to_contain_text("Ligando para o SAMU 192")


# ---------- a) filtro por atividade ----------
def test_corrida_nao_gera_alerta(page):
    iniciar(page)
    responder(page, {**VERDE, "q6": CONTATO})
    page.click("#mon"); cenario(page, "corrida")
    page.wait_for_timeout(4000)
    expect(page.locator("#alerta")).to_be_hidden()
    assert "considerado exercício" in log(page)


@pytest.mark.parametrize("c,palavra", [("crise_veiculo", "veículo"), ("crise_repouso", "Check-in de segurança")])
def test_crise_em_veiculo_e_repouso_geram_alerta(page, c, palavra):
    iniciar(page)
    responder(page, {**VERDE, "q6": CONTATO})
    page.click("#mon"); cenario(page, c)
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    assert palavra in log(page)


def test_queda_fc_dispara_check_in(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon"); page.wait_for_timeout(800); cenario(page, "recaida")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)


def test_estou_bem_silencia(page):
    iniciar(page)
    responder(page, {**VERDE, "q6": CONTATO})
    page.click("#mon"); cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    page.click("#estoubem")
    page.wait_for_timeout(3000)                                                    # 30 min a 60x = 30 s
    expect(page.locator("#alerta")).to_be_hidden()
    assert "silenciados" in log(page) and nivel_atual(page) != "vermelho"


def nivel_atual(page): return page.evaluate("S.nivel")


# ---------- b) Modo Treino ----------
def test_treino_suspende_so_fc_e_reativa_sozinho(page):
    iniciar(page)
    responder(page, TABACO)
    page.click("#mon")
    expect(page.locator("#sugestaotreino")).to_be_visible()                       # perfil leve e verde: sugestão proativa
    page.click("[data-treino='30']")
    expect(page.locator("#treinost")).to_be_visible()
    cenario(page, "academia")                                                      # FC sobe sem passos
    page.wait_for_timeout(3000)
    expect(page.locator("#alerta")).to_be_hidden()
    assert "gatilho de FC suspenso" in log(page)
    for _ in range(3): page.click("#avancar15")                                    # 30 min + 15 de tolerância
    expect(page.locator("#treinost")).to_have_count(0, timeout=3000)
    assert "Modo Treino terminou" in log(page)
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)                   # gatilho de FC voltou


def test_treino_nao_suspende_tremor_em_repouso(page):
    iniciar(page)
    responder(page, TABACO)
    page.click("#mon"); page.click("[data-treino='60']")
    cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)


def test_treino_ema_com_confusao_e_sos_continuam(page):
    iniciar(page)
    responder(page, OPIOIDE)
    page.click("#mon")
    expect(page.locator("#sugestaotreino")).to_have_count(0)                      # intenso: sem sugestão, mas pode ativar
    page.click("[data-treino='30']")
    page.click("#checkin")
    page.click("#emacorpo .op[data-v='\"confusao\"']"); page.click("#emacorpo [data-acao=continuar]")
    assert nivel(page) == "vermelho"
    expect(page.locator("#escala")).to_be_visible()
    fechar_escala(page)
    page.click("#voltarajuda")
    page.click("#sos"); page.click("#sosSim")
    expect(page.locator("#escala")).to_be_visible()


def test_treino_bloqueado_para_depressor_agudo(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon")
    expect(page.locator("#treinobloqueado")).to_contain_text("descansar")
    expect(page.locator("#sugestaotreino")).to_have_count(0)
    expect(page.locator("[data-treino]")).to_have_count(0)


# ---------- c) check-in de segurança sem resposta ----------
def test_checkin_sem_resposta_dia_45s(page):
    iniciar(page, DIA)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon"); cenario(page, "crise_repouso")
    al = page.locator("#alerta")
    expect(al).to_be_visible(timeout=10000)
    expect(al).to_have_attribute("data-timeout", "45")
    page.wait_for_timeout(5000); expect(al).to_be_visible()                       # 45 s a 5x = 9 s
    expect(page.locator("#escala")).to_be_visible(timeout=8000)
    assert nivel(page) == "vermelho" and "sem resposta" in log(page)


def test_checkin_sem_resposta_noite_90s(page):
    iniciar(page, NOITE)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon"); cenario(page, "crise_repouso")
    al = page.locator("#alerta")
    expect(al).to_be_visible(timeout=10000)
    expect(al).to_have_attribute("data-timeout", "90")
    page.wait_for_timeout(12000); expect(al).to_be_visible()                      # 90 s a 5x = 18 s
    expect(page.locator("#escala")).to_be_visible(timeout=10000)


def test_crise_de_madrugada_usa_timeout_noturno(page):
    iniciar(page, DIA)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon"); cenario(page, "crise_madrugada")
    expect(page.locator("#alerta")).to_have_attribute("data-timeout", "90", timeout=10000)


def test_preciso_de_ajuda_inicia_protocolo(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon"); cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    page.click("#precisoajuda")
    expect(page.locator("#escala")).to_have_attribute("data-estado", "contagem")


# ---------- e) regimes ----------
def regime_na_tela(page, q12):
    iniciar(page)
    responder(page, {**ALCOOL, "q12": q12, "q6": CONTATO})
    page.click("#mon")
    hud = page.locator("#hud")
    d = {k: hud.get_attribute(f"data-{k}") for k in ["regime", "checkin", "intensidade"]}
    d["alto"] = page.locator("#altorisco").count(); d["dia"] = page.locator("#dia").inner_text()
    page.click("#checkin"); d["ema"] = ema_benigna(page)
    return d


def test_regime_agudo_x_recuperacao(page, navegador):
    a = regime_na_tela(page, "1_3d")
    ctx = navegador.new_context(base_url=BASE); r = regime_na_tela(ctx.new_page(), "mais_1sem"); ctx.close()
    assert (a["regime"], a["intensidade"]) == ("agudo", "intensivo") and (r["regime"], r["intensidade"]) == ("recuperacao", "intenso")
    assert int(a["checkin"]) < int(r["checkin"])
    assert "q20" in a["ema"] and "e_uso" in r["ema"] and "e_sono" in r["ema"] and "q20" not in r["ema"]
    assert a["alto"] == 1 and r["alto"] == 0                                       # "avaliação presencial recomendada" só no agudo
    assert "Dia 1" in a["dia"] and "Recuperação precoce" in r["dia"]


def test_recaida_sozinha_nao_aciona_samu(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q12": "mais_1sem", "q6": CONTATO})
    page.click("#mon"); page.click("#checkin")
    for _ in range(6):
        if page.locator("#ema").is_hidden(): break
        q = page.locator("#emacorpo section[data-q]").get_attribute("data-q")
        if q == "q22": page.click("#emacorpo .op[data-v='9']")                       # fissura alta
        elif q == "e_uso": page.click("#emacorpo .op[data-v='\"sim\"']")            # voltou a usar
        elif q == "e_ferir": page.click("#emacorpo .op[data-v='\"nao\"']")
        else: page.locator("#emacorpo .op").first.click()
    assert nivel_atual(page) == "amarelo"
    expect(page.locator("#escala")).to_be_hidden()


# ---------- f) contraste ----------
def lum(rgb):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contraste(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return (x + 0.05) / (y + 0.05)


PARES_JS = """t => {
  document.body.dataset.tema = t;
  const app = document.getElementById('app');
  app.innerHTML = `<div class=card id=c1>texto <small id=s1>pequeno</small><p class=aviso id=a1>aviso</p>
    <div class=opc><button class=op id=o1>opção</button><button class=op id=o2 aria-pressed=true>marcada</button></div></div>
    <button id=b1>principal</button><button class=sec id=b2>secundário</button>`;
  const cs = id => getComputedStyle(document.getElementById(id)), body = getComputedStyle(document.body);
  const card = cs('c1').backgroundColor;
  return [['texto', body.color, body.backgroundColor], ['card', cs('c1').color, card], ['small', cs('s1').color, card], ['aviso', cs('a1').color, card],
          ['opção', cs('o1').color, card], ['opção marcada', cs('o2').color, cs('o2').backgroundColor],
          ['botão', cs('b1').color, cs('b1').backgroundColor], ['botão sec', cs('b2').color, body.backgroundColor]];
}"""


def rgb(s): return tuple(int(x) for x in re.findall(r"\d+", s)[:3])


def test_contraste_dos_temas(page):
    iniciar(page)
    falhas = []
    for t in ["normal", "taquicardia", "agitacao", "noite", "crise", "poscrise"]:
        page.evaluate("document.body.style.transition='none'")
        for nome, fg, bg in page.evaluate(PARES_JS, t):
            c = contraste(rgb(fg), rgb(bg))
            if c < 4.5: falhas.append(f"{t}/{nome}: {c:.2f}")
    assert not falhas, falhas


def test_contraste_chips_do_painel(page):
    iniciar(page); responder(page, {**VERDE, "q22": 8}); page.click("#painel")
    for chip in page.locator(".chip").all():
        fg, bg = chip.evaluate("e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]")
        assert contraste(rgb(fg), rgb(bg)) >= 4.5


# ---------- g) "Hoje e nos próximos dias" ----------
def test_cartao_alcool_24h_x_tabaco(page, navegador):
    iniciar(page); responder(page, {**ALCOOL, "q12": "6_24h", "q6": CONTATO})
    a = page.locator("#orientacao")
    expect(a).to_have_attribute("data-itens", "dep_0_24")
    expect(page.locator("#procure")).to_contain_text("Convulsão")
    expect(page.locator("#procure [data-acao=ligar192]")).to_be_visible()
    expect(a).to_contain_text("cada pessoa reage de um jeito")
    ctx = navegador.new_context(base_url=BASE); p2 = ctx.new_page()
    iniciar(p2); responder(p2, TABACO)
    expect(p2.locator("#orientacao")).to_have_attribute("data-itens", "tab_0_72")
    expect(p2.locator("#procure")).to_be_visible()
    expect(p2.locator("#orientacao")).not_to_contain_text("Convulsão")
    ctx.close()


def test_cartao_muda_com_a_fase(page):
    iniciar(page); responder(page, {**ALCOOL, "q12": "6_24h", "q6": CONTATO})
    page.click("#mon")
    expect(page.locator("#orientacao")).to_have_attribute("data-itens", "dep_0_24")
    page.click("#demo summary"); page.click("#avancardia")
    expect(page.locator("#orientacao")).to_have_attribute("data-itens", "dep_24_168", timeout=3000)
    expect(page.locator("#procure")).to_be_visible()
    assert "Nova fase" in log(page)


def test_cartao_adapta_ao_observado(page):
    iniciar(page); responder(page, {**TABACO, "q21": "pouco", "q22": 8})
    expect(page.locator("[data-adapt=sono_ruim]")).to_be_visible()
    expect(page.locator("[data-adapt=fissura_alta]")).to_be_visible()
    expect(page.locator("[data-adapt=amarelo]")).to_be_visible()


def test_cartao_substancia_mista_maior_risco_primeiro(page):
    iniciar(page)
    responder(page, {**VERDE, "q7": ["tabaco", "alcool"], "q12": "6_24h", "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"], "q6": CONTATO})
    expect(page.locator("#orientacao")).to_have_attribute("data-itens", "dep_0_24,tab_0_72")
    expect(page.locator("#procure li").first).to_contain_text("Convulsão")


VIBRANTES_JS = """() => {
  const ruim = [];
  const hsl = s => { const m = s.match(/\\d+(\\.\\d+)?/g); if (!m) return null; const [r,g,b,a] = m.map(Number); if (a === 0) return null;
    const R=r/255,G=g/255,B=b/255, mx=Math.max(R,G,B), mn=Math.min(R,G,B), l=(mx+mn)/2, d=mx-mn;
    if (!d) return null; const sat = d/(1-Math.abs(2*l-1)); let h = mx===R ? ((G-B)/d)%6 : mx===G ? (B-R)/d+2 : (R-G)/d+4; h = (h*60+360)%360; return {h, s:sat, l}; };
  const vib = c => c && c.s > .7 && c.l > .35 && c.l < .65 && (c.h <= 10 || c.h >= 350 || (c.h >= 45 && c.h <= 62));
  for (const e of document.querySelectorAll('#app *, #barra *, #alerta *, #escala *, #ema *')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    const cs = getComputedStyle(e);
    for (const p of ['color', 'backgroundColor', 'borderTopColor']) if (vib(hsl(cs[p]))) ruim.push(e.tagName + '#' + e.id + ' ' + p + ' ' + cs[p]);
  }
  return ruim;
}"""


def test_paciente_nunca_ve_vermelho_ou_amarelo_vibrante(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q22": 8, "q6": CONTATO})
    page.evaluate("document.body.style.transition='none'")
    telas = []
    telas.append(page.evaluate(VIBRANTES_JS))                                     # resultado amarelo
    page.click("#mon"); telas.append(page.evaluate(VIBRANTES_JS))                # acompanhamento
    cenario(page, "crise_repouso"); expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    telas.append(page.evaluate(VIBRANTES_JS))                                     # check-in de segurança
    page.click("#precisoajuda"); telas.append(page.evaluate(VIBRANTES_JS))       # escalonamento
    fechar_escala(page); telas.append(page.evaluate(VIBRANTES_JS))               # tela vermelha
    assert not [x for t in telas for x in t], telas


# ---------- monitoramento contínuo ----------
def test_monitoramento_60s_com_ema_e_so_para_no_parar(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon")
    t0 = time.time()
    page.click("#checkin")
    n1 = leituras(page); page.wait_for_timeout(1000)
    assert leituras(page) > n1                                                    # EMA não para o monitoramento
    ema_benigna(page)
    page.click("#verres"); page.click("#mon")
    while time.time() - t0 < 60:
        if page.locator("#ema").is_visible(): ema_benigna(page)
        page.wait_for_timeout(500)
    assert ativo(page)
    if page.locator("#ema").is_visible(): ema_benigna(page)
    page.click("#parar"); expect(page.locator("#parconf")).to_be_visible()
    page.click("#parNao"); assert ativo(page)
    page.click("#parar"); page.click("#parSim")
    assert not ativo(page)
    n = leituras(page); page.wait_for_timeout(500); assert leituras(page) == n


def test_offline_guarda_e_envia_ao_reconectar(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#mon"); page.click("#demo summary")
    page.click("[data-con=offline]"); page.wait_for_timeout(800)
    expect(page.locator("#buf")).to_contain_text("guardadas")
    page.click("[data-con=dados]"); page.wait_for_timeout(300)
    expect(page.locator("#buf")).to_contain_text("foram enviadas")


# ---------- sessão persistente ----------
def test_recarregar_preserva_e_encerrar_apaga(page):
    iniciar(page, salvar=True)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.reload(); assert nivel(page) == "verde"
    page.click("#mon"); page.reload()
    expect(page.locator("#hud")).to_be_visible()
    n = leituras(page); page.wait_for_timeout(500); assert leituras(page) > n
    page.click("#encerrar"); page.click("#encerrarok")
    expect(page.locator("#encerrada")).to_be_visible()
    assert page.evaluate("localStorage.getItem('pulso_v2')") is None and not ativo(page)
    page.reload(); expect(page.locator("#aceito")).to_be_visible()


def test_sem_consentimento_nada_salvo(page):
    iniciar(page)
    page.click(".op[data-v='\"30_44\"']")
    assert page.evaluate("localStorage.getItem('pulso_v2')") is None


def test_localstorage_quebrado(page):
    page.add_init_script("Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('bloqueado'); };")
    iniciar(page, salvar=True)
    responder(page, VERDE)
    assert nivel(page) == "verde"


# ---------- perfil álcool x tabaco ----------
def test_perfil_alcool_x_tabaco(page, navegador):
    def ver(pg, resp):
        iniciar(pg); responder(pg, resp); pg.click("#mon")
        hud = pg.locator("#hud")
        d = {k: hud.get_attribute(f"data-{k}") for k in ["perfil", "intensidade", "checkin", "risco-vital"]}
        d["texto"] = pg.locator("#app").text_content(); pg.click("#checkin"); d["ema"] = ema_benigna(pg)
        return d
    a = ver(page, {**ALCOOL, "q6": CONTATO})
    ctx = navegador.new_context(base_url=BASE); t = ver(ctx.new_page(), TABACO); ctx.close()
    assert (a["perfil"], a["intensidade"], a["risco-vital"]) == ("depressores", "intensivo", "true")
    assert (t["perfil"], t["intensidade"], t["risco-vital"]) == ("tabaco", "leve", "false")
    assert int(a["checkin"]) < int(t["checkin"]) and "q20" in a["ema"] and t["ema"] == ["q22", "e_sono", "e_humor"]
    assert "parando o álcool" in a["texto"] and "tremor" in a["texto"] and "parando o cigarro" in t["texto"] and "convulsão" not in t["texto"].lower()


# ---------- SOS ----------
def test_sos_pede_confirmacao_e_cancela(page):
    iniciar(page); responder(page, VERDE)
    page.click("#sos"); expect(page.locator("#sosconf")).to_be_visible()
    page.click("#sosNao"); expect(page.locator("#sos")).to_be_visible()
    assert nivel(page) == "verde"


def test_sos_localizacao_so_com_consentimento_e_voltar(page):
    iniciar(page); responder(page, {**VERDE, "q6": CONTATO})
    page.click("#mon")
    page.click("#sos"); page.click("#sosSim")
    expect(page.locator("#tl-contato")).not_to_contain_text("-23.55")             # sem consentimento: sem localização
    fechar_escala(page)
    expect(page.locator("#loc")).to_have_count(0)
    page.click("#locsim"); expect(page.locator("#loc")).to_contain_text("-23.55")
    page.click("#voltarajuda"); expect(page.locator("#hud")).to_be_visible(); assert ativo(page)


def test_consentimento_previo_de_localizacao_vai_na_telemetria(page):
    iniciar(page); responder(page, {**VERDE, "q6": CONTATO})
    page.click("#mon"); page.check("#locprevia")
    page.click("#sos"); page.click("#sosSim")
    expect(page.locator("#tl-contato")).to_contain_text("-23.55")


# ---------- f) ausente nunca verde ----------
@pytest.mark.parametrize("q", ["q7", "q12", "q20", "q22", "q28", "q29", "q32"])
def test_ausente_nunca_verde(page, q):
    iniciar(page)
    responder(page, {k: x for k, x in VERDE.items() if k != q})
    assert nivel(page) == "amarelo"
    expect(page.locator("#porque")).to_contain_text("Dados incompletos")


# ---------- outros ----------
def test_revisao_profissional_pode_baixar(page):
    iniciar(page); responder(page, {**VERDE, "q22": 8})
    page.click("#painel")
    page.select_option("#profnivel", "verde"); page.fill("#profobs", "Fissura conversada")
    page.click("#profok"); page.click("#voltar")
    assert nivel(page) == "verde"
    expect(page.locator("#revisao")).to_have_attribute("data-status", "revisado")


def test_resumo_clinico(page):
    iniciar(page); responder(page, {**ALCOOL, "q22": 8})
    page.click("#resumo")
    d = json.loads(page.locator("#json").inner_text())
    assert d["status_revisao"] == "pendente" and d["perfil"]["classe"] == "depressores" and d["perfil"]["regime"] == "agudo"


def test_tabela_de_custos_calcula_total(page):
    page.goto("/docs/pulseira-custos.html")
    expect(page.locator("#total")).to_have_text("R$ 250,00")                     # só a premissa (b) preenchida
    page.uncheck("[data-incluir='2']")                                            # pulseira sem dados próprios
    expect(page.locator("#total")).to_have_text("R$ 0,00")
    page.check("[data-incluir='2']")
    page.fill("[data-i='0'][data-k=unico]", "600"); page.fill("[data-i='0'][data-k=vida]", "24")
    expect(page.locator("#total")).to_have_text("R$ 275,00")


@pytest.mark.parametrize("resp,esperado", [(VERDE, 16), (ALCOOL, 19), (TABACO, 15), (PIOR, 23)],
                         ids=["tipico-estimulante", "tipico-alcool", "tabaco", "pior-caso"])
def test_contagem(page, resp, esperado):
    iniciar(page)
    assert len(responder(page, resp)) == esperado
