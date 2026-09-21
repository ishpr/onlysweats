/**
 * Where the assistant screen is showing: as the centre tab (its home), or pushed on the
 * stack by a deep link or notification. The screen is the same; only its chrome differs.
 */
import { createContext } from "react";

export const AssistantPlacement = createContext<"tab" | "stack">("stack");
