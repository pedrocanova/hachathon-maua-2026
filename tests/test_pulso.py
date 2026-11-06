"""Testes Playwright (Python) do protótipo Pulso, em viewport de celular (360x640).
Rodar:  python -m pytest tests  (usa o Edge instalado; PW_CHANNEL=chromium para o Chromium do Playwright)
Os testes usam ?rapido (60x; contagens curtas no máximo 5x) e ?hora=14 (dia) para serem determinísticos.
"""
import json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright, expect

RAIZ = Path(__file__).resolve().parent.parent
PORTA = 8123
BASE = f"http://localhost:{PORTA}"
DIA = "/?rapido&hora=14"
NOITE = "/?rapido&hora=23"
CELULAR = {"width": 360, "height": 640}
CONTATO = {"nome": "Ana", "tel": "11987654321"}
ABAS = ["inicio", "pulseira", "respirar", "hoje", "apoio"]

VERDE = dict(q1="30_44", q2="masculino", q6=CONTATO, q7=["cocaina"], q12="mais_1sem", q13=["cheira"], q16="nao", q17="nao",
             q20=["nenhum"], q21="normal", q22=2, q26=0, q27=0, q28="nao", q29="nao", q32="nao")
ALCOOL = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["alcool"], "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"], "q12": "1_3d"}
TABACO = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["tabaco"], "q12": "1_3d", "q22": 3}
OPIOIDE = {**VERDE, "q7": ["opioides"], "q13": ["comprimido"], "q14": "nao", "q12": "1_3d"}
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


def nova_pagina(navegador):
    ctx = navegador.new_context(base_url=BASE, viewport=CELULAR)
    return ctx, ctx.new_page()


@pytest.fixture
def page(navegador):
    ctx, pg = nova_pagina(navegador)
    erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    yield pg
    ctx.close()
    assert not erros, erros


def v(x): return json.dumps(x, ensure_ascii=False)


def iniciar(page, url=DIA, salvar=False):
    page.goto(url)
    if salvar: page.check("#salvar")
    page.click("#aceito")


def responder(page, resp, ate=None):
    """Responde perguntas até chegar a uma tela com #nivel (ou até a pergunta `ate`). Sem resposta no mapa = 'Prefiro não responder'."""
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


def aba(page, k): page.click(f"#nav [data-aba={k}]")


def monitorar(page):
    aba(page, "pulseira"); page.click("#mon"); expect(page.locator("#parar")).to_be_visible()


def demo(page):
    page.click("#engrenagem"); page.click("#abrirdemo")


def cenario(page, c):
    demo(page); page.click(f"[data-c={c}]")


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


def nivel(page): return page.locator("#app #nivel").get_attribute("data-nivel")
def nivel_atual(page): return page.evaluate("S.nivel")
def leituras(page): return page.evaluate("Pulseira.n")
def ativo(page): return page.evaluate("S.pul.ativo && !!Pulseira.timer")
def log(page): return page.evaluate("S.log.map(l => l.motivo).join(' | ')")


# ---------- perguntas do documento ----------
def test_q20_igual_ao_documento_e_q16_nao_pula_24h(page):
    iniciar(page)
    vistas = responder(page, VERDE, ate="q20")
    assert "q16_24h" not in vistas
    for fora in ["convulsao_hoje", "respiracao"]:
        expect(page.locator(f".op[data-v='\"{fora}\"']")).to_have_count(0)
    for crit in ["confusao", "alucinacao", "febre"]:
        expect(page.locator(f".op[data-v='\"{crit}\"']")).to_have_count(1)


def test_q16_sim_pergunta_24h(page):
    iniciar(page)
    vistas = responder(page, {**VERDE, "q16": "sim", "q16_24h": "sim"})
    assert vistas[-1] == "q16_24h" and nivel(page) == "vermelho"


def test_q16_sem_resposta_pergunta_24h(page):
    iniciar(page)
    vistas = responder(page, {k: x for k, x in VERDE.items() if k != "q16"})
    assert "q16_24h" in vistas


def test_sem_contato_de_confianca_e_alerta(page):
    iniciar(page); responder(page, {**VERDE, "q6": "nao"})
    assert nivel(page) == "amarelo"
    expect(page.locator("#porque")).to_contain_text("Sem contato de confiança")


def test_desintoxicacao_domiciliar_nao_indicada(page):
    iniciar(page); responder(page, {**ALCOOL, "q14": "sim"})
    expect(page.locator("#presencial")).to_contain_text("não é indicado")


