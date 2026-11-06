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
CONTATO = {"nome": "Ana", "tel": "11987654321"}

# Caminho típico: homem, estimulante (cocaína), sem ideação suicida, tudo respondido.
VERDE = dict(q1="30_44", q2="masculino", q6="nao", q7=["cocaina"], q12="mais_1sem", q13=["cheira"], q16="nao", q17="nao",
             q20=["nenhum"], q21="normal", q22=2, q26=0, q27=0, q28="nao", q29="nao", q32="nao")
ALCOOL = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["alcool"], "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"]}
TABACO = {**{k: v for k, v in VERDE.items() if k != "q13"}, "q7": ["tabaco"], "q12": "1_3d", "q22": 3, "q6": CONTATO}
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


def iniciar(page, url="/?rapido", salvar=False):
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
    """Responde o check-in aberto com respostas tranquilas; devolve os ids das perguntas."""
    ids = []
    expect(page.locator("#ema")).to_be_visible()
    for _ in range(8):
        if page.locator("#ema").is_hidden(): break
        card = page.locator("#emacorpo section[data-q]")
        q = card.get_attribute("data-q"); ids.append(q)
        if page.locator("#emacorpo [data-acao=continuar]").count():
            page.click("#emacorpo .op[data-v='\"nenhum\"']"); page.click("#emacorpo [data-acao=continuar]")
        elif page.locator("#emacorpo .op[data-v='2']").count(): page.click("#emacorpo .op[data-v='2']")
        elif page.locator("#emacorpo .op[data-v='\"nao\"']").count(): page.click("#emacorpo .op[data-v='\"nao\"']")
        else: page.locator("#emacorpo .op").first.click()
    expect(page.locator("#ema")).to_be_hidden()
    return ids


def nivel(page): return page.locator("#app #nivel").get_attribute("data-nivel")
def leituras(page): return page.evaluate("Pulseira.n")
def ativo(page): return page.evaluate("S.pul.ativo && !!Pulseira.timer")


# ---------- a) convulsão: sem pergunta repetida ----------
def test_q16_nao_esconde_convulsao_hoje(page):
    iniciar(page)
    vistas = responder(page, VERDE, ate="q20")
    assert "q16_24h" not in vistas
    expect(page.locator(".op[data-v='\"convulsao_hoje\"']")).to_have_count(0)
    for crit in ["confusao", "alucinacao", "respiracao"]:            # critérios vermelhos continuam
        expect(page.locator(f".op[data-v='\"{crit}\"']")).to_have_count(1)


def test_q16_sim_pergunta_24h(page):
    iniciar(page)
    vistas = responder(page, {**VERDE, "q16": "sim", "q16_24h": "sim"})
    assert vistas[-1] == "q16_24h"
    assert nivel(page) == "vermelho"


def test_q16_sim_mas_nao_24h_nao_repete_na_q20(page):
    iniciar(page)
    responder(page, {**VERDE, "q16": "sim", "q16_24h": "nao"}, ate="q20")
    expect(page.locator(".op[data-v='\"convulsao_hoje\"']")).to_have_count(0)


def test_q16_sem_resposta_mantem_opcao_na_q20(page):
    iniciar(page)
    r = {k: x for k, x in VERDE.items() if k != "q16"}
    responder(page, r, ate="q20")
    expect(page.locator(".op[data-v='\"convulsao_hoje\"']")).to_have_count(1)


# ---------- vermelho direto ----------
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
    assert vistas[-1] == ultima
    assert nivel(page) == "vermelho"
    expect(page.locator("#samu")).to_have_attribute("href", "tel:192")
    expect(page.locator("#upa")).to_be_visible()
    expect(page.locator("#avisar")).to_be_visible()
    expect(page.locator("#cvv")).to_have_count(1 if suicidio else 0)
    expect(page.locator("#respirar")).to_have_count(0)
    expect(page.locator("body")).to_have_attribute("data-tema", "crise")


