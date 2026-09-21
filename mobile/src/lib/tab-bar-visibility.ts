import { makeMutable } from "react-native-reanimated";

/**
 * 0 = the tab bar is showing, 1 = it has slid away. Scrolling down a long page
 * hides it to give the content the whole screen; any scroll up, reaching the top,
 * or changing tab brings it straight back. Shared between the tab screens (which
 * write it while scrolling) and the bar (which reads it).
 */
export const tabBarHidden = makeMutable(0);
