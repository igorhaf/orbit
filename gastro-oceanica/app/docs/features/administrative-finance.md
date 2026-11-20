# Financeiro administrativo da Gastro Oceânica

O plugin `gastro-finance` mantém lançamentos administrativos a pagar e receber por workspace. Ele integra-se como plugin filho de `gastro-clinic`, reutiliza o shell e os controles de acesso do Orbit e mantém a navegação sob `/gastro-finance`.

## Funções

- Registrar valores em BRL, representados como inteiros de centavos, com categoria e vencimento opcional.
- Consultar saldo calculado a partir do histórico de liquidações e estornos.
- Registrar liquidações parciais ou totais e filtrar por tipo e situação.
- Anular um lançamento somente enquanto estiver sem movimentos.
- Corrigir uma liquidação por estorno explícito, preservando o evento original e a razão informada.

O plugin aplica permissões de leitura e escrita com escopo de workspace e verifica se o plugin e suas dependências estão habilitados. A simulação ROOT pode exibir dois exemplos sintéticos somente para papéis com permissão de leitura; eles não são persistidos nem autorizam rotas. Chaves de operação idempotentes protegem criação, liquidação e estorno contra repetição. Uma transação com lock da linha do lançamento serializa liquidações concorrentes; constraints e triggers PostgreSQL preservam o saldo e o histórico append-only.

## Persistência

A migration `301_gastro_finance.sql` cria as tabelas `gastro_finance_entries` e `gastro_finance_movements`. Valores precisam ser inteiros positivos dentro do limite definido no serviço e no banco. O banco fixa a moeda como BRL, impede alterações retroativas em lançamentos e proíbe atualizar ou remover movimentos.

Os testes `gastro-finance.postgres.spec.ts` e `gastro-finance.plugin.spec.ts` exercitam a persistência descartável e os exemplos da simulação. A migration é aplicada somente a um cluster PostgreSQL temporário com dados sintéticos. Nenhum banco operacional foi migrado nesta implementação.

## Limites

Este módulo é um livro auxiliar interno. Não emite nota fiscal, não implementa contabilidade, conciliação bancária, folha, convênios/TISS, faturamento clínico nem prontuário. Não armazena nome de paciente, fornecedor ou texto livre de identificação. Seu uso não representa homologação contábil ou institucional.
