import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Terminal,
  Settings,
  ShieldCheck,
  Activity,
  Search,
  ChevronRight,
  ChevronLeft,
  Command,
  Cpu,
  Zap,
  MessageSquare,
  FileText,
  History,
  BrainCircuit,
  Database,
  Lock,
  Globe,
  Plus,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  BarChart3,
  ExternalLink,
  ChevronDown,
  Filter,
  MoreVertical,
  Edit3,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  Eye,
  EyeOff,
  Languages,
  UserPlus,
  HelpCircle,
  Code2,
  Workflow,
  Info,
  DollarSign,
  Upload,
  FileUp,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  AreaChart, Area, ReferenceLine,
} from 'recharts';
import { cn } from '../../lib/utils';
import { Agent, Project, Task, Session, AgentStatus, ProjectStatus, Model } from '../../types';
import AuditTable from '../../features/audit/AuditTable';
import { useAuditLogs } from '../../features/audit/useAuditLogs';
import { useAuditSearch } from '../../features/audit/useAuditSearch';
import SettingsPanel from '../../features/settings/SettingsPanel';
import AgentConfigModalPanel from '../../features/agent-config/AgentConfigModal';
import DeployAgentModalPanel from '../../features/deploy-agent/DeployAgentModal';
import {
  agentsApi,
  auditApi,
  modelsApi,
  projectsApi,
  systemApi,
  teamApi,
  type Model as ApiModel,
} from '../../lib/api';
import { fetchOpenClawAgentDetail, sendBatchAgentMessage } from '../../lib/adapters';
import { agents, models, projects, sessions, tasks } from '../../lib/runtimeCollections';

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-surface/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-white/5">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

