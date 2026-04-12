from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from hermes.models.memory import MemoryRecord
from hermes.models.skill import SkillRecord


class SQLiteStore:
    def __init__(self, sqlite_path: str):
        self.sqlite_path = sqlite_path
        self._lock = threading.Lock()
        self._conn = self._connect()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.sqlite_path), exist_ok=True)
        conn = sqlite3.connect(self.sqlite_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            cursor = self._conn.cursor()
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    memory_type TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    stage_context TEXT NOT NULL,
                    tech_stack TEXT NOT NULL,
                    importance_score REAL NOT NULL,
                    synced_to_platform INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                '''
            )
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS skills (
                    id TEXT PRIMARY KEY,
                    skill_key TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    instruction TEXT NOT NULL,
                    manifest TEXT NOT NULL,
                    source TEXT NOT NULL,
                    synced_to_platform INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                '''
            )
            self._conn.commit()

    def add_memory(self, payload: Dict[str, Any]) -> MemoryRecord:
        record = MemoryRecord(
            id=str(payload.get('id') or uuid.uuid4()),
            project_id=payload.get('project_id') or payload.get('projectId'),
            title=str(payload.get('title') or 'Hermes memory'),
            content=str(payload.get('content') or ''),
            memory_type=str(payload.get('memory_type') or payload.get('memoryType') or 'episodic'),
            tags=list(payload.get('tags') or []),
            stage_context=list(payload.get('stage_context') or payload.get('stageContext') or []),
            tech_stack=list(payload.get('tech_stack') or payload.get('techStack') or []),
            importance_score=float(payload.get('importance_score') or payload.get('importanceScore') or 0.5),
            synced_to_platform=bool(payload.get('synced_to_platform') or payload.get('syncedToPlatform') or False),
            created_at=payload.get('created_at') or datetime.utcnow(),
        )
        with self._lock:
            self._conn.execute(
                '''
                INSERT OR REPLACE INTO memories (
                    id, project_id, title, content, memory_type, tags, stage_context, tech_stack,
                    importance_score, synced_to_platform, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    record.id,
                    record.project_id,
                    record.title,
                    record.content,
                    record.memory_type,
                    json.dumps(record.tags),
                    json.dumps(record.stage_context),
                    json.dumps(record.tech_stack),
                    record.importance_score,
                    1 if record.synced_to_platform else 0,
                    record.created_at.isoformat(),
                ),
            )
            self._conn.commit()
        return record

    def import_memories(self, memories: Iterable[Dict[str, Any]]) -> int:
        count = 0
        for payload in memories:
            self.add_memory(
                {
                    'id': payload.get('id') or str(uuid.uuid4()),
                    'projectId': payload.get('projectId') or payload.get('project_id'),
                    'title': payload.get('title') or 'Imported memory',
                    'content': payload.get('content') or '',
                    'memoryType': payload.get('memoryType') or payload.get('memory_type') or 'semantic',
                    'tags': payload.get('tags') or [],
                    'stageContext': payload.get('stageContext') or payload.get('stage_context') or [],
                    'techStack': payload.get('techStack') or payload.get('tech_stack') or [],
                    'importanceScore': payload.get('importanceScore') or payload.get('importance_score') or 0.5,
                    'syncedToPlatform': True,
                }
            )
            count += 1
        return count

    def list_memories(self, project_id: Optional[str] = None, limit: int = 20, unsynced_only: bool = False) -> List[MemoryRecord]:
        clauses: List[str] = []
        args: List[Any] = []
        if project_id:
            clauses.append('project_id = ?')
            args.append(project_id)
        if unsynced_only:
            clauses.append('synced_to_platform = 0')
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ''
        sql = f'''
            SELECT * FROM memories
            {where}
            ORDER BY created_at DESC
            LIMIT ?
        '''
        args.append(max(1, min(limit, 200)))
        with self._lock:
            rows = self._conn.execute(sql, tuple(args)).fetchall()
        return [self._memory_from_row(row) for row in rows]

    def mark_memories_synced(self, ids: Iterable[str]) -> None:
        ids_list = [item for item in ids if item]
        if not ids_list:
            return
        with self._lock:
            self._conn.executemany(
                'UPDATE memories SET synced_to_platform = 1 WHERE id = ?',
                [(item,) for item in ids_list],
            )
            self._conn.commit()

    def add_skill(self, record: SkillRecord) -> SkillRecord:
        with self._lock:
            self._conn.execute(
                '''
                INSERT OR REPLACE INTO skills (
                    id, skill_key, name, type, instruction, manifest, source,
                    synced_to_platform, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    record.id,
                    record.skill_key,
                    record.name,
                    record.type,
                    record.instruction,
                    json.dumps(record.manifest),
                    record.source,
                    1 if record.synced_to_platform else 0,
                    record.created_at.isoformat(),
                ),
            )
            self._conn.commit()
        return record

    def import_skills(self, skills: Iterable[Dict[str, Any]]) -> int:
        count = 0
        for payload in skills:
            record = SkillRecord.from_platform_payload(payload)
            self.add_skill(record)
            count += 1
        return count

    def list_skills(self, limit: int = 20, unsynced_only: bool = False) -> List[SkillRecord]:
        where = 'WHERE synced_to_platform = 0' if unsynced_only else ''
        sql = f'''
            SELECT * FROM skills
            {where}
            ORDER BY created_at DESC
            LIMIT ?
        '''
        with self._lock:
            rows = self._conn.execute(sql, (max(1, min(limit, 200)),)).fetchall()
        return [self._skill_from_row(row) for row in rows]

    def mark_skills_synced(self, ids: Iterable[str]) -> None:
        ids_list = [item for item in ids if item]
        if not ids_list:
            return
        with self._lock:
            self._conn.executemany(
                'UPDATE skills SET synced_to_platform = 1 WHERE id = ?',
                [(item,) for item in ids_list],
            )
            self._conn.commit()

    def _memory_from_row(self, row: sqlite3.Row) -> MemoryRecord:
        return MemoryRecord(
            id=row['id'],
            project_id=row['project_id'],
            title=row['title'],
            content=row['content'],
            memory_type=row['memory_type'],
            tags=json.loads(row['tags'] or '[]'),
            stage_context=json.loads(row['stage_context'] or '[]'),
            tech_stack=json.loads(row['tech_stack'] or '[]'),
            importance_score=float(row['importance_score']),
            synced_to_platform=bool(row['synced_to_platform']),
            created_at=datetime.fromisoformat(row['created_at']),
        )

    def _skill_from_row(self, row: sqlite3.Row) -> SkillRecord:
        return SkillRecord(
            id=row['id'],
            skill_key=row['skill_key'],
            name=row['name'],
            type=row['type'],
            instruction=row['instruction'],
            manifest=json.loads(row['manifest'] or '{}'),
            source=row['source'],
            synced_to_platform=bool(row['synced_to_platform']),
            created_at=datetime.fromisoformat(row['created_at']),
        )
