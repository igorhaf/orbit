"""
Script para popular AI Models e System Settings com configurações completas
PROMPT #54 - Database Population
"""

import sys
import os
from pathlib import Path
from datetime import datetime

# Adicionar diretório pai ao path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.system_settings import SystemSettings
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def populate_ai_models(db):
    """Popular tabela de AI Models com configurações completas para todos os providers"""

    logger.info("🤖 Populating AI Models...")

    # Limpar modelos existentes (opcional - comentar se quiser manter)
    # db.query(AIModel).delete()
    # db.commit()

    ai_models_data = [
        # ANTHROPIC MODELS - PROMPT #100: Using Claude 3.5 Haiku as universal fallback
        # All Anthropic models use the same Haiku 3.5 ID for simplicity
        {
            "name": "Claude Haiku 3.5",
            "provider": "anthropic",
            "api_key": settings.anthropic_api_key or "your-anthropic-api-key",
            "usage_type": AIModelUsageType.TASK_EXECUTION,
            "is_active": True,
            "config": {
                "model": "claude-3-5-haiku-20241022",
                "model_id": "claude-3-5-haiku-20241022",
                "max_tokens": 8192,
                "temperature": 0.7
            }
        },
        {
            "name": "Claude Haiku 3.5 (Interview)",
            "provider": "anthropic",
            "api_key": settings.anthropic_api_key or "your-anthropic-api-key",
            "usage_type": AIModelUsageType.INTERVIEW,
            "is_active": True,
            "config": {
                "model": "claude-3-5-haiku-20241022",
                "model_id": "claude-3-5-haiku-20241022",
                "max_tokens": 8192,
                "temperature": 0.7
            }
        },
        {
            "name": "Claude Haiku 3.5 (Prompt Gen)",
            "provider": "anthropic",
            "api_key": settings.anthropic_api_key or "your-anthropic-api-key",
            "usage_type": AIModelUsageType.PROMPT_GENERATION,
            "is_active": True,
            "config": {
                "model": "claude-3-5-haiku-20241022",
                "model_id": "claude-3-5-haiku-20241022",
                "max_tokens": 8192,
                "temperature": 0.8
            }
        },

        # OPENAI MODELS
        {
            "name": "GPT-4o",
            "provider": "openai",
            "api_key": settings.openai_api_key or "your-openai-api-key",
            "usage_type": AIModelUsageType.PROMPT_GENERATION,
            "is_active": True,
            "config": {
                "model": "gpt-4o",
                "max_tokens": 4000,
                "temperature": 0.7
            }
        },
        {
            "name": "GPT-4 Turbo",
            "provider": "openai",
            "api_key": settings.openai_api_key or "your-openai-api-key",
            "usage_type": AIModelUsageType.GENERAL,
            "is_active": False,
            "config": {
                "model": "gpt-4-turbo-preview",
                "max_tokens": 4000,
                "temperature": 0.7
            }
        },
        {
            "name": "GPT-3.5 Turbo",
            "provider": "openai",
            "api_key": settings.openai_api_key or "your-openai-api-key",
            "usage_type": AIModelUsageType.GENERAL,
            "is_active": False,
            "config": {
                "model": "gpt-3.5-turbo",
                "max_tokens": 2000,
                "temperature": 0.7
            }
        },

        # GOOGLE AI MODELS
        {
            "name": "Gemini 1.5 Pro",
            "provider": "google",
            "api_key": settings.google_ai_api_key or "your-google-api-key",
            "usage_type": AIModelUsageType.COMMIT_GENERATION,
            "is_active": True,
            "config": {
                "model": "gemini-1.5-pro",
                "max_tokens": 8000,
                "temperature": 0.5
            }
        },
        {
            "name": "Gemini 1.5 Flash",
            "provider": "google",
            "api_key": settings.google_ai_api_key or "your-google-api-key",
            "usage_type": AIModelUsageType.GENERAL,
            "is_active": False,
            "config": {
                "model": "gemini-1.5-flash",
                "max_tokens": 4000,
                "temperature": 0.7
            }
        },
    ]

    created = 0
    skipped = 0

    for model_data in ai_models_data:
        # Verificar se já existe (por nome)
        existing = db.query(AIModel).filter(
            AIModel.name == model_data["name"]
        ).first()

        if existing:
            logger.info(f"⏭️  Skipping '{model_data['name']}' - already exists")
            skipped += 1
            continue

        # Criar novo modelo
        model = AIModel(**model_data)
        db.add(model)
        created += 1
        logger.info(f"✅ Created '{model_data['name']}' ({model_data['provider']}, {model_data['usage_type'].value})")

    db.commit()

    logger.info(f"🎉 AI Models: {created} created, {skipped} skipped")
    return created, skipped