# ---------- b) monitoramento contínuo ----------
def test_monitoramento_60s_com_ema_e_so_para_no_parar(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon")
    t0 = time.time()
    page.click("#demo summary"); page.click("[data-c=alcool]")
    expect(page.locator("#ema")).to_be_visible(timeout=40000)
    n1 = leituras(page); page.wait_for_timeout(1000)
    assert leituras(page) > n1                                    # EMA não para o monitoramento
    ema_benigna(page)
    page.click("#verres"); page.click("#mon")                     # sair da tela não para
    emas = 1
    while time.time() - t0 < 60:
        if page.locator("#ema").is_visible(): ema_benigna(page); emas += 1
        page.wait_for_timeout(500)
    assert ativo(page) and emas >= 2
    expect(page.locator("#monst")).to_contain_text("Monitorando")
    if page.locator("#ema").is_visible(): ema_benigna(page)
    page.click("#parar"); expect(page.locator("#parconf")).to_be_visible()
    page.click("#parNao"); assert ativo(page)
    page.click("#parar"); page.click("#parSim")
    assert not ativo(page)
    n = leituras(page); page.wait_for_timeout(500); assert leituras(page) == n
    expect(page.locator("#monwrap")).to_be_hidden()


def test_queda_fc_dispara_check_in(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.click("#mon"); page.wait_for_timeout(800)
    page.click("#demo summary"); page.click("[data-c=recaida]")
    expect(page.locator("#ema")).to_be_visible(timeout=40000)


def test_offline_guarda_e_envia_ao_reconectar(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#mon"); page.click("#demo summary")
    page.click("[data-con=offline]"); page.wait_for_timeout(800)
    expect(page.locator("#buf")).to_contain_text("guardadas")
    assert page.evaluate("S.pul.buffer.length") > 5
    page.click("[data-con=dados]"); page.wait_for_timeout(300)
    expect(page.locator("#buf")).to_contain_text("foram enviadas")
    assert page.evaluate("S.pul.buffer.length") == 0


# ---------- c) sessão persistente ----------
def test_recarregar_preserva_e_encerrar_apaga(page):
    iniciar(page, salvar=True)
    responder(page, {**ALCOOL, "q6": CONTATO})
    page.reload()
    assert nivel(page) == "verde"
    page.click("#mon")
    page.reload()                                                  # monitoramento retoma sozinho
    expect(page.locator("#hud")).to_be_visible()
    n = leituras(page); page.wait_for_timeout(500); assert leituras(page) > n
    assert page.evaluate("JSON.parse(localStorage.getItem('pulso_v2')).contato.nome") == "Ana"
    page.click("#encerrar"); page.click("#encerrarok")
    expect(page.locator("#encerrada")).to_be_visible()
    assert page.evaluate("localStorage.getItem('pulso_v2')") is None
    assert not ativo(page)
    page.reload()
    expect(page.locator("#aceito")).to_be_visible()


def test_encerrar_oferece_resumo(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#encerrar"); page.click("#exportar")
    expect(page.locator("#json")).to_contain_text("Resumo para revisão clínica")
    page.click("#voltar"); expect(page.locator("#encerrarok")).to_be_visible()


def test_sem_consentimento_nada_salvo(page):
    iniciar(page)
    page.click(".op[data-v='\"30_44\"']")
    assert page.evaluate("localStorage.getItem('pulso_v2')") is None


def test_localstorage_quebrado(page):
    page.add_init_script("Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('bloqueado'); };")
    iniciar(page, salvar=True)
    responder(page, VERDE)
    assert nivel(page) == "verde"
    page.click("#mon"); page.wait_for_timeout(300); assert ativo(page)


def test_refazer_reaproveita_perfil(page):
    iniciar(page)
    responder(page, {**VERDE, "q6": CONTATO})
    page.click("#refazer")
    vistas = responder(page, VERDE)
    assert not {"q1", "q2", "q6"} & set(vistas) and len(vistas) == 13


# ---------- d) perfil álcool x tabaco ----------
def perfil_na_tela(page, resp):
    iniciar(page)
    responder(page, resp)
    page.click("#mon")
    hud = page.locator("#hud")
    dados = {k: hud.get_attribute(f"data-{k}") for k in ["perfil", "intensidade", "checkin", "risco-vital"]}
    dados["texto"] = page.locator("#app").text_content()   # inclui o "Por que este acompanhamento?" recolhido
    page.click("#checkin")
    dados["ema"] = ema_benigna(page)
    return dados


def test_perfil_alcool_x_tabaco(page, navegador):
    a = perfil_na_tela(page, {**ALCOOL, "q12": "1_3d", "q6": CONTATO})
    ctx = navegador.new_context(base_url=BASE); p2 = ctx.new_page()
    t = perfil_na_tela(p2, TABACO); ctx.close()
    assert (a["perfil"], a["intensidade"], a["risco-vital"]) == ("depressores", "intensivo", "true")
    assert (t["perfil"], t["intensidade"], t["risco-vital"]) == ("tabaco", "leve", "false")
    assert int(a["checkin"]) < int(t["checkin"])
    assert "q20" in a["ema"] and "q20" not in t["ema"]
    assert t["ema"] == ["q22", "e_sono", "e_humor"]
    assert "parando o álcool" in a["texto"] and "bem de perto" in a["texto"] and "tremor" in a["texto"]
    assert "parando o cigarro" in t["texto"] and "forma leve" in t["texto"] and "fissura" in t["texto"]
    assert "convulsão" not in t["texto"]


def test_varias_substancias_vale_maior_risco(page):
    iniciar(page)
    responder(page, {**VERDE, "q7": ["tabaco", "alcool"], "q9": "1_2sem", "q11": "ate_2", "q14": "nao", "q23": ["nenhum"], "q6": CONTATO})
    expect(page.locator("#perfil")).to_have_attribute("data-perfil", "depressores")


def test_modificador_sobe_intensidade(page):
    iniciar(page)
    responder(page, {**TABACO, "q6": "nao"})
    expect(page.locator("#perfil")).to_have_attribute("data-intensidade", "intenso")
    expect(page.locator("#perfil")).to_contain_text("contato de confiança")


# ---------- e) SOS e localização ----------
def test_sos_e_localizacao_so_com_consentimento(page):
    iniciar(page)
    responder(page, {**VERDE, "q6": CONTATO})
    page.click("#mon")
    assert "-23.55" not in page.content()
    page.click("#sos"); page.click("#sosSim")
    assert nivel(page) == "vermelho"
    expect(page.locator("#samu")).to_be_visible()
    expect(page.locator("#loc")).to_have_count(0)
    assert "-23.55" not in page.locator("#app").inner_text()
    page.click("#locsim")
    expect(page.locator("#loc")).to_contain_text("-23.55")
    page.click("#avisar")
    expect(page.locator("#avisado")).to_contain_text("PROTÓTIPO")
    expect(page.locator("#avisado")).to_contain_text("-23.55")
    assert ativo(page)                                             # SOS não para o monitoramento


def test_sos_pede_confirmacao_e_cancela(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#sos")
    expect(page.locator("#sosconf")).to_be_visible()
    expect(page.locator("#samu")).to_have_count(0)                   # nada acontece antes de confirmar
    page.click("#sosNao")
    expect(page.locator("#sosconf")).to_be_hidden(); expect(page.locator("#sos")).to_be_visible()
    assert nivel(page) == "verde"


def test_sos_confirmacao_expira_sozinha(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#sos")
    expect(page.locator("#sos")).to_be_visible(timeout=12000)
    expect(page.locator("#sosconf")).to_be_hidden()


def test_sos_voltar_ao_monitoramento(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#mon")
    page.click("#sos"); page.click("#sosSim")
    page.click("#voltarajuda")
    expect(page.locator("#hud")).to_be_visible()
    expect(page.locator("#nivelmon")).to_have_attribute("data-nivel", "vermelho")   # o alerta continua registrado
    assert ativo(page)


def test_sos_voltar_durante_triagem(page):
    iniciar(page)
    responder(page, VERDE, ate="q7")
    page.click("#sos"); page.click("#sosSim")
    page.click("#voltarajuda")
    expect(page.locator("#app section[data-q=q7]")).to_be_visible()


def test_sos_voltar_ao_resultado(page):
    iniciar(page)
    responder(page, VERDE)
    page.click("#sos"); page.click("#sosSim")
    page.click("#voltarajuda")
    expect(page.locator("#perfil")).to_be_visible()
    expect(page.locator("#app")).to_contain_text("pedido de ajuda ficou registrado")


# ---------- f) ausente nunca verde ----------
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


# ---------- outros ----------
def test_amarelo_e_verde(page):
    iniciar(page)
    responder(page, {**VERDE, "q22": 8})
    assert nivel(page) == "amarelo"
    expect(page.locator("#revisao")).to_have_attribute("data-status", "pendente")
    page.click("#refazer"); responder(page, VERDE)
    assert nivel(page) == "verde"


def test_revisao_profissional_pode_baixar(page):
    iniciar(page)
    responder(page, {**VERDE, "q22": 8})
    page.click("#painel")
    expect(page.locator(".chip.amarelo").first).to_be_visible()
    page.select_option("#profnivel", "verde"); page.fill("#profobs", "Fissura conversada, sem risco agudo")
    page.click("#profok"); page.click("#voltar")
    assert nivel(page) == "verde"
    expect(page.locator("#revisao")).to_have_attribute("data-status", "revisado")


def test_resumo_clinico(page):
    iniciar(page)
    responder(page, {**ALCOOL, "q22": 8})
    page.click("#resumo")
    dados = json.loads(page.locator("#json").inner_text())
    assert dados["status_revisao"] == "pendente" and dados["nivel"] == "amarelo"
    assert dados["perfil"]["classe"] == "depressores" and dados["substancias"] == ["Álcool"]
    assert any("Vontade" in c["motivo"] for c in dados["criterios"])


def test_tabela_de_custos_calcula_total(page):
    page.goto("/docs/pulseira-custos.html")
    expect(page.locator("#total")).to_have_text("R$ 250,00")            # só a premissa (b) preenchida
    expect(page.locator("#parcial")).to_contain_text("a cotar")
    page.fill("[data-i='0'][data-k=unico]", "600"); page.fill("[data-i='0'][data-k=vida]", "24")
    expect(page.locator("#total")).to_have_text("R$ 275,00")            # 600/24 + 250


@pytest.mark.parametrize("resp,esperado", [(VERDE, 16), (ALCOOL, 19), (TABACO, 15), (PIOR, 23)],
                         ids=["tipico-estimulante", "tipico-alcool", "tabaco", "pior-caso"])
def test_contagem(page, resp, esperado):
    iniciar(page)
    vistas = responder(page, resp)
    print(f"perguntas: {len(vistas)}")
    assert len(vistas) == esperado
