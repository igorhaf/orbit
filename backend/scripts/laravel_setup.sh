#!/bin/bash
# Laravel Backend Provisioning Script
# Creates complete Laravel structure WITHOUT Docker
# PROMPT #60 - Approach 2: Manual Structure Generation

set -e  # Exit on error

PROJECT_NAME="$1"

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name required"
    echo "Usage: $0 <project-name>"
    exit 1
fi

PROJECT_PATH="/projects/$PROJECT_NAME"
BACKEND_PATH="$PROJECT_PATH/backend"

echo "=========================================="
echo "Laravel Backend Provisioning"
echo "=========================================="
echo "Project: $PROJECT_NAME"
echo "Backend Path: $BACKEND_PATH"
echo ""

# Ensure project root exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo "Error: Project directory not found: $PROJECT_PATH"
    exit 1
fi

echo "Creating Laravel directory structure..."

# Create full Laravel directory structure
mkdir -p "$BACKEND_PATH"/{app/{Console/{Commands},Exceptions,Http/{Controllers/{Auth,API},Middleware,Requests},Models,Providers},bootstrap/cache,config,database/{factories,migrations,seeders},public,resources/{css,js,views},routes,storage/{app/{public},framework/{cache/{data},sessions,testing,views},logs},tests/{Feature,Unit}}

echo "Creating Laravel configuration files..."