def populate_system_settings(db):
    """Popular tabela de System Settings com configurações padrão"""

    logger.info("⚙️  Populating System Settings...")

    # Limpar settings existentes (opcional - comentar se quiser manter)
    # db.query(SystemSettings).delete()
    # db.commit()

    settings_data = [
        {
            "key": "default_ai_provider",
            "value": "anthropic",
            "description": "Provider de IA padrão para operações gerais"
        },
        {
            "key": "max_tokens_default",
            "value": 4000,
            "description": "Número máximo de tokens padrão para requisições de IA"
        },
        {
            "key": "temperature_default",
            "value": 0.7,
            "description": "Temperatura padrão para modelos de IA (0.0 - 1.0)"
        },
        {
            "key": "enable_prompt_caching",
            "value": True,
            "description": "Habilitar cache de prompts para reduzir custos"
        },
        {
            "key": "enable_token_optimization",
            "value": True,
            "description": "Habilitar otimizações de tokens (PROMPT #54)"
        },
        {
            "key": "interview_context_max_messages",
            "value": 5,
            "description": "Número máximo de mensagens recentes a manter em contexto de entrevista"
        },
        {
            "key": "specs_max_per_request",
            "value": 10,
            "description": "Número máximo de specs a incluir por requisição"
        },
        {
            "key": "enable_ai_execution_logging",
            "value": True,
            "description": "Habilitar log detalhado de execuções de IA"
        },
        {
            "key": "cost_tracking_enabled",
            "value": True,
            "description": "Habilitar rastreamento de custos de IA"
        },
        {
            "key": "max_interview_questions",
            "value": 12,
            "description": "Número máximo de perguntas em uma entrevista"
        },
        {
            "key": "enable_specs_filtering",
            "value": True,
            "description": "Habilitar filtragem seletiva de specs (PROMPT #54)"
        },
        {
            "key": "enable_context_truncation",
            "value": True,
            "description": "Habilitar truncamento de contexto em entrevistas (PROMPT #54)"
        },
        {
            "key": "system_prompt_version",
            "value": "condensed_v1",
            "description": "Versão do system prompt (condensed_v1 = 50% menor)"
        },
        {
            "key": "app_version",
            "value": "2.1.0",
            "description": "Versão atual do ORBIT"
        },
        {
            "key": "maintenance_mode",
            "value": False,
            "description": "Modo de manutenção (desabilita novas requisições)"
        }
    ]

    created = 0
    updated = 0

    for setting_data in settings_data:
        # Verificar se já existe (por key)
        existing = db.query(SystemSettings).filter(
            SystemSettings.key == setting_data["key"]
        ).first()

        if existing:
            # Atualizar valor existente
            existing.value = setting_data["value"]
            existing.description = setting_data["description"]
            existing.updated_at = datetime.utcnow()
            updated += 1
            logger.info(f"🔄 Updated '{setting_data['key']}' = {setting_data['value']}")
        else:
            # Criar novo setting
            setting = SystemSettings(**setting_data)
            db.add(setting)
            created += 1
            logger.info(f"✅ Created '{setting_data['key']}' = {setting_data['value']}")

    db.commit()

    logger.info(f"🎉 System Settings: {created} created, {updated} updated")
    return created, updated


def main():
    """Função principal"""
    logger.info("=" * 80)
    logger.info("🌱 ORBIT DATABASE POPULATION - PROMPT #54")
    logger.info("=" * 80)

    # Criar engine e sessão
    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # Popular AI Models
        models_created, models_skipped = populate_ai_models(db)

        # Popular System Settings
        settings_created, settings_updated = populate_system_settings(db)

        # Mostrar resumo
        logger.info("")
        logger.info("=" * 80)
        logger.info("📊 FINAL SUMMARY")
        logger.info("=" * 80)

        # AI Models
        total_models = db.query(AIModel).count()
        active_models = db.query(AIModel).filter(AIModel.is_active == True).count()
        logger.info(f"🤖 AI Models:")
        logger.info(f"   - Total: {total_models}")
        logger.info(f"   - Active: {active_models}")
        logger.info(f"   - Created: {models_created}")
        logger.info(f"   - Skipped: {models_skipped}")

        # System Settings
        total_settings = db.query(SystemSettings).count()
        logger.info(f"⚙️  System Settings:")
        logger.info(f"   - Total: {total_settings}")
        logger.info(f"   - Created: {settings_created}")
        logger.info(f"   - Updated: {settings_updated}")

        logger.info("=" * 80)
        logger.info("✅ Database population completed successfully!")
        logger.info("=" * 80)

    except Exception as e:
        logger.error(f"❌ Error during population: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
