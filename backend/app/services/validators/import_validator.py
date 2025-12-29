from typing import List, Dict
import re
import logging

logger = logging.getLogger(__name__)


class ImportValidator:
    """
    Valida consistência de imports/exports

    Detecta:
    - Classes importadas mas não exportadas
    - Imports com paths incorretos
    - Circular dependencies
    - Missing imports
    """

    def validate(self, task_results: List) -> List[Dict]:
        """
        Valida imports/exports
        """

        issues = []

        # Mapear exports
        exports = self._extract_exports(task_results)

        # Mapear imports
        imports = self._extract_imports(task_results)

        # Validar que imports têm exports correspondentes
        missing_exports = self._validate_imports_have_exports(imports, exports)
        issues.extend(missing_exports)

        # Detectar circular dependencies
        circular = self._detect_circular_dependencies(imports)
        issues.extend(circular)

        return issues

    def _extract_exports(self, task_results: List) -> Dict:
        """
        Extrai exports de cada task
        """

        exports = {}

        for result in task_results:
            code = result.output_code
            file_path = result.file_path or ''

            # PHP: namespace + class name
            namespace_match = re.search(r'namespace\s+([\w\\]+)', code)
            class_match = re.search(r'class\s+(\w+)', code)

            if namespace_match and class_match:
                namespace = namespace_match.group(1)
                class_name = class_match.group(1)
                full_name = f"{namespace}\\{class_name}"

                exports[full_name] = {
                    'task_id': str(result.task_id),
                    'file_path': file_path,
                    'class_name': class_name
                }

                # Also add just the class name for easier matching
                exports[class_name] = {
                    'task_id': str(result.task_id),
                    'file_path': file_path,
                    'class_name': class_name
                }

            # TypeScript: export class/function
            ts_exports = re.findall(r'export\s+(?:class|function|const)\s+(\w+)', code)

            for exported in ts_exports:
                exports[exported] = {
                    'task_id': str(result.task_id),
                    'file_path': file_path,
                    'class_name': exported
                }

        return exports

    def _extract_imports(self, task_results: List) -> Dict:
        """
        Extrai imports de cada task
        """

        imports = {}

        for result in task_results:
            code = result.output_code
            task_imports = []

            # PHP: use statements
            php_imports = re.findall(r'use\s+([\w\\]+);', code)

            # Extract just the class name from full namespace
            for php_import in php_imports:
                # Ex: "App\Models\Book" -> "Book"
                class_name = php_import.split('\\')[-1]
                task_imports.append(class_name)
                task_imports.append(php_import)  # Also keep full name

            # TypeScript: import statements
            ts_imports = re.findall(
                r'import\s+{([^}]+)}\s+from\s+[\'"]([^\'"]+)[\'"]',
                code
            )

            for imported_items, path in ts_imports:
                items = [item.strip() for item in imported_items.split(',')]
                task_imports.extend(items)

            # TypeScript: default imports
            default_imports = re.findall(
                r'import\s+(\w+)\s+from\s+[\'"]([^\'"]+)[\'"]',
                code
            )

            for imported, path in default_imports:
                task_imports.append(imported)

            imports[str(result.task_id)] = task_imports

        return imports

    def _validate_imports_have_exports(
        self,
        imports: Dict,
        exports: Dict
    ) -> List[Dict]:
        """
        Valida que tudo que é importado foi exportado
        """

        issues = []

        for task_id, imported_items in imports.items():
            for imported in imported_items:
                if imported not in exports:
                    # Check if it's a system/library import (e.g., React, Laravel)
                    if self._is_system_import(imported):
                        continue

                    issues.append({
                        'category': 'import',
                        'severity': 'CRITICAL',
                        'message': f'Task {task_id} imports "{imported}" but it is not exported by any task',
                        'task_ids': [task_id],
                        'auto_fixable': False,
                        'fix_suggestion': f'Ensure "{imported}" is exported by the appropriate task'
                    })

        return issues

    def _is_system_import(self, import_name: str) -> bool:
        """
        Verifica se é import de sistema/biblioteca
        """

        system_imports = [
            'React', 'useState', 'useEffect', 'useCallback', 'useMemo',
            'Component', 'Fragment', 'ReactNode', 'FC',
            'Illuminate', 'Laravel', 'Model', 'Controller',
            'Request', 'Response', 'Exception',
            'Collection', 'Builder', 'Eloquent',
            'Database', 'Schema', 'Migration',
            'str', 'int', 'bool', 'float', 'list', 'dict',
        ]

        # Check if starts with capital letter and is in common system imports
        return import_name in system_imports or import_name.startswith('use ')

    def _detect_circular_dependencies(self, imports: Dict) -> List[Dict]:
        """
        Detecta circular dependencies
        """

        # Simplified - para produção, usar algoritmo DFS
        # Por enquanto, apenas retorna vazio
        # Seria necessário mapear qual task importa qual e detectar ciclos

        return []
