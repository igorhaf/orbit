from .base import StackOrchestrator
from typing import Dict, List, Any
import re

class PHPMySQLOrchestrator(StackOrchestrator):
    """
    Orquestrador especializado em PHP + MySQL

    Conhece:
    - PSR-4 autoloading
    - MVC + Repository pattern
    - PDO prepared statements
    - Security best practices PHP
    """

    def __init__(self):
        super().__init__()
        self.stack_name = "PHP + MySQL"
        self.stack_description = "PHP 8.2+ with MySQL 8.0+ using MVC and Repository patterns"

    def get_stack_context(self) -> str:
        return """
STACK: PHP 8.2+ with MySQL 8.0+

ARCHITECTURE:
- MVC (Model-View-Controller) pattern
- Repository pattern for data access
- Service layer for business logic
- PSR-4 autoloading standard
- Composer for dependency management

FILE STRUCTURE:
src/
  Controllers/      # Handle HTTP requests
  Models/           # Data entities
  Repositories/     # Database access (PDO)
  Services/         # Business logic
config/
  database.php
public/
  index.php

NAMING CONVENTIONS:
- Classes: PascalCase (UserController)
- Methods: camelCase (findById)
- Variables: camelCase ($userId)
- Files: Match class names (UserController.php)
- Database tables: snake_case PLURAL (users, books)
- Database columns: snake_case (user_id, created_at)

SECURITY REQUIREMENTS:
- ALWAYS use PDO prepared statements
- Use password_hash() for passwords
- Validate all user inputs
- CSRF tokens for forms
"""

    def get_patterns(self) -> Dict[str, str]:
        return {
            "controller": """<?php

namespace App\\Controllers;

use App\\Services\\{EntityName}Service;

class {EntityName}Controller
{{
    private {EntityName}Service ${entityName}Service;

    public function __construct({EntityName}Service ${entityName}Service)
    {{
        $this->{entityName}Service = ${entityName}Service;
    }}

    public function index(): string
    {{
        ${entityName}s = $this->{entityName}Service->getAll();
        return json_encode(${entityName}s);
    }}

    public function show(int $id): string
    {{
        ${entityName} = $this->{entityName}Service->getById($id);

        if (!${entityName}) {{
            http_response_code(404);
            return json_encode(['error' => '{EntityName} not found']);
        }}

        return json_encode(${entityName});
    }}

    public function store(): string
    {{
        $data = json_decode(file_get_contents('php://input'), true);

        try {{
            ${entityName} = $this->{entityName}Service->create($data);
            http_response_code(201);
            return json_encode(${entityName});
        }} catch (\\Exception $e) {{
            http_response_code(400);
            return json_encode(['error' => $e->getMessage()]);
        }}
    }}
}}
""",

            "repository": """<?php

namespace App\\Repositories;

use App\\Models\\{EntityName};
use PDO;

class {EntityName}Repository
{{
    private PDO $db;

    public function __construct(PDO $db)
    {{
        $this->db = $db;
    }}

    public function findAll(): array
    {{
        $stmt = $this->db->prepare("
            SELECT * FROM {table_name}
            ORDER BY created_at DESC
        ");

        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }}

    public function findById(int $id): ?array
    {{
        $stmt = $this->db->prepare("
            SELECT * FROM {table_name}
            WHERE id = :id
        ");

        $stmt->execute(['id' => $id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }}

    public function create(array $data): array
    {{
        $stmt = $this->db->prepare("
            INSERT INTO {table_name} (name, description, created_at)
            VALUES (:name, :description, NOW())
        ");

        $stmt->execute($data);
        $data['id'] = $this->db->lastInsertId();

        return $data;
    }}
}}
"""
        }

    def get_conventions(self) -> Dict[str, Any]:
        return {
            "classes": "PascalCase",
            "methods": "camelCase",
            "variables": "camelCase",
            "files": "match_class_name",
            "database": {
                "tables": "snake_case_plural",
                "columns": "snake_case"
            }
        }

    def validate_output(self, code: str, task: Dict) -> List[str]:
        """Validações específicas de PHP"""
        issues = []

        # Check SQL injection protection
        if re.search(r'(SELECT|INSERT|UPDATE|DELETE)', code, re.IGNORECASE):
            if 'prepare(' not in code:
                issues.append("❌ SQL queries NOT using PDO prepared statements!")

        # Check password handling
        if 'password' in code.lower():
            if 'password_hash(' not in code:
                issues.append("❌ NOT using password_hash()!")

        # Check namespace
        if '<?php' in code and 'namespace' not in code:
            issues.append("⚠️ Missing namespace declaration")

        return issues
