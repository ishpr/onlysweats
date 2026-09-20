/**
 * Haptics, by meaning rather than by motor pattern. A tap confirms a press, a
 * selection tick marks a change of value, and success / warning / error mark how
 * something the server decided turned out.
 *
 * `expo-haptics` is a native module: a build made before it was added doesn't
 * have it, so it's loaded lazily and its absence is silent. iOS and Android both
 * honour the system's own "vibration off" setting.
 */
type Haptics = typeof import("expo-haptics");

let cached: Haptics | null | undefined;

function load(): Haptics | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    cached = require("expo-haptics") as Haptics;
  } catch {
    cached = null;
  }
  return cached;
}

const run = (fn: (h: Haptics) => Promise<void>) => {
  const h = load();
  if (h) void fn(h).catch(() => undefined);
};

export const haptic = {
  /** A button was pressed. */
  tap: () => run((h) => h.impactAsync(h.ImpactFeedbackStyle.Light)),
  /** A value changed: chip, switch, tab. */
  select: () => run((h) => h.selectionAsync()),
  /** It worked: seat taken, checked in, posted. */
  success: () => run((h) => h.notificationAsync(h.NotificationFeedbackType.Success)),
  /** It worked, and it costs something or can't be undone: cancel, block. */
  warning: () => run((h) => h.notificationAsync(h.NotificationFeedbackType.Warning)),
  /** The server said no. */
  error: () => run((h) => h.notificationAsync(h.NotificationFeedbackType.Error)),
};
