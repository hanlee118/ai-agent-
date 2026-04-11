from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
from pathlib import Path
from typing import Any, AsyncGenerator, Dict

import uvicorn
import yaml
from fastapi import FastAPI
from sse_starlette.sse import EventSourceResponse

from hermes.adapters.llm_client import LLMClient
from hermes.adapters.platform_sync import PlatformSyncService
from hermes.adapters.sqlite_store import SQLiteStore
from hermes.core.engine import ExecutionEngine
from hermes.mcp.handlers import MCPHandler
from hermes.mcp.protocol import ExecuteRequest, ImportSkillRequest, MemoryExportRequest, RpcRequest


def load_config() -> Dict[str, Any]:
    config_path = os.getenv('HERMES_CONFIG_PATH', '/app/config/hermes.yaml')
    path = Path(config_path)
    if not path.exists():
        return {
            'hermes': {'name': 'hermes-agent-1', 'version': '2.1.0', 'host': '0.0.0.0', 'port': 3001},
            'llm': {'model': 'gpt-4.1-mini', 'temperature': 0.2},
            'memory': {'sqlite_path': '/data/hermes/memory.db'},
            'skills': {'min_score_to_create': 7.0, 'min_tool_calls_to_create': 5},
            'platform': {'enabled': True, 'api_base': 'http://agent-platform:8787/api/v1', 'sync_interval_seconds': 3600},
            'logging': {'level': 'INFO'},
        }

    with path.open('r', encoding='utf-8') as handle:
        return yaml.safe_load(handle) or {}


CONFIG = load_config()
LOG_LEVEL = str(CONFIG.get('logging', {}).get('level', 'INFO')).upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
LOGGER = logging.getLogger('hermes.server')

sqlite_path = os.getenv('HERMES_SQLITE_PATH', CONFIG.get('memory', {}).get('sqlite_path', '/data/hermes/memory.db'))
store = SQLiteStore(sqlite_path=sqlite_path)
llm = LLMClient(
    model=os.getenv('HERMES_LLM_MODEL', CONFIG.get('llm', {}).get('model', 'gpt-4.1-mini')),
    temperature=float(CONFIG.get('llm', {}).get('temperature', 0.2)),
)
engine = ExecutionEngine(
    store=store,
    llm=llm,
    min_score_to_create=float(CONFIG.get('skills', {}).get('min_score_to_create', 7.0)),
    min_tool_calls_to_create=int(CONFIG.get('skills', {}).get('min_tool_calls_to_create', 5)),
)
handler = MCPHandler(engine=engine, store=store)

platform_sync = PlatformSyncService(
    store=store,
    api_base=os.getenv('PLATFORM_API_BASE', CONFIG.get('platform', {}).get('api_base', 'http://agent-platform:8787/api/v1')),
    enabled=str(os.getenv('PLATFORM_SYNC_ENABLED', str(CONFIG.get('platform', {}).get('enabled', True)))).lower() in ('1', 'true', 'yes', 'on'),
    sync_interval_seconds=int(CONFIG.get('platform', {}).get('sync_interval_seconds', 3600)),
    request_timeout_seconds=int(CONFIG.get('platform', {}).get('request_timeout_seconds', 10)),
    api_key=os.getenv('PLATFORM_API_KEY', ''),
)

app = FastAPI(title='Hermes MCP Server', version=str(CONFIG.get('hermes', {}).get('version', '2.1.0')))
_sync_task: asyncio.Task | None = None


@app.on_event('startup')
async def on_startup() -> None:
    global _sync_task
    pulled = await platform_sync.pull_from_platform()
    LOGGER.info('Pulled from platform on startup: %s', pulled)
    _sync_task = asyncio.create_task(platform_sync.schedule_sync())


@app.on_event('shutdown')
async def on_shutdown() -> None:
    global _sync_task
    if _sync_task:
        _sync_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _sync_task


@app.get('/mcp/health')
async def mcp_health() -> Dict[str, Any]:
    return {
        'status': 'healthy',
        'name': CONFIG.get('hermes', {}).get('name', 'hermes-agent-1'),
        'version': CONFIG.get('hermes', {}).get('version', '2.1.0'),
        'platformSyncEnabled': platform_sync.enabled,
    }


@app.get('/health')
async def health() -> Dict[str, Any]:
    return await mcp_health()


@app.post('/mcp/execute')
async def execute_task(request: ExecuteRequest) -> Dict[str, Any]:
    result = await handler.execute_task(request)
    await platform_sync.sync_once()
    return result


@app.post('/mcp/skills/import')
async def import_skill(request: ImportSkillRequest) -> Dict[str, Any]:
    return await handler.import_skill(request)


@app.get('/mcp/skills/export')
async def export_skills() -> Dict[str, Any]:
    return await handler.export_skills()


@app.post('/mcp/memory/export')
async def export_memory(request: MemoryExportRequest) -> Dict[str, Any]:
    return await handler.export_memory(request)


@app.post('/mcp')
async def rpc_entrypoint(request: RpcRequest) -> Dict[str, Any]:
    result = await handler.rpc_call(request.method, request.params)
    return {
        'jsonrpc': '2.0',
        'id': request.id,
        'result': result,
    }


@app.post('/fallback')
async def fallback_call(body: Dict[str, Any]) -> Dict[str, Any]:
    method = str(body.get('method') or '')
    payload = body.get('payload') or {}
    result = await handler.rpc_call(method, payload)
    return result


@app.get('/mcp/sse')
async def mcp_sse() -> EventSourceResponse:
    async def generator() -> AsyncGenerator[Dict[str, str], None]:
        while True:
            await asyncio.sleep(2)
            yield {'event': 'heartbeat', 'data': 'ok'}

    return EventSourceResponse(generator())


def main() -> None:
    parser = argparse.ArgumentParser(description='Hermes MCP server')
    parser.add_argument('--port', type=int, default=int(os.getenv('HERMES_PORT', CONFIG.get('hermes', {}).get('port', 3001))))
    parser.add_argument('--host', type=str, default=os.getenv('HERMES_HOST', CONFIG.get('hermes', {}).get('host', '0.0.0.0')))
    args = parser.parse_args()

    uvicorn.run('hermes.server:app', host=args.host, port=args.port, reload=False)


if __name__ == '__main__':
    main()
