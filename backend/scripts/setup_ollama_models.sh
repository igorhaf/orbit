#!/bin/bash
# =============================================================================
# ORBIT Local Pipeline — Ollama Model Setup
# =============================================================================
# Pre-requisite: Ollama installed and running (ollama serve)
# Hardware: 12GB VRAM (GPU), 32GB RAM
# Disk: ~25GB for all models
# =============================================================================

set -e

echo "=== ORBIT Local Pipeline — Pulling Ollama Models ==="
echo "Requires: ~25GB disk, 12GB VRAM, 32GB RAM"
echo ""

echo "[1/4] qwen2.5-coder:14b (Code Specialist, 14.7B params, Q4_K_M, ~10.5GB VRAM)"
ollama pull qwen2.5-coder:14b
echo ""

echo "[2/4] qwen3:14b (Reasoning/Writing, 14.8B params, Q4_K_M, ~10.5GB VRAM)"
ollama pull qwen3:14b
echo ""

echo "[3/4] gemma2:9b (QA Cross-Validator, 9.2B params, Q4_K_M, ~6.5GB VRAM)"
ollama pull gemma2:9b
echo ""

echo "[4/4] nomic-embed-text (RAG Embeddings, 137M params, FP16, ~0.5GB VRAM)"
ollama pull nomic-embed-text
echo ""

echo "=== Done! Models installed: ==="
ollama list
echo ""
echo "To use: Select 'local-ollama' profile in the AI Studio pipeline settings."
