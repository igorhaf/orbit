from typing import List, Dict
from sqlalchemy.orm import Session
from app.models.task_result import TaskResult
from app.models.consistency_issue import ConsistencyIssue, IssueSeverity, IssueStatus
from app.models.project import Project
from app.services.validators import (
    NamingValidator,
    ImportValidator,
)
from app.orchestrators.registry import OrchestratorRegistry
import logging
import re

logger = logging.getLogger(__name__)


class ConsistencyValidator:
    """
    Valida consistência entre tasks após batch execution

    Features:
    - Coordena validators especializados
    - Detecta inconsistências entre tasks
    - Auto-corrige issues quando possível
    - Gera relatórios detalhados
    """

    def __init__(self, db: Session):
        self.db = db

    async def validate_batch(
        self,
        project_id: str,
        task_result_ids: List[str]
    ) -> Dict:
        """
        Valida consistência de um batch de tasks

        Args:
            project_id: ID do projeto (UUID string)
            task_result_ids: IDs dos TaskResults a validar (UUID strings)

        Returns:
            {
                'total_issues': int,
                'critical': int,
                'warnings': int,
                'auto_fixed': int,
                'issues': List[Dict]
            }
        """

        logger.info(f"🔍 Validating consistency for project {project_id}...")

        # Buscar task results
        task_results = self.db.query(TaskResult).filter(
            TaskResult.id.in_(task_result_ids)
        ).all()

        if not task_results:
            logger.info("  No task results found, skipping validation")
            return {
                'total_issues': 0,
                'critical': 0,
                'warnings': 0,
                'auto_fixed': 0,
                'issues': []
            }

        # Pegar conventions da stack (se disponível)
        project = self.db.query(Project).filter(Project.id == project_id).first()

        conventions = {}
        if project and hasattr(project, 'stack'):
            try:
                stack_key = project.stack
                orchestrator = OrchestratorRegistry.get_orchestrator(stack_key)
                if hasattr(orchestrator, 'get_conventions'):
                    conventions = orchestrator.get_conventions()
            except Exception as e:
                logger.warning(f"  Could not get conventions: {e}")

        # Executar validators
        all_issues = []

        logger.info("  Running NamingValidator...")
        naming_validator = NamingValidator(conventions)
        naming_issues = naming_validator.validate(task_results)
        all_issues.extend(naming_issues)
        logger.info(f"    Found {len(naming_issues)} naming issues")

        logger.info("  Running ImportValidator...")
        import_validator = ImportValidator()
        import_issues = import_validator.validate(task_results)
        all_issues.extend(import_issues)
        logger.info(f"    Found {len(import_issues)} import issues")

        logger.info(f"  Total issues found: {len(all_issues)}")

        # Contar por severidade
        critical = sum(1 for i in all_issues if i['severity'] == 'CRITICAL')
        warnings = sum(1 for i in all_issues if i['severity'] == 'WARNING')

        # Salvar issues no banco
        self._save_issues(project_id, all_issues)

        # Tentar auto-fix
        auto_fixed = await self._auto_fix_issues(task_results, all_issues)

        result = {
            'total_issues': len(all_issues),
            'critical': critical,
            'warnings': warnings,
            'auto_fixed': auto_fixed,
            'issues': all_issues
        }

        logger.info(
            f"✅ Validation complete: "
            f"{critical} critical, {warnings} warnings, "
            f"{auto_fixed} auto-fixed"
        )

        return result

    def _save_issues(self, project_id: str, issues: List[Dict]):
        """
        Salva issues no banco de dados
        """

        for issue_data in issues:
            try:
                issue = ConsistencyIssue(
                    project_id=project_id,
                    severity=issue_data['severity'].lower(),
                    status='detected',
                    category=issue_data['category'],
                    message=issue_data['message'],
                    task_ids=issue_data.get('task_ids', []),
                    auto_fixable=issue_data.get('auto_fixable', False),
                    fix_suggestion=issue_data.get('fix_suggestion'),
                    fix_applied=None
                )

                self.db.add(issue)
            except Exception as e:
                logger.error(f"Failed to save issue: {e}")

        try:
            self.db.commit()
        except Exception as e:
            logger.error(f"Failed to commit issues: {e}")
            self.db.rollback()

    async def _auto_fix_issues(
        self,
        task_results: List[TaskResult],
        issues: List[Dict]
    ) -> int:
        """
        Tenta auto-corrigir issues quando possível

        Returns:
            Número de issues corrigidos
        """

        fixed_count = 0

        for issue in issues:
            if not issue.get('auto_fixable'):
                continue

            try:
                # Aplicar fix baseado na categoria
                if issue['category'] == 'naming':
                    success = await self._fix_naming_issue(task_results, issue)
                elif issue['category'] == 'import':
                    success = await self._fix_import_issue(task_results, issue)
                else:
                    success = False

                if success:
                    fixed_count += 1
                    logger.info(f"  ✅ Auto-fixed: {issue['message']}")

                    # Update issue in database
                    self._mark_issue_fixed(issue)

            except Exception as e:
                logger.error(f"  ❌ Failed to auto-fix: {str(e)}")

        return fixed_count

    def _mark_issue_fixed(self, issue_data: Dict):
        """
        Marca issue como fixed no banco
        """

        try:
            # Find issue by message (não ideal mas funciona)
            issue = self.db.query(ConsistencyIssue).filter(
                ConsistencyIssue.message == issue_data['message']
            ).first()

            if issue:
                issue.status = 'auto_fixed'
                issue.fix_applied = issue_data.get('fix_suggestion')
                self.db.commit()
        except Exception as e:
            logger.error(f"Failed to mark issue as fixed: {e}")

    async def _fix_naming_issue(
        self,
        task_results: List[TaskResult],
        issue: Dict
    ) -> bool:
        """
        Corrige issue de naming
        """

        # Parse fix suggestion
        # Ex: 'Change import from "Books" to "Book"'

        suggestion = issue.get('fix_suggestion', '')

        # Extract old and new names
        match = re.search(r'from "(\w+)" to "(\w+)"', suggestion)
        if not match:
            return False

        old_name = match.group(1)
        new_name = match.group(2)

        # Aplicar fix nas tasks afetadas
        fixed = False
        for task_id in issue.get('task_ids', []):
            # Buscar TaskResult
            result = next(
                (r for r in task_results if str(r.task_id) == str(task_id)),
                None
            )

            if not result:
                continue

            # Substituir no código
            old_code = result.output_code

            # Use word boundaries to avoid partial matches
            pattern = r'\b' + re.escape(old_name) + r'\b'
            new_code = re.sub(pattern, new_name, old_code)

            if old_code != new_code:
                # Atualizar
                result.output_code = new_code
                fixed = True

        if fixed:
            try:
                self.db.commit()
                return True
            except Exception as e:
                logger.error(f"Failed to commit auto-fix: {e}")
                self.db.rollback()
                return False

        return False

    async def _fix_import_issue(
        self,
        task_results: List[TaskResult],
        issue: Dict
    ) -> bool:
        """
        Corrige issue de import
        """

        # Similar ao fix_naming_issue
        # Por enquanto, retorna False (não implementado)
        return False

    def generate_report(self, project_id: str) -> Dict:
        """
        Gera relatório de consistência para projeto

        Returns:
            {
                'summary': {...},
                'issues_by_category': {...},
                'issues_by_severity': {...},
                'recommendations': [...]
            }
        """

        # Buscar todos issues do projeto
        issues = self.db.query(ConsistencyIssue).filter(
            ConsistencyIssue.project_id == project_id
        ).all()

        # Agrupar por categoria
        by_category = {}
        for issue in issues:
            cat = issue.category
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(issue)

        # Agrupar por severidade
        by_severity = {
            'critical': 0,
            'warning': 0,
            'info': 0
        }

        for issue in issues:
            severity = issue.severity.lower()
            if severity in by_severity:
                by_severity[severity] += 1

        # Gerar recomendações
        recommendations = []

        if by_severity['critical'] > 0:
            recommendations.append(
                f"🔴 {by_severity['critical']} critical issues found. "
                "These MUST be fixed before deploying."
            )

        if by_severity['warning'] > 5:
            recommendations.append(
                f"⚠️  {by_severity['warning']} warnings found. "
                "Consider fixing these to avoid potential bugs."
            )

        auto_fixable = sum(1 for i in issues if i.auto_fixable)
        if auto_fixable > 0:
            recommendations.append(
                f"💡 {auto_fixable} issues can be auto-fixed. "
                "Run auto-fix to resolve them automatically."
            )

        if len(issues) == 0:
            recommendations.append(
                "✅ No consistency issues found! Code is consistent across all tasks."
            )

        return {
            'summary': {
                'total_issues': len(issues),
                'critical': by_severity['critical'],
                'warnings': by_severity['warning'],
                'info': by_severity['info'],
                'auto_fixable': auto_fixable
            },
            'issues_by_category': {
                cat: len(issues_list)
                for cat, issues_list in by_category.items()
            },
            'issues_by_severity': by_severity,
            'recommendations': recommendations,
            'issues': [
                {
                    'id': str(issue.id),
                    'severity': issue.severity,
                    'category': issue.category,
                    'message': issue.message,
                    'status': issue.status,
                    'auto_fixable': issue.auto_fixable,
                    'fix_suggestion': issue.fix_suggestion,
                    'created_at': issue.created_at.isoformat() if issue.created_at else None
                }
                for issue in issues
            ]
        }
