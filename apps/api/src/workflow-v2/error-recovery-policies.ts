export type RecoveryAction = {
  id: "branch_name_invalid" | "commit_message_invalid" | "merge_conflicts";
  hint: string;
  commands: string[];
  autoRecoverable: boolean;
};

export const gitErrorRecoveryMap: Array<{
  pattern: RegExp;
  action: RecoveryAction;
}> = [
  {
    pattern: /remote rejected.*branch name does not match/i,
    action: {
      id: "branch_name_invalid",
      hint: "分支命名不合规，建议重命名后重试 push",
      commands: ["git branch -m <old> feature/issue-<id>-<desc>", "git push -u origin <new-branch>"],
      autoRecoverable: true
    }
  },
  {
    pattern: /commit message invalid/i,
    action: {
      id: "commit_message_invalid",
      hint: "commit message 不合规，建议 amend 后重试 push",
      commands: ["git commit --amend -m \"feat: <summary> (#<id>)\"", "git push --force-with-lease"],
      autoRecoverable: true
    }
  },
  {
    pattern: /merge conflicts/i,
    action: {
      id: "merge_conflicts",
      hint: "检测到合并冲突，建议同步 main 并人工解决冲突",
      commands: ["git checkout main", "git pull", "git checkout <branch>", "git merge main"],
      autoRecoverable: false
    }
  }
];

export function matchGitRecoveryPolicy(errorText: string) {
  const source = String(errorText || "");
  return gitErrorRecoveryMap.find((item) => item.pattern.test(source)) ?? null;
}
