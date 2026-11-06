# Pulso — protótipo de triagem de risco (3º Hackathon em Saúde IMT/São Camilo, Tema 1)

Pulseira de baixo custo + app para quem está parando o uso de substâncias.
**Triagem de risco, não é diagnóstico.** Todo resultado fica pendente de revisão por profissional. Limiares e perfis **não validados clinicamente**.

## Rodar
```
python -m http.server 8000      # ou: rodar.bat (Windows, Python portátil em ./python)
```
Abra http://localhost:8000 (precisa de servidor porque o app carrega `rules.json`). `?rapido` liga o tempo acelerado (1 s = 1 min), também disponível em "Modo demonstração".

## Testes
```
pip install -r requirements-dev.txt
python -m pytest tests          # Playwright (Python); usa o Edge instalado. Sem Edge: playwright install chromium e PW_CHANNEL=chromium
```

## Fluxo
cadastro/triagem → perfil de risco → monitoramento da pulseira personalizado pelo perfil → (a qualquer momento) **Encerrar sessão**.
Barra fixa durante a sessão: **SOS**, "Monitorando… / Parar" e "Encerrar sessão".

## Arquivos
- `rules.json`: **toda regra clínica** (arquivo auditável): perguntas q1–q35 (+ q16_24h, q35_dias), `derivacoes`, regras de nível, `perfis`, `ema_itens`, `regras_ema`, sensor.
- `app.js`: motor de regras, derivações, perfil, telas, serviço da pulseira, sessão, resumo clínico e painel do profissional.
- `index.html`: estilos e temas do Guia de Psicologia das Cores.
- `docs/pulseira-custos.md` + `docs/pulseira-custos.html`: ficha técnica e modelo de custo (tabela editável com total).
- `tests/test_pulso.py`: testes Playwright.

## Triagem
- Base: ASSIST, PAWSS, CIWA-Ar, COWS, PHQ-2, C-SSRS (referências em `rules.json/_meta.base`). Núcleo antes do resultado; complementares depois, opcionais.
- **Derivações** (`rules.json/derivacoes`): nada já respondido ou dedutível é perguntado de novo.
  - q16 = não → q16_24h = não e "Convulsão hoje" some da q20. q16 = sim → pergunta se foi nas últimas 24 h (sim = vermelho). q16 sem resposta → a opção continua na q20.
  - Uma só substância na q7 → q8 preenchida. Só álcool/tabaco/maconha → q13 deduzida. q16 ou q17 = sim → q19 = sim.
  - "Confusão", "alucinação" e "respiração lenta/difícil" continuam na q20.
- Um critério vermelho basta e **interrompe a triagem**. Resposta obrigatória ausente **nunca** dá verde.
- Perguntas na 1ª vez: estimulante 16, álcool 19, tabaco 15, pior caso 23. Refazer a triagem com perfil salvo: 13.

## Perfil de risco e monitoramento
- Classe pela substância (com várias, vale a de maior risco): depressores (álcool, calmantes, GHB) = intensivo; opioides = intenso (overdose na recaída); estimulantes, cannabis e tabaco = leve (humor, sono, fissura).
- Modificadores (gestação, epilepsia/fígado, convulsão ou confusão prévias, mistura, morar sozinho ou na rua, sem contato de confiança, < 18 anos) sobem um degrau.
- Cada perfil define: intervalo de check-in, intervalo mínimo entre check-ins, limiar da pulseira (desvio da linha de base **em qualquer direção**), perguntas da EMA (3 a 5), janela de risco a partir do último uso (q12), psicoeducação, tema de cor e conteúdos (ex.: naloxona).
- A tela mostra nível atual, tempo desde o último uso e fase, FC e movimento ao vivo, estado da pulseira, próximo check-in e o motivo de cada ajuste ("Acompanhamos bem de perto porque você está parando o álcool e o último uso foi há cerca de 2 dias").

## Pulseira (simulada)
- Serviço independente das telas: continua ao trocar de tela, durante o check-in (painel sobreposto) e após recarregar a página. Só para com **Parar** (com confirmação) ou **Encerrar sessão**.
- Check-in/EMA reclassifica e só **sobe** o nível; para baixar: nova triagem ou revisão do profissional. Sem resposta = amarelo.
- "Modo demonstração": cenários (estável, álcool piorando, recaída, opioide), conexão (Wi-Fi, dados móveis, sem conexão) e tempo acelerado.
- Sem conexão: leituras ficam guardadas e são enviadas ao reconectar. Bateria e GPS simulados.
- **Localização:** só é compartilhada em alerta vermelho ou SOS, com consentimento próprio a cada alerta. Sem cerca virtual nem rastreamento contínuo.

## Sessão, dados e revisão
- Com consentimento explícito (LGPD art. 11), os dados ficam **só neste aparelho, apenas para teste** (`localStorage`) e persistem ao recarregar até "Encerrar sessão", que oferece exportar o resumo e apaga tudo. Sem texto livre nem localização exata. Funciona se o `localStorage` falhar.
- **Resumo para revisão clínica** (tela imprimível + JSON): perfil, substâncias, último uso, critérios, nível, histórico e status de revisão.
- **Painel do profissional** (simulado): lista com níveis em vermelho/laranja, status pendente/revisado e "Confirmar ou ajustar nível" com observação curta. O paciente vê só as cores calmas.
