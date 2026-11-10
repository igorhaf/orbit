# Embeddings e recuperação semântica do Orbit

`OrbitEmbeddingsService` e `OrbitKnowledgeRetrievalService` são capacidades genéricas do plugin Orbit AI. O host seleciona os candidatos depois da autorização, informa o escopo `{ workspaceId, pluginId, collectionId }` e recebe os itens classificados; o serviço não descobre registros, concede acesso nem persiste texto da consulta ou dos documentos.

## Configuração e retenção

- `ORBIT_AI_EMBEDDINGS_ENABLED=false` por padrão. Habilite explicitamente apenas após avaliar o fluxo e o provedor.
- `ORBIT_OPENAI_EMBEDDINGS_API_KEY` é uma credencial separada; ela não reutiliza a chave de transcrição.
- O modelo atual é `text-embedding-3-small` com 1536 dimensões.
- A tabela guarda o hash SHA-256 do texto normalizado e o vetor, particionados por workspace, plugin proprietário e coleção. Alterações na coleção substituem os hashes atuais durante a consulta.
- Se o host informar uma coleção vazia, o serviço remove somente o cache daquela coleção.
- `OrbitKnowledgeRetentionWorker` apaga índices cuja última atividade passou de 30 dias. O worker executa no boot e diariamente, independentemente de consultas vetoriais ou da disponibilidade de embeddings. Falhas são registradas e tentadas novamente no ciclo seguinte.
- A instância host registra esse worker no módulo de aplicação que fornece `Db`; `AiPluginModule` continua global e exporta o adaptador de embeddings sem depender do módulo raiz para injeção de banco.

## Privacidade e autorização

Um vetor pode revelar significado, tema ou características do texto de origem. Embeddings **não são anonimização** e continuam sendo dados potencialmente sensíveis. O host precisa reduzir o texto ao mínimo necessário, obter autorização antes de montar os candidatos, limitar escopo e coleção, considerar os termos de processamento/retenção do provedor e manter o recurso desativado quando não houver aprovação para envio externo. O serviço não recebe perguntas até o host chamar a recuperação e nunca as grava na tabela.

Quando embeddings estiverem desativados, sem chave ou indisponíveis, os plugins host devem oferecer a recuperação lexical ou uma resposta degradada segura. Suindá usa a recuperação vetorial somente após autorizar a matrícula e filtra conteúdo publicado e liberado; essa regra pertence ao plugin filho, não ao serviço genérico.
