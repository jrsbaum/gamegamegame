# LaFarmer

MVP multiplayer de fazenda compartilhada: mapa persistente, personagem
customizável, produção, criação de animais e economia em moedas.

## Desenvolvimento

```powershell
npm install
npm run build
npm test
```

O cliente usa Vite/Phaser e o servidor usa Fastify + WebSocket. O servidor é
autoritativo para identidade, movimento, moedas e ações do jogo.

## Credenciais

O MVP usa nick único e senha com no mínimo 8 caracteres, sem e-mail nem
recuperação automática. A confirmação de que o jogador guardou as credenciais
é obrigatória no primeiro acesso.

## Deploy

Os artefatos de container e o runbook de Dokploy estão em `infra/` e `docs/`.
