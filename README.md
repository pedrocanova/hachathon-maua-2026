# Pulso — protótipo de triagem (3º Hackathon em Saúde IMT/São Camilo, Tema 1)

**Não é diagnóstico.** Esboço para demonstração. Limiares não validados clinicamente.

## Rodar
```
python3 -m http.server 8000   # abra http://localhost:8000
```
(É preciso um servidor porque o app carrega `rules.json`. Também funciona no GitHub Pages.)

## Arquivos
- `rules.json`: perguntas, ramificação (`se`), regras de classificação, EMA e parâmetros do sensor. **Toda regra clínica fica aqui** (é o arquivo auditável).
- `app.js`: motor de regras, telas, simulador da pulseira e painel do profissional.
- `index.html`: estilos e temas de cor do Guia de Psicologia das Cores.

## Lógica
- Um critério vermelho basta. Nível final = o mais grave entre as regras disparadas.
- Pergunta obrigatória sem resposta nunca resulta em verde (vira amarelo).
- Sensor → EMA → reclassificação. Após a triagem, sensor/EMA só sobem o nível.
- O disparo usa desvio da linha de base individual (|z| > 2 por 3 leituras), **em qualquer direção**, porque a FC cai na abstinência de estimulantes/nicotina e na sedação por recaída.
- Sem resposta à EMA após alerta do sensor = amarelo.
- Dados apenas em memória (minimização, LGPD art. 11).
