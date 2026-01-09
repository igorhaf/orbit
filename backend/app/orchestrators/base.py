from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
import logging
import json

logger = logging.getLogger(__name__)

class StackOrchestrator(ABC):
    """
    Base class para orquestradores especializados por stack

    Cada orquestrador implementa:
    - Contexto específico da stack
    - Patterns de código (templates)
    - Naming conventions
    - Validações especializadas

    Isso permite:
    - Contexto cirúrgico (3-5k tokens vs 200k+)
    - Consistência garantida (segue padrões da stack)
    - Custo otimizado (Haiku suficiente)
    - Assertividade máxima (conhece a stack)
    """

    def __init__(self):
        self.stack_name: str = ""
        self.stack_description: str = ""
        self.version: str = "1.0.0"

    @abstractmethod
    def get_stack_context(self) -> str:
        """
        Retorna contexto específico da stack

        Deve incluir:
        - Tecnologias e versões
        - Arquitetura padrão
        - File structure esperada
        - Security best practices
        - Naming conventions
        """
        pass

    @abstractmethod
    def get_patterns(self) -> Dict[str, str]:
        """
        Retorna templates de código da stack

        Keys: "controller", "service", "model", "repository", etc
        Values: Template code with {placeholders}

        Exemplo:
        {
            "controller": "class {EntityName}Controller { ... }",
            "service": "class {EntityName}Service { ... }"
        }
        """
        pass

    @abstractmethod
    def get_conventions(self) -> Dict[str, Any]:
        """
        Retorna naming conventions da stack

        Exemplo:
        {
            "classes": "PascalCase",
            "methods": "camelCase",
            "database": {"tables": "snake_case_plural"}
        }
        """
        pass

    @abstractmethod
    def validate_output(self, code: str, task: Dict) -> List[str]:
        """
        Validação especializada da stack

        Returns:
            Lista de issues encontrados (vazio = ok)
        """
        pass

    def generate_spec_prompt(self, interview_data: Dict) -> str:
        """
        Gera prompt para criar spec técnica completa
        Usa contexto específico da stack
        """
        entities_str = ", ".join(interview_data.get("entities", []))
        features_str = ", ".join(interview_data.get("features", []))

        return f"""
You are a technical architect specializing in {self.stack_name}.

PROJECT REQUIREMENTS:
- Name: {interview_data.get("project_name", "Unnamed Project")}
- Description: {interview_data.get("project_description", "")}
- Main Entities: {entities_str}
- Required Features: {features_str}

STACK CONTEXT:
{self.get_stack_context()}

YOUR TASK:
Generate a COMPLETE technical specification for this project using {self.stack_name}.

The specification must include:

1. DATABASE SCHEMA
   - Exact table names (following conventions)
   - All fields with types
   - Relationships
   - Indexes

2. API ENDPOINTS (if applicable)
   - Exact routes
   - HTTP methods
   - Request/response formats

3. FILE STRUCTURE
   - All files to be created
   - Folder organization
   - Dependencies between files

4. IMPLEMENTATION DETAILS
   - Which patterns to use
   - Security considerations
   - Validation rules

Return a detailed JSON following this structure:
{{
    "database": {{
        "tables": [
            {{
                "name": "...",
                "fields": [...],
                "relationships": [...]
            }}
        ]
    }},
    "endpoints": [...],
    "files": [
        {{
            "path": "...",
            "type": "controller|service|model|...",
            "entity": "...",
            "dependencies": [...]
        }}
    ],
    "conventions": {{...}},
    "security": [...]
}}

Be specific and follow {self.stack_name} best practices exactly.
"""

    def decompose_spec(self, spec: Dict) -> List[Dict]:
        """
        Decompõe spec em tasks atômicas (3-5k tokens cada)

        Base implementation - pode ser sobrescrita
        """
        tasks = []
        task_id = 1

        # Task 1: Setup
        tasks.append({
            "id": task_id,
            "type": "setup",
            "title": f"Setup {self.stack_name} project structure",
            "description": "Initialize project with proper folder structure and dependencies",
            "complexity": 1,
            "estimated_tokens": 3000,
            "depends_on": []
        })
        task_id += 1

        # Tasks para cada file no spec
        for file_spec in spec.get("files", []):
            if file_spec.get("type") == "setup":
                continue

            tasks.append({
                "id": task_id,
                "type": file_spec.get("type", "generic"),
                "title": f"Create {file_spec['path']}",
                "description": f"Implement {file_spec.get('entity', '')} {file_spec.get('type', '')}",
                "complexity": self._estimate_complexity(file_spec),
                "estimated_tokens": self._estimate_tokens(file_spec),
                "depends_on": self._resolve_dependencies(file_spec, tasks),
                "file_spec": file_spec
            })
            task_id += 1

        return tasks

    def build_task_context(
        self,
        task: Dict,
        spec: Dict,
        previous_outputs: Dict[int, str]
    ) -> str:
        """
        Constrói contexto cirúrgico para task (3-5k tokens!)

        Inclui:
        - Stack context
        - Conventions
        - Pattern específico
        - Outputs de tasks dependentes
        """
        context = f"""
You are implementing a feature for a {self.stack_name} project.

STACK CONTEXT:
{self.get_stack_context()}

CRITICAL CONVENTIONS (follow EXACTLY):
{json.dumps(self.get_conventions(), indent=2)}

"""

        # Pattern específico
        task_type = task.get("type", "generic")
        if task_type in self.get_patterns():
            context += f"""
PATTERN TO FOLLOW:
{self.get_patterns()[task_type]}

"""

        # Outputs de dependências
        if task.get("depends_on"):
            context += "\nPREVIOUS CODE (maintain consistency):\n\n"
            for dep_id in task["depends_on"]:
                if dep_id in previous_outputs:
                    context += f"--- From Task {dep_id} ---\n"
                    context += previous_outputs[dep_id]
                    context += "\n\n"

        # Task atual
        context += f"""
CURRENT TASK:
{task['title']}

{task.get('description', '')}

REQUIREMENTS:
- Follow the exact patterns above
- Maintain consistency with previous code
- Use proper naming conventions
- Include error handling

Generate ONLY the code for this file.
No explanations, no markdown formatting.
"""

        return context

    def _estimate_complexity(self, file_spec: Dict) -> int:
        """Estima complexidade 1-5"""
        complexity_map = {
            "setup": 1, "model": 1, "schema": 1,
            "repository": 2, "service": 2, "controller": 2,
            "middleware": 3, "api_route": 2, "page": 3
        }
        return complexity_map.get(file_spec.get("type", ""), 2)

    def _estimate_tokens(self, file_spec: Dict) -> int:
        """Estima tokens necessários"""
        complexity = self._estimate_complexity(file_spec)
        return 2000 + (complexity * 1000)

    def _resolve_dependencies(
        self,
        file_spec: Dict,
        existing_tasks: List[Dict]
    ) -> List[int]:
        """Resolve dependências entre tasks"""
        deps = []
        for dep_path in file_spec.get("dependencies", []):
            for task in existing_tasks:
                if task.get("file_spec", {}).get("path") == dep_path:
                    deps.append(task["id"])
                    break
        return deps
