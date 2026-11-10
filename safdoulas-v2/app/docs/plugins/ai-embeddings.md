# Orbit AI: embeddings e recuperação vetorial

O plugin global `ai` oferece duas capacidades reutilizáveis para plugins host: `OrbitEmbeddingsService`, que chama o provedor de embeddings, e `OrbitKnowledgeRetrievalService`, que mantém um cache vetorial particionado e classifica candidatos autorizados pelo host.

## Uso pelo plugin host

O host deve declarar `ai` em `PluginDefinition.dependencies` se a funcionalidade depender dessa capacidade. Autentique e autorize a pessoa e obtenha os registros permitidos **antes** de chamar a recuperação. O serviço não consulta registros de negócio nem concede acesso: ele recebe os candidatos já autorizados e devolve seus valores originais em ordem de similaridade.

```ts
import { OrbitEmbeddingsService } from "../ai/embeddings";
import { OrbitKnowledgeRetrievalService } from "../ai/knowledge-retrieval";

const retrieval = new OrbitKnowledgeRetrievalService(db, embeddings);
const results = await retrieval.rank(
  { workspaceId, pluginId: "plugin-host", collectionId: "course:123" },
  question,
  authorizedRecords.map((record) => ({ key: record.id, text: record.indexText, value: record })),
);
```

`workspaceId` é o workspace que contém os dados; `pluginId` identifica o plugin proprietário; `collectionId` é uma chave estável definida pelo host. Os três fazem parte da chave do cache. O host não deve passar registros de outros workspaces ou conteúdo que a pessoa não pode ler. Use um identificador de coleção diferente quando o conjunto autorizado ou o propósito de indexação forem independentes.

## Configuração e dados

O recurso é opt-in. Configure `ORBIT_AI_EMBEDDINGS_ENABLED=true` e `ORBIT_OPENAI_EMBEDDINGS_API_KEY` somente no ambiente da API. O modelo é `text-embedding-3-small`, com 1.536 dimensões. Desativado ou sem chave, `isAvailable()` retorna `false` e `rank()` devolve uma lista vazia sem chamar o provedor; o host pode então usar sua recuperação lexical.

Na chamada ativa, a API envia a pergunta e o texto dos candidatos selecionados ao endpoint de embeddings da OpenAI. A tabela `orbit_knowledge_embeddings` guarda somente SHA-256 do texto normalizado e o vetor; não guarda o texto, a pergunta, a chave do candidato nem o valor retornado pelo host. A tabela particiona cada vetor por workspace, plugin proprietário, coleção, modelo e hash.

Cada busca limita a 200 candidatos, 6.000 caracteres por candidato, 8.000 caracteres por consulta e lotes de até 64 entradas ao provedor. A busca classifica por similaridade cosseno, filtra resultados abaixo de `0.15` e retorna até oito (cinco por padrão). O chamador continua responsável por preparar o texto de indexação com minimização adequada e por aplicar qualquer filtro adicional de produto.

## Cache e retenção

Quando a coleção atual é informada, vetores de hashes que já não fazem parte dela são removidos apenas dentro do mesmo workspace/plugin/coleção. Vetores reutilizados, inclusive em cache hit, recebem `updated_at=now()`. O serviço singleton de retenção expurga vetores sem atividade há mais de 30 dias imediatamente ao iniciar a API e depois uma vez por dia. Esse ciclo é independente do tráfego de busca e continua ativo quando embeddings estão desativados ou sem configuração. Falhas são registradas e tentadas novamente no próximo ciclo diário. A coleção informada sem candidatos remove somente seu próprio cache. A migração `147_orbit_knowledge_embeddings.sql` cria a tabela e a `148_orbit_knowledge_embedding_retention.sql` cria o índice de expurgo por data. O bootstrap `schema.sql` contém a mesma estrutura para bancos novos.

## Limites de autorização

O retriever não oferece endpoint nem autorização por conta própria. Chamadas devem ocorrer em serviços do plugin host, depois da autorização vigente, com escopo montado pelo servidor. Não aceite `workspaceId`, `pluginId` ou `collectionId` arbitrários do cliente para acessar outra partição. A dependência do plugin `ai` deve ser declarada para que a desativação do recurso base também suspenda as funcionalidades dependentes conforme o registro de plugins Orbit.