# ---------- vermelho na triagem: nunca liga sozinho para o 192 ----------
@pytest.mark.parametrize("extra,ultima,suicidio", [
    ({"q29": "sim", "q30": "sim"}, "q30", True),
    ({"q29": "sim", "q30": "nao", "q31": "sim"}, "q31", True),
    ({"q32": "sim"}, "q32", True),
    ({"q20": ["alucinacao"]}, "q20", False),
    ({"q16": "sim", "q16_24h": "sim"}, "q16_24h", False),
], ids=["Q30", "Q31", "Q32", "Q20-vendo-coisas", "convulsao-24h"])
def test_vermelho_da_triagem_sem_ligacao_automatica(page, extra, ultima, suicidio):
    iniciar(page)
    vistas = responder(page, {**VERDE, **extra})
    assert vistas[-1] == ultima and nivel(page) == "vermelho"
    page.wait_for_timeout(5000)                                                    # antes: 20 s a 5x = 4 s e ligava
    expect(page.locator("#escala")).to_be_hidden()
    assert "Ligação ao SAMU 192 (simulada" not in log(page)
    expect(page.locator("#av-caps")).to_have_class("feito")
    expect(page.locator("#av-192")).to_contain_text("só é chamado se você tocar")
    page.click("#avisar"); expect(page.locator("#av-contato")).to_have_class("feito")   # contato: oferecido, não automático
    expect(page.locator("#av-contato")).not_to_contain_text("11987654321")
    expect(page.locator("#upa")).to_be_visible()
    expect(page.locator("#cvv")).to_have_count(1 if suicidio else 0)
    expect(page.locator("#nav")).to_be_hidden()
    expect(page.locator("body")).to_have_attribute("data-tema", "crise")
    page.click("#samu"); expect(page.locator("#escala")).to_have_attribute("data-estado", "confirmar")  # só com confirmação
    page.click("#fecharescala"); expect(page.locator("#escala")).to_be_hidden()


def test_toquei_errado_volta_a_pergunta(page):
    iniciar(page)
    responder(page, {**VERDE, "q20": ["alucinacao"]})
    page.click("#corrigirresp")
    expect(page.locator("#app section[data-q]")).to_have_attribute("data-q", "q20")
    assert nivel_atual(page) is None and "Corrigiu a resposta" in log(page)
    responder(page, VERDE)
    assert nivel(page) == "verde"


def test_continuar_as_perguntas_depois_do_vermelho(page):
    iniciar(page)
    responder(page, {**VERDE, "q20": ["confusao"]})
    page.click("#continuartriagem")
    vistas = responder(page, {**VERDE, "q29": "sim", "q30": "sim"})
    assert "q28" in vistas and "q30" in vistas                                    # bloco 6 ainda é perguntado
    assert nivel(page) == "vermelho"
    expect(page.locator("#cvv")).to_have_count(1)                                 # novo vermelho (suicídio) abre a tela de ajuda


# ---------- escalonamento por origem ----------
def test_timeout_inicia_contagem_com_contato_e_cancelar(page):
    iniciar(page); responder(page, ALCOOL)
    monitorar(page); cenario(page, "crise_repouso")
    al = page.locator("#alerta")
    expect(al).to_be_visible(timeout=10000)
    expect(al).to_have_attribute("data-timeout", "45")
    page.wait_for_timeout(5000); expect(al).to_be_visible()                       # 45 s a 5x = 9 s
    esc = page.locator("#escala")
    expect(esc).to_have_attribute("data-estado", "contagem", timeout=8000)
    assert nivel_atual(page) == "vermelho" and "sem resposta" in log(page)
    expect(page.locator("#tl-contato")).to_have_class("feito")                     # sem resposta: contato avisado na hora
    expect(page.locator("#tl-contato")).to_contain_text("Ana"); expect(page.locator("#tl-contato")).not_to_contain_text("11987654321")
    expect(page.locator("#tl-192")).to_have_class("pendente")
    page.click("#cancelarligacao")
    expect(esc).to_have_attribute("data-estado", "cancelada")
    page.wait_for_timeout(5000)
    expect(esc).to_have_attribute("data-estado", "cancelada")
    assert "Ligação ao SAMU 192 (simulada" not in log(page)


def test_timeout_noturno_90s_liga_ao_fim_da_contagem(page):
    iniciar(page, NOITE); responder(page, ALCOOL)
    monitorar(page); cenario(page, "crise_repouso")
    al = page.locator("#alerta")
    expect(al).to_have_attribute("data-timeout", "90", timeout=10000)
    page.wait_for_timeout(12000); expect(al).to_be_visible()                      # 90 s a 5x = 18 s
    expect(page.locator("#escala")).to_have_attribute("data-estado", "ligando", timeout=16000)
    expect(page.locator("#escala")).to_contain_text("Ligando para o SAMU 192")


