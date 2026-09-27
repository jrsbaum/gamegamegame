# LaFarmer 2: publicação isolada

## Problem Statement

O LaFarmer 2 está na main, mas ainda não tem imagens, Compose ou domínio publicado. O lançamento precisa manter os dados dos jogadores em PostgreSQL e preservar o LaFarmer 1 e os outros jogos.

## Goals

- Publicar cliente, API e WebSocket do LaFarmer 2 no mesmo domínio.
- Persistir conta, perfil e posição entre reinícios.
- Validar a versão em HML antes de publicar o código integrado à main.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Migrar contas do LaFarmer 1 | Os jogos possuem identidades e dados independentes. |
| Alterar economia ou arte | O pedido é publicar o jogo existente. |
| Incluir o jogo no lobby ou nos scripts npm da raiz | O AGENTS da aplicação mantém essas integrações fora do escopo. |
| Alterar volumes ou bancos existentes | Serão criados volumes exclusivos para o jogo 2. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Endereço | lafarmer2.gamegamegame.site; HML em hml-lafarmer2.gamegamegame.site | Segue a separação dos jogos; usuário está providenciando login no DNS. | Sim |
| Dependência | Incorporar o commit 05f8332 da PR 45 e validar sua persistência | Corrige perda de perfil e posição que impediria o lançamento persistente. | Escopo necessário ao lançamento |
| Hospedagem | Servidor atual vmi3346990, Dokploy e rede dokploy-network | Alvo confirmado por SSH e pelos serviços existentes. | Sim |
| Dados | PostgreSQL 16, volumes externos exclusivos de HML e produção | Evita qualquer reutilização de dados de outros jogos. | Sim |

**Open questions:** none; decisões registradas acima. O acesso ao DNS depende do login do usuário.

## User Stories

### P1: Acessar e continuar a fazenda

1. WHEN as imagens forem construídas THEN o cliente SHALL incluir o HTML e os assets do vale Three.js, e o servidor SHALL executar com Node 22.
2. WHEN o domínio receber GET /healthz THEN o serviço SHALL retornar HTTP 200 e service igual a lafarmer2-server.
3. WHEN um jogador autenticado conectar em /ws THEN o serviço SHALL enviar o snapshot inicial na mesma origem do cliente.
4. WHEN o servidor receber SIGTERM após confirmar um movimento THEN o serviço SHALL encerrar as conexões e persistir perfil e posição antes de fechar o PostgreSQL.
5. IF DATABASE_URL estiver ausente em produção THEN o servidor SHALL recusar a inicialização em vez de usar memória.
6. The Compose SHALL manter PostgreSQL sem porta publicada e em volume externo exclusivo do ambiente, sem valores padrão para credenciais.
7. WHEN a PR alterar o LaFarmer 2 ou seus artefatos de deploy THEN o CI SHALL executar build e testes desse workspace separado.

**Independent Test:** Construir imagens, subir Compose isolado com PostgreSQL real, criar conta, configurar perfil, mover por WebSocket, reiniciar o servidor e retomar a mesma sessão com o perfil e a posição anteriores.

## Edge Cases

- IF uma variável obrigatória de banco estiver vazia THEN a validação do Compose SHALL falhar antes do deploy.
- WHEN HML e produção forem configurados THEN os routers e volumes SHALL ter identificadores distintos.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DEP-01 | Imagens e assets | Execute | Implementing |
| DEP-02 | Health e WebSocket na mesma origem | Execute | Implementing |
| DEP-03 | Perfil e posição após reinício | Execute | Implementing |
| DEP-04 | Produção exige PostgreSQL | Execute | Implementing |
| DEP-05 | Banco, volumes, credenciais e routers isolados | Execute | Implementing |
| DEP-06 | CI independente | Execute | Implementing |

## Execution Plan

1. Tornar o ciclo de vida do servidor seguro para deploy: index.ts, http.ts, websocket-gateway.ts, game-service.ts, persistence.ts e testes de persistência/encerramento. Verificar com testes e build. Commit fix(lafarmer2): flush persistent state during shutdown.
2. Criar imagens, Nginx, Compose e exemplos de ambiente em infra/docker e infra/dokploy/lafarmer2. Verificar configuração, imagens e smoke com PostgreSQL real. Commit build(lafarmer2): add isolated container deployment.
3. Adicionar CI dedicado e runbook da aplicação. Verificar workflow, documentação e revisão independente. Commit ci(lafarmer2): verify the standalone game before deployment.

## Success Criteria

- Testes e build do workspace aprovados.
- Imagens sobem com banco real e mantêm a sessão, o perfil e a posição após reinício.
- HML responde com HTML, assets, API e WebSocket.
- Produção usa commit integrado à main e o domínio responde com certificado válido.
