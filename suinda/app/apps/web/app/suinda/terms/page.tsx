import Link from "next/link";

export default function SuindaTermsPage() {
  return (
    <main className="min-h-screen bg-[#1d2125] px-5 py-10 text-[#dee4ea] sm:px-8">
      <article className="mx-auto max-w-3xl rounded-3xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-10">
        <Link href="/" className="text-sm font-semibold text-cyan-200 hover:underline">← Voltar ao cadastro</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[.16em] text-cyan-200">Suindá · versão suinda-terms-v1</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Termos de uso e aviso de privacidade</h1>
        <p className="mt-4 text-sm leading-6 text-[#b6c2cf]">Esta versão inicial explica como usar a plataforma de aprendizagem e como os dados da conta são utilizados nas atividades acadêmicas.</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-[#b6c2cf]">
          <section><h2 className="font-semibold text-white">Uso da conta</h2><p className="mt-2">Informe dados corretos, mantenha sua senha em sigilo e use a conta para participar das formações disponíveis. Não use a plataforma para enviar conteúdo ilegal, violar direitos de terceiros ou interromper o acesso de outras pessoas.</p></section>
          <section><h2 className="font-semibold text-white">Dados acadêmicos</h2><p className="mt-2">A plataforma registra dados necessários para autenticação e para administrar inscrições, turmas, atividades, frequência, avaliações, progresso e certificados. O acesso a informações individuais é limitado ao titular e às pessoas autorizadas pela instituição responsável pelo curso.</p></section>
          <section><h2 className="font-semibold text-white">Conteúdo dos cursos</h2><p className="mt-2">Materiais disponibilizados pelos cursos devem ser usados para fins de aprendizagem. Respeite as condições de uso indicadas pela instituição e não redistribua conteúdo protegido sem autorização.</p></section>
          <section><h2 className="font-semibold text-white">Privacidade e solicitações</h2><p className="mt-2">Você pode solicitar acesso, correção ou exclusão de dados relacionados à sua conta pelo canal de atendimento da instituição que oferece o curso. Alguns registros acadêmicos podem precisar ser mantidos conforme as obrigações aplicáveis à instituição.</p></section>
          <section><h2 className="font-semibold text-white">Responsabilidade institucional</h2><p className="mt-2">A instituição responsável pela oferta do curso administra os conteúdos, as regras acadêmicas e os canais de atendimento. Esta versão inicial pode ser substituída por termos institucionais; cada nova versão será identificada no aceite da conta.</p></section>
        </div>
        <p className="mt-9 border-t border-[#3b4754] pt-5 text-xs leading-5 text-[#9fadbc]">Versão: suinda-terms-v1 · Atualizada em outubro de 2026.</p>
      </article>
    </main>
  );
}