def test_crise_de_madrugada_usa_timeout_noturno(page):
    iniciar(page, DIA); responder(page, ALCOOL)
    monitorar(page); cenario(page, "crise_madrugada")
    expect(page.locator("#alerta")).to_have_attribute("data-timeout", "90", timeout=10000)


def test_preciso_de_ajuda_avisa_contato_sem_contagem(page):
    iniciar(page); responder(page, ALCOOL)
    monitorar(page); cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    page.click("#precisoajuda")
    expect(page.locator("#av-contato")).to_have_class("feito")
    expect(page.locator("#escala")).to_be_hidden()


# ---------- filtro por atividade ----------
def test_corrida_nao_gera_alerta(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); cenario(page, "corrida")
    page.wait_for_timeout(4000)
    expect(page.locator("#alerta")).to_be_hidden()
    assert "considerado exercício" in log(page)


@pytest.mark.parametrize("c,palavra", [("crise_veiculo", "veículo"), ("crise_repouso", "Check-in de segurança")])
def test_crise_em_veiculo_e_repouso_geram_alerta(page, c, palavra):
    iniciar(page); responder(page, VERDE)
    monitorar(page); cenario(page, c)
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    assert palavra in log(page)


def test_queda_fc_dispara_check_in(page):
    iniciar(page); responder(page, ALCOOL)
    monitorar(page); page.wait_for_timeout(800); cenario(page, "recaida")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)


def test_estou_bem_silencia(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    page.click("#estoubem")
    page.wait_for_timeout(3000)
    expect(page.locator("#alerta")).to_be_hidden()
    assert "silenciados" in log(page) and nivel_atual(page) != "vermelho"


# ---------- Modo Treino ----------
def test_treino_suspende_so_fc_e_reativa_sozinho(page):
    iniciar(page); responder(page, TABACO)
    monitorar(page); aba(page, "inicio")
    expect(page.locator("#sugestaotreino")).to_be_visible()
    page.click("[data-treino='30']")
    expect(page.locator("#treinost")).to_be_visible()
    cenario(page, "academia")
    page.wait_for_timeout(3000)
    expect(page.locator("#alerta")).to_be_hidden()
    assert "gatilho de FC suspenso" in log(page)
    for _ in range(3): page.click("#avancar15")                                    # 30 min + 15 de tolerância
    page.wait_for_function("S.pul.treino === null", timeout=3000)
    assert "Modo Treino terminou" in log(page)
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)


def test_treino_nao_suspende_tremor_em_repouso(page):
    iniciar(page); responder(page, TABACO)
    monitorar(page); aba(page, "inicio"); page.click("[data-treino='60']")
    cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)


def test_treino_ema_com_confusao_e_sos_continuam(page):
    iniciar(page); responder(page, OPIOIDE)
    monitorar(page); aba(page, "inicio")
    expect(page.locator("#sugestaotreino")).to_have_count(0)
    page.click("[data-treino='30']")
    page.click("#checkin")
    page.click("#emacorpo .op[data-v='\"confusao\"']"); page.click("#emacorpo [data-acao=continuar]")
    assert nivel(page) == "vermelho"
    expect(page.locator("#escala")).to_be_hidden()                                # check-in respondido: sem ligação automática
    page.click("#voltarajuda")
    page.click("#sos"); page.click("#sosSim")
    expect(page.locator("#av-contato")).to_have_class("feito")                     # SOS: contato avisado na hora


def test_treino_bloqueado_para_depressor_agudo(page):
    iniciar(page); responder(page, ALCOOL)
    expect(page.locator("#treinobloqueado")).to_contain_text("descansar")
    expect(page.locator("#sugestaotreino")).to_have_count(0)
    expect(page.locator("[data-treino]")).to_have_count(0)


# ---------- regimes ----------
def regime_na_tela(page, q12):
    iniciar(page); responder(page, {**ALCOOL, "q12": q12})
    monitorar(page)
    hud = page.locator("#hud")
    d = {k: hud.get_attribute(f"data-{k}") for k in ["regime", "checkin", "intensidade"]}
    aba(page, "inicio")
    d["alto"] = page.locator("#altorisco").count(); d["dia"] = page.locator("#dia").inner_text()
    page.click("#checkin"); d["ema"] = ema_benigna(page)
    return d


