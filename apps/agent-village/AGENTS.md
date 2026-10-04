# Vila dos Agentes

Aplicação independente: servidor Node22 em `server/`, cliente Vite/Three em
`web/`, porta API 3340 e Vite 5176. Não conecte auth ou arquivo persistido a
outros jogos. Uma réplica por volume; o store serial não é multi-processo.

Leia a spec `.specs/features/agent-village/` antes de alterar o protocolo.
Um robô representa uma sessão. IDs de provedor, argumentos, prompts e tokens
nunca aparecem na projeção de outro membro. `none` é o default; apenas o
dono altera privacidade. Token do coletor só envia eventos do robô vinculado.

`npm test`, `npm run typecheck`, `npm run build` neste workspace são os gates.
QA browser e persistência em volume Docker são validações separadas. A demo
é fictícia e não monitora contas. Preserve `/healthz` e API mesma origem.
