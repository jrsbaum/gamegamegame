# Validação do workspace LaFarmer

Execute a partir de `apps/lafarmer/`:

```powershell
npm ci
npm run build
npm test
```

`npm run build` compila o conteúdo compartilhado, o servidor Fastify/WebSocket
e o cliente Vite/Phaser. `npm test` executa os testes de domínio/conteúdo, os
testes de integração HTTP/WebSocket/economia e o teste estrutural desta
relocação.

O teste estrutural confirma que os workspaces continuam apontando para
`apps/lafarmer/packages/` e que os artefatos principais do cliente e do
servidor permanecem na nova raiz. Ele não substitui uma validação com
PostgreSQL real, navegador ou deploy Dokploy.
