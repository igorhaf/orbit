# Validação do SafDoulas sem navegador

O produto é de acreditação institucional de cursos; dados pedagógicos são evidências da análise documental.
A validação não executa aulas, matrículas nem atividades de estudantes e não simula autorização do MEC.

## Verificações

Execute na raiz de `safdoulas-v2/app`, em sequência:

```sh
npm test -w apps/api
ORBIT_NEXT_DIST_DIR=.next-validation npm run build
node scripts/safdoulas-validate.mjs "/pasta/dos/treze/documentos"
```

A integração cria um banco descartável no PostgreSQL DEV existente, aplica as migrations e remove o banco ao terminar, inclusive em caso de falha.
Não usa os dados do banco SafDoulas, não inicia serviços e não executa Selenium, Chrome ou ChromeDriver.

A suíte verifica os checksums dos 13 documentos e a preparação idempotente das fontes, matriz, formulários, modelos e regras de demonstração.
O percurso cobre protocolo, triagem, cegamento com revisão independente, alinhamento comprovado, dupla de acreditadoras sem root, certificado de habilitação em PDF, avaliações com 80 critérios, consolidação, votos, concessão e pasta do processo.
Também verifica a negativa de acesso ao original e ao parecer alheio, dependências desativadas, transições autorizadas, conteúdo final imutável e retirada de publicação.
Os testes unitários complementam o percurso com diligências, recurso, divergências/terceira análise, conflitos, retenção, relatórios e consulta pública.

## Preparação da instância

`scripts/safdoulas-prepare.ts` importa os originais e prepara somente os registros de demonstração em um workspace próprio, usando o motor de registros e suas validações.
Exige `DATABASE_URL` do banco `safdoulas`, uma conta root ativa e a pasta dos 13 documentos; pode ser repetido sem duplicar os registros.
Não sobrescreve registros reais, não cria cursos fictícios como acreditações reais e não publica o portal ou um selo sem os arquivos e autorizações correspondentes.
O backup local anterior à preparação está em `safdoulas-v2/data/backups/pre-scope-completion-20261021.dump`.

## Limites da evidência

Nenhum teste de navegador foi executado, conforme a restrição deste host.
A resposta HTTP das páginas e os testes de API não comprovam, sozinhos, a renderização e os gestos em dispositivos móveis.
SMTP, assinatura institucional, envio externo e recebimento pelo MEC exigem os serviços e comprovantes reais; a suíte usa somente atores e documentos fictícios no banco descartável.

## Demonstração solicitada

`TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx scripts/safdoulas-demo.ts /pasta/dos/documentos /pasta/privada/relatorios` prepara onze contas fictícias, nove perfis institucionais mais administração técnica e a segunda acreditadora, sem criar nem alterar root.
O comando exige o banco `safdoulas`, preserva o manifesto de credenciais com modo 0600 e pode retomar uma preparação interrompida.
Mantém três processos: rascunho sem protocolo, avaliação em andamento e decisão/concessão simuladas, com duas avaliações e votação da governança e diretoria.
Os documentos originais e o histórico normativo supersedido são preservados; não havia processos legados fora desse escopo na base revisada.

`node scripts/safdoulas-demo-verify.mjs /pasta/privada/relatorios` verifica login, perfis, navegação HTTP e recusas de acesso na API SafDoulas já em funcionamento; exige DATABASE_URL e JWT_SECRET dessa instância no ambiente, sem imprimi-los.
O resultado fica em `validacao-demo.json`, sem tokens e sem senhas.
Relatório com senhas e manifesto permanecem em `safdoulas-v2/data/reports`, fora dos três checkouts de código e fora do cofre.

Os comprovantes usam o vínculo genérico `related_record_id`/`related_record_revision` do plugin Documentos; `source_id` permanece reservado à origem de cópias anonimizadas.
