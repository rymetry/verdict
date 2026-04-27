import { type DetectedPackageManager, type ProjectSummary } from "@pwqa/shared";

export interface CurrentProject {
  summary: ProjectSummary;
  packageManager: DetectedPackageManager;
}

export interface ProjectStore {
  set(current: CurrentProject): void;
  get(): CurrentProject | undefined;
  getById(projectId: string): CurrentProject | undefined;
  clear(): void;
}

export function createProjectStore(initial?: CurrentProject): ProjectStore {
  let current: CurrentProject | undefined = initial;
  return {
    set(next) {
      current = next;
    },
    get() {
      return current;
    },
    getById(projectId) {
      if (current && current.summary.id === projectId) return current;
      return undefined;
    },
    clear() {
      current = undefined;
    }
  };
}
