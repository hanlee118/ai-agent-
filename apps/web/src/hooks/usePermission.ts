import { useMemo } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface ProjectMember {
  role: string;
  userId: string;
}

interface ProjectPermissionSnapshot {
  projectRole?: "owner" | "editor" | "viewer" | null;
  canEdit?: boolean;
  canApprove?: boolean;
  canDelete?: boolean;
}

export function usePermission(
  currentUser: User | null,
  projectMembers: ProjectMember[] = [],
  snapshot?: ProjectPermissionSnapshot,
) {
  const isAdmin = currentUser?.role === "admin";

  const projectRole = useMemo(() => {
    if (snapshot && typeof snapshot.projectRole !== "undefined") {
      return snapshot.projectRole ?? null;
    }
    if (!currentUser) {
      return null;
    }
    if (isAdmin) {
      return "owner";
    }
    const member = projectMembers.find((item) => item.userId === currentUser.id);
    return (member?.role as "owner" | "editor" | "viewer" | undefined) || null;
  }, [currentUser, projectMembers, isAdmin, snapshot]);

  const canEdit = typeof snapshot?.canEdit === "boolean"
    ? snapshot.canEdit
    : Boolean(isAdmin || ["owner", "editor"].includes(projectRole || ""));

  const canApprove = typeof snapshot?.canApprove === "boolean"
    ? snapshot.canApprove
    : Boolean(isAdmin || ["owner", "editor"].includes(projectRole || ""));

  const canDelete = typeof snapshot?.canDelete === "boolean"
    ? snapshot.canDelete
    : Boolean(isAdmin || projectRole === "owner");

  return {
    isAdmin: Boolean(isAdmin),
    projectRole,
    canEdit,
    canApprove,
    canDelete,
  };
}
