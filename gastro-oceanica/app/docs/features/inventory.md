# Inventário administrativo

O plugin filho `gastro-inventory` mantém catálogo de produtos, lotes, entradas, saídas e histórico append-only por workspace. Movimentos validam produto/lote no mesmo escopo, usam chave idempotente e transação, e impedem saída acima do saldo disponível.

O estoque é administrativo. Não calcula dose, prescrição, consumo clínico ou exigência sanitária. Use dados sintéticos até a instituição aprovar seus próprios parâmetros e executar as migrations no banco isolado do produto.
