import AssistantRoute from "@/app/assistant";
import { AssistantPlacement } from "@/lib/assistant-placement";

/** The assistant's home: the centre tab. `/assistant` stays for deep links and pushes. */
export default function AgentTab() {
  return (
    <AssistantPlacement value="tab">
      <AssistantRoute />
    </AssistantPlacement>
  );
}
