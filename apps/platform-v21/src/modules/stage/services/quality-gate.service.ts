import { Injectable } from '@nestjs/common';
import { ProjectStage } from '../entities/project-stage.entity';
import { StageTemplate } from '../entities/stage-template.entity';

export type GateEvaluationResult = {
  passed: boolean;
  violations: string[];
  checks: Array<{ type: string; passed: boolean; details: string }>;
};

@Injectable()
export class QualityGateService {
  async evaluate(stage: ProjectStage, template: StageTemplate): Promise<GateEvaluationResult> {
    const criteria = Array.isArray(template.acceptanceCriteria) ? template.acceptanceCriteria : [];
    if (criteria.length === 0) {
      return { passed: true, violations: [], checks: [] };
    }

    const checks: Array<{ type: string; passed: boolean; details: string }> = [];
    const violations: string[] = [];

    for (const criterion of criteria) {
      const type = String((criterion as { type?: unknown }).type || 'unknown');
      const config = ((criterion as { config?: unknown }).config || {}) as Record<string, unknown>;
      const result = this.evaluateCriterion(type, config, stage);
      checks.push({ type, passed: result.passed, details: result.details });
      if (!result.passed) {
        violations.push(`${type}: ${result.details}`);
      }
    }

    return { passed: violations.length === 0, violations, checks };
  }

  private evaluateCriterion(type: string, config: Record<string, unknown>, stage: ProjectStage) {
    if (type === 'artifact_exists') {
      return this.checkArtifactExists(config, stage);
    }

    if (type === 'manual_approval') {
      const role = String(config.role || 'reviewer');
      const approvals = (stage.gateResults?.manualApprovals || {}) as Record<string, boolean>;
      const approved = Boolean(approvals[role]);
      return {
        passed: approved,
        details: approved ? `Approved by ${role}` : `Pending manual approval from ${role}`,
      };
    }

    if (type === 'quality_gate') {
      return this.checkQualityGate(config, stage);
    }

    if (type === 'auto_check') {
      return this.runAutoCheck(config, stage);
    }

    return { passed: true, details: 'Unsupported criterion type, ignored' };
  }

  private checkArtifactExists(config: Record<string, unknown>, stage: ProjectStage) {
    const artifactName = String(config.artifact || '');
    const artifacts = Array.isArray(stage.outputArtifacts) ? stage.outputArtifacts : [];
    const artifact = artifacts.find((item) => String((item as { name?: unknown }).name || '') === artifactName);

    if (!artifact) {
      return { passed: false, details: `Missing artifact: ${artifactName}` };
    }

    const minLength = Number(config.minLength || 0);
    const minCount = Number(config.minCount || 0);
    const content = String((artifact as { content?: unknown }).content || '');

    if (minLength > 0 && content.length < minLength) {
      return { passed: false, details: `${artifactName} length ${content.length} < ${minLength}` };
    }

    if (minCount > 0 && artifacts.length < minCount) {
      return { passed: false, details: `Artifact count ${artifacts.length} < ${minCount}` };
    }

    return { passed: true, details: 'Artifact exists' };
  }

  private checkQualityGate(config: Record<string, unknown>, stage: ProjectStage) {
    const minArtifacts = Number(config.minArtifacts || 0);
    const requireNoErrors = Boolean(config.requireNoErrors);
    const artifacts = Array.isArray(stage.outputArtifacts) ? stage.outputArtifacts : [];
    const errors = Array.isArray(stage.executionTrace?.errors) ? stage.executionTrace.errors : [];

    if (minArtifacts > 0 && artifacts.length < minArtifacts) {
      return { passed: false, details: `Artifacts ${artifacts.length} < ${minArtifacts}` };
    }

    if (requireNoErrors && errors.length > 0) {
      return { passed: false, details: `Execution trace contains ${errors.length} errors` };
    }

    return { passed: true, details: 'Quality gate passed' };
  }

  private runAutoCheck(config: Record<string, unknown>, stage: ProjectStage) {
    const validator = String(config.validator || 'no_execution_errors');

    if (validator === 'no_execution_errors') {
      const errors = Array.isArray(stage.executionTrace?.errors) ? stage.executionTrace.errors : [];
      return {
        passed: errors.length === 0,
        details: errors.length === 0 ? 'No execution errors' : `${errors.length} execution errors found`,
      };
    }

    if (validator === 'minimum_artifact_count') {
      const min = Number(config.min || 1);
      const count = Array.isArray(stage.outputArtifacts) ? stage.outputArtifacts.length : 0;
      return {
        passed: count >= min,
        details: count >= min ? `Artifact count ${count}` : `Artifact count ${count} < ${min}`,
      };
    }

    if (validator === 'artifact_keyword_check') {
      const artifactName = String(config.artifact || '');
      const keywords = Array.isArray(config.keywords) ? config.keywords.map((item) => String(item).toLowerCase()) : [];
      const mode = String(config.mode || 'all');
      const artifact = (stage.outputArtifacts || []).find(
        (item) => String((item as { name?: unknown }).name || '') === artifactName,
      ) as { content?: unknown } | undefined;

      if (!artifact) {
        return { passed: false, details: `Missing artifact: ${artifactName}` };
      }

      const content = String(artifact.content || '').toLowerCase();
      const hitCount = keywords.filter((word) => content.includes(word)).length;
      const passed = mode === 'any' ? hitCount > 0 : hitCount === keywords.length;
      return {
        passed,
        details: passed ? `Keyword check passed (${hitCount}/${keywords.length})` : `Keyword check failed (${hitCount}/${keywords.length})`,
      };
    }

    return {
      passed: false,
      details: `Unknown auto_check validator: ${validator}`,
    };
  }
}
