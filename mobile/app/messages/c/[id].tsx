/** A conversation by its stable id — direct or group. See src/chat/Conversation.tsx. */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { Conversation } from "@/chat/Conversation";

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Conversation id={id} />;
}
