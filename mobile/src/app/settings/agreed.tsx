import { Linking } from "react-native";

import { ListCard, ListRow } from "@/components/list";
import { Card, Screen, T } from "@/components/ui";
import { SITE_URL } from "@/lib/config";
import { FileText, Lock } from "lucide-react-native";

import { APP_TERMS_COACHING_NOTICE, APP_TERMS_VERSION } from "../../../../shared/app-terms";

/** What you agreed to: the notice, word for word, and the documents it points to. */
export default function AgreedSettings() {
  const web = (path: string) => () => void Linking.openURL(`${SITE_URL}${path}`);
  return (
    <Screen>
      <Card>
        <T variant="eyebrow" color="textFaint">
          Version {APP_TERMS_VERSION}
        </T>
        <T selectable>{APP_TERMS_COACHING_NOTICE}</T>
      </Card>
      <ListCard>
        <ListRow
          icon={FileText}
          label="Terms of Service"
          accessibilityRole="link"
          onPress={web("/terms")}
        />
        <ListRow
          icon={Lock}
          label="Privacy Policy"
          accessibilityRole="link"
          onPress={web("/privacy")}
        />
      </ListCard>
    </Screen>
  );
}
