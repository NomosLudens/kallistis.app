# KALLÍSTIS.APP — Mapa de Percurso

**Versão:** 0.1 · **Data:** 26/10/2026 · **Situação:** reconstrução local em andamento

## 1. Norte do projeto

Entregar **um aplicativo KALLÍSTIS completo**, jogável e administrável, com chat conversacional, fichas, Forge, Mesas, campanhas e ferramentas do Mestre, tendo **um único estado autoritativo de personagem**. Desenvolver e provar tudo localmente; migrar depois para uma VM dedicada ao KALLÍSTIS e ao Gravewright.

**Repositório novo:** `NomosLudens/kallistis.app`  
**Destino de desenvolvimento:** `/home/tonyus-dev/Portifolio/KALLISTIS_RECOVERY/kallistis-genesis`

O projeto novo não substitui automaticamente a produção atual. Os checkouts antigos, seus WIPs, personagens e banco de produção continuam preservados.

## 2. Fontes de implementação

| Fonte | Aproveitar | Limite |
| --- | --- | --- |
| `NomosLudens/totalidade` | Fundação web, autenticação e chat/streaming onde comprovados | Não importar módulos pessoais ou persistências concorrentes |
| `NomosLudens/velmoor-legacy` | Experiência de criação conversacional que já funcionou | Não importar regras de D&D |
| `NomosLudens/kallistis` | Cânone, catálogos, regras, validadores, fichas, Mesas, progressão e Mestre | Não reproduzir defeitos do Forge/bridge antigo |

Os commits-fonte devem permanecer identificados no Git e na memória de código. Não incluir `.env`, credenciais, exports privados ou históricos Git aninhados.

## 3. Estado observado (último andamento informado pelo Codex)

| Item | Estado | Evidência / limite |
| --- | --- | --- |
| Novo checkout e recuperação das fontes | **Feito, segundo o Codex** | Fonte Totalidade `6ac9aad…`, Velmoor `7c54484…`, KALLÍSTIS `8c6770d…` |
| App local | **Parcial** | `http://127.0.0.1:5175/`, páginas inicial e `/auth` abriram no navegador |
| PostgreSQL de desenvolvimento | **Encontrado** | Serviço local via Docker; schema completo ainda não comprovado |
| IA local | **Encontrada** | Ollama real disponível; conversa e ferramentas ainda não comprovadas |
| Migrações | **Incidente aberto: `0048`** | Migração tentava criar Mestre histórico com UUID fixo; separar schema e dados históricos |
| Login, chat, criação, Forge, recarga | **Não comprovados** | Não existe aceite de fluxo ponta a ponta |
| Produção e deploy | **Intocados, conforme relato** | Nenhum push/deploy de reconstrução confirmado |

**Veredito atual: `IN_PROGRESS / NÃO ACEITO`.** Página renderizada, build ou testes isolados não provam funcionamento do produto.

## 4. Contratos que não podem quebrar

1. **Fonte única:** ficha, Forge e chat leem e alteram o mesmo personagem persistido; operações versionadas e atômicas.
2. **Regras soberanas:** o modelo sugere, o jogador confirma e o servidor valida pelo cânone. A IA não cria opções mecânicas inexistentes.
3. **Persistência verificável:** decisões confirmadas sobrevivem a refresh, logout, login e recuperação do histórico.
4. **Permissões:** proprietário, membro de Mesa e Mestre enxergam apenas o que lhes é autorizado; segredos do Mestre são isolados.
5. **Banco simples e seguro:** PostgreSQL com schema mínimo suficiente, migrations reproduzíveis, RLS efetiva, conexões protegidas, backup e restauração testada.
6. **Dados reais preservados:** importação futura é planejada e reversível; nunca modificar ou fabricar personagens históricos para testar.
7. **Agente sem SQL irrestrito:** caso adotado, recebe ferramentas autorizadas da API, não credenciais amplas do banco.

**Defeito conhecido a impedir de reaparecer:** a ponte antiga descartava chaves `server*` (incluindo `serverCreationProgress`) antes do `PUT`; o repositório substituía o snapshot inteiro. Conferir o novo fluxo antes de reutilizar esse código.

## 5. Gates de entrega — em ordem

| Gate | Entrega exigida | Prova manual obrigatória |
| --- | --- | --- |
| **G0 — Banco e sessão** | Migrações limpas, sem seeds históricos; login real | Usuário entra e sessão resiste à recarga; permissões efetivas |
| **G1 — Personagem real** | Chat + IA real + escolhas canônicas + gravação | Criar, confirmar, abrir ficha, sair, voltar e recuperar ficha/histórico |
| **G2 — Forge integrado** | Edição visual e conversacional do mesmo personagem | Alterar no Forge → ver no chat; alterar no chat → ver no Forge; sem perda de campos |
| **G3 — Jogo completo** | Marcos até 4, inventário, Mesas, campanhas e Mestre | Jogador e Mestre reais percorrem fluxos e limites de acesso |
| **G4 — Gravewright** | Contratos e ações vinculadas ao personagem real | Ação no VTT resulta no estado esperado e auditável na ficha |
| **G5 — Migração** | Importação segura, VM e Cloudflare Tunnel | Restore, migração ensaiada, teste no destino e rollback comprovado |

**Se um gate falhar:** declarar `INCIDENT`, registrar causa concreta, limitar correção ao fluxo afetado e repetir apenas a prova necessária. Não avançar sobre regressão aberta.

## 6. Infraestrutura e IA

- **Agora:** desenvolvimento local com PostgreSQL e modelo real; nenhum mock é evidência de aceite.
- **Depois:** VM Google exclusiva para KALLÍSTIS + Gravewright, acesso por Cloudflare Tunnel. Capacidade de cerca de 1 GB RAM e orçamento ainda **não validados por carga e preço real**.
- **Modelo na VM:** preferencialmente API externa; não presumir Ollama executando modelo grande na VM pequena.
- **Agente:** ZeroClaw é **candidato prioritário**, não uma dependência aprovada. PicoClaw/NullClaw são alternativas investigadas. Só incorporar se demonstrar ganho concreto sobre o chat existente.
- **Memória de ocorrências:** decisões, eventos narrativos e mudanças de ficha podem ser registrados com identidade, Mesa, autoria, horário e versão canônica; segredos não cruzam permissões.

## 7. Próxima ação exata

**Deixar o Codex concluir G0 no checkout novo**: separar a migração `0048` em estrutura e dados históricos, provar autenticação local e então executar G1 com personagem novo de teste autorizado e IA verdadeira. Registrar resultados e hashes sem tocar em produção.

## 8. Definição de pronto

`PASS` apenas quando os fluxos principais forem executados **no navegador, com usuários e dados reais**, persistência reaberta, acesso do Mestre verificado, regras canônicas validadas, ausência de comportamento simulado e caminho de restauração demonstrado. Uma primeira prova bem-sucedida de G1 **não encerra o produto**.

---

**Regra editorial deste mapa:** atualizar estados, decisões e próximo gate. Histórico longo, relatórios antigos e logs permanecem nos respectivos repositórios; este arquivo é somente a bússola operacional atual.
