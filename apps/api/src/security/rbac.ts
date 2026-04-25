import { prisma } from "../db.js";

export type ProjectPermission = "approve" | "delete" | "edit";
export type ProjectRole = "owner" | "editor" | "viewer";

export async function getProjectRole(input: {
  projectId: string;
  userId: string;
}): Promise<ProjectRole | null> {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId: input.projectId,
        userId: input.userId
      }
    },
    select: { role: true }
  });
  const role = String(member?.role || "").trim().toLowerCase();
  if (role === "owner" || role === "editor" || role === "viewer") {
    return role;
  }
  return null;
}

export function isPermissionAllowed(input: {
  userRole: string;
  projectRole: ProjectRole | null;
  permission: ProjectPermission;
}) {
  if (input.userRole === "admin") {
    return true;
  }

  if (!input.projectRole) {
    return false;
  }

  if (input.permission === "delete") {
    return input.projectRole === "owner";
  }

  if (input.permission === "approve" || input.permission === "edit") {
    return input.projectRole === "owner" || input.projectRole === "editor";
  }

  return false;
}
