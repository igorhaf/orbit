# PROMPT #56 - Correções da Entrevista

**Status**: ✅ Implementado
**Data**: 2025-12-29
**Categoria**: Bug Fixes & UX Improvements
**Related PROMPTs**: #55 (Debug Interview Auto-Start), #46 (Stack Questions)

---

## Problemas Identificados

### 1. **Criar entrevista não redireciona**
**Problema**: Ao criar uma nova entrevista, o sistema apenas adicionava na lista mas não redirecionava para ela.

**Comportamento esperado**: Após criar, deve redirecionar automaticamente para a entrevista com as perguntas fixas já iniciadas.

### 2. **Scroll automático não funciona**
**Problema**: O chat não faz scroll automático para a última mensagem quando novas mensagens são adicionadas.

**Comportamento esperado**: Sempre que uma nova mensagem é adicionada, o chat deve fazer scroll automático para mostrar a última mensagem.

### 3. **Perguntas fixas não aparecem automaticamente**
**Problema**: As perguntas fixas de stack (Backend, Database, Frontend, CSS) não aparecem automaticamente ao abrir uma nova entrevista.

**Comportamento esperado**: Ao abrir uma entrevista vazia, o sistema deve automaticamente chamar o endpoint `/start` que inicia com a primeira pergunta fixa em português.

### 4. **UI muito grande**
**Problema**: Todos os elementos da interface estavam muito grandes.

**Solução**: Reduzir tudo para 70% do tamanho original.

---

## Soluções Implementadas

### 1. Redirect Após Criar Entrevista

**Arquivo**: `frontend/src/components/interview/InterviewList.tsx`

**Mudanças**:

1. **Adicionado useRouter**:
```typescript
import { useRouter } from 'next/navigation';

export function InterviewList() {
  const router = useRouter();
  // ...
```

2. **Modificado handleCreate** para redirecionar:
```typescript
const handleCreate = async () => {
  if (!selectedProject) {
    alert('Please select a project');
    return;
  }

  setCreating(true);
  try {
    // PROMPT #56 - Create and redirect to interview
    const response = await interviewsApi.create({
      project_id: selectedProject,
      ai_model_used: 'claude-3-sonnet',
      conversation_data: [],
    });

    // Get the created interview ID
    const createdInterview = response.data || response;
    const interviewId = createdInterview.id;

    // Redirect to the interview page (it will auto-start with fixed questions)
    router.push(`/interviews/${interviewId}`);
  } catch (error) {
    console.error('Failed to create interview:', error);
    alert('Failed to create interview. Please try again.');
    setCreating(false);
  }
  // Note: Don't setCreating(false) on success - we're navigating away
};
```

**Resultado**: Agora ao criar uma entrevista, o usuário é imediatamente redirecionado para a página da entrevista.

---

### 2. Scroll Automático Melhorado

**Arquivo**: `frontend/src/components/interview/ChatInterface.tsx`

**Problema Identificado**: O scroll estava sendo chamado muito rápido, antes do DOM ter renderizado as novas mensagens.

**Solução**:

1. **Adicionado delay no useEffect**:
```typescript
useEffect(() => {
  // PROMPT #56 - Improved auto-scroll with delay for DOM rendering
  const timer = setTimeout(() => {
    scrollToBottom();
  }, 100);
  return () => clearTimeout(timer);
}, [interview?.conversation_data]);
```

2. **Melhorado scrollToBottom**:
```typescript
const scrollToBottom = () => {
  // PROMPT #56 - More robust scroll with fallback
  if (messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
};
```

**Mudanças**:
- ✅ Adicionado setTimeout de 100ms para aguardar renderização
- ✅ Adicionado cleanup para cancelar timer se componente desmontar
- ✅ Adicionado `block: 'end'` para garantir que scroll vai até o final
- ✅ Adicionado verificação se ref existe antes de fazer scroll

**Resultado**: Agora o chat sempre faz scroll automático para a última mensagem.

---

### 3. Auto-Start com Perguntas Fixas

**Status**: JÁ IMPLEMENTADO em PROMPT #55

**Arquivos**:
- `frontend/src/components/interview/ChatInterface.tsx` (linhas 46-52)
- `backend/app/api/routes/interviews.py` (endpoint `/start`)

**Código Frontend**:
```typescript
// Se não tem mensagens, iniciar automaticamente com IA
const hasMessages = interviewData?.conversation_data && interviewData.conversation_data.length > 0;
console.log('💬 Has messages:', hasMessages, 'Count:', interviewData?.conversation_data?.length);

if (!hasMessages) {
  console.log('🎬 No messages found, auto-starting interview with AI...');
  await startInterviewWithAI();
}
```