def test_regime_agudo_x_recuperacao(page, navegador):
    a = regime_na_tela(page, "1_3d")
    ctx, p2 = nova_pagina(navegador); r = regime_na_tela(p2, "mais_1sem"); ctx.close()
    assert (a["regime"], a["intensidade"]) == ("agudo", "intensivo") and (r["regime"], r["intensidade"]) == ("recuperacao", "intenso")
    assert int(a["checkin"]) < int(r["checkin"])
    assert "q20" in a["ema"] and "e_uso" in r["ema"] and "e_sono" in r["ema"] and "q20" not in r["ema"]
    assert a["alto"] == 1 and r["alto"] == 0
    assert "Dia 1" in a["dia"] and "Recuperação precoce" in r["dia"]


def test_recaida_sozinha_nao_aciona_samu(page):
    iniciar(page); responder(page, {**ALCOOL, "q12": "mais_1sem"})
    page.click("#checkin")
    for _ in range(6):
        if page.locator("#ema").is_hidden(): break
        q = page.locator("#emacorpo section[data-q]").get_attribute("data-q")
        if q == "q22": page.click("#emacorpo .op[data-v='9']")
        elif q == "e_uso": page.click("#emacorpo .op[data-v='\"sim\"']")
        elif q == "e_ferir": page.click("#emacorpo .op[data-v='\"nao\"']")
        else: page.locator("#emacorpo .op").first.click()
    assert nivel_atual(page) == "amarelo"
    expect(page.locator("#escala")).to_be_hidden()
    expect(page.locator("#acolheema")).to_contain_text("Isso não apaga o que você já fez")   # acolher primeiro
    page.click("#agoranao"); expect(page.locator("#acolheamarelo")).to_contain_text("não é motivo de culpa")


# ---------- a/b) último uso: uma pergunta, carimbo, "Usei de novo", "Corrigir data" ----------
def test_ultimo_uso_perguntado_uma_vez(page):
    iniciar(page)
    nucleo = responder(page, VERDE)
    page.click("#comp")
    comp = responder(page, {})
    todas = nucleo + comp
    assert todas.count("q12") == 1 and "q35" not in todas and "q35_dias" not in todas
    textos = page.evaluate("R.triagem.filter(q => !q._removida).map(q => q.texto.toLowerCase())")
    assert sum(("última vez que você usou" in t) or ("parou de usar e está tentando" in t) for t in textos) == 1


def test_tempo_sem_usar_recarregar_abas_usei_e_corrigir(page):
    iniciar(page, salvar=True)
    responder(page, {**ALCOOL, "q12": "4_7d"})                                    # faixa 4-7 dias: carimbo em 132 h
    iso = page.evaluate("S.ultimoUso.iso")
    assert page.evaluate("S.ultimoUso.faixa") == "4_7d"
    expect(page.locator("#semuso")).to_contain_text("5 dias e 12 horas sem usar")
    aba(page, "hoje"); aba(page, "inicio")
    expect(page.locator("#semuso")).to_contain_text("5 dias")
    page.reload()
    assert page.evaluate("S.ultimoUso.iso") == iso                                # o carimbo não muda; o tempo é sempre agora − carimbo
    expect(page.locator("#semuso")).to_contain_text("5 dias e 12")
    page.click("#useidenovo"); page.click("#usosim")
    expect(page.locator("#acolhe")).to_be_visible()
    assert "usou de novo" in log(page) and nivel_atual(page) != "vermelho"
    page.click("#voltarinicio")
    expect(page.locator("#semuso")).to_contain_text("0 dias e 0 horas")
    assert page.evaluate("perfil().regime.id") == "agudo"
    page.click("#corrigiruso")
    page.fill("#ajn", "10"); page.select_option("#aju", "dias"); page.click("#app .op[data-v='\"mais_1sem\"']")
    expect(page.locator("#semuso")).to_contain_text("10 dias")
    assert page.evaluate("perfil().regime.id") == "recuperacao"
    expect(page.locator("#dia")).to_contain_text("Recuperação precoce")


def test_usei_de_novo_opioide_avisa_tolerancia_sem_vermelho(page):
    iniciar(page); responder(page, {**OPIOIDE, "q12": "mais_1sem"})
    page.click("#useidenovo"); page.click("#usosim")
    expect(page.locator("#tolerancia")).to_contain_text("overdose")
    assert nivel_atual(page) == "amarelo"


def test_ultimo_uso_nao_informado_nunca_verde_e_informar_depois(page):
    iniciar(page); responder(page, {k: x for k, x in VERDE.items() if k != "q12"})
    assert nivel(page) == "amarelo"
    expect(page.locator("#semuso")).to_have_text("Último uso não informado")
    page.click("#corrigiruso"); page.click("#app .op[data-v='\"1_3d\"']")
    expect(page.locator("#semuso")).to_contain_text("2 dias")


