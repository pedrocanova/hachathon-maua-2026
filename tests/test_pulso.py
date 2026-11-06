"""Testes Playwright (Python) do protótipo Pulso.
Rodar:  python -m pytest tests  (usa o Edge instalado; PW_CHANNEL=chromium para o Chromium do Playwright)
"""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright, expect

RAIZ = Path(__file__).resolve().parent.parent
PORTA = 8123
BASE = f"http://localhost:{PORTA}"

# Caminho típico: homem, estimulante (cocaína), sem ideação suicida, tudo respondido.
VERDE = dict(q1="30_44", q2="masculino", q6="nao", q7=["cocaina"], q12="mais_1sem", q13=["cheira"], q16="nao", q17="nao",
             q20=["nenhum"], q21="normal", q22=2, q26=0, q27=0, q28="nao", q29="nao", q32="nao")
ALCOOL = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["alcool"], "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"]}
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


def iniciar(page, url="/", salvar=False):
    page.goto(url)
    if salvar: page.check("#salvar")
    page.click("#aceito")


def responder(page, resp):
    """Responde até chegar no resultado. Pergunta sem resposta no mapa = 'Prefiro não responder'."""
    vistas = []
    for _ in range(60):
        if page.locator("#nivel").count(): break
        card = page.locator("section[data-q]")
        expect(card).to_have_count(1)
        q = card.get_attribute("data-q"); vistas.append(q)
        r = resp.get(q)
        if r is None: page.click("#pular")
        elif q == "q6" and isinstance(r, dict):
            page.fill("#cnome", r["nome"]); page.fill("#ctel", r["tel"]); page.click("#csim")
        elif q == "q6" and r == "nao": page.click("#cnao")
        elif isinstance(r, list):
            for x in r: page.click(f".op[data-v='{v(x)}']")
            page.click("#continuar")
        else: page.click(f".op[data-v='{v(r)}']")
    return vistas


def nivel(page): return page.locator("#nivel").get_attribute("data-nivel")


def ema_responder(page, ferir):
    expect(page.locator("section[data-q=q20]")).to_be_visible()
    page.click(".op[data-v='\"nenhum\"']"); page.click("#continuar")
    page.click("section[data-q=q22] .op[data-v='2']")
    page.click("section[data-q=e_uso] .op[data-v='\"nao\"']")
    page.click(f"section[data-q=e_ferir] .op[data-v='\"{ferir}\"']")


# ---------- vermelho direto ----------
@pytest.mark.parametrize("extra,ultima,suicidio", [
    ({"q29": "sim", "q30": "sim"}, "q30", True),
    ({"q29": "sim", "q30": "nao", "q31": "sim"}, "q31", True),
    ({"q32": "sim"}, "q32", True),
    ({"q20": ["confusao"]}, "q20", False),
    ({"q20": ["convulsao_hoje"]}, "q20", False),
], ids=["Q30", "Q31", "Q32", "Q20-confusao", "Q20-convulsao"])
def test_vermelho_direto(page, extra, ultima, suicidio):
    iniciar(page)
    vistas = responder(page, {**VERDE, **extra})
    assert vistas[-1] == ultima                      # a triagem para na hora
    assert nivel(page) == "vermelho"
    expect(page.locator("#samu")).to_have_attribute("href", "tel:192")
    expect(page.locator("#upa")).to_be_visible()
    expect(page.locator("#avisar")).to_be_visible()
    expect(page.locator("#cvv")).to_have_count(1 if suicidio else 0)
    expect(page.locator("#respirar")).to_have_count(0)  # sem exercício de respiração
    expect(page.locator("#comp")).to_have_count(0)      # sem complementares
    expect(page.locator("body")).to_have_attribute("data-tema", "crise")


def test_notificacao_simulada_contato(page):
    iniciar(page)
    responder(page, {**VERDE, "q6": {"nome": "Ana", "tel": "11987654321"}, "q32": "sim"})
    page.click("#avisar")
    av = page.locator("#avisado")
    expect(av).to_contain_text("PROTÓTIPO"); expect(av).to_contain_text("Ana"); expect(av).to_contain_text("vermelho")
    expect(av).not_to_contain_text("11987654321")


# ---------- amarelo / verde / ausente ----------
def test_amarelo_vontade_alta(page):
    iniciar(page)
    responder(page, {**VERDE, "q22": 8})
    assert nivel(page) == "amarelo"
    expect(page.locator("#porque")).to_contain_text("Vontade de usar")
    expect(page.locator("#comp")).to_be_visible()


