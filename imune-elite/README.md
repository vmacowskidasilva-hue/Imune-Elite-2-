# WhatsApp Web • IMUNE ELITE

Aplicação web educativa inspirada no **WhatsApp Web**, desenvolvida em HTML, CSS e JavaScript puros (sem frameworks ou dependências externas), com foco em recursos defensivos de segurança e comunicação em tempo real.

## Recursos implementados
- **Visual WhatsApp Web** (temas Dark e Light) com ícones vetoriais SVG.
- **Anti-Trava**: neutraliza textos gigantes e rajadas de caracteres invisíveis / combinados (Zalgo).
- **Anti-Flood**: limita rajadas rápidas de spam recebidas em sequência.
- **Anti-Delete & Anti-Edit**: preserva histórico quando o remetente apaga ou edita mensagens.
- **Anti-Link homógrafo**: detecta domínios suspeitos (`xn--` / caracteres fora do ASCII).
- **Privacidade Fantasma, Bloqueio por PIN, Status, Resposta Automática, Agendador e Backup JSON**.
- **Chamadas de Voz e Vídeo (WebRTC)**: funcionam entre abas locais (`BroadcastChannel`) ou entre dispositivos usando o servidor WebSocket incluído (`server.js`).

> **Nota para apresentação:** O aplicativo funciona de forma autônoma no navegador (contatos de demonstração e múltiplas abas). Ele não realiza chamadas nem acessa contas pessoais da rede oficial do WhatsApp sem configuração da WhatsApp Cloud API corporativa.

## Como hospedar no GitHub Pages (trabalho de escola)
1. Crie um repositório no GitHub (ex.: `imune-elite`).
2. Envie todos os arquivos desta pasta (`index.html`, `styles.css`, `app.js`, `server.js`, `package.json`, `.gitignore`, `.nojekyll`, `README.md`) para a branch `main`.
3. No repositório do GitHub, acesse **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**, selecione `main` e a pasta `/ (root)` e clique em **Save**.
5. Aguarde alguns instantes e acesse o link gerado (`https://SEU-USUARIO.github.io/imune-elite/`).

### Testando chat e ligações durante a apresentação
- No **GitHub Pages**, abra o link em **duas abas do mesmo navegador** com números diferentes para testar troca de mensagens, áudio/vídeo WebRTC, Anti-Delete e Anti-Trava em tempo real.
- Se quiser testar entre **computadores/celulares diferentes**, rode `npm start` em um computador ou hospede o mesmo repositório no Render/Railway (`npm start`).
