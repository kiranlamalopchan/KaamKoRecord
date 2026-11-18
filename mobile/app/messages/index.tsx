/** Chats is a tab now; older links to /messages land there. */
import { Redirect } from "expo-router";

export default function MessagesRoute() { return <Redirect href="/chats" />; }
