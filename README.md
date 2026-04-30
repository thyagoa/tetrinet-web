# BrickNet

Versão multiplayer do Tetris com blocos especiais (bombas), modos de jogo em times e bots com IA.

## Jogando agora (só frontend)

Abra `public/index.html` no navegador — funciona sem servidor.  
Ou faça deploy da pasta `public/` no **Netlify**.

## Estrutura do projeto

```
bricknet/
├── public/               ← tudo que vai pro Netlify
│   ├── index.html        ← tela inicial / lobby
│   ├── game.html         ← tela de jogo
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── game.js       ← motor do jogo (peças, board, física, bombas)
│       ├── bot.js        ← IA dos bots
│       ├── render.js     ← renderização canvas
│       └── ui.js         ← coordenador principal
├── server.js             ← servidor multiplayer (futuro - Render)
├── package.json
└── render.yaml           ← config deploy Render
```

## Deploy Netlify (frontend)

1. Acesse netlify.com e faça login
2. Clique em **"Add new site" → "Deploy manually"**
3. Arraste a pasta `public/` para a área indicada
4. Pronto! URL gerada automaticamente.

## Deploy Render (backend - futuro multiplayer)

1. Suba o projeto no GitHub
2. Acesse render.com → **"New Web Service"**
3. Conecte o repositório
4. Configure:
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. Após deploy, copie a URL e substitua em `public/js/ui.js`:
   ```js
   // Troque BotSocket por:
   const socket = io('https://SEU-APP.onrender.com');
   ```

## Controles

| Tecla | Ação |
|-------|------|
| ← → | Mover peça |
| ↑ | Rotacionar |
| ↓ | Queda rápida |
| ESPAÇO | Drop instantâneo |
| 1-5 | Selecionar alvo |
| D | Usar bomba selecionada |
| Clique no inventário | Selecionar bomba |

## Modos de jogo

- **Free For All** — cada um por si, último vivo vence
- **1v1** — duelo direto
- **2v2** — dois times de dois
- **3v3** — dois times de três
- **2v2v2** — três times de dois

## Bombas especiais

| Tecla | Nome | Efeito |
|-------|------|--------|
| A | Add Line | Adiciona linha de lixo ao alvo |
| C | Clear Line | Remove a linha mais baixa do alvo |
| B | Clear Specials | Limpa todas as bombas do campo do alvo |
| R | Random Clear | Remove blocos aleatórios do alvo |
| O | Block Bomb | Explode blocos O e adjacentes no alvo |
| Q | Blockquake | Embaralha todos os blocos do alvo |
| G | Gravity | Aplica gravidade no campo do alvo |
| S | Switch Fields | Troca seu campo com o do alvo |
| N | Nuke Field | Limpa completamente o campo do alvo |
