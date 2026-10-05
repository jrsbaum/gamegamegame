# Vila dos Agentes no Dokploy

Crie um Compose separado no projeto `GameGameGame` para cada ambiente. Use o repositório `jrsbaum/gamegamegame`, a branch `staging` em HML e `main` em produção. Os caminhos são:

- HML: `infra/dokploy/agent-village/docker-compose.staging.yml`
- produção: `infra/dokploy/agent-village/docker-compose.yml`

No ambiente HML, crie antes o volume externo vazio `gamegamegame-staging-agent-village` e configure:

```text
AGENT_VILLAGE_HML_DATA_VOLUME=gamegamegame-staging-agent-village
AGENT_VILLAGE_HML_INVITE_CODE=<segredo com pelo menos 16 caracteres>
```

Em produção, confirme o nome do volume novo e exclusivo antes de criar o serviço:

```text
AGENT_VILLAGE_DATA_VOLUME=gamegamegame-agent-village
AGENT_VILLAGE_INVITE_CODE=<segredo com pelo menos 16 caracteres>
```

Não reutilize volumes de Caracol, LaFarmer ou Dokploy. O serviço é uma réplica única porque o armazenamento JSON não é multi-processo. O Compose já liga a rede `dokploy-network`, o healthcheck `/healthz`, TLS e routers exclusivos. O Dockerfile copia as dependências de runtime para a imagem final porque o servidor usa o pacote `ws` no canal WebSocket.

Valide localmente na raiz, sem segredos reais:

```powershell
$env:AGENT_VILLAGE_INVITE_CODE='ci-structural-example-only'
$env:AGENT_VILLAGE_DATA_VOLUME='ci-agent-village'
$env:AGENT_VILLAGE_HML_INVITE_CODE='ci-hml-structural-example-only'
$env:AGENT_VILLAGE_HML_DATA_VOLUME='ci-hml-agent-village'
docker compose -f infra/dokploy/agent-village/docker-compose.yml config --quiet
docker compose -f infra/dokploy/agent-village/docker-compose.staging.yml config --quiet
```

Depois do deploy HML, confira `/healthz`, `/`, cadastro com o convite HML, persistência do arquivo após reiniciar o serviço e os três níveis de privacidade. O DNS e os certificados só funcionarão quando `hml-agents.gamegamegame.site` estiver apontando para o servidor. Promova para `main` somente depois do smoke test e do CI verde; produção exige um volume e secrets diferentes.
