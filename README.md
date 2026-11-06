# Pulso — protótipo de triagem (3º Hackathon em Saúde IMT/São Camilo, Tema 1)

**Não é diagnóstico.** Esboço para demonstração. Limiares **não validados clinicamente**. Itens de CIWA-Ar, COWS e PAWSS em autorrelato não têm a validação dos instrumentos originais.

## Rodar
```
python -m http.server 8000      # ou: rodar.bat (Windows, Python portátil em ./python)
```
Abra http://localhost:8000. É preciso um servidor porque o app carrega `rules.json`. Também funciona no GitHub Pages.
`?rapido` na URL acelera a pulseira simulada (demonstração).

## Testes
```
pip install -r requirements-dev.txt
python -m pytest tests          # Playwright (Python); usa o Edge instalado. Sem Edge: playwright install chromium e PW_CHANNEL=chromium
```
26 testes: vermelho direto (Q30, Q31, Q32, Q20 confusão, convulsão), amarelo, verde, resposta ausente nunca verde, persistência + apagar dados, localStorage quebrado, monitoramento até "Parar", EMA, queda de FC e contagem de perguntas.

## Arquivos
- `rules.json`: as 35 perguntas (q1…q35), ramificação (`se`), núcleo/complementar (`fase`, `nucleo_se`), regras de classificação, EMA e parâmetros do sensor. **Toda regra clínica fica aqui** (é o arquivo auditável).
- `app.js`: motor de regras, telas, persistência local, simulador da pulseira e painel do profissional.
- `index.html`: estilos e temas do Guia de Psicologia das Cores.
- `tests/test_pulso.py`: testes Playwright (pytest).

## Triagem
- Base: ASSIST, PAWSS, CIWA-Ar, COWS, PHQ-2, C-SSRS (referências em `rules.json/_meta.base`).
- **Núcleo** (antes do resultado) e **complementar** (depois, opcional e pulável). Uma pergunta por tela, "Prefiro não responder" em todas.
- Ramificação: q3 só se feminino; q11 só com álcool; q25 só com opioide; q30–q31 só se q29 = sim; "há quantos dias" só se q35 = sim; q14 só com álcool/calmante/GHB/opioide. q9, q13 e q23 só entram no núcleo quando alimentam uma regra (depressor ou substância injetável); senão vão para o complementar.
- Sem texto livre (q8 e q24 são listas). Região: só CEP com 5 dígitos ou bairro.
- Perguntas por caminho (primeira vez): típico estimulante **16**, típico álcool **19**, pior caso **23**. Retorno com perfil salvo: **13**.

## Classificação
- Um critério vermelho basta; nível final = o mais grave. Bloco 6 (suicídio) aciona vermelho independentemente do resto.
- **Vermelho interrompe a triagem** e vai para uma tela única: SAMU 192, UPA/pronto-socorro (rota), aviso ao contato de confiança (simulado) e CVV 188 se o motivo for suicídio. Sem escolha de serviço e sem exercício de respiração.
- Resposta obrigatória ausente (q7, q12, q20, q22, q28, q29, q30–q32 quando se aplicam) **nunca** resulta em verde: vira amarelo com o motivo "dados incompletos".
- Regras `info` (naloxona, perda de tolerância) não mudam o nível.
- Sempre aparece "Por que esta orientação?".

## Pulseira e EMA
- Roda até o usuário clicar **Parar** (com confirmação). "Monitorando…" e o botão ficam visíveis em todas as telas.
- Disparo: desvio da linha de base individual (|z| > 2 por 3 leituras), **em qualquer direção** (a FC cai na abstinência de estimulantes e na sedação).
- EMA: sempre as mesmas 4 perguntas, no mesmo formato da triagem. Intervalo mínimo entre EMAs. Depois volta ao monitoramento; se o nível subir, interrompe e mostra a tela do nível. Sem resposta = amarelo.
- Após a triagem, sensor/EMA só sobem o nível.

## Dados (LGPD art. 11)
- Por padrão, só na memória da aba. Com consentimento explícito, `localStorage` **só neste aparelho, apenas para teste**: respostas, contato de confiança, linha de base e log.
- Na reabertura: "Continuar de onde parei" ou "Começar de novo" (reaproveita o perfil: idade, sexo, região, moradia, contato). Botão "Apagar meus dados" sempre visível. Se o `localStorage` falhar, o app continua funcionando.

## Cores
Paciente: temas do guia (azul, verde-sálvia, índigo à noite, terracota no rebote, verde-água no vermelho); nunca vermelho/amarelo vibrantes nem branco puro. Painel do profissional: vermelho/laranja para priorização. O app não afirma efeito fisiológico das cores.
