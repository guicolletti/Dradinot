# Couraçado

Jogo de navegador no estilo **Drednot.io (Deep Space Airships)**: você constrói sua aeronave bloco a bloco, anda dentro dela como tripulante, pilota pelo leme, controla torretas, fabrica itens e luta contra bots, naves piratas e **naves de outros jogadores**. Online, várias pessoas tripulam a mesma nave.

> Projeto de fã, sem fins lucrativos, inspirado nas mecânicas do Drednot.io. Não é afiliado ao jogo original. Toda a arte é desenhada por código (canvas) e os sons são sintetizados — não há arquivos de imagem ou áudio.

## Como jogar

### Offline (só você)
Abra o `index.html` no navegador e clique em **Jogar offline**. Funciona direto do arquivo ou pelo GitHub Pages (*Settings → Pages*, branch `main`, pasta `/ (root)`).

### Online (com amigos)
O online precisa do servidor, que está em `server/server.js` e **não tem dependências** (só precisa do Node.js 18 ou mais novo).

**No seu computador / mesma rede:**
```bash
node server/server.js
```
Abra `http://localhost:8080` e clique em **Jogar online**. Amigos na mesma rede Wi-Fi abrem `http://SEU-IP:8080`.

**Na internet (grátis, no Render.com):**
1. Crie uma conta em https://render.com e clique em **New → Blueprint**.
2. Escolha este repositório. O arquivo `render.yaml` já configura tudo.
3. Quando terminar, o jogo fica em `https://couracado-XXXX.onrender.com`. Mande esse link para os amigos (ou digite o endereço no campo "Endereço do servidor" da versão do GitHub Pages).

> No plano grátis do Render o servidor "dorme" depois de 15 min sem ninguém (demora ~1 min para acordar) e os dados das naves são apagados quando o servidor reinicia. Para guardar as naves de forma permanente, use um disco persistente e aponte `DATA_FILE` para ele.

Variáveis do servidor: `PORT` (padrão 8080), `CHEATS=1` (libera `/cheats`), `DATA_FILE` (onde as naves são salvas; padrão `server/data/ships.json`).

### Como funciona o online
- Cada jogador cria a **própria nave** ou entra na nave de alguém. Todos os tripulantes andam, constroem, pilotam e atiram na mesma nave, ao mesmo tempo.
- Toda nave tem um **código de convite** (`/convite`). Quem tem o código entra pelo menu. O capitão pode deixar a nave **pública** (`/publica`) para ela aparecer na lista, e pode expulsar alguém (`/expulsar NOME`).
- Nas zonas **JxJ** (Pardal, Falcão, Os Fossos, Canário, Abutre) naves de jogadores diferentes podem se atacar. Nas outras zonas, só bots e piratas causam dano.
- As naves são salvas no servidor quando estão no Porto Livre. Quando todo mundo sai, a nave fica no mundo por um tempo (30 s no Porto Livre, 5 min nas outras zonas) e depois é guardada. Se for destruída, ela some de vez.

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
- **Chat com comandos:** `/help`, `/convite`, `/publica`, `/expulsar NOME`, `/navenome NOME`, `/tripulacao`, `/save`, `/zonas`, `/nome`, `/stats` e `/cheats` (offline; libera `/goto ZONA`, `/give ITEM N` e `/perto`).

## Estrutura

A simulação roda no **Universe** (no servidor Node, ou dentro do navegador no modo offline). O navegador só envia a entrada do jogador e desenha o estado recebido, prevendo o movimento do próprio tripulante para não ter atraso.

```
index.html        página e interface
style.css         estilos da interface
server/server.js  servidor HTTP + WebSocket (sem dependências)
js/util.js        matemática, aleatoriedade, ruído
js/data.js        itens, objetos, torretas, munições, receitas, zonas, bots
js/ship.js        nave: grade, objetos, torretas, redimensionamento, rede
js/player.js      física do tripulante e inventário
js/ai.js          bots e naves piratas
js/world.js       zona: terreno, portais, projéteis, saque, colisões, efeitos
js/actions.js     ações de cada tripulante (servidor)
js/universe.js    zonas, naves, tripulações, snapshots, salvamento
js/net.js         conexão offline/online do navegador
js/audio.js       efeitos sonoros sintetizados
js/icons.js       ícones e desenhos procedurais
js/render.js      renderização no canvas e minimapa
js/ui.js          título, menu de naves, HUD, inventário, painéis, chat
js/game.js        cliente: espelho do estado, predição, entrada, câmera
```

## Próximos passos possíveis

- Cargos na tripulação (capitão, tripulante, convidado) com permissões.
- Carregadores/empurradores automáticos, controladores de torreta e estação de comunicação.
- Filtros por item na Escotilha de Carga.
