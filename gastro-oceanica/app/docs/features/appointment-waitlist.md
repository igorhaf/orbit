# Lista de espera administrativa

A lista de espera usa os registros versionados do plugin `gastro-clinic` e fica disponível em **Extensões → Gestão clínica administrativa → Novo registro → Lista de espera**. Cada item aponta para uma pessoa atendida ativa no mesmo workspace. O exemplo ROOT é sintético, somente de leitura e só aparece quando a simulação tem a permissão de consulta.

## Ciclo

- Criar o registro no estado `waiting` (Aguardando), escolhendo a pessoa existente.
- Remover pela transição versionada para `removed` (Removido). O estado final é imutável e preserva o histórico de auditoria do Orbit.
- A validação usa a resolução de registros autorizada pelo Core, que limita a busca ao workspace corrente e aplica permissão de leitura. Referência inexistente, inativa, de outro tipo ou sem acesso é recusada.

## Limites observados

As referências externas documentam inclusão e remoção de uma pessoa sintética. A ação de conversão **Agendar** não foi validada. Por isso, a lista não cria agendamentos nem aciona lembretes, cobrança ou integrações. O estado `removed` substitui a exclusão visual observada para preservar a trilha versionada do Orbit.
