from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Iterable, List, Optional

import aiohttp

from hermes.adapters.sqlite_store import SQLiteStore
from hermes.models.memory import MemoryRecord
from hermes.models.skill import SkillRecord


class PlatformSyncService:
    def __init__(
        self,
        store: SQLiteStore,
        api_base: str,
        enabled: bool = True,
        sync_interval_seconds: int = 3600,
        request_timeout_seconds: int = 10,
        api_key: Optional[str] = None,
    ):
        self.store = store
        self.api_base = api_base.rstrip('/')
        self.enabled = enabled
        self.api_key = (api_key or '').strip()
        self.sync_interval_seconds = max(sync_interval_seconds, 30)
        self.timeout = aiohttp.ClientTimeout(total=max(request_timeout_seconds, 3))
        self.logger = logging.getLogger('hermes.platform_sync')

    def _headers(self) -> Dict[str, str]:
        if not self.api_key:
            return {}
        return {'x-hermes-api-key': self.api_key}

    @staticmethod
    def _unwrap(body: Dict[str, Any]) -> Dict[str, Any]:
        payload = body.get('data')
        if isinstance(payload, dict):
            return payload
        return body

    async def pull_from_platform(self, project_id: Optional[str] = None) -> Dict[str, int]:
        if not self.enabled:
            return {'memories': 0, 'skills': 0}

        pulled_memories = 0
        pulled_skills = 0

        params = {}
        if project_id:
            params['projectId'] = project_id
        params['limit'] = 50

        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                knowledge_url = f'{self.api_base}/knowledge/for-hermes'
                async with session.get(knowledge_url, params=params, headers=self._headers()) as resp:
                    if resp.status == 200:
                        body = await resp.json()
                        payload = self._unwrap(body)
                        pulled_memories = self.store.import_memories(payload.get('items') or [])

                skills_url = f'{self.api_base}/skills/for-hermes'
                async with session.get(skills_url, params=params, headers=self._headers()) as resp:
                    if resp.status == 200:
                        body = await resp.json()
                        payload = self._unwrap(body)
                        pulled_skills = self.store.import_skills(payload.get('skills') or [])
        except Exception as exc:
            self.logger.warning('Pull from platform failed: %s', exc)

        return {'memories': pulled_memories, 'skills': pulled_skills}

    async def push_memories(self, memories: Iterable[MemoryRecord]) -> int:
        if not self.enabled:
            return 0

        pushed: List[str] = []
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                url = f'{self.api_base}/knowledge/sync-from-hermes'
                for memory in memories:
                    async with session.post(url, json=memory.to_platform_payload(), headers=self._headers()) as resp:
                        if resp.status in (200, 201):
                            pushed.append(memory.id)
        except Exception as exc:
            self.logger.warning('Push memories failed: %s', exc)

        self.store.mark_memories_synced(pushed)
        return len(pushed)

    async def push_skills(self, skills: Iterable[SkillRecord]) -> int:
        if not self.enabled:
            return 0

        pushed: List[str] = []
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                url = f'{self.api_base}/skills/import/hermes'
                for skill in skills:
                    payload = {
                        'hermesSkillId': skill.id,
                        'skillData': {
                            'name': skill.name,
                            'skillKey': skill.skill_key,
                            'instruction': skill.instruction,
                            'type': skill.type,
                            'manifest': skill.manifest,
                        },
                    }
                    async with session.post(url, json=payload, headers=self._headers()) as resp:
                        if resp.status in (200, 201):
                            pushed.append(skill.id)
        except Exception as exc:
            self.logger.warning('Push skills failed: %s', exc)

        self.store.mark_skills_synced(pushed)
        return len(pushed)

    async def sync_once(self) -> Dict[str, int]:
        memories = self.store.list_memories(limit=100, unsynced_only=True)
        skills = self.store.list_skills(limit=100, unsynced_only=True)
        pushed_memories = await self.push_memories(memories)
        pushed_skills = await self.push_skills(skills)
        return {
            'pushed_memories': pushed_memories,
            'pushed_skills': pushed_skills,
        }

    async def schedule_sync(self) -> None:
        if not self.enabled:
            return

        while True:
            try:
                await self.sync_once()
            except Exception as exc:
                self.logger.warning('Scheduled sync failed: %s', exc)
            await asyncio.sleep(self.sync_interval_seconds)
