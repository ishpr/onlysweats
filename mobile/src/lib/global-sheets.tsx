/**
 * The few sheets that can be asked for from anywhere (the verify gate, the membership
 * gate, report, block…) live once, at the root — so a screen never has to own them, and
 * so the one-sheet rule holds across the whole app: `open` refuses while one is up.
 *
 * Register a sheet by adding it to `REGISTRY`. Each takes `visible`, `onClose` and its
 * own props.
 */
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

type GlobalSheet<P> = ComponentType<P & { visible: boolean; onClose: () => void }>;

// Filled in as the gates and shared sheets are built (master plan, phases 2 and 7).
const REGISTRY: Record<string, GlobalSheet<any>> = {};

export function registerGlobalSheet<P>(name: string, sheet: GlobalSheet<P>) {
  REGISTRY[name] = sheet;
}

const GlobalSheetsContext = createContext<{
  /** `false` when another global sheet is already up — close that one first. */
  open: (name: string, props?: Record<string, unknown>) => boolean;
  close: () => void;
} | null>(null);

export function useGlobalSheets() {
  const value = use(GlobalSheetsContext);
  if (!value) throw new Error("useGlobalSheets needs <GlobalSheetsProvider> above it.");
  return value;
}

export function GlobalSheetsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ name: string; props: Record<string, unknown> } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const open = useCallback(
    (name: string, props: Record<string, unknown> = {}) => {
      if (visible || !REGISTRY[name]) {
        if (__DEV__ && !REGISTRY[name]) console.warn(`No global sheet named "${name}".`);
        return false;
      }
      setCurrent({ name, props });
      setVisible(true);
      return true;
    },
    [visible],
  );
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ open, close }), [open, close]);
  const Current = current ? REGISTRY[current.name] : null;
  return (
    <GlobalSheetsContext value={value}>
      {children}
      {Current ? <Current {...current!.props} visible={visible} onClose={close} /> : null}
    </GlobalSheetsContext>
  );
}
