from pydantic import BaseModel
from typing import Dict, List, Any

class GenerateSpecRequest(BaseModel):
    stack: str
    interview_data: Dict[str, Any]

class DecomposeRequest(BaseModel):
    stack: str
    spec: Dict[str, Any]

class SpecResponse(BaseModel):
    success: bool
    spec: Dict[str, Any]

class TasksResponse(BaseModel):
    success: bool
    tasks: List[Dict[str, Any]]
    total: int