# Create composer.json
cat > "$BACKEND_PATH/composer.json" << 'EOF'
{
    "name": "laravel/laravel",
    "type": "project",
    "description": "The Laravel Framework.",
    "keywords": ["framework", "laravel"],
    "license": "MIT",
    "require": {
        "php": "^8.1",
        "guzzlehttp/guzzle": "^7.2",
        "laravel/framework": "^10.10",
        "laravel/sanctum": "^3.2",
        "laravel/tinker": "^2.8"
    },
    "require-dev": {
        "fakerphp/faker": "^1.9.1",
        "laravel/pint": "^1.0",
        "laravel/sail": "^1.18",
        "mockery/mockery": "^1.4.4",
        "nunomaduro/collision": "^7.0",
        "phpunit/phpunit": "^10.1",
        "spatie/laravel-ignition": "^2.0"
    },
    "autoload": {
        "psr-4": {
            "App\\": "app/",
            "Database\\Factories\\": "database/factories/",
            "Database\\Seeders\\": "database/seeders/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Tests\\": "tests/"
        }
    },
    "scripts": {
        "post-autoload-dump": [
            "Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
            "@php artisan package:discover --ansi"
        ],
        "post-update-cmd": [
            "@php artisan vendor:publish --tag=laravel-assets --ansi --force"
        ],
        "post-root-package-install": [
            "@php -r \"file_exists('.env') || copy('.env.example', '.env');\""
        ],
        "post-create-project-cmd": [
            "@php artisan key:generate --ansi"
        ]
    },
    "extra": {
        "laravel": {
            "dont-discover": []
        }
    },
    "config": {
        "optimize-autoloader": true,
        "preferred-install": "dist",
        "sort-packages": true,
        "allow-plugins": {
            "pestphp/pest-plugin": true,
            "php-http/discovery": true
        }
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}
EOF

# Create .env
cat > "$BACKEND_PATH/.env" << EOF
APP_NAME="${PROJECT_NAME//-/_}"
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8000

LOG_CHANNEL=stack
LOG_LEVEL=debug

DB_CONNECTION=pgsql
DB_HOST=database
DB_PORT=5432
DB_DATABASE=${PROJECT_NAME//-/_}_db
DB_USERNAME=orbit_user
DB_PASSWORD=orbit_password

BROADCAST_DRIVER=log
CACHE_DRIVER=file
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120

SANCTUM_STATEFUL_DOMAINS=localhost:3000
SESSION_DOMAIN=localhost
EOF

# Create .env.example
cp "$BACKEND_PATH/.env" "$BACKEND_PATH/.env.example"

# Create artisan executable
cat > "$BACKEND_PATH/artisan" << 'EOF'
#!/usr/bin/env php
<?php

define('LARAVEL_START', microtime(true));

require __DIR__.'/vendor/autoload.php';

$app = require_once __DIR__.'/bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);

$status = $kernel->handle(
    $input = new Symfony\Component\Console\Input\ArgvInput,
    new Symfony\Component\Console\Output\ConsoleOutput
);

$kernel->terminate($input, $status);

exit($status);
EOF

chmod +x "$BACKEND_PATH/artisan"

# Create bootstrap/app.php
cat > "$BACKEND_PATH/bootstrap/app.php" << 'EOF'
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        //
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
EOF

# Create config/app.php
cat > "$BACKEND_PATH/config/app.php" << 'EOF'
<?php

use Illuminate\Support\Facades\Facade;

return [
    'name' => env('APP_NAME', 'Laravel'),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost'),
    'asset_url' => env('ASSET_URL'),
    'timezone' => 'UTC',
    'locale' => 'en',
    'fallback_locale' => 'en',
    'faker_locale' => 'en_US',
    'key' => env('APP_KEY'),
    'cipher' => 'AES-256-CBC',
    'maintenance' => [
        'driver' => 'file',
    ],
    'providers' => [
        Illuminate\Auth\AuthServiceProvider::class,
        Illuminate\Broadcasting\BroadcastServiceProvider::class,
        Illuminate\Bus\BusServiceProvider::class,
        Illuminate\Cache\CacheServiceProvider::class,
        Illuminate\Foundation\Providers\ConsoleSupportServiceProvider::class,
        Illuminate\Cookie\CookieServiceProvider::class,
        Illuminate\Database\DatabaseServiceProvider::class,
        Illuminate\Encryption\EncryptionServiceProvider::class,
        Illuminate\Filesystem\FilesystemServiceProvider::class,
        Illuminate\Foundation\Providers\FoundationServiceProvider::class,
        Illuminate\Hashing\HashServiceProvider::class,
        Illuminate\Mail\MailServiceProvider::class,
        Illuminate\Notifications\NotificationServiceProvider::class,
        Illuminate\Pagination\PaginationServiceProvider::class,
        Illuminate\Pipeline\PipelineServiceProvider::class,
        Illuminate\Queue\QueueServiceProvider::class,
        Illuminate\Redis\RedisServiceProvider::class,
        Illuminate\Auth\Passwords\PasswordResetServiceProvider::class,
        Illuminate\Session\SessionServiceProvider::class,
        Illuminate\Translation\TranslationServiceProvider::class,
        Illuminate\Validation\ValidationServiceProvider::class,
        Illuminate\View\ViewServiceProvider::class,
    ],
    'aliases' => Facade::defaultAliases()->merge([
        // Add custom aliases here
    ])->toArray(),
];
EOF

# Create config/database.php
cat > "$BACKEND_PATH/config/database.php" << 'EOF'
<?php

use Illuminate\Support\Str;

return [
    'default' => env('DB_CONNECTION', 'pgsql'),
    'connections' => [
        'pgsql' => [
            'driver' => 'pgsql',
            'url' => env('DATABASE_URL'),
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'forge'),
            'username' => env('DB_USERNAME', 'forge'),
            'password' => env('DB_PASSWORD', ''),
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => 'public',
            'sslmode' => 'prefer',
        ],
    ],
    'migrations' => 'migrations',
    'redis' => [
        'client' => env('REDIS_CLIENT', 'phpredis'),
        'options' => [
            'cluster' => env('REDIS_CLUSTER', 'redis'),
            'prefix' => env('REDIS_PREFIX', Str::slug(env('APP_NAME', 'laravel'), '_').'_database_'),
        ],
        'default' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_DB', '0'),
        ],
        'cache' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_CACHE_DB', '1'),
        ],
    ],
];
EOF

# Create routes/api.php
cat > "$BACKEND_PATH/routes/api.php" << 'EOF'
<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json(['status' => 'ok']);
});

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
EOF

# Create routes/web.php
cat > "$BACKEND_PATH/routes/web.php" << 'EOF'
<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'message' => 'Laravel API',
        'version' => '10.0',
    ]);
});
EOF

# Create routes/console.php
cat > "$BACKEND_PATH/routes/console.php" << 'EOF'
<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');
EOF

# Create public/index.php
cat > "$BACKEND_PATH/public/index.php" << 'EOF'
<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

require __DIR__.'/../vendor/autoload.php';

$app = require_once __DIR__.'/../bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$response = $kernel->handle(
    $request = Request::capture()
)->send();

$kernel->terminate($request, $response);
EOF

# Create app/Models/User.php
cat > "$BACKEND_PATH/app/Models/User.php" << 'EOF'
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
    ];
}
EOF

# Create app/Http/Controllers/Controller.php
cat > "$BACKEND_PATH/app/Http/Controllers/Controller.php" << 'EOF'
<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Foundation\Validation\ValidatesRequests;
use Illuminate\Routing\Controller as BaseController;

class Controller extends BaseController
{
    use AuthorizesRequests, ValidatesRequests;
}
EOF

