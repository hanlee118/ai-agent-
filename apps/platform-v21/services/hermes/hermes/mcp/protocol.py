from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ExecuteRequest(BaseModel):
    task: str
    stage_id: str = Field(alias='stageId')
    template_key: str = Field(alias='templateKey')
    inputs: List[Dict[str, Any]] = Field(default_factory=list)
    soul_md: str = ''
    memory_md: str = ''
    skills: List[Dict[str, Any]] = Field(default_factory=list)
    enable_self_evaluation: bool = True


class ImportSkillRequest(BaseModel):
    skill: Dict[str, Any]


class MemoryExportRequest(BaseModel):
    project_id: Optional[str] = None
    limit: int = 50


class RpcRequest(BaseModel):
    jsonrpc: str = '2.0'
    id: Any = None
    method: str
    params: Dict[str, Any] = Field(default_factory=dict)
