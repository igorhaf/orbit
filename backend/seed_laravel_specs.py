"""
Seed Comprehensive Laravel Specs (PROMPT #47 - Phase 2)
NO ARBITRARY LIMITS - Create as many specs as useful for Laravel framework
"""
import sys
import os

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.spec import Spec
from uuid import uuid4

# Comprehensive Laravel Specs - NO LIMITS!
LARAVEL_SPECS = [
    # CONTROLLERS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "controller",
        "title": "Controller Structure",
        "description": "Laravel controller with proper dependency injection and resource methods",
        "content": """<?php

namespace App\\Http\\Controllers;

use App\\Models\\{ModelName};
use App\\Http\\Requests\\{ModelName}Request;
use Illuminate\\Http\\JsonResponse;
use Illuminate\\Http\\Request;

class {ModelName}Controller extends Controller
{
    public function index(): JsonResponse
    {
        ${items} = {ModelName}::paginate(15);
        return response()->json(${items});
    }

    public function store({ModelName}Request $request): JsonResponse
    {
        ${item} = {ModelName}::create($request->validated());
        return response()->json(${item}, 201);
    }

    public function show({ModelName} ${item}): JsonResponse
    {
        return response()->json(${item});
    }

    public function update({ModelName}Request $request, {ModelName} ${item}): JsonResponse
    {
        ${item}->update($request->validated());
        return response()->json(${item});
    }

    public function destroy({ModelName} ${item}): JsonResponse
    {
        ${item}->delete();
        return response()->json(null, 204);
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*", "node_modules/*", "storage/*", "bootstrap/cache/*"]
    },

    # MODELS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "model",
        "title": "Eloquent Model",
        "description": "Laravel Eloquent model with fillable, casts, and relationships",
        "content": """<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Factories\\HasFactory;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\{RelationType};
use Illuminate\\Database\\Eloquent\\SoftDeletes;

class {ModelName} extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'field1',
        'field2',
        'field3',
    ];

    protected $casts = [
        'field1' => 'string',
        'field2' => 'integer',
        'is_active' => 'boolean',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    // Relationships
    public function relatedModel(): {RelationType}
    {
        return $this->{relation}(RelatedModel::class);
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*", "node_modules/*"]
    },

    # MIGRATIONS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "migration",
        "title": "Database Migration",
        "description": "Laravel migration with proper column types and indexes",
        "content": """<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('{table_name}', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->timestamps();
            $table->softDeletes();

            // Indexes
            $table->index('name');
            $table->index(['user_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('{table_name}');
    }
};""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # ROUTES - API
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "routes_api",
        "title": "API Routes",
        "description": "Laravel API routes with resource controllers and middleware",
        "content": """<?php

use App\\Http\\Controllers\\{ControllerName};
use Illuminate\\Support\\Facades\\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('{resources}', {ControllerName}::class);

    // Custom routes
    Route::post('{resources}/{id}/custom-action', [{ControllerName}::class, 'customAction']);
});

// Public routes
Route::get('{resources}/public', [{ControllerName}::class, 'publicIndex']);""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # ROUTES - WEB
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "routes_web",
        "title": "Web Routes",
        "description": "Laravel web routes with proper naming and middleware",
        "content": """<?php

use App\\Http\\Controllers\\{ControllerName};
use Illuminate\\Support\\Facades\\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::resource('{resources}', {ControllerName}::class);

    Route::get('/dashboard', function () {
        return view('dashboard');
    })->name('dashboard');
});

require __DIR__.'/auth.php';""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # FORM REQUESTS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "request",
        "title": "Form Request Validation",
        "description": "Laravel form request with validation rules and authorization",
        "content": """<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;
use Illuminate\\Validation\\Rule;

class {ModelName}Request extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Implement your authorization logic
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', Rule::unique('users')->ignore($this->user)],
            'description' => ['nullable', 'string'],
            'is_active' => ['boolean'],
            'category_id' => ['required', 'exists:categories,id'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => 'The name field is required.',
            'email.unique' => 'This email is already taken.',
        ];
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # API RESOURCES
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "resource",
        "title": "API Resource",
        "description": "Laravel API resource for transforming models to JSON",
        "content": """<?php

namespace App\\Http\\Resources;

use Illuminate\\Http\\Request;
use Illuminate\\Http\\Resources\\Json\\JsonResource;

class {ModelName}Resource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'is_active' => $this->is_active,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),

            // Relationships (conditional loading)
            'related' => RelatedResource::collection($this->whenLoaded('related')),
        ];
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # MIDDLEWARE
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "middleware",
        "title": "Middleware",
        "description": "Laravel middleware for request filtering",
        "content": """<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;
use Symfony\\Component\\HttpFoundation\\Response;

class {MiddlewareName}
{
    public function handle(Request $request, Closure $next): Response
    {
        // Pre-request logic
        if (! $this->shouldAllow($request)) {
            abort(403, 'Unauthorized action.');
        }

        $response = $next($request);

        // Post-request logic
        return $response;
    }

    private function shouldAllow(Request $request): bool
    {
        // Implement your logic
        return true;
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # POLICIES
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "policy",
        "title": "Authorization Policy",
        "description": "Laravel policy for model authorization",
        "content": """<?php

namespace App\\Policies;

use App\\Models\\User;
use App\\Models\\{ModelName};

class {ModelName}Policy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, {ModelName} ${model}): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('create_{model}');
    }

    public function update(User $user, {ModelName} ${model}): bool
    {
        return $user->id === ${model}->user_id
            || $user->hasPermission('update_any_{model}');
    }

    public function delete(User $user, {ModelName} ${model}): bool
    {
        return $user->id === ${model}->user_id
            || $user->hasPermission('delete_any_{model}');
    }

    public function restore(User $user, {ModelName} ${model}): bool
    {
        return $user->hasPermission('restore_{model}');
    }

    public function forceDelete(User $user, {ModelName} ${model}): bool
    {
        return $user->hasPermission('force_delete_{model}');
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # JOBS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "job",
        "title": "Queue Job",
        "description": "Laravel queued job for background processing",
        "content": """<?php

namespace App\\Jobs;

use Illuminate\\Bus\\Queueable;
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Foundation\\Bus\\Dispatchable;
use Illuminate\\Queue\\InteractsWithQueue;
use Illuminate\\Queue\\SerializesModels;
use Illuminate\\Support\\Facades\\Log;

class {JobName} implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 120;

    public function __construct(
        public readonly int $itemId,
    ) {}

    public function handle(): void
    {
        Log::info("Processing job for item: {$this->itemId}");

        // Job logic here
    }

    public function failed(\\Throwable $exception): void
    {
        Log::error("Job failed: {$exception->getMessage()}");
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # EVENTS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "event",
        "title": "Event",
        "description": "Laravel event for broadcasting and listeners",
        "content": """<?php

namespace App\\Events;

use App\\Models\\{ModelName};
use Illuminate\\Broadcasting\\Channel;
use Illuminate\\Broadcasting\\InteractsWithSockets;
use Illuminate\\Broadcasting\\PresenceChannel;
use Illuminate\\Contracts\\Broadcasting\\ShouldBroadcast;
use Illuminate\\Foundation\\Events\\Dispatchable;
use Illuminate\\Queue\\SerializesModels;

class {EventName} implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly {ModelName} ${model},
    ) {}

    public function broadcastOn(): array
    {
        return [
            new Channel('{channel-name}'),
            new PresenceChannel('presence-{channel}'),
        ];
    }

    public function broadcastAs(): string
    {
        return '{event.name}';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->{model}->id,
            'name' => $this->{model}->name,
        ];
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # LISTENERS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "listener",
        "title": "Event Listener",
        "description": "Laravel event listener for handling events",
        "content": """<?php

namespace App\\Listeners;

use App\\Events\\{EventName};
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Queue\\InteractsWithQueue;
use Illuminate\\Support\\Facades\\Log;

class {ListenerName} implements ShouldQueue
{
    use InteractsWithQueue;

    public function __construct()
    {
        //
    }

    public function handle({EventName} $event): void
    {
        Log::info('Handling event', [
            'event' => get_class($event),
            'data' => $event->{model}->toArray(),
        ]);

        // Listener logic here
    }

    public function failed({EventName} $event, \\Throwable $exception): void
    {
        Log::error("Listener failed: {$exception->getMessage()}");
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # NOTIFICATIONS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "notification",
        "title": "Notification",
        "description": "Laravel notification for multi-channel notifications",
        "content": """<?php

namespace App\\Notifications;

use Illuminate\\Bus\\Queueable;
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Notifications\\Messages\\MailMessage;
use Illuminate\\Notifications\\Notification;

class {NotificationName} extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $title,
        public readonly string $message,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail', 'database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject($this->title)
            ->line($this->message)
            ->action('View Details', url('/'))
            ->line('Thank you for using our application!');
    }

    public function toArray(object $notifiable): array
    {
        return [
            'title' => $this->title,
            'message' => $this->message,
        ];
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # COMMANDS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "command",
        "title": "Artisan Command",
        "description": "Laravel artisan console command",
        "content": """<?php

namespace App\\Console\\Commands;

use Illuminate\\Console\\Command;

class {CommandName} extends Command
{
    protected $signature = '{command:name} {argument} {--option=}';
    protected $description = 'Command description';

    public function handle(): int
    {
        $this->info('Starting command...');

        $argument = $this->argument('argument');
        $option = $this->option('option');

        // Command logic here
        $this->info("Processing: $argument");

        if ($this->confirm('Do you wish to continue?')) {
            // Continue processing
        }

        $this->newLine();
        $this->info('Command completed successfully!');

        return Command::SUCCESS;
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # TESTS - FEATURE
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "test_feature",
        "title": "Feature Test",
        "description": "Laravel feature test with HTTP assertions",
        "content": """<?php

namespace Tests\\Feature;

use App\\Models\\User;
use App\\Models\\{ModelName};
use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use Tests\\TestCase;

class {TestName} extends TestCase
{
    use RefreshDatabase;

    public function test_can_list_{models}(): void
    {
        $user = User::factory()->create();
        {ModelName}::factory()->count(3)->create();

        $response = $this->actingAs($user)
            ->getJson('/api/{models}');

        $response->assertStatus(200)
            ->assertJsonCount(3, 'data');
    }

    public function test_can_create_{model}(): void
    {
        $user = User::factory()->create();
        $data = {ModelName}::factory()->make()->toArray();

        $response = $this->actingAs($user)
            ->postJson('/api/{models}', $data);

        $response->assertStatus(201)
            ->assertJsonStructure(['id', 'name']);

        $this->assertDatabaseHas('{models}', ['name' => $data['name']]);
    }

    public function test_can_update_{model}(): void
    {
        $user = User::factory()->create();
        ${model} = {ModelName}::factory()->create();

        $response = $this->actingAs($user)
            ->patchJson("/api/{models}/{${model}->id}", [
                'name' => 'Updated Name'
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('{models}', ['id' => ${model}->id, 'name' => 'Updated Name']);
    }

    public function test_can_delete_{model}(): void
    {
        $user = User::factory()->create();
        ${model} = {ModelName}::factory()->create();

        $response = $this->actingAs($user)
            ->deleteJson("/api/{models}/{${model}->id}");

        $response->assertStatus(204);
        $this->assertDatabaseMissing('{models}', ['id' => ${model}->id]);
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*", "node_modules/*"]
    },

    # TESTS - UNIT
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "test_unit",
        "title": "Unit Test",
        "description": "Laravel unit test for model and business logic",
        "content": """<?php

namespace Tests\\Unit;

use App\\Models\\{ModelName};
use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use Tests\\TestCase;

class {TestName} extends TestCase
{
    use RefreshDatabase;

    public function test_{model}_has_required_attributes(): void
    {
        ${model} = {ModelName}::factory()->create([
            'name' => 'Test Name',
            'is_active' => true,
        ]);

        $this->assertEquals('Test Name', ${model}->name);
        $this->assertTrue(${model}->is_active);
    }

    public function test_{model}_can_be_created(): void
    {
        ${model} = {ModelName}::create([
            'name' => 'Test',
            'description' => 'Test description',
        ]);

        $this->assertInstanceOf({ModelName}::class, ${model});
        $this->assertDatabaseHas('{models}', ['name' => 'Test']);
    }

    public function test_{model}_relationships(): void
    {
        ${model} = {ModelName}::factory()->create();

        $this->assertInstanceOf(\\Illuminate\\Database\\Eloquent\\Collection::class, ${model}->related);
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*", "node_modules/*"]
    },

    # FACTORIES
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "factory",
        "title": "Model Factory",
        "description": "Laravel model factory for testing",
        "content": """<?php

namespace Database\\Factories;

use App\\Models\\{ModelName};
use Illuminate\\Database\\Eloquent\\Factories\\Factory;

class {ModelName}Factory extends Factory
{
    protected $model = {ModelName}::class;

    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'description' => fake()->paragraph(),
            'email' => fake()->unique()->safeEmail(),
            'is_active' => fake()->boolean(80),
            'user_id' => \\App\\Models\\User::factory(),
        ];
    }

    public function active(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => true,
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # SEEDERS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "seeder",
        "title": "Database Seeder",
        "description": "Laravel seeder for populating database",
        "content": """<?php

namespace Database\\Seeders;

use App\\Models\\{ModelName};
use Illuminate\\Database\\Seeder;

class {ModelName}Seeder extends Seeder
{
    public function run(): void
    {
        // Create specific records
        {ModelName}::create([
            'name' => 'Default Item',
            'description' => 'Default description',
            'is_active' => true,
        ]);

        // Create random records using factory
        {ModelName}::factory()
            ->count(50)
            ->create();

        // Create with relationships
        {ModelName}::factory()
            ->count(10)
            ->hasRelated(3)
            ->create();
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # SERVICE CLASSES
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "service",
        "title": "Service Class",
        "description": "Laravel service class for business logic",
        "content": """<?php

namespace App\\Services;

use App\\Models\\{ModelName};
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Log;

class {ServiceName}
{
    public function __construct(
        private readonly {ModelName}Repository $repository,
    ) {}

    public function process(array $data): {ModelName}
    {
        return DB::transaction(function () use ($data) {
            ${model} = $this->repository->create($data);

            // Additional business logic
            $this->performAdditionalProcessing(${model});

            Log::info("{ModelName} processed", ['id' => ${model}->id]);

            return ${model};
        });
    }

    private function performAdditionalProcessing({ModelName} ${model}): void
    {
        // Complex business logic here
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # REPOSITORIES
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "repository",
        "title": "Repository Pattern",
        "description": "Laravel repository for data access abstraction",
        "content": """<?php

namespace App\\Repositories;

use App\\Models\\{ModelName};
use Illuminate\\Database\\Eloquent\\Collection;

class {ModelName}Repository
{
    public function all(): Collection
    {
        return {ModelName}::all();
    }

    public function find(int $id): ?{ModelName}
    {
        return {ModelName}::find($id);
    }

    public function create(array $data): {ModelName}
    {
        return {ModelName}::create($data);
    }

    public function update({ModelName} ${model}, array $data): {ModelName}
    {
        ${model}->update($data);
        return ${model}->fresh();
    }

    public function delete({ModelName} ${model}): bool
    {
        return ${model}->delete();
    }

    public function findByEmail(string $email): ?{ModelName}
    {
        return {ModelName}::where('email', $email)->first();
    }

    public function getActive(): Collection
    {
        return {ModelName}::where('is_active', true)->get();
    }
}""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },

    # BLADE VIEWS
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "blade_view",
        "title": "Blade Template",
        "description": "Laravel Blade view template",
        "content": """@extends('layouts.app')

@section('title', '{Page Title}')

@section('content')
<div class="container">
    <div class="row">
        <div class="col-md-12">
            <h1>{{ ${title} }}</h1>

            @if(session('success'))
                <div class="alert alert-success">
                    {{ session('success') }}
                </div>
            @endif

            <div class="card">
                <div class="card-header">
                    <h2>{{ ${heading} }}</h2>
                </div>
                <div class="card-body">
                    @forelse(${items} as ${item})
                        <div class="item">
                            <h3>{{ ${item}->name }}</h3>
                            <p>{{ ${item}->description }}</p>

                            @can('update', ${item})
                                <a href="{{ route('{resource}.edit', ${item}) }}" class="btn btn-primary">
                                    Edit
                                </a>
                            @endcan
                        </div>
                    @empty
                        <p>No items found.</p>
                    @endforelse

                    {{ ${items}->links() }}
                </div>
            </div>
        </div>
    </div>
</div>
@endsection""",
        "language": "blade",
        "file_extensions": ["blade.php"],
        "ignore_patterns": ["vendor/*", "node_modules/*"]
    },

    # CONFIG
    {
        "category": "backend",
        "name": "laravel",
        "spec_type": "config",
        "title": "Configuration File",
        "description": "Laravel configuration file",
        "content": """<?php

return [
    /*
    |--------------------------------------------------------------------------
    | {Configuration Name}
    |--------------------------------------------------------------------------
    |
    | Configuration description here
    |
    */

    'key' => env('CONFIG_KEY', 'default_value'),

    'nested' => [
        'option1' => env('OPTION1', true),
        'option2' => env('OPTION2', 'value'),
    ],

    'array_options' => [
        'item1',
        'item2',
        'item3',
    ],
];""",
        "language": "php",
        "file_extensions": ["php"],
        "ignore_patterns": ["vendor/*"]
    },
]


def seed_specs():
    """Seed Laravel specs into database"""
    db = SessionLocal()

    try:
        print(f"🌱 Seeding {len(LARAVEL_SPECS)} Laravel specs...")

        created_count = 0
        updated_count = 0

        for spec_data in LARAVEL_SPECS:
            # Check if spec already exists
            existing = db.query(Spec).filter(
                Spec.category == spec_data["category"],
                Spec.name == spec_data["name"],
                Spec.spec_type == spec_data["spec_type"]
            ).first()

            if existing:
                # Update existing spec
                for key, value in spec_data.items():
                    setattr(existing, key, value)
                updated_count += 1
                print(f"   ↻ Updated: {spec_data['spec_type']} - {spec_data['title']}")
            else:
                # Create new spec
                spec = Spec(id=uuid4(), **spec_data)
                db.add(spec)
                created_count += 1
                print(f"   ✓ Created: {spec_data['spec_type']} - {spec_data['title']}")

        db.commit()
        print(f"\n✅ Laravel specs seeded successfully!")
        print(f"   📦 Created: {created_count}")
        print(f"   🔄 Updated: {updated_count}")
        print(f"   📊 Total: {len(LARAVEL_SPECS)} specs")

    except Exception as e:
        db.rollback()
        print(f"❌ Error seeding specs: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_specs()
