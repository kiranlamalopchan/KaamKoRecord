import React from "react";
import { render } from "@testing-library/react-native";
import { AdminBadge } from "@/ui/AdminBadge";

test("beside a name only the shield, named for screen readers; on a profile the word", async () => {
  const admin = await render(<AdminBadge person={{ is_admin: true }} />);
  expect(admin.getByTestId("admin-badge")).toHaveProp("accessibilityLabel", "Admin");
  expect(admin.queryByText("Admin")).toBeNull();

  const moderator = await render(<AdminBadge person={{ is_admin: false, is_moderator: true }} />);
  expect(moderator.getByTestId("moderator-badge")).toHaveProp("accessibilityLabel", "Moderator");
  expect(moderator.queryByText("Moderator")).toBeNull();

  const profile = await render(<AdminBadge person={{ is_admin: false, is_moderator: true }} full />);
  expect(profile.getByText("Moderator")).toBeTruthy();

  const nobody = await render(<AdminBadge person={{ is_admin: false, is_moderator: false }} />);
  expect(nobody.toJSON()).toBeNull();
});
