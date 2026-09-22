# LaFarmer

MVP multiplayer de fazenda compartilhada: mapa persistente, personagem
customizável, produção, criação de animais e economia em moedas.

Esta é a cópia integrada em `apps/lafarmer/`. O workspace é independente do
aplicativo legado em `lafarmer/` e mantém os pacotes compartilhados, o cliente
Vite/Phaser, o servidor Fastify/WebSocket e a persistência PostgreSQL dentro
desta pasta.

## Desenvolvimento

```powershell
npm ci
npm run build
npm test
```

Os comandos devem ser executados a partir de `apps/lafarmer/`. Para executar a
partir da raiz do repositório, use `Push-Location apps/lafarmer` antes deles.

O cliente usa Vite/Phaser e o servidor usa Fastify + WebSocket. O servidor é
autoritativo para identidade, movimento, moedas e ações do jogo.

## Credenciais

O MVP usa nick único e senha com no mínimo 8 caracteres, sem e-mail nem
recuperação automática. A confirmação de que o jogador guardou as credenciais
é obrigatória no primeiro acesso.

## Deploy

Os artefatos de container e o runbook de Dokploy estão em `infra/` e `docs/`.

O checklist de validação está em [`tests/README.md`](tests/README.md).
