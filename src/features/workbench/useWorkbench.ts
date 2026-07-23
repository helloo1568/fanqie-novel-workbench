import { useQuery } from "@tanstack/react-query";
import type { CanonEntity, Chapter, Novel } from "@shared/types";
import { api } from "../../api";
import type { ApiError } from "../../lib/errors";

export type WorkspaceRecord = Record<string, unknown>;

export interface Workspace {
  novel: Novel;
  volumes: WorkspaceRecord[];
  arcs: WorkspaceRecord[];
  chapters: Chapter[];
  canon: CanonEntity[];
  facts: WorkspaceRecord[];
  foreshadows: WorkspaceRecord[];
  timeline: WorkspaceRecord[];
  proposals: WorkspaceRecord[];
  publications: WorkspaceRecord[];
}

export const workbenchKeys = {
  workspace: (novelId: string) => ["workspace", novelId] as const,
};

export function getWorkspaceChapter(workspace: Workspace, chapterId: string | null) {
  return workspace.chapters.find((chapter) => chapter.id === chapterId) ?? workspace.chapters[0];
}

export function useWorkbench(novelId: string) {
  const query = useQuery<Workspace, ApiError>({
    queryKey: workbenchKeys.workspace(novelId),
    queryFn: () => api<Workspace>(`/novels/${novelId}/workspace`),
    enabled: Boolean(novelId),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