# ---------- c/d/e) navegação por abas ----------
def test_abas_sem_rolagem_horizontal_uma_acao_principal_e_sos(page):
    iniciar(page); responder(page, VERDE)
    for k in ABAS + ["dados"]:
        page.click("#engrenagem") if k == "dados" else aba(page, k)
        assert page.evaluate("document.documentElement.scrollWidth") <= 360, k
        expect(page.locator("#sos")).to_be_visible()
        assert page.locator("#app .big:not(.sec)").count() <= 1, k
    expect(page.locator("#nav button")).to_have_count(5)


def test_monitoramento_continua_ao_trocar_de_aba(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); n0 = leituras(page)
    for k in ABAS: aba(page, k); page.wait_for_timeout(300)
    page.click("#engrenagem"); page.wait_for_timeout(300)
    aba(page, "pulseira")
    assert ativo(page) and leituras(page) > n0
    expect(page.locator("#parar")).to_be_visible(); expect(page.locator("#pulsestado")).to_have_text("Monitorando")


def test_alerta_cobre_navegacao_e_volta_para_aba_anterior(page):
    iniciar(page); responder(page, VERDE)
    aba(page, "hoje")
    page.click("#sos"); page.click("#sosSim")
    assert nivel(page) == "vermelho"
    expect(page.locator("#nav")).to_be_hidden(); expect(page.locator("#sos")).to_be_visible()
    page.click("#voltarajuda")
    expect(page.locator("#nav")).to_be_visible()
    expect(page.locator("#nav [data-aba=hoje]")).to_have_attribute("aria-current", "page")
    expect(page.locator("#orientacao")).to_be_visible()


def test_checkin_cobre_navegacao(page):
    iniciar(page); responder(page, VERDE)
    page.click("#checkin")
    expect(page.locator("#nav")).to_be_hidden()
    ema_benigna(page)
    expect(page.locator("#nav")).to_be_visible()


# ---------- contraste ----------
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
    iniciar(page); responder(page, {**VERDE, "q22": 8}); demo(page); page.click("#painel")
    for chip in page.locator(".chip").all():
        fg, bg = chip.evaluate("e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]")
        assert contraste(rgb(fg), rgb(bg)) >= 4.5


# ---------- "Hoje e nos próximos dias" ----------
def test_cartao_alcool_24h_x_tabaco(page, navegador):
    iniciar(page); responder(page, {**ALCOOL, "q12": "6_24h"}); aba(page, "hoje")
    a = page.locator("#orientacao")
    expect(a).to_have_attribute("data-itens", "dep_0_24")
    expect(page.locator("#procure")).to_contain_text("Convulsão")
    expect(page.locator("#procure [data-acao=ligar192]")).to_be_visible()
    expect(a).to_contain_text("cada pessoa reage de um jeito")
    ctx, p2 = nova_pagina(navegador)
    iniciar(p2); responder(p2, TABACO); aba(p2, "hoje")
    expect(p2.locator("#orientacao")).to_have_attribute("data-itens", "tab_0_72")
    expect(p2.locator("#procure")).to_be_visible()
    expect(p2.locator("#orientacao")).not_to_contain_text("Convulsão")
    ctx.close()


def test_cartao_muda_com_a_fase(page):
    iniciar(page); responder(page, {**ALCOOL, "q12": "6_24h"})
    monitorar(page); aba(page, "hoje")
    expect(page.locator("#orientacao")).to_have_attribute("data-itens", "dep_0_24")
    demo(page); page.click("#avancardia"); page.wait_for_timeout(500)
    if page.locator("#ema").is_visible(): ema_benigna(page)                       # 1 dia depois, o check-in vence e cobre a navegação
    aba(page, "hoje")
    expect(page.locator("#orientacao")).to_have_attribute("data-itens", "dep_24_168", timeout=3000)
    expect(page.locator("#procure")).to_be_visible()
    assert "Nova fase" in log(page)


def test_cartao_adapta_ao_observado(page):
    iniciar(page); responder(page, {**TABACO, "q21": "pouco", "q22": 8}); aba(page, "hoje")
    for k in ["sono_ruim", "fissura_alta", "amarelo"]: expect(page.locator(f"[data-adapt={k}]")).to_be_visible()


