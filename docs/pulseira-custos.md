# Pulseira Pulso: ficha técnica e modelo de custo por paciente

> Protótipo de hackathon. Componentes e valores são **propostas a validar**; nenhum preço foi inventado.
> Tabela editável com total calculado: abra [`pulseira-custos.html`](pulseira-custos.html) no navegador.

## 1. Ficha técnica (proposta)

| Bloco | Função no Pulso | Opções a avaliar | Observações |
|---|---|---|---|
| Sensor óptico PPG | Frequência cardíaca (e variabilidade, se possível) para a linha de base individual | Módulo PPG de pulso com LED verde | Precisão cai com movimento e tremor; validar contra referência |
| Acelerômetro (IMU) | Movimento, agitação, tremor, sono/inatividade | IMU de 3 ou 6 eixos | Também ajuda a descartar leituras de PPG com artefato |
| GPS / GNSS | Localização **só** em alerta vermelho ou SOS, com consentimento do paciente | GNSS integrado ao módulo celular ou separado | Sem cerca virtual, sem rastreamento contínuo por terceiros; GPS desligado fora de alertas para poupar bateria |
| Wi-Fi | Envio das leituras em casa ou no serviço, sem gastar dados | Wi-Fi 2,4 GHz | Preferido quando disponível |
| Dados móveis próprios | Envio de leituras e do alerta onde não há Wi-Fi (situação de rua, deslocamento) | LTE-M ou NB-IoT (baixo consumo) **ou** 4G com plano próprio | Verificar cobertura LTE-M/NB-IoT na região; 4G gasta mais bateria |
| Memória local | Guardar leituras quando offline e enviar ao reconectar | Flash interna | Dimensionar para alguns dias de leituras |
| Bateria | Uso contínuo com recarga simples | Li-Po recarregável | Meta de autonomia a definir (ex.: ≥ 2 dias); aviso de bateria fraca no app |
| Botão físico (opcional) | SOS sem precisar do celular | Botão com toque longo | Evitar disparo acidental |
| Pulseira e carcaça | Conforto e resistência | Silicone hipoalergênico, resistência a água | Higienização entre pacientes, se houver reuso |

## 2. Modelo de custo por paciente

**Fórmula do custo mensal por paciente**

```
custo mensal = (hardware ÷ vida útil em meses) + dados móveis + plataforma/nuvem + suporte e reposição
```

Só entram no total os itens já preenchidos. Enquanto houver item "a cotar", o total é **parcial**.

| Item | Tipo | Custo único (R$) | Vida útil (meses) | Custo mensal (R$) | Status | Fonte |
|---|---|---|---|---|---|---|
| (a) Hardware: pulseira (PPG, acelerômetro, GPS, Wi-Fi, módulo de dados, bateria, carcaça) | único | a cotar | a definir | = custo único ÷ vida útil | a cotar | a preencher |
| (a) Hardware: carregador e cabo | único | a cotar | a definir | = custo único ÷ vida útil | a cotar | a preencher |
| (b) Dados móveis para localização e envio das leituras (chip/plano por pulseira) | mensal | — | — | **250,00** | **premissa a validar** (valor informado pela equipe) | a preencher |
| (c) Plataforma/nuvem (recebimento das leituras, painel do profissional, armazenamento) | mensal | — | — | a cotar | a cotar | a preencher |
| (d) Suporte técnico ao paciente e ao serviço | mensal | — | — | a cotar | a cotar | a preencher |
| (d) Reposição (perda, quebra, troca de bateria/pulseira) | mensal | — | — | a cotar | a cotar | a preencher |
| **Total mensal por paciente (parcial)** | | | | **250,00 + itens a cotar** | | |

> O valor de R$ 250/mês foi **informado pela equipe** e se refere **somente** ao item (b), dados móveis/localização.
> Ele **não** é o custo total por paciente. Precisa de validação (cotação com operadora, volume de dados real
> e plano de IoT LTE-M/NB-IoT vs. 4G).

## 3. Itens a cotar

- **Hardware:** pulseira completa (com e sem módulo celular), carregador, custo de montagem e certificação (Anatel), garantia, vida útil esperada.
- **Dados móveis:** plano IoT por chip (LTE-M/NB-IoT) e plano 4G; franquia necessária para leituras + alertas; cobertura na região dos CAPS AD participantes. Validar a premissa de R$ 250/mês.
- **Plataforma/nuvem:** hospedagem, banco de dados, envio de notificações (SMS/push), backups, adequação à LGPD (dados sensíveis, art. 11), registros de acesso.
- **Suporte e reposição:** atendimento a pacientes e equipes, logística de troca, taxa estimada de perda/quebra, higienização em caso de reuso.

## 4. Premissas a validar

- Volume de dados por paciente por mês (frequência de leituras e tamanho de cada envio).
- Proporção de pacientes sem Wi-Fi em casa (define quantos dependem de dados móveis).
- Vida útil real da pulseira e da bateria em uso contínuo.
- Taxa de perda e quebra (especialmente em situação de rua).
