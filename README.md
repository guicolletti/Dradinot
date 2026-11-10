# Couraçado

Jogo de navegador no estilo **Drednot.io (Deep Space Airships)**: você constrói sua aeronave bloco a bloco, anda dentro dela como tripulante, pilota pelo leme, controla torretas, fabrica itens e luta contra bots e naves piratas pelo espaço.

> Projeto de fã, sem fins lucrativos, inspirado nas mecânicas do Drednot.io. Não é afiliado ao jogo original. Toda a arte é desenhada por código (canvas) e os sons são sintetizados — não há arquivos de imagem ou áudio.

## Como jogar

- **Local:** abra o `index.html` no navegador (funciona direto do arquivo, sem servidor).
- **GitHub Pages:** em *Settings → Pages*, escolha a branch `main` e a pasta `/ (root)`.

## Controles

| Tripulante | |
|---|---|
| `A` / `D` | andar |
| `Espaço` | pular (segure para pular mais alto) |
| `W` / `S` | subir/descer escadas • `S` desce de passarelas |
| `1`–`0` | trocar slot do inventário |
| `Clique` | usar o item na mão / interagir |
| `Q` | soltar/arremessar a pilha (`Shift+Q`: só um) |
| `R` | ação secundária (eixo do ampliador/encolhedor) |
| `Botão direito` | cancelar |
| `I` | equipamento • `M` mapa • `H` ajuda • `Enter` chat • roda do mouse: zoom |

| Leme | |
|---|---|
| `WASD` | mover a nave |
| `Clique` | disparar as torretas RC (laranja) |
| `Q` | atravessar um portal |
| `Espaço` / `Esc` | sair |

| Torreta manual | |
|---|---|
| mouse | mirar |
| `Clique` | atirar |
| `Q` | descarregar a munição |
| `Espaço` / `Esc` | sair |

## O que tem no jogo

- **Física de plataforma dentro da nave:** gravidade, pulo variável, escadas, passarelas de mão única, redes de itens (jogadores passam, itens não), portas.
- **Construção:** blocos, passarelas, escadas, redes e objetos que precisam de piso. Torretas vão no casco externo e ocupam 3 blocos. Chave inglesa para desmontar. Ampliador/Encolhedor de nave (até 80×80).
- **Inventário** de 10 slots com arrastar e soltar, dividir pilha com Shift, arremessar itens; itens soltos têm física (bolas quicam!).
- **Fabricadores:** Inicial, Munição, Engenharia, Máquinas e Equipamento, cada um com suas receitas, fila de produção e modo repetir. Carregue Metal, Explosivos e Fluxo clicando neles.
- **Torretas:** Torreta, Automática, de Rajada e RC (pelo leme).
- **8 tipos de munição:** Padrão, Dispersão, Flak (explode no ar), Atirador (ricocheteia), Soco (empurra), Puxão (puxa), Perfurante (atravessa rochas) e Lixo (grátis, perde força).
- **Escudo e casco:** com o escudo zerado as balas destroem o interior; casco zerado destrói a nave. Reforços de Escudo, Kits de Reparo e Geradores de Escudo.
- **Saque:** bots e rochas soltam caixas flutuantes; encoste a nave e os itens saem pela Escotilha de Carga (que pode ser bloqueada). Ejetor de Carga lança itens ao espaço. Reciclador devolve materiais.
- **Bots:** vermelhos (metal e explosivos), azuis (torretas e fluxo) e verdes (bolas e munição de soco).
- **Naves piratas com IA** que perseguem, desviam do terreno e atiram com mira preditiva, além de uma **nave chefe** na zona Abutre.
- **Terreno destrutível:** rochas (25% de chance de metal), cristais de fluxo e rochas com diamante branco (sempre dão itens raros).
- **Zonas ligadas por portais:** Porto Livre (seguro), Beija-flor, Tentilhão, Pardal, Falcão e as missões Os Fossos, Canário e Abutre.
- **Salvamento** automático no Porto Livre (como no original, só dá para salvar em zona segura). Se a nave for destruída, o jogo salvo é perdido.
- **Equipamentos:** Botas Saltadoras, Botas de Velocidade e Mochila-Foguete.
- **Chat com comandos:** `/help`, `/save`, `/zonas`, `/nome`, `/stats`, `/cheats` (libera `/goto ZONA` e `/give ITEM N` para testes).

## Estrutura

```
index.html      página e interface
style.css       estilos da interface
js/util.js      matemática, aleatoriedade, ruído
js/data.js      itens, objetos, torretas, munições, receitas, zonas, bots
js/audio.js     efeitos sonoros sintetizados
js/ship.js      nave: grade, objetos, torretas, redimensionamento, salvamento
js/player.js    física do tripulante e inventário
js/ai.js        bots e naves piratas
js/world.js     zona: terreno, portais, projéteis, saque, colisões
js/icons.js     ícones e desenhos procedurais
js/render.js    renderização no canvas e minimapa
js/ui.js        HUD, inventário, painéis, chat
js/game.js      laço principal, entrada, ações, viagens, salvamento
```

## Próximos passos possíveis

- Multiplayer de verdade (servidor Node com WebSocket) para tripulações e combate entre jogadores.
- Carregadores/empurradores automáticos, controladores de torreta e estação de comunicação.
- Filtros por item na Escotilha de Carga.
