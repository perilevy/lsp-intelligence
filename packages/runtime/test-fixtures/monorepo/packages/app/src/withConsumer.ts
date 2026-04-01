import { SDK } from "@fixtures/core";

/** Props injected by withConsumer */
export interface ConsumerProps {
  sdk: SDK;
}

/** HOC that wraps a component with SDK context */
export const withConsumer = <T extends ConsumerProps>(
  Component: (props: T) => string,
): ((props: Omit<T, keyof ConsumerProps>) => string) => {
  return (props) => {
    const sdk = {} as SDK;
    return Component({ ...props, sdk } as T);
  };
};
