import React, { useState } from "react";
import { useT } from "@/i18n";
import { Card, Page, PageTitle, Screen } from "@/ui";
import { PushRow } from "@/ui/PushRow";
import { ShiftReminderSetting } from "@/ui/WorkAlarmSettings";
import { NotificationChoices } from "@/ui/NotificationChoices";

export default function NotificationSettings() {
  const tr = useT();
  const [pushRevision, setPushRevision] = useState(0);
  return <Screen back backLabel={tr("Settings")}>
    <Page>
      <PageTitle>{tr("Notifications")}</PageTitle>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <PushRow minimal onChange={() => setPushRevision(value => value + 1)} />
        <NotificationChoices refreshKey={pushRevision} />
        <ShiftReminderSetting />
      </Card>
    </Page>
  </Screen>;
}
