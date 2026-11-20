# Antecedentes da pessoa atendida

O cadastro de pessoa atendida oferece quatro campos opcionais, separados, para antecedentes clínicos, antecedentes cirúrgicos, antecedentes familiares e hábitos. Eles seguem a tela e os rótulos observados no mapeamento do produto. Os campos não preenchem valores automaticamente e não representam diagnóstico, evolução, recomendação ou conduta.

Os valores são armazenados no registro versionado `gastro-clinic/patient` e declarados como sensíveis. O serviço de Registros cifra cada campo com `ORBIT_DATA_ENCRYPTION_KEY` e o contexto de produto/tipo/registro/revisão. Sem uma chave configurada, o salvamento falha fechado. A configuração e rotação de uma chave operacional ainda precisam de homologação separada.

O acesso continua sujeito a `plugin.gastro-clinic.read`/`plugin.gastro-clinic.write`, escopo de workspace e permissões do registro. A simulação ROOT continua somente leitura e usa dados fictícios. Em desenvolvimento, use somente registros sintéticos.

Não foram criados campos livres para alergias ou medicamentos: o protótipo mostrava seleção em catálogo e não há um catálogo validado neste produto. Prontuário longitudinal, evolução/nota, prescrição, assinatura e exportação clínica permanecem fora deste módulo.