def test_cartao_substancia_mista_maior_risco_primeiro(page):
    iniciar(page)
    responder(page, {**VERDE, "q7": ["tabaco", "alcool"], "q12": "6_24h", "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"]})
    aba(page, "hoje")
    expect(page.locator("#orientacao")).to_have_attribute("data-itens", "dep_0_24,tab_0_72")
    expect(page.locator("#procure li").first).to_contain_text("Convulsão")


VIBRANTES_JS = """() => {
  const ruim = [];
  const hsl = s => { const m = s.match(/\\d+(\\.\\d+)?/g); if (!m) return null; const [r,g,b,a] = m.map(Number); if (a === 0) return null;
    const R=r/255,G=g/255,B=b/255, mx=Math.max(R,G,B), mn=Math.min(R,G,B), l=(mx+mn)/2, d=mx-mn;
    if (!d) return null; const sat = d/(1-Math.abs(2*l-1)); let h = mx===R ? ((G-B)/d)%6 : mx===G ? (B-R)/d+2 : (R-G)/d+4; h = (h*60+360)%360; return {h, s:sat, l}; };
  const vib = c => c && c.s > .7 && c.l > .35 && c.l < .65 && (c.h <= 10 || c.h >= 350 || (c.h >= 45 && c.h <= 62));
  for (const e of document.querySelectorAll('#app *, #topo *, #nav *, #alerta *, #escala *, #ema *')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    const cs = getComputedStyle(e);
    for (const p of ['color', 'backgroundColor', 'borderTopColor']) if (vib(hsl(cs[p]))) ruim.push(e.tagName + '#' + e.id + ' ' + p + ' ' + cs[p]);
  }
  return ruim;
}"""


def test_paciente_nunca_ve_vermelho_ou_amarelo_vibrante(page):
    iniciar(page); responder(page, {**ALCOOL, "q22": 8})
    page.evaluate("document.body.style.transition='none'")
    telas = []
    for k in ABAS: aba(page, k); telas.append(page.evaluate(VIBRANTES_JS))
    monitorar(page); cenario(page, "crise_repouso"); expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    telas.append(page.evaluate(VIBRANTES_JS))
    page.click("#precisoajuda"); telas.append(page.evaluate(VIBRANTES_JS))
    page.click("#samu"); telas.append(page.evaluate(VIBRANTES_JS))
    assert not [x for t in telas for x in t], telas


# ---------- monitoramento contínuo ----------
def test_monitoramento_60s_com_ema_e_so_para_no_parar(page):
    iniciar(page); responder(page, ALCOOL)
    monitorar(page); aba(page, "inicio")
    t0 = time.time()
    page.click("#checkin")
    n1 = leituras(page); page.wait_for_timeout(1000)
    assert leituras(page) > n1
    ema_benigna(page)
    i = 0
    while time.time() - t0 < 60:
        if page.locator("#ema").is_visible(): ema_benigna(page)
        else: aba(page, ABAS[i % 5]); i += 1
        page.wait_for_timeout(500)
    assert ativo(page)
    if page.locator("#ema").is_visible(): ema_benigna(page)
    aba(page, "pulseira")
    page.click("#parar"); expect(page.locator("#parconf")).to_be_visible()
    page.click("#parNao"); assert ativo(page)
    page.click("#parar"); page.click("#parSim")
    assert not ativo(page)
    n = leituras(page); page.wait_for_timeout(500); assert leituras(page) == n


def test_offline_guarda_e_envia_ao_reconectar(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); demo(page)
    page.click("[data-con=offline]"); page.wait_for_timeout(800)
    aba(page, "pulseira"); expect(page.locator("#buf")).to_contain_text("guardadas")
    demo(page); page.click("[data-con=dados]"); page.wait_for_timeout(300)
    aba(page, "pulseira"); expect(page.locator("#buf")).to_contain_text("foram enviadas")


# ---------- sessão persistente ----------
def test_recarregar_preserva_e_encerrar_apaga(page):
    iniciar(page, salvar=True); responder(page, ALCOOL)
    page.reload(); assert nivel(page) == "verde"
    monitorar(page); page.reload()
    expect(page.locator("#hud")).to_be_visible()
    n = leituras(page); page.wait_for_timeout(500); assert leituras(page) > n
    page.click("#engrenagem"); page.click("#encerrar"); page.click("#encerrarok")
    expect(page.locator("#encerrada")).to_be_visible()
    assert page.evaluate("localStorage.getItem('pulso_v2')") is None and not ativo(page)
    page.reload(); expect(page.locator("#aceito")).to_be_visible()


def test_sem_consentimento_nada_salvo(page):
    iniciar(page)
    page.click(".op[data-v='\"30_44\"']")
    assert page.evaluate("localStorage.getItem('pulso_v2')") is None


