# LaFarmer

MVP multiplayer de fazenda compartilhada: mapa persistente, personagem
customizável, produção, criação de animais e economia em moedas.

Esta é a aplicação oficial em `apps/lafarmer/`. O workspace mantém os pacotes
de conteúdo, o cliente Vite/Phaser, o servidor Fastify/WebSocket e a
persistência PostgreSQL dentro desta pasta.

Domínio de produção: `https://lafarmer.gamegamegame.site`. O frontend, a API,
o WebSocket e o PostgreSQL são publicados como um Compose próprio dentro do
projeto `GameGameGame` no Dokploy.

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

Os artefatos de container e o runbook de Dokploy estão em `infra/`.

O Compose usa `infra/dokploy/lafarmer/docker-compose.yml`, a branch `main`, a
rede `dokploy-network` e o volume externo configurado por
`LAFARMER_POSTGRES_VOLUME`. O volume de produção existente nunca deve ser
substituído por um volume novo durante um deploy.

O checklist de validação está em [`tests/README.md`](tests/README.md).
