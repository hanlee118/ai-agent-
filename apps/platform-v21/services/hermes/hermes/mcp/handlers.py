from __future__ import annotations

from typing import Any, Dict

from hermes.adapters.sqlite_store import SQLiteStore
from hermes.core.engine import ExecutionEngine
from hermes.mcp.protocol import ExecuteRequest, ImportSkillRequest, MemoryExportRequest


class MCPHandler:
    def __init__(self, engine: ExecutionEngine, store: SQLiteStore):
        self.engine = engine
        self.store = store

    async def execute_task(self, request: ExecuteRequest) -> Dict[str, Any]:
        return await self.engine.execute(
            task=request.task,
            stage_id=request.stage_id,
            template_key=request.template_key,
            inputs=request.inputs,
            soul_md=request.soul_md,
            memory_md=request.memory_md,
            skills=request.skills,
            enable_self_evaluation=request.enable_self_evaluation,
        )

    async def import_skill(self, request: ImportSkillRequest) -> Dict[str, Any]:
        payload = request.skill or {}
        skill_data = payload.get('skillData') if isinstance(payload.get('skillData'), dict) else payload
        self.store.import_skills([skill_data])
        return {'status': 'imported'}

    async def export_skills(self) -> Dict[str, Any]:
        skills = self.store.list_skills(limit=100, unsynced_only=True)
        return {'skills': [item.model_dump() for item in skills]}

    async def export_memory(self, request: MemoryExportRequest) -> Dict[str, Any]:
        memories = self.store.list_memories(project_id=request.project_id, limit=request.limit, unsynced_only=True)
        return {'memories': [item.model_dump() for item in memories]}

    async def rpc_call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if method == 'ping':
            return {'status': 'ok'}
        if method == 'execute_task':
            req = ExecuteRequest.model_validate(params)
            return await self.execute_task(req)
        if method == 'import_skill':
            req = ImportSkillRequest.model_validate(params)
            return await self.import_skill(req)
        if method == 'export_skills':
            return await self.export_skills()
        if method == 'export_memory':
            req = MemoryExportRequest.model_validate(params)
            return await self.export_memory(req)
        return {'status': 'unknown_method', 'method': method}