def test_verde(page):
    iniciar(page)
    responder(page, VERDE)
    assert nivel(page) == "verde"
    expect(page.locator("#porque")).to_contain_text("Nenhum critério")


@pytest.mark.parametrize("q", ["q7", "q12", "q20", "q22", "q28", "q29", "q32"])
def test_ausente_nunca_verde(page, q):
    iniciar(page)
    responder(page, {k: x for k, x in VERDE.items() if k != q})
    assert nivel(page) == "amarelo"
    expect(page.locator("#porque")).to_contain_text("Dados incompletos")


def test_tudo_sem_resposta(page):
    iniciar(page)
    responder(page, {})
    assert nivel(page) == "amarelo"


# ---------- persistência ----------
def test_persistencia_continuar_e_apagar(page):
    iniciar(page, salvar=True)
    page.click(".op[data-v='\"30_44\"']"); page.click(".op[data-v='\"masculino\"']")
    expect(page.locator("section[data-q=q6]")).to_be_visible()
    page.reload()
    page.click("text=Continuar de onde parei")
    expect(page.locator("section[data-q=q6]")).to_be_visible()
    page.click("#apagar")
    expect(page.locator("#apagado")).to_be_visible()
    assert page.evaluate("localStorage.getItem('pulso_v1')") is None
    page.reload()
    expect(page.locator("#aceito")).to_be_visible()


def test_sem_consentimento_nada_salvo(page):
    iniciar(page)
    page.click(".op[data-v='\"30_44\"']")
    assert page.evaluate("localStorage.getItem('pulso_v1')") is None


def test_localstorage_quebrado(page):
    page.add_init_script("Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('bloqueado'); };")
    iniciar(page, salvar=True)
    responder(page, VERDE)
    assert nivel(page) == "verde"


def test_comecar_de_novo_reaproveita_perfil(page):
    iniciar(page, salvar=True)
    responder(page, {**VERDE, "q6": {"nome": "Ana", "tel": "11987654321"}})
    page.reload()
    page.click("text=Começar de novo")
    vistas = responder(page, VERDE)
    assert not {"q1", "q2", "q6"} & set(vistas)
    assert len(vistas) == 13
    assert nivel(page) == "verde"


# ---------- monitoramento ----------
def test_monitoramento_ate_parar(page):
    iniciar(page, "/?rapido")
    responder(page, VERDE)
    page.click("#mon")
    expect(page.locator("#monbar")).to_be_visible()
    expect(page.locator("#monst")).to_contain_text("Monitorando")
    page.wait_for_timeout(3000)                       # ~60 leituras, cenário estável
    expect(page.locator("#st")).to_contain_text("linha de base")
    expect(page.locator("section[data-q]")).to_have_count(0)  # estável não dispara EMA
    page.click("text=Ver minha orientação")           # barra segue visível em outras telas
    expect(page.locator("#monbar")).to_be_visible()
    page.click("#parar"); expect(page.locator("#parconf")).to_be_visible()
    page.click("#parNao"); expect(page.locator("#monbar")).to_be_visible()
    page.click("#parar"); page.click("#parSim")
    expect(page.locator("#monbar")).to_be_hidden()


def test_ema_volta_e_interrompe_se_subir(page):
    iniciar(page, "/?rapido")
    responder(page, VERDE)
    page.click("#mon")
    page.click("[data-c=alcool]")
    expect(page.locator("section[data-q=q20]")).to_be_visible(timeout=10000)
    expect(page.locator("#monst")).to_contain_text("pausa")
    ema_responder(page, "nao")
    expect(page.locator("#st")).to_be_visible()       # de volta à pulseira
    expect(page.locator("#monbar")).to_be_visible()
    expect(page.locator("section[data-q=q20]")).to_be_visible(timeout=10000)  # nova EMA após intervalo mínimo
    ema_responder(page, "sim")
    assert nivel(page) == "vermelho"
    expect(page.locator("#monbar")).to_be_hidden()


def test_queda_fc_dispara(page):
    iniciar(page, "/?rapido")
    responder(page, VERDE)
    page.click("#mon")
    page.wait_for_timeout(800)                        # linha de base
    page.click("[data-c=recaida]")
    expect(page.locator("section[data-q=q20]")).to_be_visible(timeout=10000)


# ---------- contagem de perguntas ----------
@pytest.mark.parametrize("resp,esperado", [(VERDE, 16), (ALCOOL, 19), (PIOR, 23)], ids=["tipico-estimulante", "tipico-alcool", "pior-caso"])
def test_contagem(page, resp, esperado):
    iniciar(page)
    vistas = responder(page, resp)
    print(f"perguntas: {len(vistas)}")
    assert len(vistas) == esperado
