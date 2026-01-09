from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Gerenciar conexões ativas
# {project_id: Set[WebSocket]}
active_connections: Dict[str, Set[WebSocket]] = {}


class ConnectionManager:
    """
    Gerencia conexões WebSocket por projeto
    
    Cada projeto tem sua própria "room" de conexões.
    Quando um evento acontece em um projeto, todos os clientes
    conectados àquele projeto recebem o update.
    """
    
    @staticmethod
    async def connect(websocket: WebSocket, project_id: str):
        """Adiciona conexão ao projeto"""
        await websocket.accept()
        
        if project_id not in active_connections:
            active_connections[project_id] = set()
        
        active_connections[project_id].add(websocket)
        logger.info(f"✅ WebSocket connected to project {project_id} (total: {len(active_connections[project_id])})")
    
    @staticmethod
    async def disconnect(websocket: WebSocket, project_id: str):
        """Remove conexão do projeto"""
        if project_id in active_connections:
            active_connections[project_id].discard(websocket)
            
            # Limpar se não há mais conexões
            if not active_connections[project_id]:
                del active_connections[project_id]
                logger.info(f"🗑️  Project {project_id} room closed (no connections)")
        
        logger.info(f"❌ WebSocket disconnected from project {project_id}")
    
    @staticmethod
    async def broadcast(project_id: str, message: dict):
        """
        Envia mensagem para todas conexões do projeto
        
        Args:
            project_id: ID do projeto
            message: Mensagem dict (será convertida para JSON)
        """
        if project_id not in active_connections:
            logger.debug(f"No connections for project {project_id}, skipping broadcast")
            return
        
        # Converter dict para JSON
        message_json = json.dumps(message)
        
        # Enviar para todas conexões
        disconnected = set()
        
        for connection in active_connections[project_id]:
            try:
                await connection.send_text(message_json)
            except Exception as e:
                logger.error(f"Failed to send message: {e}")
                disconnected.add(connection)
        
        # Remover conexões que falharam
        for conn in disconnected:
            active_connections[project_id].discard(conn)
        
        logger.debug(f"📡 Broadcasted {message['event']} to {len(active_connections[project_id])} clients")


@router.websocket("/ws/projects/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    """
    WebSocket endpoint para receber updates de execução em tempo real
    
    URL: ws://localhost:8000/api/v1/ws/projects/{project_id}
    
    Events enviados ao cliente:
    - batch_started: Batch de tasks iniciou
    - task_started: Task começou a executar
    - task_completed: Task completou com sucesso
    - task_failed: Task falhou após tentativas
    - validation_failed: Validação falhou (vai tentar novamente)
    - batch_progress: Progresso do batch atualizado
    - batch_completed: Batch completou
    
    Example message:
    {
      "event": "task_completed",
      "timestamp": "2025-12-27T20:15:32.123Z",
      "data": {
        "task_id": "...",
        "task_title": "Create Book Model",
        "cost": 0.0052,
        "execution_time": 3.2
      }
    }
    """
    
    await ConnectionManager.connect(websocket, project_id)
    
    try:
        # Manter conexão aberta
        while True:
            # Aguardar mensagem do cliente (keepalive ou comandos)
            data = await websocket.receive_text()
            
            # Processar comandos do cliente se necessário
            # Ex: {"command": "pause"}, {"command": "stop"}
            try:
                message = json.loads(data)
                if message.get("command") == "ping":
                    await websocket.send_text(json.dumps({"event": "pong"}))
            except json.JSONDecodeError:
                pass
            
    except WebSocketDisconnect:
        await ConnectionManager.disconnect(websocket, project_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await ConnectionManager.disconnect(websocket, project_id)


# Função helper para broadcast (usar no TaskExecutor)
async def broadcast_event(
    project_id: str,
    event_type: str,
    data: dict
):
    """
    Broadcast evento para todas conexões do projeto
    
    Args:
        project_id: ID do projeto (string)
        event_type: Tipo do evento (task_started, task_completed, etc)
        data: Dados do evento
    """
    
    message = {
        "event": event_type,
        "timestamp": datetime.utcnow().isoformat(),
        "data": data
    }
    
    await ConnectionManager.broadcast(project_id, message)
