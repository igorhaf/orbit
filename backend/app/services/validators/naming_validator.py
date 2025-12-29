from typing import List, Dict
import re
import logging

logger = logging.getLogger(__name__)


class NamingValidator:
    """
    Valida consistência de naming entre tasks

    Detecta:
    - Class names diferentes (Book vs Books)
    - Method names diferentes (findById vs getById)
    - Field names diferentes (created_at vs createdAt)
    - Variable names diferentes
    """

    def __init__(self, stack_conventions: Dict):
        """
        Args:
            stack_conventions: Conventions da stack (do orquestrador)
        """
        self.conventions = stack_conventions

    def validate(self, task_results: List) -> List[Dict]:
        """
        Valida naming entre tasks

        Returns:
            Lista de issues encontrados
        """

        issues = []

        # Extrair entities de todas tasks
        entities = self._extract_entities(task_results)

        # Validar class names
        class_issues = self._validate_class_names(entities, task_results)
        issues.extend(class_issues)

        # Validar method names
        method_issues = self._validate_method_names(task_results)
        issues.extend(method_issues)

        # Validar field names
        field_issues = self._validate_field_names(task_results)
        issues.extend(field_issues)

        return issues

    def _extract_entities(self, task_results: List) -> Dict:
        """
        Extrai entities (classes) de cada task

        Returns:
            {task_id: {entity_name, defined_as, referenced_as}}
        """

        entities = {}

        for result in task_results:
            code = result.output_code
            task_id = str(result.task_id)

            # Detectar definições de classe
            # Ex: "class Book", "class BookRepository"
            class_defs = re.findall(r'class\s+(\w+)', code)

            # Detectar importações
            # Ex: "import Book", "from models import Books"
            imports = re.findall(r'(?:import|from)\s+[\w.]+\s+import\s+(\w+)', code)
            imports += re.findall(r'import\s+{([^}]+)}', code)  # TypeScript: import { Book }

            # Flatten imports from TypeScript
            flat_imports = []
            for imp in imports:
                if ',' in imp:
                    flat_imports.extend([i.strip() for i in imp.split(',')])
                else:
                    flat_imports.append(imp)

            # Detectar referências
            # Ex: "new Book()", "Book::find()"
            refs = re.findall(r'\b([A-Z]\w+)(?:\(|\:\:)', code)

            entities[task_id] = {
                'defined': class_defs,
                'imported': flat_imports,
                'referenced': refs
            }

        return entities

    def _validate_class_names(self, entities: Dict, task_results: List) -> List[Dict]:
        """
        Valida que class names são consistentes

        Exemplo de issue:
        - Task 1 define "Book"
        - Task 2 importa "Books" ← INCONSISTENTE!
        """

        issues = []

        # Mapear definições
        defined_classes = {}  # {class_name: task_id}

        for task_id, entity in entities.items():
            for class_name in entity['defined']:
                defined_classes[class_name] = task_id

        # Verificar importações/referências
        for task_id, entity in entities.items():
            # Checar imports
            for imported in entity['imported']:
                if imported not in defined_classes:
                    # Buscar similar (pode ser typo)
                    similar = self._find_similar(imported, defined_classes.keys())

                    if similar:
                        issues.append({
                            'category': 'naming',
                            'severity': 'CRITICAL',
                            'message': f'Task {task_id} imports "{imported}" but class is defined as "{similar}"',
                            'task_ids': [task_id, defined_classes[similar]],
                            'auto_fixable': True,
                            'fix_suggestion': f'Change import from "{imported}" to "{similar}"'
                        })

            # Checar referências
            for ref in entity['referenced']:
                if ref not in defined_classes:
                    similar = self._find_similar(ref, defined_classes.keys())

                    if similar:
                        issues.append({
                            'category': 'naming',
                            'severity': 'WARNING',
                            'message': f'Task {task_id} references "{ref}" but class is defined as "{similar}"',
                            'task_ids': [task_id, defined_classes[similar]],
                            'auto_fixable': True,
                            'fix_suggestion': f'Change reference from "{ref}" to "{similar}"'
                        })

        return issues

    def _validate_method_names(self, task_results: List) -> List[Dict]:
        """
        Valida que métodos são chamados com nomes corretos

        Exemplo:
        - Repository define "findById()"
        - Controller chama "getById()" ← INCONSISTENTE!
        """

        issues = []

        # Mapear métodos definidos
        defined_methods = {}  # {class_name: {method_name: task_id}}

        for result in task_results:
            code = result.output_code

            # Detectar definições de método
            # PHP: "public function findById"
            # TypeScript: "findById()"

            methods = re.findall(
                r'(?:function|public|private|protected)\s+(\w+)\s*\(',
                code
            )

            # Detectar qual classe
            class_match = re.search(r'class\s+(\w+)', code)
            if class_match:
                class_name = class_match.group(1)

                if class_name not in defined_methods:
                    defined_methods[class_name] = {}

                for method in methods:
                    defined_methods[class_name][method] = str(result.task_id)

        # Verificar chamadas de método
        for result in task_results:
            code = result.output_code

            # Detectar chamadas de método
            # Ex: "$repo->findById(", "repository.getById("
            calls = re.findall(r'(?:\$\w+|\w+)->(\w+)\(', code)
            calls += re.findall(r'(?:\$\w+|\w+)\.(\w+)\(', code)

            for called_method in calls:
                # Verificar se método existe em alguma classe
                method_exists = any(
                    called_method in methods
                    for methods in defined_methods.values()
                )

                if not method_exists:
                    # Buscar similar
                    all_methods = [
                        method
                        for methods in defined_methods.values()
                        for method in methods.keys()
                    ]

                    similar = self._find_similar(called_method, all_methods)

                    if similar:
                        issues.append({
                            'category': 'naming',
                            'severity': 'CRITICAL',
                            'message': f'Task {result.task_id} calls method "{called_method}()" but method is defined as "{similar}()"',
                            'task_ids': [str(result.task_id)],
                            'auto_fixable': True,
                            'fix_suggestion': f'Change method call from "{called_method}" to "{similar}"'
                        })

        return issues

    def _validate_field_names(self, task_results: List) -> List[Dict]:
        """
        Valida que field names são consistentes

        Exemplo:
        - Model define "created_at" (snake_case)
        - Controller usa "createdAt" (camelCase) ← INCONSISTENTE!
        """

        issues = []

        # Mapear campos definidos
        defined_fields = {}  # {class_name: {field_name: task_id}}

        for result in task_results:
            code = result.output_code

            # Detectar definições de campo
            # PHP: "private $created_at"
            # TypeScript: "created_at: string"

            fields = re.findall(r'(?:private|public|protected)\s+\$?(\w+)', code)
            fields += re.findall(r'(\w+):\s*(?:string|number|boolean|Date)', code)

            class_match = re.search(r'class\s+(\w+)', code)
            if class_match:
                class_name = class_match.group(1)

                if class_name not in defined_fields:
                    defined_fields[class_name] = {}

                for field in fields:
                    defined_fields[class_name][field] = str(result.task_id)

        # Verificar referências a campos
        for result in task_results:
            code = result.output_code

            # Detectar acessos a campos
            # Ex: "$book->created_at", "book.createdAt"
            accesses = re.findall(r'\$\w+->(\w+)', code)
            accesses += re.findall(r'\w+\.(\w+)', code)

            for accessed_field in accesses:
                # Verificar consistência de naming
                # Ex: created_at vs createdAt

                # Converter para diferentes styles
                snake_case = self._to_snake_case(accessed_field)
                camel_case = self._to_camel_case(accessed_field)

                # Verificar se campo existe em algum style
                field_exists = any(
                    accessed_field in fields or
                    snake_case in fields or
                    camel_case in fields
                    for fields in defined_fields.values()
                )

                if not field_exists:
                    # Buscar similar
                    all_fields = [
                        field
                        for fields in defined_fields.values()
                        for field in fields.keys()
                    ]

                    similar = self._find_similar(accessed_field, all_fields)

                    if similar and similar != accessed_field:
                        issues.append({
                            'category': 'naming',
                            'severity': 'WARNING',
                            'message': f'Task {result.task_id} accesses field "{accessed_field}" but field is defined as "{similar}"',
                            'task_ids': [str(result.task_id)],
                            'auto_fixable': True,
                            'fix_suggestion': f'Change field access from "{accessed_field}" to "{similar}"'
                        })

        return issues

    def _find_similar(self, name: str, candidates: List[str]) -> str:
        """
        Encontra nome similar em lista de candidatos
        Usa Levenshtein distance
        """

        from difflib import get_close_matches

        if not candidates:
            return None

        matches = get_close_matches(name, candidates, n=1, cutoff=0.6)

        return matches[0] if matches else None

    def _to_snake_case(self, name: str) -> str:
        """Converte para snake_case"""
        return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()

    def _to_camel_case(self, name: str) -> str:
        """Converte para camelCase"""
        components = name.split('_')
        return components[0] + ''.join(x.title() for x in components[1:])
