# Configurações de execução aplicadas

Estas cópias permitem revisar as mudanças nos arquivos Compose que ficam fora dos repositórios Git das aplicações. Os caminhos relativos das cópias continuam sendo relativos às pastas originais; use os arquivos reais para operar os serviços.

| Cópia | Arquivo real |
|---|---|
| orbit.compose.snapshot.yml | /home/meada/projetos/orbit/compose.yml |
| suinda.compose.snapshot.yml | /home/meada/projetos/orbit/suinda/compose.yml |
| safdoulas-v2.compose.snapshot.yml | /home/meada/projetos/orbit/safdoulas-v2/compose.yml |

Os arquivos `.patch` mostram a diferença em relação à configuração anterior à intervenção. Nenhum `.env`, token ou conteúdo de banco foi copiado. Os snapshots anteriores e evidências estão em `/home/meada/projetos/orbit/control/state/ram-20261101/`.

O frontend Safdoulas usa o volume `orbit_safdoulas_v2_web_node_modules`, provisionado a partir do `node_modules` local validado, com Next 16.4.3. O volume anterior foi preservado para os consumidores existentes. Os frontends continuam com bind mount do código e `next dev`.

Limites de memória são tetos individuais, não reservas nem garantia de que a soma dos picos cabe nos 11,47 GiB do host. A reserva configurada é proteção suave de páginas sob pressão, não RAM pré-alocada. Builds de validação usam saída separada e são serializados. O uso normal e a pressão de memória precisam continuar sendo acompanhados.
