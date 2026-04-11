from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class MemoryRecord(BaseModel):
    id: str
    project_id: Optional[str] = None
    title: str
    content: str
    memory_type: str = Field(default='episodic')
    tags: List[str] = Field(default_factory=list)
    stage_context: List[str] = Field(default_factory=list)
    tech_stack: List[str] = Field(default_factory=list)
    importance_score: float = 0.5
    synced_to_platform: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def to_platform_payload(self) -> dict:
        return {
            'projectId': self.project_id,
            'title': self.title,
            'content': self.content,
            'memoryType': self.memory_type,
            'tags': self.tags,
            'stageContext': self.stage_context,
            'techStack': self.tech_stack,
            'importanceScore': self.importance_score,
        }
