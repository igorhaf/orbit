# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 1940 in / 911 out | Cost: $0.0065

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/services/stack_detector.py (python):
"""
StackDetector Service
Detects technology stack from project file structure and dependencies
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


# Stack detection signatures
STACK_SIGNATURES = {
    "laravel": {
        "required_files": ["artisan", "composer.json"],
        "required_dirs": ["app/Http/Controllers"],
        "optional_files": ["app/Models"],
        "package_indicators": {
            "composer.json": ["laravel/framework"]
        },
        "confidence_boost": 25,
        "description": "Laravel (PHP MVC Framework)"
    },
    "nextjs": {
        "required_files": ["package.json"],
        "required_dirs": [],
        "optional_files": ["next.config.js", "next.config.ts", "app", "pages"],
        "package_indicators": {
            "package.json": ["next", "react"]
        },
        "confidence_boost": 30,
        "description": "Next.js (React Framework)"
    },
    "django": {
        "required_files": ["manage.py"],
        "required_dirs": [],
        "optional_files": ["settings.py", "wsgi.py"],
        "package_indicators": {
            "requirements.txt": ["Django", "django"],
            "pyproject.toml": ["Django", "django"]
        },
        "confidence_boost": 25,
        "description": "Django (Python Web Framework)"
    },
    "rails": {
        "required_files": ["Gemfile", "config.ru"],
        "required_dirs": ["app/controllers", "app/models"],
        "optional_files": ["config/application.rb"],
        "package_indicators": {
            "Gemfile": ["rails"]
        },
        "confidence_boost": 30,
        "description": "Ruby on Rails"
    },
    "express": {
        "required_files": ["package.json"],
        "required_dirs": [],
        "optional_files": ["server.js", "app.js", "index.js"],
        "package_indicators": {
            "package.json": ["express"]
        },
        "confidence_boost": 20,
        "description": "Express.js (Node.js Framework)"
    },
    "fastapi": {
        "required_files": [],
        "required_dirs": [],
        "optional_files": ["main.py", "app.py"],
        "package_indicators": {
            "requirements.txt": ["fastapi", "FastAPI"],
            "pyproject.toml": ["fastapi", "FastAPI"]
        },
        "confidence_boost": 25,
        "description": "FastAPI (Python Framework)"
    },
    "vue": {
        "required_files": ["package.json"],
        "required_dirs": [],
        "optional_files": ["vue.config.js", "vite.config.js", "nuxt.config.js"],
        "package_indicators": {
            "package.json": ["vue", "@vue/cli"]
        },
        "confidence_boost": 25,
        "description": "Vue.js Framework"
    },
    "react": {
        "required_files": ["package.json"],
        "required_dirs": [],
        "optional_files": ["src/App.js", "src/App.tsx", "src/index.js"],
        "package_indicators": {
            "package.json": ["react", "react-dom"]
        },
        "confidence_boost": 15,
        "description": "React Application"
    },
    "angular": {
        "required_files": ["package.json", "angular.json"],
        "required_dirs": [],
        "optional_files": ["src/app"],
        "package_indicators": {
            "package.json": ["@angular/core"]
        },
        "confidence_boost": 30,
        "description": "Angular Framework"
    },
    "spring_boot": {
        "required_files": ["pom.xml"],
        "required_dirs": ["src/main/java"],
        "optional_files": ["application.properties", "application.yml"],
        "package_indicators": {
            "pom.xml": ["spring-boot"]
        },
        "confidence_boost": 30,
        "description": "Spring Boot (Java)"
    },
}


class StackDetector:
    """
    Detects technology stack from project structure
    """

    def detect(self, extraction_path: Path) -> Dict[str, Any]:
        """
        Detect stack from extracted project

        Args:
            extraction_path: Path to extracted project

        Returns:
            {
                "detected_stack": "laravel" or None,
                "confidence": 85 (0-100),
                "indicators_found": [...],
                "all_scores": {"laravel": 85, "nextjs": 30, ...}
            }
        """

        logger.info(f"Detecting stack from {extraction_path}")

        # Calculate confidence scores for each stack
        scores = {}
        indicators = {}

        for stack_key, signature in STACK_SIGNATURES.items():
            score, found_indicators = self._calculate_stack_score(
                extraction_path,
                signature
            )
            scores[stack_key] = score
            indicators[stack_key] = found_indicators

        # Find best match
        if not scores:
            return {
                "detected_stack": None,
                "confidence": 0,
                "indicators_found": [],
                "all_scores": {}
            }

        best_stack = max(scores.items(), key=lambda x: x[1])
        stack_name = best_stack[0]
        confidence = best_stack[1]

        # Only consider detected if confidence > 50
        if confidence < 50:
            logger.info(f"No clear stack detected. Best: {stack_name} ({confidence}%)")
            return {
                "detected_stack": None,
                "confidence": confidence,
                "indicators_found": indicators[stack_name],
                "all_scores": scores
            }

        logger.info(f"Detected stack: {stack_name} ({confidence}% confidence)")

        return {
            "detected_stack": stack_name,
            "confidence": confidence,
            "indicators_found": indicators[stack_name],
            "all_scores": scores,
            "description": STACK_SIGNATURES[stack_name]["description"]
        }

    def _calculate_stack_score(
        self,
        root_path: Path,
        signature: Dict
    ) -> tuple[int, List[str]]:
        """
        Calculate confidence score for a specific stack

        Returns:
            (score, indicators_found)
        """

        score = 0
        indicators = []

        # Check required files (30 points each)
        for required_file in signature.get("required_files", []):
            if self._file_exists(root_path, required_file):
                score += 30
                indicators.append(f"✓ Required file: {required_file}")
            else:
                # Missing required file is a deal-breaker
                return (0, [f"✗ Missing required file: {required_file}"])

        # Check required directories (20 points each)
        for required_dir in signature.get("required_dirs", []):
            if self._dir_exists(root_path, required_dir):
                score += 20
                indicators.append(f"✓ Required dir: {required_dir}")
            else:
                # Missing required dir reduces confidence
                indicators.append(f"✗ Missing required dir: {required_dir}")

        # Check optional files (10 points each, max 30)
        optional_score = 0
        for optional_file in signature.get("optional_files", []):
            if self._file_exists(root_path, optional_file):
                optional_score += 10
                indicators.append(f"✓ Optional: {optional_file}")
            if optional_score >= 30:
                break
        score += min(optional_score, 30)

        # Check package indicators (confidence boost)
        package_indicators = signature.get("package_indicators", {})
        for package_file, required_packages in package_indicators.items():
            if self._check_packages(root_path, package_file, required_packages):
                boost = signature.get("confidence_boost", 20)
                score += boost
                indicators.append(f"✓ Package indicators in {package_file}")

        # Cap at 100
        score = min(score, 100)

        return (score, indicators)

    def _file_exists(self, root_path: Path, file_path: 

## Response

{
  "business_rules": [
    {
      "rule_text": "O sistema identifica a pilha tecnológica com base na presença de arquivos e diretórios específicos para cada stack. Se qualquer arquivo obrigatório estiver ausente, a detecção para essa stack é inválida.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "A confiança na detecção de uma stack é calculada por pontos atribuídos a arquivos obrigatórios (30 pontos cada), diretórios obrigatórios (20 pontos cada), arquivosopcionais (10 pontos cada, máximo 30) e indicadores de pacotes (confiança adicional variável).",
      "rule_type": "domain",
      "confidence": "high"
    },
    {
      "rule_text": "Apenas stacks com confiança superior a 50% são consideradas válidas. Caso contrário, o sistema não identifica nenhuma stack e retorna todos os indicadores encontrados.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema prioriza a stack com a maior pontuação de confiança, limitando o resultado máximo a 100% para evitar superestimação de stacks com múltiplos indicadores.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "A detecção de stacks como Laravel, Next.js e Django inclui verificações específicas de arquivos de configuração e dependências, como composer.json, package.json ou requirements.txt.",
      "rule_type": "validation",
      "confidence": "medium"
    }
  ]
}
