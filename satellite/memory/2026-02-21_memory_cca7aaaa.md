# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 2409 in / 866 out | Cost: $0.0067

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

projects/suinda/resources/views/cursos/widget-nota.blade.php (php):
@php
    $curso = [ 'id'=> request()->route('id') ?? 201, 'titulo'=>'Formação Laravel Profissional', 'idiomas'=>['PT-BR','EN'] ];
    $estado = 'ok'; // ok | loading | empty | error
    $media = 4.6; $total = 324; $verificado = true; $versoes = ['v2 (2025)','v1 (2024)'];
    $dist = [5=>62,4=>24,3=>8,2=>4,1=>2]; // porcentagens mock
@endphp

<x-layouts.app :title="$curso['titulo'].' — Avaliação do curso'">
    <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header>
            <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Avaliação do curso</h1>
            <p class="text-white/70">{{ $curso['titulo'] }}</p>
        </header>

        {{-- Estados --}}
        @if($estado==='loading')
            <div class="mt-6 grid gap-3">
                @for($i=0;$i<5;$i++)
                    <div class="h-10 rounded-lg border border-white/10 bg-white/5 animate-pulse"></div>
                @endfor
            </div>
        @elseif($estado==='error')
            <div class="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300" role="alert">Erro ao carregar avaliações.</div>
        @elseif($estado==='empty')
            <div class="mt-6 rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
                <div class="mx-auto w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">⭐</div>
                <h3 class="mt-3 font-medium">Ainda não há avaliações</h3>
                <p class="text-sm text-white/70">Seja o primeiro a avaliar este curso.</p>
                <a href="{{ route('aluno.cursos.avaliar', $curso['id']) }}" class="mt-4 inline-flex items-center gap-2 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">Avaliar este curso</a>
            </div>
        @else
            <div class="mt-6 grid gap-6 lg:grid-cols-3">
                <section class="lg:col-span-2 rounded-2xl border border-white/10 bg-[#0F0F0F]/90 p-5">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="text-4xl font-semibold" aria-live="polite" aria-label="Nota média {{ number_format($media,1) }} de 5">{{ number_format($media,1) }}</div>
                            <div class="text-sm text-white/70"><span aria-label="Total de avaliações {{ $total }}">{{ $total }} avaliações</span> @if($verificado)<span class="ml-2 inline-flex items-center rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-xs">aluno verificado</span>@endif</div>
                        </div>
                        <div class="flex items-center gap-2 text-sm">
                            <label class="sr-only" for="fltLang">Idioma</label>
                            <select id="fltLang" class="rounded-xl bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50">
                                @foreach($curso['idiomas'] as $lang)
                                    <option>{{ $lang }}</option>
                                @endforeach
                            </select>
                            <label class="sr-only" for="fltVer">Versão</label>
                            <select id="fltVer" class="rounded-xl bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50">
                                @foreach($versoes as $v)
                                    <option>{{ $v }}</option>
                                @endforeach
                            </select>
                        </div>
                    </div>
                    <div class="mt-4 space-y-2">
                        @for($s=5;$s>=1;$s--)
                            @php $pct = $dist[$s] ?? 0; @endphp
                            <div class="flex items-center gap-2" title="{{ $pct }}% — {{ round($pct*$total/100) }} avaliações">
                                <span class="w-8 text-right text-xs">{{ $s }}★</span>
                                <div class="h-2 flex-1 rounded-full bg-white/10 overflow-hidden" aria-label="{{ $pct }} por cento de notas {{ $s }} estrelas" role="img">
                                    <div class="h-full bg-white/40" style="width: {{ $pct }}%"></div>
                                </div>
                                <span class="w-10 text-xs text-white/70">{{ $pct }}%</span>
                            </div>
                        @endfor
                    </div>
                    <div class="mt-5 flex items-center gap-3">
                        <a href="{{ route('aluno.cursos.avaliar', $curso['id']) }}" class="inline-flex items-center gap-2 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">Avaliar este curso</a>
                        <a href="{{ route('cursos.avaliacoes', $curso['id']) }}" class="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">Ver todas as avaliações</a>
                    </div>
                </section>
                <aside class="rounded-2xl border border-white/10 bg-[#0F0F0F]/90 p-5">
                    <h2 class="text-lg font-medium">Sobre as avaliações</h2>
                    <p class="mt-2 text-sm text-white/80">Mostramos a média geral e a distribuição por estrelas. O selo “aluno verificado” indica que a nota veio de um aluno inscrito.</p>
                </aside>
            </div>
        @endif
    </section>
</x-layouts.app> 

## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode avaliar um curso se não houver avaliações ainda registradas.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "A avaliação do curso exibe a média e distribuição por estrelas com base em dados mockados, mas calcula a porcentagem de cada categoria de avaliação.",
      "rule_type": "domain",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode filtrar avaliações por idioma e versão do curso, que são opções pré-definidas.",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "A visualização das avaliações depende do estado da carga (ok/loading/error/empty), com comportamentos específicos para cada situação.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "Apenas usuários verificados podem deixar avaliações, indicado por um selo visual na interface.",
      "rule_type": "validation",
      "confidence": "medium"
    },
    {
      "rule_text": "O usuário pode acessar todas as avaliações de um curso através de um link direcionado para uma rota específica.",
      "rule_type": "workflow",
      "confidence": "high"
    }
  ]
}
