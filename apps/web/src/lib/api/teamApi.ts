import { request } from './core';
import type { TopologyEdge, TopologyNode } from './types';

export const teamApi = {
  async getTopology() {
    return request<{
      nodes: TopologyNode[];
      edges: TopologyEdge[];
    }>('/team/topology');
  },
};
