# Catálogo e impacto de alterações

O catálogo é reconstruído a partir dos fontes dos runtimes declarados em `orbit.workspace.json`. Ele usa o parser TypeScript já instalado no projeto, sem importar ou executar módulos da aplicação e sem exigir serviço, banco, Docker ou acesso externo.

```sh
node tools/orbit/cli.mjs catalog
node tools/orbit/cli.mjs catalog --runtime suinda
node tools/orbit/cli.mjs impact --files dev/app/apps/api/src/plugins/contract.ts
node tools/orbit/cli.mjs impact --base HEAD~1
```

`catalog` retorna os runtimes, versões do core e plugins descobertos, com caminhos e linhas de origem, versões, dependências, pai, capacidades, permissões declaradas, ações, eventos e contribuições. `registered` indica que existe uma chamada de registro no fonte; não informa instalação ou ativação efetiva guardada no banco. Registros dentro de condições de produto aparecem como capacidades disponíveis no código. Definições declaradas ainda sem registro também aparecem.

A leitura estática reconhece objetos, constantes importadas, factories, parâmetros de classes de injeção, campos declarados, spreads, templates, helpers e arrays de plugins. Nenhum construtor, provider ou handler é executado. Uma factory não resolvida na chamada de registro ou uma dependência não resolvida gera diagnóstico; o catálogo não assume que um serviço externo esteja disponível.

Os diagnósticos cobrem IDs duplicados, dependências ausentes, ciclos, pai sem dependência explícita, versões inválidas, incompatibilidade com a versão/API do core, duplicação de capacidades/ações/eventos e divergência de contratos declarativos entre runtimes que contêm o mesmo plugin. As regras de validação executáveis e os estados no banco precisam das verificações de integração existentes. A comparação estática não prova equivalência dos handlers.

`impact` analisa arquivos fornecidos ou combina alterações staged, unstaged e arquivos não rastreados que o Git não ignora. `--base` acrescenta a diferença entre aquele commit e `HEAD`. Os caminhos nunca podem sair da raiz do repositório.

A análise segue importações estáticas, exports, imports dinâmicos literais, `require` literal e dependências entre plugins. Os mapeamentos `sharedPackages[].files` propagam mudanças na fonte compartilhada para as projeções de todos os consumidores. Uma alteração não mapeada dentro de um pacote, como seu manifesto, alcança todos os módulos projetados desse pacote. Mudanças em ferramentas selecionam os testes das ferramentas. Caminhos compartilhados desconhecidos e configuração estrutural acionam cobertura conservadora em todos os runtimes.

A saída lista arquivos, plugins e runtimes afetados e recomenda comandos existentes com justificativas. Os comandos são arrays de argumentos e não são executados pela análise. Typechecks usam a instalação local de TypeScript, sem download implícito. Testes unitários que importam código afetado são selecionados; testes que dependem de banco ou navegador ficam para a integração correspondente. Um marco amplia a cobertura funcional conforme as regras do projeto. `context.write_scope`, verificações obrigatórias do cartão e restrições de ciclo de vida permanecem aplicáveis.

Exemplos de decisão:

| Alteração | Cobertura recomendada |
| --- | --- |
| Fonte de contrato compartilhado | Projeções, consumidores transitivos, contratos e testes relacionados nos runtimes |
| Implementação de plugin base | Plugin base, dependentes declarados e testes que importam os consumidores |
| Arquivo exclusivo de Suindá | Consumidores e verificações de Suindá |
| Ferramenta do CLI | Testes das ferramentas e contrato de compatibilidade |
| Configuração compartilhada desconhecida | Verificações conservadoras dos quatro runtimes |

O catálogo processa um runtime por vez e guarda apenas metadados JSON em `.orbit/cache/catalog`. Cada entrada depende do hash da ferramenta, de todos os fontes API, da versão do core e dos módulos importados fora desse conjunto; qualquer mudança nessas entradas invalida o resultado. Uma entrada corrompida ou um diretório de cache indisponível provoca reconstrução. O grafo de imports usa a pré-análise de tokens do TypeScript sem reter árvores sintáticas dos quatro aplicativos. Diretórios de builds `.next*` são ignorados. Mudanças apenas em ferramentas/documentação usam um caminho direto que dispensa análise das aplicações. Cache de comandos e evidências pertence ao executor de verificações e também deve usar hashes das entradas.

API para outras ferramentas:

```js
import { catalogRuntime, buildCatalog, analyzeImpact, execute } from './tools/orbit/catalog.mjs';
const catalog = catalogRuntime(root, { id: 'dev', app: 'dev/app' });
const all = buildCatalog(root, config);
const impact = analyzeImpact(root, config, changedPaths);
const result = await execute('catalog', ['--runtime', 'dev'], { root, config });
```