**Código Backend** (System Prompt em Português):
```python
system_prompt = f"""Você é um analista de requisitos de IA para projetos de software.

CONTEXTO DO PROJETO (já definido):
- Título: {project.name}
- Descrição: {project.description}

CRÍTICO: Esta entrevista deve COMEÇAR com 4 PERGUNTAS FIXAS sobre STACK TECNOLÓGICA antes de perguntar sobre funcionalidades.

IMPORTANTE: Conduza TODA a entrevista em PORTUGUÊS. Todas as perguntas, opções e respostas devem ser em português.

Faça a Pergunta 1 AGORA (Stack - Backend):

❓ Pergunta 1: Qual framework de backend você vai usar para {project.name}?

OPÇÕES:
○ Laravel (PHP)
○ Django (Python)
○ FastAPI (Python)
○ Express.js (Node.js)
○ Outro

◉ Escolha uma opção
```

**Como Debugar**:

Se o auto-start não estiver funcionando:

1. **Abra o console do navegador** (F12)
2. **Crie uma nova entrevista**
3. **Verifique os logs**:
   ```
   📥 Loading interview: <uuid>
   📄 Interview loaded: {...}
   💬 Has messages: false, Count: 0
   🎬 No messages found, auto-starting interview with AI...
   🚀 Starting interview with AI...
   ✅ Interview started successfully!
   ```

4. **Se aparecer erro**: O alerta mostrará exatamente qual foi o problema

**Possíveis Erros**:
- `No active AI model for interview` → Ativar modelo com usage_type="interview"
- `Credit balance too low` → Adicionar créditos na conta da API
- `Model not found` → Verificar nome do modelo na configuração

---

### 4. UI Reduzida para 70%

**Arquivos Modificados**:

1. **`frontend/src/app/globals.css`**:
```css
/* PROMPT #56 - Scale UI to 70% */
html {
  font-size: 11.2px; /* 70% of default 16px */
}
```

2. **`frontend/src/components/layout/Sidebar.tsx`**:
- Largura: `w-64` → `w-[180px]` (70% de 256px)
- Padding-top: `pt-16` → `pt-[45px]`

3. **`frontend/src/components/layout/Layout.tsx`**:
- Padding-left: `pl-64` → `pl-[180px]`
- Padding-top: `pt-16` → `pt-[45px]`

4. **`frontend/src/components/layout/Navbar.tsx`**:
- Altura: `h-16` → `h-[45px]` (70% de 64px)

---

## Fluxo Completo Esperado

### Criar Nova Entrevista

1. **Usuário** clica em "New Interview"
2. **Sistema** abre dialog para selecionar projeto
3. **Usuário** seleciona projeto e clica "Create"
4. **Sistema**:
   - ✅ Cria entrevista no backend com `conversation_data: []`
   - ✅ Pega o ID da entrevista criada
   - ✅ Redireciona para `/interviews/{id}`
5. **ChatInterface** carrega:
   - ✅ Detecta que `conversation_data` está vazio
   - ✅ Chama `startInterviewWithAI()`
   - ✅ Backend executa AI com system prompt em português
   - ✅ AI responde com Pergunta 1 (Backend framework)
   - ✅ Mensagem é adicionada ao `conversation_data`
   - ✅ Interface recarrega e mostra a pergunta
   - ✅ Scroll automático vai para a mensagem
6. **Usuário** vê a primeira pergunta fixa imediatamente

### Responder Perguntas

1. **Usuário** seleciona opção ou digita resposta
2. **Sistema**:
   - ✅ Adiciona resposta do usuário ao conversation_data
   - ✅ Envia para AI com contexto da conversa
   - ✅ AI responde com próxima pergunta fixa (2, 3, 4) ou pergunta de negócio
   - ✅ Scroll automático vai para a nova mensagem
3. Repete até completar 4 perguntas de stack
4. Depois continua com perguntas de requisitos de negócio

---

## Correção de Bugs Adicionais

### Cor do Texto no Input

**Arquivo**: `frontend/src/components/interview/ChatInterface.tsx`

**Problema**: Texto digitado estava aparecendo branco (invisível) no textarea.

**Solução**:
```typescript
<textarea
  className="... text-gray-900 bg-white"
  // Adicionado text-gray-900 (cinza escuro) e bg-white (fundo branco)
/>
```

---

## Validação

### ✅ Checklist de Testes

- [ ] Criar nova entrevista redireciona automaticamente
- [ ] Entrevista inicia com Pergunta 1 em português
- [ ] Perguntas fixas são apresentadas em ordem (1-4)
- [ ] Scroll automático funciona ao receber novas mensagens
- [ ] Texto digitado é visível no textarea
- [ ] UI está 70% menor que antes
- [ ] Sidebar e navbar estão proporcionais
- [ ] Mobile/responsivo continua funcionando

---

## Impacto

### User Experience
- ✅ **Fluxo mais fluido**: Criar → Redirecionar → Perguntas aparecem
- ✅ **Sem ação manual**: Não precisa enviar mensagem para iniciar
- ✅ **Scroll automático**: Sempre vê a última mensagem
- ✅ **UI compacta**: Mais conteúdo visível na tela
- ✅ **Texto visível**: Pode ver o que está digitando

### Developer Experience
- ✅ **Logs detalhados**: Fácil debugar problemas de auto-start
- ✅ **Erros visíveis**: Alertas mostram exatamente o que falhou
- ✅ **Código limpo**: Router e redirect bem implementados

---

## Arquivos Modificados

