import AgentConfigModalPanel from '../../features/agent-config/AgentConfigModal';
import { agents, models } from '../../lib/runtimeCollections';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  agentId?: string | null;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onUpdated?: () => Promise<void> | void;
};

export default function AgentConfigModal({
  isOpen,
  onClose,
  agentId,
  addToast,
  onUpdated,
}: Props) {
  return (
    <AgentConfigModalPanel
      isOpen={isOpen}
      onClose={onClose}
      agentId={agentId}
      addToast={addToast}
      onUpdated={onUpdated}
      agents={agents}
      models={models}
    />
  );
}
