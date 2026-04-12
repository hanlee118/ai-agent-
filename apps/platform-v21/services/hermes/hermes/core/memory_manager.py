from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from hermes.adapters.sqlite_store import SQLiteStore
from hermes.models.memory import MemoryRecord


class MemoryManager:
    def __init__(self, store: SQLiteStore):
        self.store = store

    def add_execution_memory(
        self,
        project_id: Optional[str],
        stage_key: str,
        task: str,
        artifacts: List[Dict[str, Any]],
        resolution: str,
        success: bool,
    ) -> MemoryRecord:
        artifact_names = [str(item.get('name') or item.get('type') or 'artifact') for item in artifacts]
        content = (
            f'Task: {task}\n'
            f'Stage: {stage_key}\n'
            f'Success: {success}\n'
            f'Artifacts: {", ".join(artifact_names) if artifact_names else "none"}\n'
            f'Resolution: {resolution}'
        )
        return self.store.add_memory(
            {
                'id': str(uuid.uuid4()),
                'projectId': project_id,
                'title': f'{stage_key} execution memory',
                'content': content,
                'memoryType': 'episodic',
                'tags': [stage_key, 'execution', 'hermes'],
                'stageContext': [stage_key],
                'importanceScore': 0.7 if success else 0.4,
                'syncedToPlatform': False,
            }
        )

    def import_project_context(self, items: List[Dict[str, Any]]) -> int:
        return self.store.import_memories(items)

    def export_for_platform(self, project_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        memories = self.store.list_memories(project_id=project_id, limit=limit, unsynced_only=False)
        return [item.to_platform_payload() for item in memories]