def test_localstorage_quebrado(page):
    page.add_init_script("Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('bloqueado'); };")
    iniciar(page, salvar=True); responder(page, VERDE)
    assert nivel(page) == "verde"


# ---------- perfil álcool x tabaco ----------
def test_perfil_alcool_x_tabaco(page, navegador):
    def ver(pg, resp):
        iniciar(pg); responder(pg, resp); monitorar(pg)
        hud = pg.locator("#hud")
        d = {k: hud.get_attribute(f"data-{k}") for k in ["perfil", "intensidade", "checkin", "risco-vital"]}
        aba(pg, "hoje"); d["texto"] = pg.locator("#app").text_content()
        aba(pg, "inicio"); d["texto"] += pg.locator("#perfil").text_content()
        pg.click("#checkin"); d["ema"] = ema_benigna(pg)
        return d
    a = ver(page, ALCOOL)
    ctx, p2 = nova_pagina(navegador); t = ver(p2, TABACO); ctx.close()
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
    iniciar(page); responder(page, VERDE)
    monitorar(page)
    page.click("#sos"); page.click("#sosSim")
    expect(page.locator("#av-contato")).to_have_class("feito")
    expect(page.locator("#av-contato")).not_to_contain_text("-23.55")
    expect(page.locator("#loc")).to_have_count(0)
    page.click("#locsim"); expect(page.locator("#loc")).to_contain_text("-23.55")
    page.click("#voltarajuda"); expect(page.locator("#hud")).to_be_visible(); assert ativo(page)


def test_consentimento_previo_de_localizacao_vai_na_telemetria(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); page.click("#engrenagem"); page.check("#locprevia")
    page.click("#sos"); page.click("#sosSim")
    expect(page.locator("#av-contato")).to_contain_text("-23.55")


def test_sos_durante_a_triagem_continua_valendo(page):
    iniciar(page)
    responder(page, VERDE, ate="q20")
    page.click("#sos"); page.click("#sosSim"); page.click("#voltarajuda")
    responder(page, VERDE)
    assert nivel(page) == "vermelho"


# ---------- ausente nunca verde ----------
@pytest.mark.parametrize("q", ["q7", "q12", "q20", "q22", "q28", "q29", "q32"])
def test_ausente_nunca_verde(page, q):
    iniciar(page); responder(page, {k: x for k, x in VERDE.items() if k != q})
    assert nivel(page) == "amarelo"
    expect(page.locator("#porque")).to_contain_text("Dados incompletos")


# ---------- outros ----------
def test_revisao_profissional_pode_baixar(page):
    iniciar(page); responder(page, {**VERDE, "q22": 8})
    demo(page); page.click("#painel")
    page.select_option("#profnivel", "verde"); page.fill("#profobs", "Fissura conversada")
    page.click("#profok"); page.click("#voltar"); aba(page, "inicio")
    assert nivel(page) == "verde"
    expect(page.locator("#revisao")).to_have_attribute("data-status", "revisado")


def test_resumo_clinico(page):
    iniciar(page); responder(page, {**ALCOOL, "q22": 8})
    page.click("#engrenagem"); page.click("#resumo")
    d = json.loads(page.locator("#json").inner_text())
    assert d["status_revisao"] == "pendente" and d["perfil"]["classe"] == "depressores" and d["perfil"]["regime"] == "agudo"
    assert d["ultimo_uso"]["faixa"] == "1_3d" and d["ultimo_uso"]["iso"]


def test_tabela_de_custos_calcula_total(page):
    page.goto("/docs/pulseira-custos.html")
    expect(page.locator("#total")).to_have_text("R$ 250,00")
    page.uncheck("[data-incluir='2']")
    expect(page.locator("#total")).to_have_text("R$ 0,00")
    page.check("[data-incluir='2']")
    page.fill("[data-i='0'][data-k=unico]", "600"); page.fill("[data-i='0'][data-k=vida]", "24")
    expect(page.locator("#total")).to_have_text("R$ 275,00")


@pytest.mark.parametrize("resp,esperado", [(VERDE, 16), (ALCOOL, 19), (TABACO, 15), (PIOR, 23)],
                         ids=["tipico-estimulante", "tipico-alcool", "tabaco", "pior-caso"])
def test_contagem(page, resp, esperado):
    iniciar(page)
    assert len(responder(page, resp)) == esperado


