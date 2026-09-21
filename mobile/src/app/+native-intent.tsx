import { nativeAppLink } from "@/lib/app-links";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return nativeAppLink(path);
}
