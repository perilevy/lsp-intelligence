import { Config, ItemStatus, PaginatedResponse } from "@fixtures/types";

/** Item entity */
export interface Item {
  id: string;
  name: string;
  status: ItemStatus;
}

/** Create the SDK with typed API methods */
export const createSDK = (config: Config) => {
  return {
    projectId: config.projectId,
    Items: {
      get: async (id: string): Promise<Item> => ({ id, name: "", status: ItemStatus.Active }),
      getAll: async (): Promise<PaginatedResponse<Item>> => ({ items: [], total: 0, offset: 0 }),
      create: async (data: Partial<Item>): Promise<Item> => ({ id: "new", name: data.name ?? "", status: ItemStatus.Draft }),
    },
  };
};

/** Update SDK config without re-creating */
export const updateSDK = (sdk: SDK, config: Config) => {
  // In real code this would mutate the internal config
};

/** SDK type alias — derived from createSDK return type */
export type SDK = ReturnType<typeof createSDK>;