# Create app/Exceptions/Handler.php
cat > "$BACKEND_PATH/app/Exceptions/Handler.php" << 'EOF'
<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

class Handler extends ExceptionHandler
{
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }
}
EOF

# Create app/Providers/AppServiceProvider.php
cat > "$BACKEND_PATH/app/Providers/AppServiceProvider.php" << 'EOF'
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        //
    }
}
EOF

# Create .gitignore
cat > "$BACKEND_PATH/.gitignore" << 'EOF'
/vendor
/node_modules
.env
.env.backup
.phpunit.result.cache
Homestead.json
Homestead.yaml
npm-debug.log
yarn-error.log
/.idea
/.vscode
EOF

# Create phpunit.xml
cat > "$BACKEND_PATH/phpunit.xml" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="./vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true">
    <testsuites>
        <testsuite name="Unit">
            <directory suffix="Test.php">./tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory suffix="Test.php">./tests/Feature</directory>
        </testsuite>
    </testsuites>
    <coverage>
        <include>
            <directory suffix=".php">./app</directory>
        </include>
    </coverage>
</phpunit>
EOF

# Create storage .gitignore files to preserve empty directories
# Ensure all directories exist first
mkdir -p "$BACKEND_PATH/storage/app/public"
mkdir -p "$BACKEND_PATH/storage/framework/cache/data"
mkdir -p "$BACKEND_PATH/storage/framework/sessions"
mkdir -p "$BACKEND_PATH/storage/framework/testing"
mkdir -p "$BACKEND_PATH/storage/framework/views"
mkdir -p "$BACKEND_PATH/storage/logs"

cat > "$BACKEND_PATH/storage/app/.gitignore" << 'EOF'
*
!public/
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/app/public/.gitignore" << 'EOF'
*
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/framework/.gitignore" << 'EOF'
compiled.php
config.php
down
events.scanned.php
maintenance.php
routes.php
routes.scanned.php
schedule-*
services.json
EOF

cat > "$BACKEND_PATH/storage/framework/cache/.gitignore" << 'EOF'
*
!data/
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/framework/cache/data/.gitignore" << 'EOF'
*
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/framework/sessions/.gitignore" << 'EOF'
*
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/framework/testing/.gitignore" << 'EOF'
*
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/framework/views/.gitignore" << 'EOF'
*
!.gitignore
EOF

cat > "$BACKEND_PATH/storage/logs/.gitignore" << 'EOF'
*
!.gitignore
EOF

# Set permissions
chmod -R 775 "$BACKEND_PATH/storage"
chmod -R 775 "$BACKEND_PATH/bootstrap/cache"

# Create database migration for users table
cat > "$BACKEND_PATH/database/migrations/0001_01_01_000000_create_users_table.php" << 'EOF'
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};
EOF

# Create basic test files
cat > "$BACKEND_PATH/tests/TestCase.php" << 'EOF'
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;
}
EOF

cat > "$BACKEND_PATH/tests/CreatesApplication.php" << 'EOF'
<?php

namespace Tests;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;

trait CreatesApplication
{
    public function createApplication(): Application
    {
        $app = require __DIR__.'/../bootstrap/app.php';

        $app->make(Kernel::class)->bootstrap();

        return $app;
    }
}
EOF

cat > "$BACKEND_PATH/tests/Feature/ExampleTest.php" << 'EOF'
<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    public function test_the_application_returns_a_successful_response(): void
    {
        $response = $this->get('/');

        $response->assertStatus(200);
    }
}
EOF

cat > "$BACKEND_PATH/tests/Unit/ExampleTest.php" << 'EOF'
<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class ExampleTest extends TestCase
{
    public function test_that_true_is_true(): void
    {
        $this->assertTrue(true);
    }
}
EOF

echo ""
echo "✅ Laravel backend provisioned successfully!"
echo ""
echo "Installation Notes:"
echo "  - Full Laravel 10 structure created"
echo "  - composer.json configured with all dependencies"
echo "  - Database configured for PostgreSQL"
echo "  - Dependencies will install when you run: docker-compose up"
echo ""
echo "Database Configuration:"
echo "  Database: ${PROJECT_NAME//-/_}_db"
echo "  Username: orbit_user"
echo "  Password: orbit_password"
echo "  Host: database"
echo "  Port: 5432"
echo ""
echo "Next Steps:"
echo "  1. cd projects/$PROJECT_NAME"
echo "  2. docker-compose up -d"
echo "  3. Wait for Composer to install dependencies (~2-3 minutes)"
echo "  4. docker-compose exec backend php artisan key:generate"
echo "  5. docker-compose exec backend php artisan migrate"
echo ""
