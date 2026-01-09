"""
Interview Question Deduplication Service
PROMPT #97 - RAG Anti-Duplicação Cross-Interview

Previne perguntas duplicadas/similares entre TODAS as entrevistas do mesmo projeto.
Reutiliza a arquitetura de anti-duplicação de tasks (similarity_detector + RAG).
"""

import re
import logging
from typing import Tuple, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session

from app.services.similarity_detector import calculate_semantic_similarity
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


class InterviewQuestionDeduplicator:
    """
    Serviço para detectar e prevenir perguntas duplicadas em entrevistas
    usando análise semântica com embeddings (RAG).

    REUTILIZA a arquitetura de anti-duplicação de tasks:
    - calculate_semantic_similarity() do similarity_detector.py
    - RAGService para storage e busca com project_id scoping
    - Mesmo padrão de thresholds e verificação

    PROMPT #97 - Cross-Interview Deduplication
    """

    def __init__(self, db: Session, similarity_threshold: float = 0.85):
        """
        Inicializa o deduplicator com threshold configurável.

        Args:
            db: Database session
            similarity_threshold: Limite de similaridade (0.0-1.0)
                                 0.85 = 85% similar (padrão, restritivo)
                                 0.90 = 90% similar (usado em tasks)
                                 0.95 = 95% similar (muito permissivo)
        """
        self.db = db
        self.rag_service = RAGService(db)
        self.threshold = similarity_threshold

        logger.info(f"✅ InterviewQuestionDeduplicator initialized (threshold={threshold:.0%})")

    def store_question(
        self,
        project_id: UUID,
        interview_id: UUID,
        interview_mode: str,
        question_text: str,
        question_number: int,
        is_fixed: bool = False
    ):
        """
        Armazena pergunta no RAG para futuras comparações CROSS-INTERVIEW.

        CRÍTICO: Armazena com project_id para permitir verificação entre
        TODAS as entrevistas do MESMO projeto (igual ao sistema de tasks)!

        Args:
            project_id: ID do projeto (SCOPING!)
            interview_id: ID da entrevista
            interview_mode: Modo da entrevista (meta_prompt, orchestrator, etc.)
            question_text: Texto da pergunta (limpo, sem formatação)
            question_number: Número da pergunta (Q1, Q2, Q3, etc.)
            is_fixed: True se fixed question, False se AI-generated
        """
        # Limpar pergunta (remover emojis, formatação, opções)
        cleaned_question = self._clean_question(question_text)

        # Armazenar no RAG com PROJECT_ID (scoped por projeto, igual às tasks!)
        self.rag_service.store(
            content=cleaned_question,
            metadata={
                "type": "interview_question",
                "project_id": str(project_id),  # ← CRITICAL for cross-interview dedup!
                "interview_id": str(interview_id),
                "interview_mode": interview_mode,
                "question_number": question_number,
                "is_fixed": is_fixed,
                "timestamp": datetime.utcnow().isoformat()
            },
            project_id=project_id  # ← SCOPED por projeto!
        )

        logger.info(
            f"✅ Question stored: Q{question_number} "
            f"(project={project_id}, interview={interview_id}, mode={interview_mode})"
        )

    def check_duplicate(
        self,
        project_id: UUID,
        candidate_question: str
    ) -> Tuple[bool, Optional[Dict], float]:
        """
        Verifica se pergunta candidata é duplicada/similar a perguntas já feitas
        em QUALQUER entrevista do projeto.

        CRÍTICO: Busca em TODAS as entrevistas do projeto (cross-interview)!
        Reutiliza o mesmo padrão de detect_modification_attempt() de tasks.

        Args:
            project_id: ID do projeto
            candidate_question: Pergunta a ser verificada

        Returns:
            (is_duplicate, similar_question, similarity_score)

        Example:
            is_dup, similar_q, score = check_duplicate(project_id, "Qual banco de dados?")
            if is_dup:
                # similar_q["content"] = "Qual database você vai usar?"
                # similar_q["metadata"]["interview_id"] = "uuid-entrevista-1"
                # similar_q["metadata"]["interview_mode"] = "meta_prompt"
                # score = 0.92 (92% similar!)
        """
        # Limpar pergunta candidata
        cleaned = self._clean_question(candidate_question)

        # Buscar perguntas similares em TODAS as entrevistas do projeto
        # Usa RAGService (igual ao sistema de tasks)
        similar_questions = self.rag_service.retrieve(
            query=cleaned,
            filter={
                "type": "interview_question",
                "project_id": str(project_id)  # ← CROSS-INTERVIEW!
            },
            top_k=5,
            similarity_threshold=0.70  # Pré-filtro baixo para capturar candidatos
        )

        if not similar_questions:
            logger.debug(f"✅ No similar questions found for project {project_id}")
            return (False, None, 0.0)

        # Verificar se alguma está acima do threshold crítico
        best_match = similar_questions[0]
        similarity = best_match["similarity"]

        is_duplicate = similarity >= self.threshold  # >= 0.85

        if is_duplicate:
            logger.warning(
                f"🚫 Duplicate detected! Similarity={similarity:.2%} (threshold={self.threshold:.0%})\n"
                f"   Similar to: Q{best_match['metadata']['question_number']} "
                f"from {best_match['metadata']['interview_mode']} interview"
            )
        else:
            logger.debug(
                f"✅ Question OK (highest similarity: {similarity:.2%}, below threshold {self.threshold:.0%})"
            )

        return (is_duplicate, best_match if is_duplicate else None, similarity)

    def _clean_question(self, question_text: str) -> str:
        """
        Remove formatação para análise semântica pura.

        Remove:
        - Emojis (❓, 🏗️, 🔧, etc.)
        - "Pergunta N:"
        - Opções (○ Opção 1, ○ Opção 2, ✅ checkbox, etc.)
        - Instruções ("Escolha uma opção", "Selecione todos", etc.)

        Mantém apenas o core da pergunta para análise semântica.

        Example:
            Input: "❓ Pergunta 3: Qual framework de backend você vai usar?\n\n○ Laravel (PHP)\n○ Django (Python)\n\nEscolha uma opção."
            Output: "Qual framework de backend você vai usar?"
        """
        # Remover emojis (todos os caracteres não-ASCII)
        text = re.sub(r'[^\x00-\x7F]+', '', question_text)

        # Remover "Pergunta N:" ou "Question N:"
        text = re.sub(r'Pergunta \d+:', '', text, flags=re.IGNORECASE)
        text = re.sub(r'Question \d+:', '', text, flags=re.IGNORECASE)

        # Remover opções (linhas começando com ○, ●, -, *, ✓, ✅, etc.)
        lines = text.split('\n')
        question_lines = []
        for line in lines:
            stripped = line.strip()
            # Pular linhas que são opções ou instruções
            if stripped.startswith(('○', '●', '-', '*', '✓', '✅', '☐', '☑')):
                continue
            # Pular instruções comuns
            if any(keyword in stripped.lower() for keyword in [
                'escolha', 'selecione', 'digite', 'responda', 'marque',
                'choose', 'select', 'type', 'answer', 'mark',
                'por favor', 'please'
            ]):
                continue
            # Manter linha se tiver conteúdo relevante
            if stripped:
                question_lines.append(line)

        text = '\n'.join(question_lines)

        # Limpar múltiplos espaços/quebras de linha
        text = re.sub(r'\s+', ' ', text)

        return text.strip()
