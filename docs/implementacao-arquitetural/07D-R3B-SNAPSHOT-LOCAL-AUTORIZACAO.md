# 07D-R3B — Snapshot local da autorização editorial

Fundação local implementada. O contrato registra observações do processo e detecta divergências nos campos conhecidos. Toda observação de fontes vivas continua parcial e não verificável para fins de autorização.

## Estado e arquivos

A branch `main` estava no HEAD `d9307b8`. DEV, PROD, Safdoulas e Suindá registram Core fonte 1.12.5 com 231 mappings. A migration 209 está distribuída. 210 e 211 permanecem na fonte. R05 continua resolvido. R02, R06 e R08 continuam abertos.

- `packages/orbit-core/src/execution/editorial-authorization-snapshot.ts` contém o contrato de observação, selagem, validação, comparação e erros.
- `packages/orbit-core/src/execution/editorial-authorization-snapshot.spec.ts` cobre integridade do valor e as quatro variantes com classes reais em fixtures.
- `{dev,prod,safdoulas,suinda}/app/apps/api/src/access/access.ts` ganhou `editorialProviderInventory()`, uma leitura de contagens e chaves. Os mutadores, o detector vigente e as permissões continuam com o comportamento anterior.
- Este relatório completa a entrega. Os novos arquivos do Core permanecem na fonte canônica e os manifests de projeção continuam com 231 entradas.

## Contrato e origem dos dados

| Campo | Origem e interpretação |
|---|---|
| `schemaVersion`, `runtimeId` | Contrato v1 e identificador lógico fornecido pela camada interna que seleciona as instâncias observadas. O identificador é validado estruturalmente e não autentica a origem das instâncias. |
| `providers`, `providerPresent` | Contagem por família no AccessService, com chaves dos Maps de escopo e membership. Os arrays fornecem apenas contagem. A presença também é consultada pelo detector usado pelo host editorial. A ausência de família esperada ou divergência em relação ao detector gera motivo de recusa. |
| `permissions` | IDs do catálogo de permissões do AccessService. O catálogo não guarda os grants de uma pessoa. |
| `plugins` | IDs do catálogo visível e IDs conhecidos fornecidos pelo chamador interno. O mesmo PluginRegistry fornece versão declarada, dependências, plugin pai, instalação e habilitação efetivas. `configuredEnabled` distingue a configuração explícita da habilitação efetiva de um plugin bloqueado por dependência. Para plugin conhecido oculto, esse campo é `null`. |
| `configurationIdentity`, `digest` | SHA-256 da configuração observada e do corpo normalizado do snapshot, respectivamente, usando o JSON canônico do Core. Ambos identificam conteúdo, sem atestar quem o produziu. |
| `completeness`, `verification`, `reasons` | `partial` e `unverifiable` nesta versão. As razões cobrem fontes vivas sem selo, inventário parcial do registry, família desconhecida, provider sem homologação e possível divergência de detecção. |

`sealEditorialAuthorizationSnapshot` seleciona somente os campos conhecidos, valida tipos e identificadores, ordena listas sem depender de locale e congela todas as estruturas que produz. O snapshot não retém referências ao AccessService, ao PluginRegistry ou a callbacks. Campos desconhecidos do catálogo não entram no valor. Uma família desconhecida é registrada como motivo, sem transportar o identificador recebido.

`verifyEditorialAuthorizationSnapshot` reconstrói a forma canônica de um valor JSON, valida v1 e compara os dois hashes e o corpo completo. Falhas usam códigos fixos de schema, integridade ou fonte indisponível. `compareEditorialAuthorizationSnapshots` retorna `changed` com os grupos alterados ou `unverifiable` quando as observações coincidem. A comparação evita mostrar valores internos em diagnósticos.

## Mutações e limites

- Adição de provider, alteração de chave ou contagem, mudança de ID do catálogo, versão declarada, dependências e instalação/habilitação observáveis mudam o digest. O valor anterior permanece congelado. Observar uma configuração equivalente após reconstrução do registry produz o mesmo digest.
- A substituição por `Map.set` sob a mesma chave, troca por `setAuthorizer`, mudança interna de uma closure, alteração de metadados fora da seleção e mutações que ocorram e revertam entre observações podem manter o digest. O inventário visível também omite plugins ocultos desconhecidos. A versão de plugin é declarativa. Esta etapa não tem uma fonte confiável de identidade de software ou de geração local e não preenche esses dados.
- O selo protege o valor observado. O registry continua mutável. O contrato ainda não vincula a observação à janela de autorização ou ao COMMIT, e não coordena instâncias. Alterações detectadas geram divergência quando comparadas. Um digest igual permanece não verificável.

## Compatibilidade e evidência

Os testes carregaram os objetos reais AccessService e PluginRegistry de DEV, PROD, Safdoulas e Suindá, com o loader e tsconfig de cada runtime. O inventário contém 11 famílias comuns e inclui `scoped_permission` e `request_permission` no Suindá. As fixtures exercitaram Vault instalado, desativado e oculto sem presumir a configuração real de cada produto. Os casos de regressão confirmaram o acesso editorial por concessão explícita e a recusa durante simulação nos quatro runtimes.

- **10/10 testes dirigidos**, sendo seis novos e quatro de regressão em `tools/orbit/discovery-editorial-access.test.mjs`. Incluem determinismo, independência das referências, integridade, falha sanitizada, mutações conhecidas, substituição invisível, instâncias divergentes e registry reconstruído.
- O teste do host confirmou a recusa de provider cadastrado antes de SQL e a sequência exata das 13 tabelas em SHARE na entrada nativa. O teste usa conexão de fixture para verificar o contrato e não mede concorrência PostgreSQL.
- TypeScript dirigido em modo estrito passou para o novo contrato e seu spec. Nenhum teste usou banco operacional.

## Bloqueios e R3C

O snapshot é utilizável para inspeção interna. O host editorial conserva o detector anterior e não consome o digest para conceder permissão. O Discovery Review segue desativado. As fontes de política e evidência de produção, MCP/Codex nativo, as migrations 210/211 nos produtos e os findings R02, R06 e R08 continuam bloqueados.

Para R3C, primeiro definir quem produz e valida a identidade de configuração por banco e runtime. Mapear os writers de `plugin_settings` e `plugin_installations` e as mutações de bootstrap/catalogação que precisam participar. Vincular mudança e avanço de geração à mesma transação e avaliar o snapshot local selado contra a geração protegida até o COMMIT. Cobrir duas instâncias, versão mista, corrida após o último check, conexão perdida e retry idempotente. Manter a recusa dos providers não homologados e os 13 locks enquanto a cobertura dos writers e dos papéis SQL estiver pendente.
