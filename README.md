# Pulso — protótipo de classificação de risco (3º Hackathon em Saúde IMT/São Camilo, Tema 1)

Pulseira de baixo custo + app para quem está parando o uso de substâncias.
**Classificação de risco, não é diagnóstico.** Todo resultado fica pendente de revisão por profissional. Limiares, perfis e orientações são parâmetros iniciais **não validados clinicamente** (`rules.json/_meta.aviso`).

## Rodar
```
python -m http.server 8000      # ou: rodar.bat (Windows, Python portátil em ./python)
```
Abra http://localhost:8000 (precisa de servidor porque o app carrega `rules.json`).
Parâmetros de demonstração: `?rapido` (tempo 60x), `?vel=5` (5x), `?hora=3` (começa às 3h). Também no "Modo demonstração".

## Testes
```
pip install -r requirements-dev.txt
python -m pytest tests          # Playwright (Python); usa o Edge instalado. Sem Edge: playwright install chromium e PW_CHANNEL=chromium
```

## Premissas
- A pulseira (BLE) mede FC, tremor/movimento e sono, e vibra. **GPS e reconhecimento de atividade vêm da pulseira e/ou do celular** (configurável).
- Tudo é simulado na demo, inclusive a ligação ao 192.

## Fluxo
cadastro/triagem → perfil de risco → monitoramento personalizado → (a qualquer momento) **Encerrar sessão**.
Barra fixa: **SOS** (com confirmação, que some em 10 s; a tela de ajuda tem "Voltar"), "Monitorando… / Parar" e "Encerrar sessão".

## Arquivos
- `rules.json`: **toda regra clínica** (auditável): perguntas, `derivacoes`, regras de nível, `perfis`, `regimes`, `orientacao`, `ema_itens`, `regras_ema`, `sensor` (filtro de atividade, check-in de segurança, Modo Treino, escalonamento).
- `app.js`: motor de regras, perfil, telas, serviço da pulseira, escalonamento, sessão, resumo clínico e painel do CAPS.
- `index.html`: estilos e temas do Guia de Psicologia das Cores.
- `docs/`: [viabilidade](docs/viabilidade.md), [lacunas](docs/lacunas.md), [custos](docs/pulseira-custos.md) + [tabela editável](docs/pulseira-custos.html).
- `tests/test_pulso.py`: testes Playwright.

## Triagem
- Base: ASSIST, PAWSS, CIWA-Ar, COWS, PHQ-2, C-SSRS. Núcleo antes do resultado; complementares depois, opcionais.
- **Derivações**: nada já respondido ou dedutível é perguntado de novo (ex.: q16 = não esconde "Convulsão hoje" da q20).
- Um critério vermelho basta e **interrompe a triagem** (e a EMA). Resposta obrigatória ausente **nunca** dá verde.

## Perfil, regimes e monitoramento
- Classe pela substância (a de maior risco vale): depressores = intensivo; opioides = intenso; estimulantes, cannabis, tabaco = leve. Modificadores sobem um degrau.
- **Regimes** pelo tempo desde o último uso (q12): **agudo (0–7 dias)** foca tremor, suor, FC e confusão (depressores de alto risco: "avaliação presencial recomendada; a pulseira não substitui atendimento médico"); **recuperação precoce (semanas 2–12)** foca sono, atividade, humor e fissura, com check-ins mais espaçados. A tela mostra "Dia X de acompanhamento" e a fase.
- **Níveis:** amarelo = contato do CAPS/UBS em até 24 h (inclui risco de recaída); vermelho = risco vital/SAMU. Recaída sozinha nunca aciona o SAMU.
- **"Hoje e nos próximos dias"**: cartão com "Hoje você pode sentir…", "Nos próximos dias…", "O que ajuda agora" e, **sempre**, "Procure ajuda se…" (com CAPS/UBS e SAMU). Conteúdo por classe e faixa de horas em `rules.json/orientacao`, com `fonte` e `revisao_clinica: pendente`. Adapta-se ao observado (sono ruim, fissura alta, nível amarelo). Notificação simulada no início do dia e a cada mudança de fase. Substância mista: combina, com o "procure ajuda" do maior risco primeiro.

## Pulseira, filtro e escalonamento (simulados)
- Serviço independente das telas; só para com **Parar** (com confirmação) ou **Encerrar sessão**.
- Disparo por desvio da linha de base individual, em qualquer direção.
- **Filtro por atividade:** FC alta só é descartada como exercício se a atividade for andando/correndo **com cadência rítmica**. Em veículo ou parado, não descarta. Velocidade de GPS sozinha nunca basta. Cada descarte vai para o log.
- **Modo Treino** (30 min, 1 h, 2 h; +15 min de tolerância; máx. 2 h): suspende **só** gatilhos de FC. Nunca suspende critérios vermelhos, SOS, sinais vermelhos na EMA nem tremor em repouso. Sugerido só para perfil leve e verde; bloqueado para depressores na fase aguda (orientação: descansar).
- **Check-in de segurança** (anomalia só de sensor): tela cheia, vibração e som, "Estou bem / fazendo exercício" (silencia 30 min) ou "Preciso de ajuda". Sem resposta em 45 s (dia) ou 90 s (22h–6h) = crise aguda.
- **Escalonamento** (critério vermelho da triagem, EMA, SOS ou timeout): em paralelo, aviso ao contato de confiança + telemetria ao painel do CAPS, e ligação ao 192 após contagem com "Cancelar (estou bem)" e "Ligar agora". O 192 recebe só voz.
- Cenários: estável, álcool piorando, recaída, opioide, corrida (falso positivo), musculação, crise em repouso, em veículo e de madrugada. Velocidade 1x, 5x, 60x (contagens curtas aceleram no máximo 5x); "Avançar 15 min / 1 dia".
- **Localização:** só em alerta vermelho ou SOS, com consentimento (por alerta ou prévio, separado). Sem cerca virtual nem rastreamento contínuo.

## Sessão, dados e revisão
- Com consentimento explícito (LGPD art. 11), dados **só neste aparelho, apenas para teste**, até "Encerrar sessão" (que oferece exportar o resumo e apaga tudo).
- **Resumo para revisão clínica** (tela imprimível + JSON) e **painel do CAPS** (níveis em vermelho/laranja, telemetria dos alertas, "Confirmar ou ajustar nível").

## Cores e acessibilidade
Paletas do guia mantidas como **escolha de design para ambiente calmo, sem efeito fisiológico comprovado**. Só a cor do texto foi ajustada para contraste WCAG ≥ 4,5:1 (teste automático). O paciente nunca vê vermelho ou amarelo vibrantes.
