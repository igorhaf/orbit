# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 785 in / 674 out | Cost: $0.0042

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

projects/suinda/app/Http/Controllers/Instrutor/ReceitasController.php (php):
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\Enrollment;
use Illuminate\Http\Request;

class ReceitasController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $courses = Course::where('instructor_id', $user->id)->get();
        
        // Calcular receitas por curso
        $receitasPorCurso = $courses->map(function (Course $course) {
            $enrollments = $course->enrollments()->where('status', 'ativo')->get();
            $receitaTotal = $enrollments->sum(function ($enrollment) use ($course) {
                return $course->price_cents ? $course->price_cents / 100 : 0;
            });
            
            return [
                'id' => $course->id,
                'titulo' => $course->title,
                'thumb' => $course->cover_url,
                'inscritos' => $enrollments->count(),
                'receita' => $receitaTotal,
                'comissao' => $receitaTotal * 0.7, // 70% para o instrutor
                'periodo' => 'Últimos 30 dias',
            ];
        })->all();

        // Resumo geral
        $resumo = [
            'receitaTotal' => collect($receitasPorCurso)->sum('receita'),
            'comissaoTotal' => collect($receitasPorCurso)->sum('comissao'),
            'cursosAtivos' => $courses->where('status', 'publicado')->count(),
            'totalInscritos' => $courses->sum('enrollments_count'),
        ];

        // Histórico de receitas (mock por enquanto)
        $historico = [
            ['mes' => 'Janeiro 2025', 'receita' => 1250.00, 'comissao' => 875.00],
            ['mes' => 'Fevereiro 2025', 'receita' => 1890.00, 'comissao' => 1323.00],
            ['mes' => 'Março 2025', 'receita' => 2100.00, 'comissao' => 1470.00],
        ];

        return view('instrutor.receitas', compact('receitasPorCurso', 'resumo', 'historico'));
    }
} 

## Response

{
  "business_rules": [
    {
      "rule_text": "Apenas instrutores podem acessar a tela de receitas.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "A receita por curso é calculada com base nas inscrições ativas, multiplicando o preço do curso por quantidade de inscritos.",
      "rule_type": "calculation",
      "confidence": "high"
    },
    {
      "rule_text": "A comissão do instrutor é fixada em 70% da receita total por curso.",
      "rule_type": "calculation",
      "confidence": "high"
    },
    {
      "rule_text": "Os dados exibidos correspondem apenas ao período de 30 dias úteis.",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "O histórico de receitas exibe dados mockados (simulados) para demonstração.",
      "rule_type": "workflow",
      "confidence": "medium"
    }
  ]
}
