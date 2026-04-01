// Fixture for structural predicate testing — no DOM references

function useEffect(cb: () => void | (() => void), deps?: any[]): void {}
function useMemo<T>(cb: () => T, deps: any[]): T { return cb(); }
function useCallback<T extends Function>(cb: T, deps: any[]): T { return cb; }
function useState<T>(init: T): [T, (v: T) => void] { return [init, () => {}]; }

/** useEffect with CONDITIONAL cleanup */
export function ConditionalCleanupComponent() {
  const [enabled] = useState(false);
  useEffect(() => {
    if (enabled) {
      const id = setTimeout(() => {}, 1000);
      return () => clearTimeout(id);
    }
  }, [enabled]);
}

/** useEffect with UNCONDITIONAL cleanup */
export function UnconditionalCleanupComponent() {
  useEffect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  }, []);
}

/** useEffect with NO cleanup */
export function NoCleanupComponent() {
  useEffect(() => {
    void 0;
  }, []);
}

/** useMemo usage */
export function MemoComponent() {
  const value = useMemo(() => 42, []);
  return value;
}

/** useCallback usage */
export function CallbackComponent() {
  const fn = useCallback(() => {}, []);
  return fn;
}

/** Misleading name: callbackRegistry — NOT a hook */
export const callbackRegistry = new Map<string, Function>();

/** Misleading name: callApi */
export function callApi(url: string): Promise<void> {
  return Promise.resolve();
}

/** Custom hook — usePermissions */
export function usePermissions(userId: string) {
  const [perms] = useState<string[]>([]);
  useEffect(() => { callApi(`/perms/${userId}`); }, [userId]);
  return perms;
}

/** useEffect that sets state based on previous state — functional updater pattern */
export function CounterComponent() {
  const [, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setCount((prev: number) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);
}

/** useEffect with constant updater — NOT functional (prev unused) */
export function ResetComponent() {
  const [, setValue] = useState(0);
  useEffect(() => {
    setValue(() => 0);
  }, []);
}
