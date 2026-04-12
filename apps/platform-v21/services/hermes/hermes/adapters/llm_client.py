from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from openai import OpenAI


class LLMClient:
    def __init__(self, model: str = 'gpt-4.1-mini', temperature: float = 0.2):
        self.model = model
        self.temperature = temperature
        api_key = os.getenv('OPENAI_API_KEY', '').strip()
        self.client = OpenAI(api_key=api_key) if api_key else None

    async def evaluate_execution(self, prompt: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
        if not self.client:
            return fallback

        try:
            response = self.client.responses.create(
                model=self.model,
                temperature=self.temperature,
                input=[
                    {
                        'role': 'system',
                        'content': [
                            {
                                'type': 'input_text',
                                'text': 'Return strict JSON only. Keys: should_create, score, name, type, key_steps, pitfalls.',
                            }
                        ],
                    },
                    {
                        'role': 'user',
                        'content': [{'type': 'input_text', 'text': prompt}],
                    },
                ],
            )
            text = (response.output_text or '').strip()
            if not text:
                return fallback
            return json.loads(text)
        except Exception:
            return fallback

    async def summarize_context(self, pieces: List[str]) -> str:
        if not self.client:
            return '\n'.join(pieces[:5])

        try:
            prompt = 'Summarize these context pieces for an autonomous agent.\n\n' + '\n\n'.join(pieces[:10])
            response = self.client.responses.create(
                model=self.model,
                temperature=0.1,
                input=prompt,
            )
            text = (response.output_text or '').strip()
            return text or '\n'.join(pieces[:5])
        except Exception:
            return '\n'.join(pieces[:5])
