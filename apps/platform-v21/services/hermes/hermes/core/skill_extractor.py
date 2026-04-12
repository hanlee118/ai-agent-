from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List

from hermes.adapters.llm_client import LLMClient
from hermes.adapters.sqlite_store import SQLiteStore
from hermes.models.skill import SkillRecord


class SkillExtractor:
    def __init__(self, llm: LLMClient, store: SQLiteStore, min_score_to_create: float = 7.0):
        self.llm = llm
        self.store = store
        self.min_score_to_create = min_score_to_create

    async def evaluate_execution(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        fallback = self._heuristic_evaluation(payload)
        prompt = self._build_prompt(payload)
        evaluated = await self.llm.evaluate_execution(prompt, fallback)

        normalized = {
            'should_create': bool(evaluated.get('should_create', fallback['should_create'])),
            'score': float(evaluated.get('score', fallback['score'])),
            'name': str(evaluated.get('name', fallback['name'])),
            'type': str(evaluated.get('type', fallback['type'])),
            'key_steps': evaluated.get('key_steps') or fallback['key_steps'],
            'pitfalls': evaluated.get('pitfalls') or fallback['pitfalls'],
        }
        return normalized

    def _heuristic_evaluation(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        stage_key = str(payload.get('template_key') or 'stage')
        tool_calls = int(payload.get('tool_calls_count') or 0)
        has_errors = bool(payload.get('errors'))
        success = bool(payload.get('success'))

        score = 8.0 if success and not has_errors else 5.0
        if tool_calls >= 10:
            score += 0.5
        if has_errors:
            score -= 1.5

        pretty = stage_key.replace('_', ' ').strip().title()
        return {
            'should_create': success and not has_errors,
            'score': max(0.0, min(10.0, score)),
            'name': f'{pretty} Execution Pattern',
            'type': 'procedural',
            'key_steps': [
                'Load context and prior memory',
                'Execute stage task with clear checkpoints',
                'Validate artifacts against quality gates',
            ],
            'pitfalls': [
                'Missing required artifacts',
                'Insufficient context from previous stage',
            ],
        }

    def _build_prompt(self, payload: Dict[str, Any]) -> str:
        return (
            'Evaluate whether this execution trace is reusable as a Skill.\n'
            f"Stage: {payload.get('template_key')}\n"
            f"Success: {payload.get('success')}\n"
            f"Tool calls: {payload.get('tool_calls_count')}\n"
            f"Errors: {payload.get('errors')}\n"
            f"Decisions: {payload.get('decisions')}\n"
            f"Resolution: {payload.get('resolution')}\n"
        )

    async def create_skill(self, evaluation: Dict[str, Any], stage_key: str, instruction_seed: str) -> SkillRecord | None:
        score = float(evaluation.get('score') or 0)
        if score < self.min_score_to_create or not bool(evaluation.get('should_create')):
            return None

        name = str(evaluation.get('name') or 'Auto Extracted Skill').strip()
        base_key = self._to_kebab(name) or 'auto-extracted-skill'
        skill_key = f'{base_key}-v1'

        existing = self.store.list_skills(limit=200, unsynced_only=False)
        existing_keys = {item.skill_key for item in existing}
        index = 1
        while skill_key in existing_keys:
            index += 1
            skill_key = f'{base_key}-v{index}'

        key_steps = evaluation.get('key_steps') or []
        pitfalls = evaluation.get('pitfalls') or []
        instruction = self._build_instruction(name, key_steps, pitfalls, instruction_seed)

        skill = SkillRecord(
            id=str(uuid.uuid4()),
            skill_key=skill_key,
            name=name,
            type=str(evaluation.get('type') or 'procedural'),
            instruction=instruction,
            manifest={
                'version': '1.0.0',
                'sourceStage': stage_key,
                'score': score,
                'tags': [stage_key, 'auto-generated', 'hermes'],
            },
            source='auto_extracted',
            synced_to_platform=False,
        )
        self.store.add_skill(skill)
        return skill

    def _build_instruction(self, name: str, key_steps: List[str], pitfalls: List[str], seed: str) -> str:
        steps = '\n'.join([f'{i + 1}. {str(item)}' for i, item in enumerate(key_steps)]) or '1. Execute with validated context.'
        risk = '\n'.join([f'- {str(item)}' for item in pitfalls]) or '- Missing key input.'
        return (
            f'# {name}\n\n'
            '## Intent\n'
            f'{seed}\n\n'
            '## Steps\n'
            f'{steps}\n\n'
            '## Pitfalls\n'
            f'{risk}\n'
        )

    def _to_kebab(self, value: str) -> str:
        cleaned = re.sub(r'[^a-zA-Z0-9\s-]', '', value).strip().lower()
        return re.sub(r'\s+', '-', cleaned)
