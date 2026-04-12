from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from pydantic import BaseModel, Field


class SkillRecord(BaseModel):
    id: str
    skill_key: str
    name: str
    type: str = Field(default='procedural')
    instruction: str
    manifest: Dict[str, Any] = Field(default_factory=dict)
    source: str = Field(default='auto_extracted')
    synced_to_platform: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def to_platform_payload(self) -> dict:
        return {
            'hermesSkillId': self.id,
            'skillData': {
                'skillKey': self.skill_key,
                'name': self.name,
                'type': self.type,
                'instruction': self.instruction,
                'manifest': self.manifest,
                'source': self.source,
                'tags': self.manifest.get('tags', []),
            },
        }

    @classmethod
    def from_platform_payload(cls, payload: Dict[str, Any]) -> 'SkillRecord':
        skill_id = str(payload.get('id') or payload.get('hermesSkillId') or payload.get('skillKey') or payload.get('name') or 'imported-skill')
        return cls(
            id=skill_id,
            skill_key=str(payload.get('skillKey') or f'{skill_id}-imported'),
            name=str(payload.get('name') or 'Imported Skill'),
            type=str(payload.get('type') or 'procedural'),
            instruction=str(payload.get('instruction') or ''),
            manifest=dict(payload.get('manifest') or {}),
            source=str(payload.get('source') or 'community_imported'),
            synced_to_platform=True,
        )