# ---------- check-in agendado: intervalos maiores, nunca no sono; mais rigoroso só pelo profissional ----------
def test_checkin_agendado_nao_acorda_o_paciente(page):
    iniciar(page, NOITE); responder(page, ALCOOL)
    monitorar(page)
    assert page.locator("#hud").get_attribute("data-checkin") == "360"            # fase aguda de depressores: a cada 6 h acordado
    page.evaluate("S.pul.ultimaEma -= 600 * 60000")                               # check-in vencido às 23h
    page.wait_for_timeout(2500)
    expect(page.locator("#ema")).to_be_hidden()
    aba(page, "inicio"); expect(page.locator("#prox")).to_contain_text("depois do seu horário de sono")
    expect(page.locator("#perfil")).to_contain_text("nunca no seu horário de sono")


def test_profissional_define_intervalo_e_madrugada(page):
    iniciar(page, NOITE); responder(page, ALCOOL)
    demo(page); page.click("#painel")
    page.select_option("#profintervalo", "60"); page.check("#profnoite"); page.click("#profcheckinok")
    assert "definido pelo profissional" in log(page)
    page.click("#voltar"); monitorar(page)
    assert page.locator("#hud").get_attribute("data-checkin") == "60"
    page.evaluate("S.pul.ultimaEma -= 120 * 60000")
    expect(page.locator("#ema")).to_be_visible(timeout=5000)                       # o profissional liberou a madrugada


def test_paciente_ajusta_horario_de_sono(page):
    iniciar(page, DIA); responder(page, ALCOOL)
    page.click("#engrenagem"); page.fill("#sonoini", "13"); page.fill("#sonofim", "16"); page.locator("#sonofim").blur()
    monitorar(page); page.evaluate("S.pul.ultimaEma -= 600 * 60000"); page.wait_for_timeout(2500)
    expect(page.locator("#ema")).to_be_hidden()                                    # 14h está dentro do sono informado


# ---------- acolhimento (fumaça) ----------
def test_boas_vindas_com_nome_e_saudacao(page):
    page.goto(DIA); page.fill("#nome", "Lu"); page.click("#aceito")
    expect(page.locator(".transicao")).to_be_visible()
    responder(page, VERDE)
    expect(page.locator("#saudacao")).to_contain_text("Lu")


def test_fissura_alta_abre_tela_calma(page):
    iniciar(page); responder(page, TABACO)
    page.click("#checkin")
    for _ in range(5):
        if page.locator("#ema").is_hidden(): break
        q = page.locator("#emacorpo section[data-q]").get_attribute("data-q")
        if q == "q22": page.click("#emacorpo .op[data-v='9']")
        else: page.locator("#emacorpo .op").first.click()
    expect(page.locator("#fissura")).to_be_visible()


def test_estou_bem_nao_repete_alerta_se_nao_piorar(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    page.wait_for_timeout(3000)                                                    # sinal estabiliza no platô do cenário
    page.click("#estoubem")
    for _ in range(9): page.click("#avancar15")                                   # 2 h 15 depois: pausa acabou, sinal igual
    page.wait_for_timeout(4000)
    expect(page.locator("#alerta")).to_be_hidden()
    assert "parecida com a anterior" in log(page)


def test_demo_escolher_cenario_de_novo_permite_novo_alerta(page):
    iniciar(page); responder(page, VERDE)
    monitorar(page); cenario(page, "crise_repouso")
    expect(page.locator("#alerta")).to_be_visible(timeout=10000)
    page.click("#estoubem")
    page.click("[data-c=estavel]"); page.click("[data-c=crise_repouso]")         # apresentação: disparar de novo
    expect(page.locator("#alerta")).to_be_visible(timeout=15000)


def test_marcos_parabens_e_tempo_conquistado(page):
    iniciar(page); responder(page, ALCOOL)                                         # último uso entre 1 e 3 dias (48 h)
    expect(page.locator("#marco")).to_contain_text("Parabéns! 1 dia sem usar!")
    expect(page.locator("#proxmarco")).to_contain_text("3 dias sem usar")
    monitorar(page); demo(page); page.click("#avancardia")                         # chega a 72 h
    page.wait_for_function("S.log.some(l => l.motivo.includes('Marco: 3 dias'))", timeout=5000)
    expect(page.locator("#toast")).to_be_visible()
    if page.locator("#ema").is_visible(): ema_benigna(page)
    aba(page, "inicio"); page.click("#useidenovo"); page.click("#usosim")
    expect(page.locator("#acolhe")).to_contain_text("Esse tempo é seu")
    page.click("#voltarinicio")
    expect(page.locator("#totalconq")).to_contain_text("3 dias")                   # recaída não zera o que foi conquistado
