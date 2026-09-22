import { Redirect, useLocalSearchParams } from "expo-router";

/** The conversation became the Plan screen. Old links and notifications land there. */
export default function AgentChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/assistant/plan/[id]", params: { id } }} />;
}
