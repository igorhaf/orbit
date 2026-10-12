export const questionStart = '[[ORBIT_QUESTION]]';
export const questionEnd = '[[/ORBIT_QUESTION]]';

export function extractPromptQuestion(output: string): string | null {
  const start = output.lastIndexOf(questionStart);
  if (start < 0) return null;
  const end = output.indexOf(questionEnd, start + questionStart.length);
  if (end < 0 || output.slice(end + questionEnd.length).trim()) return null;
  return output.slice(start + questionStart.length, end).trim() || null;
}

export function questionGuidance(answered: boolean): string {
  return answered
    ? `MODO QUESTIONAR: a resposta abaixo permite continuar a execução. Se precisar de outra decisão, pare e retorne somente a pergunta entre ${questionStart} e ${questionEnd}, sem o bloco de resumo. Não presuma a resposta.`
    : `MODO QUESTIONAR: antes de implementar, examine o projeto em leitura e solicite uma decisão ou confirmação do caminho proposto. Não edite arquivos nem execute o checklist ainda. Encerre retornando somente a pergunta entre ${questionStart} e ${questionEnd}, sem o bloco de resumo. Aguarde a resposta do usuário para continuar.`;
}
