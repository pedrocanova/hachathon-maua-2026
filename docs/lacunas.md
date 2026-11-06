# Lacunas a resolver antes de um piloto

> Protótipo de hackathon. Nada aqui foi validado clinicamente ou juridicamente.

## 1. Quem responde aos alertas noturnos
- Muitos CAPS AD não funcionam 24 h. É preciso definir quem recebe um alerta vermelho às 3h: CAPS AD III (24 h), plantão regional, central de regulação, ou apenas contato de confiança + SAMU.
- Definir tempo máximo de resposta, escala de plantão e o que acontece se ninguém responder.
- Até isso estar definido, o painel do CAPS no protótipo é **simulado** e não deve ser apresentado como monitoramento 24 h.

## 2. Parecer jurídico sobre a ligação automática ao 192
- Responsabilidade em caso de falso positivo (ligação indevida) e de falso negativo (crise não detectada).
- Se o sistema pode ligar em nome do paciente; como o paciente consente; o que acontece com a contagem cancelada.
- Uso do SAMU: o 192 recebe **só voz**. A telemetria vai ao contato de confiança e ao CAPS, não ao SAMU.
- Enquadramento regulatório: verificar se o conjunto pulseira + software se enquadra como dispositivo médico / software como dispositivo médico na ANVISA (confirmar a RDC 657/2022 e normas relacionadas) e a homologação Anatel do rádio.

## 3. Plano de validação do piloto
- **Desfecho de referência**: crise confirmada por avaliação profissional (registro do CAPS/UPA/SAMU) em uma janela de tempo definida.
- **Métricas**: sensibilidade, valor preditivo positivo (VPP), taxa de falso positivo por paciente-semana, tempo até a resposta, proporção de check-ins sem resposta.
- **Calibração**: limiares por perfil e regime (`rules.json`), timeout 45/90 s, intervalo mínimo entre alertas.
- **Comparação do sensor**: PPG de punho × referência (oxímetro/ECG), com e sem movimento/tremor.
- **Aceitabilidade**: uso diário, abandono, conforto, carga de alertas para o paciente e para a equipe.
- **Revisão clínica** de todo o conteúdo de `rules.json` (perguntas, regras, perfis, orientação "o que esperar"): hoje marcado `revisao_clinica: pendente`.
- Aprovação em comitê de ética (CEP/CONEP) antes de envolver pacientes.

## 4. Base legal LGPD (art. 11)
- Dados sobre uso de substâncias e saúde mental são **dados pessoais sensíveis**.
- Hipótese de tratamento a definir: consentimento específico e destacado (art. 11, I) e/ou tutela da saúde por profissionais e serviços de saúde (art. 11, II, f). Localização tem consentimento próprio e separado.
- Definir controlador e operador, prazo de retenção, local de armazenamento, registro de acessos, relatório de impacto (RIPD), canal para o titular e regras para adolescentes (ECA).
- No protótipo: dados só no aparelho (`localStorage`), apenas para teste, apagados em "Encerrar sessão".
