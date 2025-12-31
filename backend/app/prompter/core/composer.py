"""
Prompt Composer

Composes prompts from templates with inheritance, components, and variable substitution.
Uses Jinja2 for templating with support for hybrid storage (DB + filesystem).
"""

from pathlib import Path
from typing import Dict, Any, Optional, List
import hashlib
import yaml
from jinja2 import Environment, FileSystemLoader, Template, TemplateSyntaxError
from sqlalchemy.orm import Session

from app.models.prompt_template import PromptTemplate
from app.prompter.core.exceptions import (
    TemplateNotFoundError,
    TemplateValidationError,
    VariableValidationError
)
from app.prompter.core.commands import (
    StructuredPrompt,
    Action,
    Step,
    ExpectedOutput,
    Command,
    Conditional,
    CommandVerb,
    parse_action_from_dict,
    parse_step_from_dict,
    parse_expected_output_from_dict
)


class PromptComposer:
    """
    Composes prompts from templates with support for:
    - Jinja2 templating
    - Template inheritance (extends)
    - Component composition
    - Variable validation
    - Post-processing pipeline
    - Hybrid storage (DB priority, filesystem fallback)
    """

    def __init__(self, template_dir: Path, db: Session):
        """
        Initialize composer

        Args:
            template_dir: Directory containing YAML template files
            db: Database session for template queries
        """
        self.template_dir = Path(template_dir)
        self.db = db

        # Initialize Jinja2 environment
        self.jinja_env = Environment(
            loader=FileSystemLoader(self.template_dir),
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False  # We control the content
        )

        # Component cache for performance
        self._component_cache: Dict[str, Dict] = {}

    def render(
        self,
        template_name: str,
        variables: Dict[str, Any],
        version: Optional[int] = None
    ) -> str:
        """
        Render template with variables

        Steps:
        1. Load template (DB or filesystem)
        2. Validate variables against schema
        3. Load and render components
        4. Handle inheritance (extends)
        5. Render with Jinja2
        6. Post-process
        7. Update usage stats

        Args:
            template_name: Name of the template
            variables: Variables to substitute
            version: Specific version (None = latest active)

        Returns:
            Rendered prompt string

        Raises:
            TemplateNotFoundError: Template not found
            VariableValidationError: Missing/invalid variables
            TemplateSyntaxError: Invalid Jinja2 syntax
        """

        # 1. Load template
        template_def = self._load_template(template_name, version)

        # 2. Validate variables
        self._validate_variables(variables, template_def.get('variables_schema', {}))

        # 3. Load components
        components = self._load_components(template_def.get('components', []))
        variables['components'] = components

        # 4. Handle inheritance
        if 'extends' in template_def:
            base_template = self._load_template(template_def['extends'])
            template_def = self._merge_templates(base_template, template_def)

        # 5. Render with Jinja2
        try:
            template = Template(template_def['template_content'])
            rendered = template.render(**variables)
        except TemplateSyntaxError as e:
            raise TemplateValidationError(f"Template syntax error: {e}")

        # 6. Post-process
        if 'post_process' in template_def and template_def['post_process']:
            rendered = self._post_process(rendered, template_def['post_process'])

        # 7. Update usage stats (async in production)
        self._increment_usage(template_name, version)

        return rendered

    def render_structured(
        self,
        template_name: str,
        variables: Dict[str, Any],
        version: Optional[int] = None
    ) -> str:
        """
        Render template in structured ACTION/STEP/EXPECTED_OUTPUT format

        This method checks if the template uses the new structured format
        (with 'action', 'steps', 'expected_output' fields). If yes, it renders
        using the StructuredPrompt class. If no, it falls back to the legacy
        render() method for backward compatibility.

        Args:
            template_name: Name of the template
            variables: Variables to substitute
            version: Specific version (None = latest active)

        Returns:
            Rendered prompt string

        Raises:
            TemplateNotFoundError: Template not found
            VariableValidationError: Missing/invalid variables
        """

        # 1. Load template
        template_def = self._load_template(template_name, version)

        # 2. Check if structured format
        if 'action' in template_def and 'steps' in template_def and 'expected_output' in template_def:
            # New structured format
            return self._render_structured_template(template_def, variables, version)
        else:
            # Legacy format - fallback to old render()
            return self.render(template_name, variables, version)

    def _render_structured_template(
        self,
        template_def: Dict,
        variables: Dict[str, Any],
        version: Optional[int]
    ) -> str:
        """
        Render structured template using StructuredPrompt class

        Args:
            template_def: Template definition dictionary
            variables: Variables to substitute
            version: Template version

        Returns:
            Rendered prompt string
        """

        # 1. Validate variables
        self._validate_variables(variables, template_def.get('variables_schema', {}))

        # 2. Load components
        components = self._load_components(template_def.get('components', []))
        variables['components'] = components

        # 3. Parse structured elements
        action = parse_action_from_dict(template_def['action'])
        steps = [parse_step_from_dict(step) for step in template_def['steps']]
        expected_output = parse_expected_output_from_dict(template_def['expected_output'])
        system_context = template_def.get('system_context')

        # 4. Create StructuredPrompt
        structured_prompt = StructuredPrompt(
            action=action,
            steps=steps,
            expected_output=expected_output,
            system_context=system_context
        )

        # 5. Render to string
        rendered = structured_prompt.render()

        # 6. Apply Jinja2 variable substitution
        try:
            template = Template(rendered)
            rendered = template.render(**variables)
        except TemplateSyntaxError as e:
            raise TemplateValidationError(f"Template syntax error during variable substitution: {e}")

        # 7. Post-process
        if 'post_process' in template_def and template_def['post_process']:
            rendered = self._post_process(rendered, template_def['post_process'])

        # 8. Update usage stats
        self._increment_usage(template_def['name'], version)

        return rendered

    def _load_template(self, name: str, version: Optional[int] = None) -> Dict:
        """
        Load template from DB (priority) or filesystem (fallback)

        Args:
            name: Template name
            version: Specific version or None for latest

        Returns:
            Template dictionary

        Raises:
            TemplateNotFoundError: If template not found
        """

        # Try database first (allows runtime changes)
        query = self.db.query(PromptTemplate).filter(
            PromptTemplate.name == name,
            PromptTemplate.is_active == True
        )

        if version:
            query = query.filter(PromptTemplate.version == version)
        else:
            query = query.order_by(PromptTemplate.version.desc())

        db_template = query.first()

        if db_template:
            return self._db_template_to_dict(db_template)

        # Fallback to filesystem
        template_path = self.template_dir / f"{name}.yaml"
        if template_path.exists():
            with open(template_path, 'r', encoding='utf-8') as f:
                return yaml.safe_load(f)

        # Not found
        raise TemplateNotFoundError(f"Template '{name}' not found in DB or filesystem")

    def _db_template_to_dict(self, template: PromptTemplate) -> Dict:
        """Convert DB model to dictionary format"""
        return {
            'id': str(template.id),
            'name': template.name,
            'category': template.category,
            'template_content': template.template_content,
            'template_format': template.template_format,
            'components': template.components or [],
            'variables_schema': template.variables_schema or {},
            'version': template.version,
            'post_process': template.post_process or [],
            'tags': template.tags or [],
            'recommended_model': template.recommended_model,
            'estimated_tokens': template.estimated_tokens
        }

    def _validate_variables(self, variables: Dict[str, Any], schema: Dict) -> None:
        """
        Validate variables against schema

        Args:
            variables: Provided variables
            schema: Variable schema with 'required' and 'optional' keys

        Raises:
            VariableValidationError: If validation fails
        """
        if not schema:
            return  # No schema = no validation

        required_vars = schema.get('required', [])
        optional_vars = schema.get('optional', [])
        all_allowed = set(required_vars + optional_vars)

        # Check required variables
        missing = [var for var in required_vars if var not in variables]
        if missing:
            raise VariableValidationError(
                f"Missing required variables: {', '.join(missing)}"
            )

        # Check for unexpected variables (warning only in production)
        unexpected = [var for var in variables if var not in all_allowed and var != 'components']
        if unexpected:
            # In production: log warning instead of raising
            print(f"⚠️  Unexpected variables: {', '.join(unexpected)}")

    def _load_components(self, component_list: List[str]) -> Dict[str, Any]:
        """
        Load and cache components

        Args:
            component_list: List of component names/IDs

        Returns:
            Dictionary of component name -> rendered component dict
        """
        components = {}

        for component_name in component_list:
            # Check cache first
            if component_name in self._component_cache:
                components[component_name] = self._component_cache[component_name]
                continue

            # Load component
            try:
                component_def = self._load_template(component_name)
                self._component_cache[component_name] = component_def
                components[component_name] = component_def
            except TemplateNotFoundError:
                print(f"⚠️  Component '{component_name}' not found, skipping")

        return components

    def _merge_templates(self, base: Dict, child: Dict) -> Dict:
        """
        Merge child template with base (inheritance)

        Child overrides base for most fields, but some are merged:
        - variables.required: union
        - variables.optional: union
        - components: union
        - tags: union

        Args:
            base: Base template dict
            child: Child template dict

        Returns:
            Merged template dict
        """
        merged = base.copy()

        # Override simple fields
        merged['template_content'] = child.get('template_content', base['template_content'])
        merged['name'] = child.get('name', base['name'])

        # Merge variables
        base_vars = base.get('variables_schema', {})
        child_vars = child.get('variables_schema', {})

        merged['variables_schema'] = {
            'required': list(set(
                base_vars.get('required', []) +
                child_vars.get('required', [])
            )),
            'optional': list(set(
                base_vars.get('optional', []) +
                child_vars.get('optional', [])
            ))
        }

        # Merge components (union)
        merged['components'] = list(set(
            base.get('components', []) + child.get('components', [])
        ))

        # Merge tags
        merged['tags'] = list(set(
            base.get('tags', []) + child.get('tags', [])
        ))

        # Child overrides post-processing
        merged['post_process'] = child.get('post_process', base.get('post_process', []))

        return merged

    def _post_process(self, text: str, steps: List[Dict]) -> str:
        """
        Apply post-processing pipeline

        Supported steps:
        - trim_whitespace: Remove extra whitespace
        - validate_json: Check JSON validity (doesn't modify)
        - token_count_limit: Truncate if exceeds limit
        - lowercase/uppercase: Transform case

        Args:
            text: Input text
            steps: List of processing step dicts

        Returns:
            Processed text
        """
        import json
        import re

        for step in steps:
            step_type = step.get('type')
            params = step.get('params', {})

            if step_type == 'trim_whitespace':
                # Remove extra whitespace while preserving structure
                text = re.sub(r'\n{3,}', '\n\n', text)  # Max 2 newlines
                text = re.sub(r' {2,}', ' ', text)  # Single spaces
                text = text.strip()

            elif step_type == 'validate_json':
                # Check if JSON is valid (raises error if not)
                try:
                    json.loads(text)
                except json.JSONDecodeError as e:
                    raise TemplateValidationError(f"Invalid JSON in rendered template: {e}")

            elif step_type == 'token_count_limit':
                # Rough token estimation: ~4 chars per token
                max_tokens = params.get('max_tokens', 8000)
                max_chars = max_tokens * 4

                if len(text) > max_chars:
                    text = text[:max_chars] + "\n\n[... truncated ...]"

            elif step_type == 'lowercase':
                text = text.lower()

            elif step_type == 'uppercase':
                text = text.upper()

            else:
                print(f"⚠️  Unknown post-processing step: {step_type}")

        return text

    def _increment_usage(self, template_name: str, version: Optional[int]) -> None:
        """
        Increment usage counter for template

        In production: make this async or queue-based
        """
        query = self.db.query(PromptTemplate).filter(
            PromptTemplate.name == template_name,
            PromptTemplate.is_active == True
        )

        if version:
            query = query.filter(PromptTemplate.version == version)
        else:
            query = query.order_by(PromptTemplate.version.desc())

        template = query.first()

        if template:
            template.usage_count += 1
            self.db.commit()

    def clear_cache(self):
        """Clear component cache"""
        self._component_cache.clear()
