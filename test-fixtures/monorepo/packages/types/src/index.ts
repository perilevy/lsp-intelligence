/** Configuration for the SDK */
export interface Config {
  projectId: string;
  apiUrl?: string;
}

/** Status enum for items */
export enum ItemStatus {
  Active = "active",
  Archived = "archived",
  Draft = "draft",
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
}
