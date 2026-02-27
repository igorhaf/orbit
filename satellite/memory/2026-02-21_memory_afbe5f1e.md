# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte.
Sua perspectiva é de NEGÓCIO, não de tecnologia.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES?
- Como funcionam os FLUXOS e PROCESSOS?
- Quais CÁLCULOS de negócio existem?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam o usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE: tipos de campos, configs de framework, banco de dados técnico, CSS, logs, cache, filas, imports, boilerplate.

Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda APENAS em JSON válido.

## User Prompt

Projeto: Orbit

Lote 11/20 — 58 arquivos de código:

### unknown (json)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/interview-1763983645420-end249oqb.json
Language: json


Content Preview:
{
  "id": "1763983645420-end249oqb",
  "answers": [
    {
      "questionId": "initial-question-1",
      "questionText": "Com quem estamos tratando? (Múltipla escolha)",
      "selectedOptions": [
        "dev-backend",
        "dev-frontend",
        "dev-mobile"
      ],
      "timestamp": "2025-11-24T11:27:31.860Z"
    },
    {
      "questionId": "initial-question-2",
      "questionText": "Qual o tipo da sua demanda?",
      "selectedOptions": [
        "feature"
      ],
      "timestamp"
```

### unknown (python)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/cancao_raiva.py
Language: python

Classes: CancaoDeRaiva
Functions: __init__, _construir_cancioneta, exibir_html, _gerar_html_refrão, exibir_texto, obter_como_json, obter_estatisticas, _data_formatada, tocar_canção, main
Imports: typing, sys

    cancao , pprint
        pprint

Content Preview:
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
╔═══════════════════════════════════════════════════════════════╗
║     🎵 UMA CANÇÃO DE RAIVA - DESABAFO MUSICAL 🎵             ║
║                                                               ║
║  Arquivo Python com uma canção sobre raiva e indignação      ║
║  Data: 2025-11-24                                             ║
╚═══════════════════════════════════════════════════════════════╝
"""

from typing import List, Dict, Optional
from dateti
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/cancao_dor_cabeca.php
Language: php

Classes: CancaoDorCabeca
Functions: __construct, construirCancioneta, exibirHTML, gerarHTML, exibirTexto, gerarTexto, obterComoJSON, obterEstatisticas, getDataFormatada

Content Preview:
<?php

class CancaoDorCabeca
{
    private string $titulo = "🎵 Dor de Cabeça: Uma Sinfonia de Sofrimento 🎵";
    private string $artista = "O Coro dos Desconfortáveis";
    private string $genero = "Pop/Rock Dramático";
    private array $estrofes = [];

    public function __construct()
    {
        $this->construirCancioneta();
    }

    private function construirCancioneta(): void
    {
        $this->estrofes = [
            [
                "numero" => 1,
                "linhas" => [
  
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/poesia_amor.php
Language: php

Classes: PoesiaDeAmor
Functions: __construct, obterEstrofes, exibirHTML, gerarHTML, exibirTexto, gerarTexto, obterComoArray, obterComoJSON, getDataFormatada, contarVersos

Content Preview:
<?php

/**
 * ╔════════════════════════════════════════════════════════════╗
 * ║          💝 UMA LINDA POESIA DE AMOR 💝                   ║
 * ║                                                             ║
 * ║  Arquivo PHP com uma poesia dedicada ao amor eterno        ║
 * ║  Data: 2025-11-24                                          ║
 * ╚════════════════════════════════════════════════════════════╝
 */

// ============================================================================
// CLASSE 
```

### unknown (json)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/composer.json
Language: json


Content Preview:
{
    "$schema": "https://getcomposer.org/schema.json",
    "name": "laravel/laravel",
    "type": "project",
    "description": "The skeleton application for the Laravel framework.",
    "keywords": ["laravel", "framework"],
    "license": "MIT",
    "require": {
        "php": "^8.2",
        "laravel/framework": "^12.0",
        "laravel/tinker": "^2.10.1"
    },
    "require-dev": {
        "fakerphp/faker": "^1.23",
        "laravel/pail": "^1.2.2",
        "laravel/pint": "^1.13",
        
```

### unknown (javascript)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/vite.config.js
Language: javascript

Imports: vite, laravel-vite-plugin, @tailwindcss/vite

Content Preview:
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
        tailwindcss(),
    ],
});

```

### unknown (json)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/interview-1763968419393-iucibbvht.json
Language: json


Content Preview:
{
  "id": "1763968419393-iucibbvht",
  "answers": [
    {
      "questionId": "initial-question-1",
      "questionText": "Com quem estamos tratando? (Múltipla escolha)",
      "selectedOptions": [
        "dev-mobile"
      ],
      "timestamp": "2025-11-24T07:13:46.001Z"
    },
    {
      "questionId": "initial-question-2",
      "questionText": "Qual o tipo da sua demanda?",
      "selectedOptions": [
        "feature"
      ],
      "timestamp": "2025-11-24T07:13:54.521Z"
    },
    {
     
```

### unknown (json)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/.claude-mcp-config.json
Language: json


Content Preview:
{
  "mcpServers": {
    "claude-code-chat-permissions": {
      "command": "node",
      "args": [
        "/home/igorhaf/.vscode-server/extensions/orbit-dev.orbit-vscode-0.23.20/dist/mcp-server.js"
      ]
    }
  }
}
```

### unknown (json)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/interview-1763969891383-f3i4k5otj.json
Language: json


Content Preview:
{
  "id": "1763969891383-f3i4k5otj",
  "answers": [
    {
      "questionId": "initial-question-1",
      "questionText": "Com quem estamos tratando? (Múltipla escolha)",
      "selectedOptions": [
        "po"
      ],
      "timestamp": "2025-11-24T07:38:20.479Z"
    },
    {
      "questionId": "initial-question-2",
      "questionText": "Qual o tipo da sua demanda?",
      "selectedOptions": [
        "feature"
      ],
      "timestamp": "2025-11-24T07:38:26.978Z"
    },
    {
      "questi
```

### unknown (json)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/interview-1763970841414-lj27lgnab.json
Language: json


Content Preview:
{
  "id": "1763970841414-lj27lgnab",
  "answers": [
    {
      "questionId": "initial-question-1",
      "questionText": "Com quem estamos tratando? (Múltipla escolha)",
      "selectedOptions": [
        "dev-frontend"
      ],
      "timestamp": "2025-11-24T07:54:10.666Z"
    },
    {
      "questionId": "initial-question-2",
      "questionText": "Qual o tipo da sua demanda?",
      "selectedOptions": [
        "feature"
      ],
      "timestamp": "2025-11-24T07:54:15.204Z"
    },
    {
   
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/CourseReview.php
Language: php

Classes: CourseReview
Functions: course, user
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CourseReview extends Model
{
	use HasFactory;

	protected $fillable = [ 'course_id','user_id','rating','title','text','tags','status','published_at' ];

	protected $casts = [ 'rating' => 'integer', 'tags' => 'array', 'published_at' => 'datetime' ];

	public function course() { return $this->belongsTo(Course::class); }
	public function user() { return $this->belongsT
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/User.php
Language: php

Classes: User
Functions: casts, scopeAluno, scopeInstrutor, courses
Imports: Illuminate\Contracts\Auth\MustVerifyEmail, Illuminate\Database\Eloquent\Builder, Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Notifications\Notifiable

Content Preview:
<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
	/** @use HasFactory<\Database\Factories\UserFactory> */
	use HasFactory, Notifiable;

	/**
	 * The attributes that are mass assignable.
	 *
	 * @var list<string>
	 */
	protected $fillable
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/UserNotificationSetting.php
Language: php

Classes: UserNotificationSetting
Functions: user
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UserNotificationSetting extends Model
{
	use HasFactory;

	protected $fillable = [
		'user_id','settings','summary_frequency','quiet_hours'
	];

	protected $casts = [
		'settings' => 'array',
		'quiet_hours' => 'array',
	];

	public function user()
	{
		return $this->belongsTo(User::class);
	}
} 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/LessonDiscussion.php
Language: php

Classes: LessonDiscussion
Functions: lesson, user
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class LessonDiscussion extends Model
{
	use HasFactory;

	protected $fillable = [ 'lesson_id', 'user_id', 'title', 'body', 'tags', 'is_question', 'attachments', 'votes_count', 'answers_count', 'resolved_at' ];

	protected $casts = [ 'tags' => 'array', 'attachments' => 'array', 'resolved_at' => 'datetime' ];

	public function lesson() { return $this->belongsTo(Lesson::clas
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Plan.php
Language: php

Classes: Plan
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    use HasFactory;

    protected $fillable = [
        'slug',
        'name',
        'subtitle',
        'monthly_price_cents',
        'annual_price_cents',
        'features',
        'seat_limit',
        'highlight',
        'recommended',
        'badge',
        'sort_order',
        'trial_days',
    ];

    protected $casts = [
     
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Module.php
Language: php

Classes: Module
Functions: course, lessons, scopeVisible
Imports: Illuminate\Database\Eloquent\Builder, Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Module extends Model
{
	use HasFactory;

	protected $fillable = [ 'course_id', 'title', 'slug', 'position', 'status' ];

	public function course() { return $this->belongsTo(Course::class); }
	public function lessons() { return $this->hasMany(Lesson::class)->orderBy('position'); }

	public function scopeVisible(Builder $q): B
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Subscription.php
Language: php

Classes: Subscription
Functions: user
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Subscription extends Model
{
	use HasFactory;

	protected $fillable = [
		'user_id','plan_name','cycle','next_due_at','status','benefits'
	];

	protected $casts = [
		'next_due_at' => 'datetime',
		'benefits' => 'array',
	];

	public function user()
	{
		return $this->belongsTo(User::class);
	}
} 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/LessonMaterial.php
Language: php

Classes: LessonMaterial
Functions: lesson
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class LessonMaterial extends Model
{
	use HasFactory;

	protected $fillable = [ 'lesson_id', 'name', 'type', 'url', 'size_kb', 'tags' ];

	protected $casts = [ 'size_kb' => 'integer', 'tags' => 'array' ];

	public function lesson() { return $this->belongsTo(Lesson::class); }
} 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Certificate.php
Language: php

Classes: Certificate
Functions: user, course
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Certificate extends Model
{
	use HasFactory;

	protected $fillable = [ 'user_id','course_id','code','hours','issued_at','pdf_url','thumbnail_url','hash' ];

	protected $casts = [ 'hours' => 'integer', 'issued_at' => 'datetime' ];

	public function user() { return $this->belongsTo(User::class); }
	public function course() { return $this->belongsTo(Course::class); }
}
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Course.php
Language: php

Classes: Course
Functions: instructor, modules, scopePublished, scopeSearch
Imports: Illuminate\Database\Eloquent\Builder, Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Course extends Model
{
	use HasFactory;

	protected $fillable = [
		'title',
		'slug',
		'description',
		'language',
		'duration_minutes',
		'status',
		'cover_url',
		'price_cents',
		'currency',
		'category',
		'level',
		'tags',
		'instructor_id',
		'published_at',
		'rating_average',
		'rating_count',
		'enrollments_cou
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Enrollment.php
Language: php

Classes: Enrollment
Functions: user, course
Imports: Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Enrollment extends Model
{
	use HasFactory;

	protected $fillable = [
		'user_id', 'course_id', 'progress_percent', 'last_position', 'last_accessed_at',
	];

	protected $casts = [
		'progress_percent' => 'integer',
		'last_accessed_at' => 'datetime',
	];

	public function user() { return $this->belongsTo(User::class); }
	public function course() { return $this->belo
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Models/Lesson.php
Language: php

Classes: Lesson
Functions: module, course, materials, scopeVisible
Imports: Illuminate\Database\Eloquent\Builder, Illuminate\Database\Eloquent\Factories\HasFactory, Illuminate\Database\Eloquent\Model, HasFactory

Content Preview:
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Lesson extends Model
{
	use HasFactory;

	protected $fillable = [ 'module_id', 'title', 'slug', 'duration_minutes', 'description', 'video_url', 'position', 'status' ];

	protected $casts = [ 'duration_minutes' => 'integer' ];

	public function module() { return $this->belongsTo(Module::class); }
	public function course() { r
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Observers/CourseObserver.php
Language: php

Classes: CourseObserver
Functions: creating, updating, ensureSlug
Imports: App\Models\Course, Illuminate\Support\Str

Content Preview:
<?php

namespace App\Observers;

use App\Models\Course;
use Illuminate\Support\Str;

class CourseObserver
{
	public function creating(Course $course): void
	{
		$this->ensureSlug($course);
	}

	public function updating(Course $course): void
	{
		if ($course->isDirty('title') && !$course->isDirty('slug')) {
			$this->ensureSlug($course);
		}
	}

	protected function ensureSlug(Course $course): void
	{
		$base = $course->slug ?: Str::slug($course->title ?? 'curso');
		$slug = $base;
		$counter = 1;
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Observers/EnrollmentObserver.php
Language: php


Content Preview:
 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Providers/AuthServiceProvider.php
Language: php

Classes: AuthServiceProvider
Functions: boot
Imports: App\Models\Course, App\Models\User, App\Policies\CoursePolicy, App\Policies\UserPolicy

Content Preview:
<?php

namespace App\Providers;

use App\Models\Course;
use App\Models\User;
use App\Policies\CoursePolicy;
use App\Policies\UserPolicy;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;

class AuthServiceProvider extends ServiceProvider
{
	protected $policies = [
		User::class => UserPolicy::class,
		Course::class => CoursePolicy::class,
	];

	public function boot(): void
	{
		$this->registerPolicies();
	}
} 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Providers/AppServiceProvider.php
Language: php

Classes: AppServiceProvider
Functions: register, boot
Imports: App\Models\Course, App\Observers\CourseObserver, App\Observers\EnrollmentObserver, App\Models\Enrollment, Illuminate\Support\ServiceProvider

Content Preview:
<?php

namespace App\Providers;

use App\Models\Course;
use App\Observers\CourseObserver;
use App\Observers\EnrollmentObserver;
use App\Models\Enrollment;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
	/**
	 * Register any application services.
	 */
	public function register(): void
	{
		//
	}

	/**
	 * Bootstrap any application services.
	 */
	public function boot(): void
	{
		if (class_exists(\App\Observers\CourseObserver::class)) {
			Course::obse
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/InstrutoresController.php
Language: php

Classes: InstrutoresController
Functions: index, show, getEspecialidades
Imports: App\Models\User, App\Models\Course, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\Course;
use Illuminate\Http\Request;

class InstrutoresController extends Controller
{
    public function index()
    {
        $instrutores = User::where('role', 'instrutor')
            ->get()
            ->map(function (User $instrutor) {
                $publishedCoursesQuery = $instrutor->courses()->where('status', 'publicado');

                $totalCursos = (int) $publishedCoursesQuery->count();
               
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/HomeController.php
Language: php

Classes: HomeController
Functions: index
Imports: App\Models\Enrollment, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers;

use App\Models\Enrollment;
use Illuminate\Http\Request;

class HomeController extends Controller
{
	public function index(Request $request)
	{
		$progressoAtual = null;
		if ($request->user()) {
			$enrollment = Enrollment::query()
				->with('course')
				->where('user_id', $request->user()->id)
				->orderByDesc('last_accessed_at')
				->first();
			if ($enrollment && $enrollment->course) {
				$progressoAtual = [
					'curso' => [
						'id' => $enrollm
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Controller.php
Language: php

Classes: Controller
Imports: Illuminate\Foundation\Auth\Access\AuthorizesRequests, Illuminate\Foundation\Bus\DispatchesJobs, Illuminate\Foundation\Validation\ValidatesRequests

Content Preview:
<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Foundation\Bus\DispatchesJobs;
use Illuminate\Foundation\Validation\ValidatesRequests;

abstract class Controller
{
	use AuthorizesRequests, DispatchesJobs, ValidatesRequests;
}

```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/PlanosController.php
Language: php

Classes: PlanosController
Functions: index
Imports: App\Models\Plan, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use Illuminate\Http\Request;

class PlanosController extends Controller
{
    public function index(Request $request)
    {
        $periodo = $request->query('periodo', 'mensal'); // mensal|anual

        $planos = Plan::orderBy('sort_order')
            ->get()
            ->map(function (Plan $plan) use ($periodo) {
                $precoCents = $periodo === 'anual' ? $plan->annual_price_cents : $plan->monthly_price_cents;
         
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Cursos/ProgressController.php
Language: php

Classes: ProgressController
Functions: show, findCourse
Imports: App\Http\Controllers\Controller, App\Models\Course, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Cursos;

use App\Http\Controllers\Controller;
use App\Models\Course;
use Illuminate\Http\Request;

class ProgressController extends Controller
{
	public function show(Request $request, string $id)
	{
		$course = $this->findCourse($id);
		abort_unless($course, 404);

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$modulos = $course->modules()->with('lessons')->orderBy('position')->get()->map(function($m){
			return [
				'id' => $m->id,
			
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Cursos/CatalogoController.php
Language: php

Classes: CatalogoController
Functions: index, mapLanguage
Imports: App\Http\Controllers\Controller, App\Models\Course, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Cursos;

use App\Http\Controllers\Controller;
use App\Models\Course;
use Illuminate\Http\Request;

class CatalogoController extends Controller
{
	public function index(Request $request)
	{
		$q = (string) $request->query('q');

		$published = Course::query()->published();

		$courses = (clone $published)
			->when($q, fn($qBuilder) => $qBuilder->where('title', 'like', '%'.$q.'%'))
			->latest('published_at')
			->limit(120)
			->get(['id','title','category',
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Cursos/ReviewsController.php
Language: php

Classes: ReviewsController
Functions: create, store, findCourse
Imports: App\Http\Controllers\Controller, App\Http\Requests\Reviews\StoreCourseReviewRequest, App\Models\Course, App\Models\CourseReview, Illuminate\Http\RedirectResponse, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Cursos;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reviews\StoreCourseReviewRequest;
use App\Models\Course;
use App\Models\CourseReview;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class ReviewsController extends Controller
{
	public function create(Request $request, string $id)
	{
		$course = $this->findCourse($id);
		abort_unless($course, 404);

		$curso = [
			'id' => $course->id,
			'titulo' => $course->title,
			
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Cursos/ReviewsListController.php
Language: php

Classes: ReviewsListController
Functions: index, findCourse
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\CourseReview, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Cursos;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\CourseReview;
use Illuminate\Http\Request;

class ReviewsListController extends Controller
{
	public function index(Request $request, string $id)
	{
		$course = $this->findCourse($id);
		abort_unless($course, 404);

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];

		$reviews = CourseReview::with('user')
			->where('course_id', $course->id)
			->latest('publish
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Cursos/MaterialsController.php
Language: php

Classes: MaterialsController
Functions: index, findCourse
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\LessonMaterial, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Cursos;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\LessonMaterial;
use Illuminate\Http\Request;

class MaterialsController extends Controller
{
	public function index(Request $request, string $id)
	{
		$course = $this->findCourse($id);
		abort_unless($course, 404);
		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];

		$items = LessonMaterial::query()
			->whereIn('lesson_id', $course->modules()->with('lessons:id,
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Cursos/ShowController.php
Language: php

Classes: ShowController
Functions: show, findCourse, mapLanguage
Imports: App\Http\Controllers\Controller, App\Models\Course, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Cursos;

use App\Http\Controllers\Controller;
use App\Models\Course;
use Illuminate\Http\Request;

class ShowController extends Controller
{
	public function show(Request $request, string $id)
	{
		$course = $this->findCourse($id);
		abort_unless($course, 404);

		$this->authorize('view', $course);

		$curso = [
			'id' => $course->id,
			'titulo' => $course->title,
			'tags' => $course->tags ?: ['Programação', 'Backend', 'Laravel'],
			'rating' => (float) (
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Auth/AuthController.php
Language: php

Classes: AuthController
Functions: showLogin, showRegister, showForgot, showReset, login, register, logout
Imports: App\Http\Controllers\Controller, App\Http\Requests\Auth\LoginRequest, App\Http\Requests\Auth\RegisterRequest, App\Models\User, Illuminate\Http\RedirectResponse, Illuminate\Support\Facades\Hash, Illuminate\Support\Facades\Auth, Illuminate\Contracts\View\View

Content Preview:
<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Auth;
use Illuminate\Contracts\View\View;

class AuthController extends Controller
{
	public function showLogin(): View { return view('auth.login'); }
	public function showRegister(): View { return view('au
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/DiscussõesController.php
Language: php

Classes: DiscussõesController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, App\Models\LessonDiscussion, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use App\Models\LessonDiscussion;
use Illuminate\Http\Request;

class DiscussõesController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->titl
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/PlayerController.php
Language: php

Classes: PlayerController
Functions: show, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class PlayerController extends Controller
{
	public function show(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);

		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licaoAtual = [
			'id' => $lesson->id,
			'titulo' => $lesson->title,
			'duracao' => $lesson
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/AcessibilidadeController.php
Language: php

Classes: AcessibilidadeController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class AcessibilidadeController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->title, 'duracao' => (int)($lesson
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/DiscussoesFormController.php
Language: php

Classes: DiscussoesFormController
Functions: create, edit, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, App\Models\LessonDiscussion, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use App\Models\LessonDiscussion;
use Illuminate\Http\Request;

class DiscussoesFormController extends Controller
{
	public function create(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson-
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/MarcadoresController.php
Language: php

Classes: MarcadoresController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class MarcadoresController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->title ];
		$temasDisponiveis = [];
		
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/QuizController.php
Language: php

Classes: QuizController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class QuizController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->title, 'estimado' => null ];
		$questoes = 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/MateriaisController.php
Language: php

Classes: MateriaisController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class MateriaisController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->title ];
		$materiais = $lesson->mater
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/NotasController.php
Language: php

Classes: NotasController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class NotasController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->title ];
		$todasTags = []; // sem tabela 
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/LiveController.php
Language: php

Classes: LiveController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class LiveController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$live = [
			'id' => $lesson->id,
			'tema' => 'Sessão ao vivo',
			'inicio' => now()->addMinute
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/DiscussoesMinhasController.php
Language: php

Classes: DiscussoesMinhasController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, App\Models\LessonDiscussion, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use App\Models\LessonDiscussion;
use Illuminate\Http\Request;

class DiscussoesMinhasController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Aulas/FeedbackController.php
Language: php

Classes: FeedbackController
Functions: index, findLesson
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Aulas;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class FeedbackController extends Controller
{
	public function index(Request $request, string $id)
	{
		$lesson = $this->findLesson($id);
		abort_unless($lesson, 404);
		$course = $lesson->module->course;

		$curso = [ 'id' => $course->id, 'titulo' => $course->title ];
		$licao = [ 'id' => $lesson->id, 'titulo' => $lesson->title ];
		$maxChars = 300;

		return v
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/CuponsController.php
Language: php

Classes: CuponsController
Functions: show
Imports: App\Http\Controllers\Controller, App\Models\Course, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use Illuminate\Http\Request;

class CuponsController extends Controller
{
    public function show(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $course = Course::where('id', $id)
            ->where('instructor_id', $user->id)
            ->firstOrFail();

        $cur
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/EstruturaController.php
Language: php

Classes: EstruturaController
Functions: show, calcularProgresso
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\Module, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\Module;
use App\Models\Lesson;
use Illuminate\Http\Request;

class EstruturaController extends Controller
{
    public function show(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $course = Course::where('id', $id)
            ->where('instructor_id', $use
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/AulasLiveController.php
Language: php

Classes: AulasLiveController
Functions: show
Imports: App\Http\Controllers\Controller, App\Models\Lesson, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Lesson;
use Illuminate\Http\Request;

class AulasLiveController extends Controller
{
    public function show(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $lesson = Lesson::with(['module.course'])
            ->whereHas('module.course', function ($query) use ($user) {
        
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/RepasseDetalheController.php
Language: php

Classes: RepasseDetalheController
Functions: show
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\Enrollment, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\Enrollment;
use Illuminate\Http\Request;

class RepasseDetalheController extends Controller
{
    public function show(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        // Buscar curso do instrutor
        $course = Course::where('id', $id)
            ->wher
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/PreferenciasNotificacoesController.php
Language: php

Classes: PreferenciasNotificacoesController
Functions: index
Imports: App\Http\Controllers\Controller, App\Models\UserNotificationSetting, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\UserNotificationSetting;
use Illuminate\Http\Request;

class PreferenciasNotificacoesController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $settings = UserNotificationSetting::where('user_id', $user->id)->first();
        
        if (!$set
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/AvaliacoesRecebidasController.php
Language: php

Classes: AvaliacoesRecebidasController
Functions: index
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\CourseReview, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\CourseReview;
use Illuminate\Http\Request;

class AvaliacoesRecebidasController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $courses = Course::where('instructor_id', $user->id)->pluck('id');
        
        $avaliacoe
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/AvaliacoesController.php
Language: php

Classes: AvaliacoesController
Functions: show
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\CourseReview, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\CourseReview;
use Illuminate\Http\Request;

class AvaliacoesController extends Controller
{
    public function show(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $course = Course::where('id', $id)
            ->where('instructor_id', $user->id)
         
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/MeusCursosController.php
Language: php

Classes: MeusCursosController
Functions: index, mapLanguage
Imports: App\Http\Controllers\Controller, App\Models\Course, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use Illuminate\Http\Request;

class MeusCursosController extends Controller
{
	public function index(Request $request)
	{
		$user = $request->user();
		if (!$user) {
			return redirect()->route('login');
		}
		if ($user->role !== 'instrutor') {
			abort(403);
		}

		$courses = Course::query()
			->where('instructor_id', $user->id)
			->latest('id')
			->get(['id','title','language','stat
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/CourseController.php
Language: php

Classes: CourseController
Functions: index, store, update, destroy, status, meta
Imports: App\Http\Controllers\Controller, App\Http\Requests\Courses\CourseStatusRequest, App\Http\Requests\Courses\CourseStoreRequest, App\Http\Requests\Courses\CourseMetaRequest, App\Http\Requests\Courses\CourseUpdateRequest, App\Models\Course, Illuminate\Http\RedirectResponse, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Http\Requests\Courses\CourseStatusRequest;
use App\Http\Requests\Courses\CourseStoreRequest;
use App\Http\Requests\Courses\CourseMetaRequest;
use App\Http\Requests\Courses\CourseUpdateRequest;
use App\Models\Course;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class CourseController extends Controller
{
	public function index(Request $request): RedirectResponse
	{
		return redire
```

### unknown (php)
```
File: /home/igorhaf/orbit/projects/suinda/.claude-backups/app/Http/Controllers/Instrutor/MateriaisController.php
Language: php

Classes: MateriaisController
Functions: show
Imports: App\Http\Controllers\Controller, App\Models\Course, App\Models\LessonMaterial, Illuminate\Http\Request

Content Preview:
<?php

namespace App\Http\Controllers\Instrutor;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\LessonMaterial;
use Illuminate\Http\Request;

class MateriaisController extends Controller
{
    public function show(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user || $user->role !== 'instrutor') {
            abort(403);
        }

        $course = Course::where('id', $id)
            ->where('instructor_id', $user->id)
        
```

Extraia TODAS as regras de negócio FUNCIONAIS deste código.
Responda em JSON:
{
  "business_rules": [
    {"rule_text": "...", "rule_type": "domain|validation|constraint|workflow|permission|calculation", "source_file": "...", "priority": "high|normal|low"}
  ]
}

## Response

```json
{
  "business_rules": [
    {
      "rule_text": "Apenas usuários com o papel 'instrutor' podem acessar a área de instrutor. Qualquer outro usuário (incluindo alunos) recebe erro 403 ao tentar acessar qualquer funcionalidade da área de instrutor.",
      "rule_type": "permission",
      "source_file": "app/Http/Controllers/Instrutor/MeusCursosController.php, CuponsController.php, EstruturaController.php, AulasLiveController.php, RepasseDetalheController.php, PreferenciasNotificacoesController.php, AvaliacoesRecebidasController.php, AvaliacoesController.php, MateriaisController.php",
      "priority": "high"
    },
    {
      "rule_text": "Usuário não autenticado que tenta acessar 'Meus Cursos' (área do instrutor) é redirecionado para a tela de login, em vez de receber um erro.",
      "rule_type": "workflow",
      "source_file": "app/Http/Controllers/Instrutor/MeusCursosController.php",
      "priority": "high"
    },
    {
      "rule_text": "Um instrutor só pode visualizar, editar e gerenciar os seus próprios cursos. O sistema filtra sempre os cursos pelo instructor_id igual ao ID do usuário logado.",
      "rule_type": "permission",
      "source_file": "app/Http/Controllers/Instrutor/CourseController.php, MeusCursosController.php, CuponsController.php, EstruturaController.php, AvaliacoesController.php, MateriaisController.php, RepasseDetalheController.php",
      "priority": "high"
    },
    {
      "rule_text": "O acesso para visualizar um curso exige autorização via política de acesso (CoursePolicy). Isso significa que pode haver cursos restritos a determinados perfis de usuário.",
      "rule_type": "permission",
      "source_file": "app/Http/Controllers/Cursos/ShowController.php, app/Providers/AuthServiceProvider.php",
      "priority": "high"
    },
    {
      "rule_text": "O catálogo público de cursos exibe apenas cursos com status 'publicado'. Cursos em outros status (rascunho, etc.) são invisíveis para o aluno.",
      "rule_type": "constraint",
      "source_file": "app/Http/Controllers/Cursos/CatalogoController.php, app/Models/Course.php",
      "priority": "high"
    },
    {
      "rule_text": "O catálogo de cursos retorna no máximo 120 cursos por consulta, ordenados pela data de publicação mais recente. Não há paginação visível além desse limite.",
      "rule_type": "constraint",
      "source_file": "app/Http/Controllers/Cursos/CatalogoController.php",
      "priority": "normal"
    },
    {
      "rule_text": "O catálogo permite busca de cursos pelo título (busca parcial, case-insensitive via LIKE). Quando não há termo de busca, todos os cursos publicados são retornados.",
      "rule_type": "workflow",
      "source_file": "app/Http/Controllers/Cursos/CatalogoController.php",
      "priority": "normal"
    },
    {
      "rule_text": "A página inicial mostra ao usuário logado o curso que ele acessou por último (baseado em last_accessed_at), permitindo retomar de onde parou.",
      "rule_type": "workflow",
      "source_file": "app/Http/Controllers/HomeController.php",
      "priority": "normal"
    },
    {
      "rule_text": "O sistema possui dois perfis principais de usuário: 'aluno' e 'instrutor'. O papel determina quais áreas e funcionalidades cada usuário pode acessar.",
      "rule_type": "domain",
      "source_file": "app/Models/User.php",
      "priority": "high"
    },
    {
      "rule_text": "Um instrutor possui cursos. Um curso possui módulos. Um módulo possui aulas (lessons), ordenadas por 'position'. A hierarquia é: Instrutor → Curso → Módulo → Aula.",
      "rule_type": "domain",
      "source_file": "app/Models/Course.php, Module.php, Lesson.php, User.php",
      "priority": "high"
    },
    {
      "rule_text": "O slug de um curso é gerado automaticamente a partir do título no momento da criação. Se o título for alterado e o slug não tiver sido modificado manualmente, o slug é atualizado automaticamente.",
      "rule_type": "workflow",
      "source_file": "app/Observers/CourseObserver.php",
      "priority": "normal"
    },
    {
      "rule_text": "O slug de cada curso deve ser único no sistema. Se já existir um slug igual, o sistema adiciona um sufixo numérico incremental (ex: meu-curso, meu-curso-1, meu-curso-2).",
      "rule_type": "constraint",
      "source_file": "app/Observers/CourseObserver.php",
      "priority": "normal"
    },
    {
      "rule_text": "Os planos de assinatura possuem dois ciclos de cobrança: mensal e anual, com preços distintos para cada modalidade. O preço exibido depende do período selecionado pelo usuário.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/PlanosController.php, app/Models/Plan.php",
      "priority": "high"
    },
    {
      "rule_text": "Os planos possuem limite de assentos (seat_limit), período de teste gratuito (trial_days), e podem ser marcados como 'recomendado' ou 'destaque' para fins de apresentação comercial.",
      "rule_type": "domain",
      "source_file": "app/Models/Plan.php",
      "priority": "normal"
    },
    {
      "rule_text": "A ordem de exibição dos planos na tela é determinada pelo campo 'sort_order', permitindo controle editorial sobre qual plano aparece primeiro.",
      "rule_type": "domain",
      "source_file": "app/Models/Plan.php",
      "priority": "low"
    },
    {
      "rule_text": "Uma assinatura de usuário registra: qual plano contratou, o ciclo (mensal ou anual), a data do próximo vencimento e o status atual. Os benefícios da assinatura são armazenados diretamente no registro.",
      "rule_type": "domain",
      "source_file": "app/Models/Subscription.php",
      "priority": "high"
    },
    {
      "rule_text": "O progresso do aluno em um curso é registrado como percentual inteiro (0 a 100). O sistema também registra a última posição acessada e a data/hora do último acesso.",
      "rule_type": "domain",
      "source_file": "app/Models/Enrollment.php",
      "priority": "high"
    },
    {
      "rule_text": "Avaliações (reviews) de cursos possuem um status e uma data de publicação (published_at), indicando que existe um fluxo de moderação antes da publicação pública.",
      "rule_type": "workflow",
      "source_file": "app/Models/CourseReview.php, app/Http/Controllers/Cursos/ReviewsListController.php",
      "priority": "high"
    },
    {
      "rule_text": "As avaliações exibidas na lista pública de um curso são ordenadas da mais recente para a mais antiga, com base na data de publicação.",
      "rule_type": "workflow",
      "source_file": "app/Http/Controllers/Cursos/ReviewsListController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Um certificado é emitido por curso para cada usuário, contendo: código único, carga horária, data de emissão, URL do PDF, URL da miniatura e um hash de autenticidade.",
      "rule_type": "domain",
      "source_file": "app/Models/Certificate.php",
      "priority": "high"
    },
    {
      "rule_text": "Discussões em aulas podem ser marcadas como 'pergunta' (is_question) e podem ser resolvidas (resolved_at). O sistema contabiliza votos e respostas de cada discussão.",
      "rule_type": "domain",
      "source_file": "app/Models/LessonDiscussion.php",
      "priority": "normal"
    },
    {
      "rule_text": "Aulas podem ter materiais de apoio associados (arquivos com nome, tipo, URL e tamanho em KB), categorizados por tags.",
      "rule_type": "domain",
      "source_file": "app/Models/LessonMaterial.php",
      "priority": "normal"
    },
    {
      "rule_text": "O feedback textual que um aluno dá sobre uma aula tem limite máximo de 300 caracteres.",
      "rule_type": "validation",
      "source_file": "app/Http/Controllers/Aulas/FeedbackController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Aulas podem ser do tipo 'ao vivo' (live). Uma sessão ao vivo possui um tema e horário de início, diferenciando-se das aulas gravadas.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Aulas/LiveController.php, app/Http/Controllers/Instrutor/AulasLiveController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Aulas podem conter quiz com questões e tempo estimado de realização.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Aulas/QuizController.php",
      "priority": "normal"
    },
    {
      "rule_text": "O aluno pode fazer marcadores (bookmarks) em aulas, organizados por temas disponíveis.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Aulas/MarcadoresController.php",
      "priority": "normal"
    },
    {
      "rule_text": "O aluno pode fazer anotações pessoais em aulas, organizadas por tags.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Aulas/NotasController.php",
      "priority": "normal"
    },
    {
      "rule_text": "As aulas possuem configurações de acessibilidade disponíveis, indicando suporte a diferentes necessidades dos alunos.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Aulas/AcessibilidadeController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Instrutores têm acesso a um relatório de 'repasse' (receita transferida) detalhado por curso, baseado nas matrículas (enrollments) daquele curso.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Instrutor/RepasseDetalheController.php",
      "priority": "high"
    },
    {
      "rule_text": "Instrutores podem gerenciar cupons de desconto associados a seus próprios cursos.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Instrutor/CuponsController.php",
      "priority": "normal"
    },
    {
      "rule_text": "O sistema calcula e exibe o progresso de estruturação de um curso pelo instrutor (percentual de preenchimento dos módulos/aulas), através do método calcularProgresso.",
      "rule_type": "calculation",
      "source_file": "app/Http/Controllers/Instrutor/EstruturaController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Instrutores recebem e podem consultar todas as avaliações dos alunos em seus cursos, tanto de forma consolidada (todas as avaliações) quanto por curso específico.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Instrutor/AvaliacoesRecebidasController.php, AvaliacoesController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Instrutores podem configurar preferências de notificações, incluindo frequência de resumos e horários de silêncio (quiet hours). Se não houver configuração salva, são aplicados valores padrão.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Instrutor/PreferenciasNotificacoesController.php, app/Models/UserNotificationSetting.php",
      "priority": "low"
    },
    {
      "rule_text": "A ficha pública de cada instrutor exibe apenas os cursos com status 'publicado', junto com métricas agregadas como total de cursos e avaliações.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/InstrutoresController.php",
      "priority": "normal"
    },
    {
      "rule_text": "Cursos possuem informações de idioma. O sistema mapeia os valores internos de idioma para rótulos amigáveis para exibição ao usuário.",
      "rule_type": "domain",
      "source_file": "app/Http/Controllers/Cursos/ShowController.php, app/Http/Controllers/Instrutor/MeusCursosController.php",
      "priority": "low"
    },
    {
      "rule_text": "O sistema suporta um fluxo de coleta de demandas (entrevistas), onde o solicitante informa seu papel (dev-backend, dev-frontend, dev-mobile, PO) e o tipo de demanda (feature, etc.). Cada resposta é registrada com timestamp.",
      "rule_type": "workflow",
      "source_file": "projects/suinda/.claude-backups/interview-*.json",
      "priority": "normal"
    },
    {
      "rule_text": "Cursos têm preço em centavos (price_cents) com moeda configurável (currency), indicando suporte a múltiplas moedas no sistema.",
      "rule_type": "domain",
      "source_file": "app/Models/Course.php",
      "priority": "normal"
    },
    {
      "rule_text": "Cursos possuem nível de dificuldade (level) e categoria, permitindo filtragem e organização do catálogo por esses atributos.",
      "rule_type": "domain",
      "source_file": "app/Models/Course.php",
      "priority": "normal"
    },
    {
      "rule_text": "A média de avaliação e o total de avaliações de um curso são armazenados diretamente no registro do curso (rating_average, rating_count), assim como o total de matrículas (enrollments_count), para exibição rápida sem recálculo em tempo real.",
      "rule_type": "calculation",
      "source_file": "app/Models/Course.php",
      "priority": "normal"
    },
    {
      "rule_text": "Módulos e aulas possuem um escopo de visibilidade (scopeVisible), indicando que nem todos os módulos/aulas publicados são necessariamente visíveis para todos os usuários.",
      "rule_type": "permission",
      "source_file": "app/Models/Module.php, app/Models/Lesson.php",
      "priority": "normal"
    },
    {
      "rule_text": "O aluno, ao visualizar o progresso de um curso, enxerga todos os módulos e aulas com informações de posição e status de cada aula.",
      "rule_type": "workflow",
      "source_file": "app/Http/Controllers/Cursos/ProgressController.php",
      "priority": "normal"
    }
  ]
}
```