const TeamTopologyModal = ({ isOpen, onClose }: any) => {
  const [topologyNodes, setTopologyNodes] = useState<Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    x?: number;
    y?: number;
  }>>([]);
  const [topologyEdges, setTopologyEdges] = useState<Array<{
    from: string;
    to: string;
    label?: string;
  }>>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;
    const loadTopology = async () => {
      try {
        const result = await teamApi.getTopology();
        if (!active) {
          return;
        }
        setTopologyNodes(Array.isArray(result.nodes) ? result.nodes : []);
        setTopologyEdges(Array.isArray(result.edges) ? result.edges : []);
      } catch {
        if (!active) {
          return;
        }
        setTopologyNodes([]);
        setTopologyEdges([]);
      }
    };

    void loadTopology();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const topologyAgents: Array<{
    id: string;
    name: string;
    role: string;
    status?: string;
    x?: number;
    y?: number;
  }> = topologyNodes.length > 0
    ? topologyNodes
    : agents.slice(0, 5);

  const topLevelAgents = topologyAgents.filter((agent) => {
    const role = (agent.role || '').toLowerCase();
    return role.includes('director') || role.includes('lead') || /总监|负责人|架构/.test(agent.role || '');
  });
  const midLevelAgents = topologyAgents.filter((agent) => {
    const role = (agent.role || '').toLowerCase();
    return role.includes('manager') || role.includes('analyst') || /经理|分析|产品/.test(agent.role || '');
  });
  const execAgents = topologyAgents.filter((agent) => {
    const role = (agent.role || '').toLowerCase();
    return role.includes('engineer') || role.includes('qa') || /工程|研发|测试/.test(agent.role || '');
  });
  const activeConnections = topologyEdges.length > 0
    ? topologyEdges.length
    : topologyAgents.length > 0
      ? topologyAgents.length * 2
      : 0;
  const syncLatency = topologyNodes.length > 0 ? '实时' : topologyAgents.length > 0 ? '12-20ms' : '-';

  const numericXs = topologyAgents
    .map((agent) => agent.x)
    .filter((value): value is number => typeof value === 'number');
  const numericYs = topologyAgents
    .map((agent) => agent.y)
    .filter((value): value is number => typeof value === 'number');
  const hasRemoteCoordinates = topologyNodes.length > 0
    && numericXs.length === topologyAgents.length
    && numericYs.length === topologyAgents.length;
  const minX = hasRemoteCoordinates ? Math.min(...numericXs) : 0;
  const maxX = hasRemoteCoordinates ? Math.max(...numericXs) : 0;
  const minY = hasRemoteCoordinates ? Math.min(...numericYs) : 0;
  const maxY = hasRemoteCoordinates ? Math.max(...numericYs) : 0;

  const positionedNodes = topologyAgents.map((agent, index) => {
    const total = Math.max(topologyAgents.length - 1, 1);
    const isTop = topLevelAgents.some((item) => item.id === agent.id);
    const isMid = midLevelAgents.some((item) => item.id === agent.id);
    const isExec = execAgents.some((item) => item.id === agent.id);
    const level: 'top' | 'mid' | 'exec' = isTop ? 'top' : isMid ? 'mid' : isExec ? 'exec' : 'exec';
    const defaultX = topologyAgents.length === 1 ? 200 : 60 + Math.round((index * 280) / total);
    const defaultY = level === 'top' ? 60 : level === 'mid' ? 150 : 240;
    const x = hasRemoteCoordinates
      ? Math.round(60 + (((agent.x as number) - minX) / Math.max(1, maxX - minX)) * 280)
      : defaultX;
    const y = hasRemoteCoordinates
      ? Math.round(60 + (((agent.y as number) - minY) / Math.max(1, maxY - minY)) * 180)
      : defaultY;
    const fill = level === 'top' ? '#10b981' : level === 'mid' ? '#8b5cf6' : '#64748b';
    const label = agent.name.length > 8 ? `${agent.name.slice(0, 8)}...` : agent.name;
    return { ...agent, x, y, fill, level, label, status: agent.status || 'Idle' };
  });
  const positionedNodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const topNodes = positionedNodes.filter((node) => node.level === 'top');
  const fallbackTopNode = positionedNodes[0];
  const nodeLinks = topologyEdges.length > 0
    ? topologyEdges
      .map((edge) => {
        const from = positionedNodeMap.get(edge.from);
        const to = positionedNodeMap.get(edge.to);
        return from && to ? { from, to } : null;
      })
      .filter(Boolean) as Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>
    : positionedNodes
      .filter((node) => node.level !== 'top')
      .map((node, index) => {
        const from = topNodes[index % Math.max(topNodes.length, 1)] || fallbackTopNode;
        return from ? { from, to: node } : null;
      })
      .filter(Boolean) as Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="团队拓扑图谱">
      <div className="space-y-6">
        <div className="h-[400px] w-full bg-surface-muted rounded-2xl border border-border-subtle relative overflow-hidden flex items-center justify-center bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.05),transparent_70%)]">
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#10b981 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <svg className="w-full h-full relative z-10" viewBox="0 0 400 300">
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g stroke="rgba(16, 185, 129, 0.3)" strokeWidth="1.5" filter="url(#glow)">
              {nodeLinks.map((link, index) => (
                <line
                  key={`line-${index}`}
                  x1={link.from.x}
                  y1={link.from.y}
                  x2={link.to.x}
                  y2={link.to.y}
                />
              ))}
            </g>

            {positionedNodes.map((node) => (
              <g key={node.id}>
                {node.level === 'top' ? (
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    r="22"
                    fill={node.fill}
                    animate={{ r: [22, 24, 22] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                ) : (
                  <circle cx={node.x} cy={node.y} r={node.level === 'mid' ? 18 : 12} fill={node.fill} />
                )}
                <text
                  x={node.x}
                  y={node.y + (node.level === 'exec' ? 24 : 35)}
                  textAnchor="middle"
                  fill={node.level === 'exec' ? '#94a3b8' : 'white'}
                  fontSize={node.level === 'exec' ? '8' : '9'}
                  fontWeight={node.level === 'top' ? 'bold' : 'medium'}
                >
                  {node.label}
                </text>
              </g>
            ))}

            {positionedNodes.length === 0 && (
              <text x="200" y="160" textAnchor="middle" fill="#94a3b8" fontSize="12">
                暂无 Agent 数据
              </text>
            )}
          </svg>

          <div className="absolute bottom-4 left-4 p-3 bg-surface/80 backdrop-blur-md border border-border-subtle rounded-xl space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">核心决策层</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">逻辑处理层</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">任务执行层</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">活跃连接</h4>
            <p className="text-xl font-bold text-white">{activeConnections} <span className="text-xs font-normal text-slate-500">个通道</span></p>
          </div>
          <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">同步延迟</h4>
            <p className="text-xl font-bold text-primary">{syncLatency}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          {topologyAgents.length > 0
            ? `当前拓扑显示了 ${topologyAgents.length} 个 Agent 之间的协作关系。`
            : '暂无 Agent 数据'}
        </p>
      </div>
    </Modal>
  );
};


export default TeamTopologyModal;
