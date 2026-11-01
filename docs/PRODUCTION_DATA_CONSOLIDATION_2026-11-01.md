# Consolidação de dados do Genesis em produção — 2026-11-01

## Estado operacional

- Aplicação: `https://genesis.kallistis.app`
- Release que executou a consolidação de dados: `16203fc28d49a0676cf581a8e69aed7cb057f250`
- Branch publicada: `codex/genesis-production-auth`
- Banco operacional: PostgreSQL `kallistis_genesis`
- O volume da antiga QA `kallistis_genesis_pg_data` foi preservado como origem histórica; a produção é a fonte operacional dos registros elegíveis consolidados.
- Não foi executada migration de schema nem alterado código nesta consolidação.

## Backup anterior à importação

- Artefato: backup PostgreSQL de produção criado imediatamente antes da importação (cópia protegida local e cópia no bucket operacional de backups)
- SHA-256: `c54112fdbc694acb791c6b5f8b1b65aa15be3c1053fa926145cbad8cc70fef95`
- O formato foi verificado com `pg_restore --list` (495 entradas). A restauração deste backup específico não foi executada.

## Reconciliação

As contas e perfis existentes foram associados às identidades de produção. Credenciais, sessões, convites e papéis de produção não foram substituídos. A importação foi transacional e utilizou o usuário de banco da aplicação; registros com chaves existentes foram preservados.

| Registro | Antes | Depois | Resultado |
|---|---:|---:|---|
| Usuários | 9 | 9 | Identidades reutilizadas; sem duplicação |
| Credenciais | 9 | 9 | Credenciais de produção preservadas |
| Perfis | 8 | 8 | Campos de perfil conferidos após associação de identidade; valores de produção mantidos |
| Personagens | 2 | 5 | 3 fichas elegíveis adicionadas; 2 cópias idênticas preservadas |
| Versões de ficha | 96 | 156 | 60 adicionadas; 96 cópias idênticas preservadas |
| Eventos de ficha | 96 | 156 | 60 adicionados; 96 cópias idênticas preservadas |
| Mensagens de criação | 139 | 184 | 45 adicionadas; 139 cópias idênticas preservadas |
| Memórias de criação | 2 | 3 | 1 adicionada; 2 cópias idênticas preservadas |
| Mensagens do Chat Geral | 2 | 51 | 49 adicionadas |
| Mesas | 3 | 3 | Mesas existentes preservadas; a mesa operacional de teste manteve sua identidade |
| Vínculos de mesa | 7 | 8 | 1 vínculo de Mestre adicionado; cinco vínculos existentes reconciliados sem alterar papel/status |

Os oito threads de chat, 41 mensagens de chat, duas memórias do agente, cinco sedimentos e uma preferência coincidiam por chave e conteúdo; não foram duplicados. Papéis de contas existentes foram confirmados pelas APIs protegidas; eventos administrativos da QA não foram importados. Não havia campanhas nem sessões de mesa ativas na origem.

## Registros de validação mantidos somente na QA

A origem continha uma ficha de validação local e resíduos operacionais associados. Esses registros não foram importados: pertencem ao runtime `KALLISTIS_NEXO_1` de validação, cujas tabelas/APIs não fazem parte do release operacional `16203fc`. A mesa de validação não foi duplicada; os vínculos elegíveis de participantes foram reconciliados com a mesa de teste já existente em produção. A QA permanece intacta como arquivo da origem.

Credenciais, sessões de autenticação, convites, estados OAuth, confirmações transitórias e ledger de migrations da QA não foram importados.

## Verificação funcional

- Após a importação, o serviço `kallistis-genesis.service` foi reiniciado uma vez, permaneceu ativo e `https://genesis.kallistis.app/api/public/health` respondeu `200`.
- Com a autenticação privada da proprietária, a lista real exibiu três fichas; a ficha NEXO prioritária abriu, mostrou a versão 19 e manteve os dados após recarga. A conversa de criação salva também foi exibida pela interface.
- O banco confirma a propriedade pela conta correta, 19 versões, 19 eventos e 8 mensagens de criação para essa ficha. A interface atual não apresenta uma lista/navegação para abrir versões históricas individualmente; uma navegação visual de versões fica registrada como melhoria futura.
- Na administração real da mesa de teste, a interface mostrou dois vínculos de Mestre e quatro de jogador. A frase de acesso foi digitada apenas na página de login; não foi copiada, redefinida nem registrada.
- Durante a consulta da Central do Mestre, um painel exibiu erro de limite de conexões PostgreSQL; a lista de membros da mesa carregou. Esse erro não foi investigado nem alterado nesta consolidação.

## Proteção e continuidade

- Produção, QA original, credenciais e dados anteriores foram preservados.
- Nenhuma migration, publicação de código, merge ou deploy adicional foi executado nesta consolidação.
- A consolidação de registros elegíveis foi commitada atomicamente, sem conflitos de chave; o backup e a QA original permanecem disponíveis para recuperação e auditoria.
- Este documento contém somente estado operacional agregado; não registrar frases de acesso, hashes de credenciais, mensagens privadas ou dados de ficha.

## Incidente de conexões PostgreSQL — correção em 2026-11-01

- Causa no código: `createBunPostgresExecutor` criava um `Bun.SQL` novo em cada requisição; os handlers chamavam `close()` ao final. Em Bun 1.3.14 cada instância possui seu próprio pool de até 10 conexões, de modo que as chamadas concorrentes da Central do Mestre podiam multiplicar os pools. O PostgreSQL estava configurado com `max_connections=100`.
- Correção: commit `bf77185600aa4566b5703ae8ff2eb9a65b17d56a`; o adaptador Bun agora reutiliza um pool por URL no processo e não fecha esse pool ao final de cada requisição. Os adaptadores `pg.Client` e Hyperdrive não mudaram.
- Release ativo após a correção: `/opt/kallistis/releases/20261101-genesis-pg-pool-bf77185`; entrypoint Bun verificado por SHA-256 `7890b6ae3b425914cce01a2aa58127a5f34d87ed047408b0dd483ef4d9201122`. O release anterior permanece disponível para rollback de código.
- Após o deploy, a Central do Mestre carregou sem a mensagem de limite de conexões; `pg_stat_activity` mostrou 10 conexões ociosas do app de 100 permitidas, estáveis após abrir a lista e a ficha. Nenhum erro `sorry, too many clients already` apareceu nos logs PostgreSQL desde a publicação.
- O login já autenticado, a lista de personagens e a ficha NEXO prioritária abriram; a versão 19 persistiu após recarga. Não houve migration nem alteração de dados PostgreSQL neste incidente.
