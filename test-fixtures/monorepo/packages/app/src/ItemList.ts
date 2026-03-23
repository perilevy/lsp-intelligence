import { createSDK, SDK, Item, ItemStatus } from "@fixtures/core";
import { withConsumer, ConsumerProps } from "./withConsumer";

interface ItemListProps extends ConsumerProps {
  filter?: ItemStatus;
}

/** Component that lists items */
const ItemListInner = (props: ItemListProps): string => {
  return `Items filtered by ${props.filter}`;
};

/** Wrapped with consumer HOC */
export const ItemList = withConsumer(ItemListInner);

/** Direct SDK usage */
export async function fetchItems(projectId: string): Promise<Item[]> {
  const sdk: SDK = createSDK({ projectId });
  const response = await sdk.Items.getAll();
  return response.items;
}