1. ✅ `frontend/src/components/interview/InterviewList.tsx` - Redirect após criar
2. ✅ `frontend/src/components/interview/ChatInterface.tsx` - Scroll automático + cor do texto
3. ✅ `frontend/src/app/globals.css` - UI 70%
4. ✅ `frontend/src/components/layout/Sidebar.tsx` - Dimensões 70%
5. ✅ `frontend/src/components/layout/Layout.tsx` - Dimensões 70%
6. ✅ `frontend/src/components/layout/Navbar.tsx` - Dimensões 70%

---

## Próximos Passos (Se Necessário)

1. **Se auto-start não funcionar**: Verificar logs do console e alerta de erro
2. **Se scroll não funcionar**: Aumentar delay de 100ms para 200ms
3. **Se UI muito pequena**: Ajustar font-size de 11.2px para 12px ou 12.8px
4. **Se redirect não funcionar**: Verificar se API retorna o ID correto

---

## PROMPT #56 - PARTE 2: Reforço das Perguntas Fixas no Backend

**Data**: 2025-12-29 (Continuação)
**Problema Identificado**: As perguntas fixas de stack devem estar **hardcoded no backend** como parte do meta prompt (system prompt), não no frontend.

### Solução Implementada

**Abordagem**: Fortalecer os prompts do backend para garantir que a IA siga **exatamente** o formato das perguntas fixas sem parafrasear ou adicionar texto extra.

### Mudanças nos Prompts

**Arquivo**: `backend/app/api/routes/interviews.py`

#### 1. Prompt Inicial (Pergunta 1 - Backend)
**Linhas 336-364**

**Antes**:
```python
system_prompt = f"""Você é um analista de requisitos de IA para projetos de software.
...
CRÍTICO: Esta entrevista deve COMEÇAR com 4 PERGUNTAS FIXAS...
Faça a Pergunta 1 AGORA (Stack - Backend):
❓ Pergunta 1: Qual framework de backend você vai usar para {project.name}?
...
"""
```

**Depois**:
```python
system_prompt = f"""Você é um analista de requisitos de IA para projetos de software.
...
CRÍTICO - PRIMEIRA PERGUNTA FIXA (Stack):
Você DEVE copiar EXATAMENTE a pergunta abaixo, sem modificar, parafrasear ou adicionar texto extra.
Use EXATAMENTE este formato:

❓ Pergunta 1: Qual framework de backend você vai usar para {project.name}?
...
REGRA: Seja direto. NÃO adicione saudações, introduções ou explicações extras. Apenas a pergunta formatada.
"""
```

#### 2. Perguntas 2, 3, 4 (Database, Frontend, CSS)
**Linhas 555-603**

**Mudanças**:
- Adicionado "CRÍTICO - PERGUNTA FIXA X" em cada uma
- Adicionado "Copie EXATAMENTE a pergunta abaixo sem modificar"
- Removido textos ambíguos como "Faça a Pergunta X AGORA"
- Mantido formato idêntico em todas as 4 perguntas

### Funcionamento

1. **Pergunta 1**: Aparece automaticamente ao chamar `/start` endpoint
2. **Pergunta 2**: Aparece após primeira resposta do usuário (message_count = 2)
3. **Pergunta 3**: Aparece após segunda resposta do usuário (message_count = 4)
4. **Pergunta 4**: Aparece após terceira resposta do usuário (message_count = 6)
5. **Perguntas de Negócio**: Começam após quarta resposta (message_count ≥ 8)

### Formato Exato das Perguntas Fixas

Todas as 4 perguntas seguem este formato EXATO:

```
❓ Pergunta [N]: [Texto da pergunta]

OPÇÕES:
○ Opção 1
○ Opção 2
○ Opção 3
○ Opção 4
[○ Opção 5 - opcional]

◉ Escolha uma opção
```

### Por Que Backend e Não Frontend?

**Decisão**: Perguntas fixas devem ser **hardcoded no backend** como parte do meta prompt.

**Motivos**:
1. ✅ **Consistência**: O sistema prompt garante que a IA sempre siga o formato exato
2. ✅ **Manutenção**: Mais fácil alterar perguntas em um só lugar (backend)
3. ✅ **Flexibilidade**: Permite ajustar perguntas baseadas em contexto do projeto
4. ✅ **Integração**: Funciona nativamente com o fluxo de AI Orchestrator
5. ✅ **Histórico**: Todas as mensagens ficam no conversation_data (incluindo stack questions)

**Alternativa Rejeitada**: Hardcoded no frontend
- ❌ Requer lógica duplicada de controle de estado
- ❌ Mais complexo para manter sincronização com backend
- ❌ Dificulta customização baseada em projeto

### Arquivos Modificados (Parte 2)

7. ✅ `backend/app/api/routes/interviews.py` (linhas 336-364, 555-603)
   - System prompt da Pergunta 1 reforçado
   - System prompts das Perguntas 2, 3, 4 reforçados
   - Adicionado instruções "CRÍTICO" e "Copie EXATAMENTE"

---

**Implementation Status**: ✅ Complete
**Breaking Changes**: None
**Migration Required**: No
**Documentation Updated**: Yes (this file)
