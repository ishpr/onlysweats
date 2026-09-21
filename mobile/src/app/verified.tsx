import { Redirect } from "expo-router";

/**
 * `samepace://verified` — where Persona's flow hands back. On iOS the browser
 * sheet swallows it; where it does open the app, land on the screen that asks
 * the server how the check came out.
 */
export default function Verified() {
  return <Redirect href="/verify" />;
}
