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

    def _file_exists(self, root_path: Path, file_path: str) -> bool:
        """Check if file exists in project"""

        # Try exact path
        if (root_path / file_path).is_file():
            return True

        # Try in subdirectories (one level deep)
        for subdir in root_path.iterdir():
            if subdir.is_dir():
                if (subdir / file_path).is_file():
                    return True

        return False

    def _dir_exists(self, root_path: Path, dir_path: str) -> bool:
        """Check if directory exists in project"""

        # Try exact path
        if (root_path / dir_path).is_dir():
            return True

        # Try in subdirectories (one level deep)
        for subdir in root_path.iterdir():
            if subdir.is_dir():
                if (subdir / dir_path).is_dir():
                    return True

        return False

    def _check_packages(
        self,
        root_path: Path,
        package_file: str,
        required_packages: List[str]
    ) -> bool:
        """
        Check if package file contains required packages

        Supports:
        - package.json (Node.js)
        - composer.json (PHP)
        - requirements.txt (Python)
        - Gemfile (Ruby)
        - pom.xml (Java)
        """

        # Find package file
        file_path = None
        if (root_path / package_file).is_file():
            file_path = root_path / package_file
        else:
            # Check subdirectories
            for subdir in root_path.iterdir():
                if subdir.is_dir() and (subdir / package_file).is_file():
                    file_path = subdir / package_file
                    break

        if not file_path:
            return False

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")

            # JSON files (package.json, composer.json)
            if package_file.endswith(".json"):
                data = json.loads(content)
                dependencies = {
                    **data.get("dependencies", {}),
                    **data.get("devDependencies", {}),
                    **data.get("require", {}),
                    **data.get("require-dev", {})
                }

                for package in required_packages:
                    if package in dependencies:
                        return True

            # Text files (requirements.txt, Gemfile)
            else:
                for package in required_packages:
                    if package in content:
                        return True

        except Exception as e:
            logger.warning(f"Failed to parse {package_file}: {e}")
            return False

        return False
