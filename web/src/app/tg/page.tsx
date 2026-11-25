import { Suspense } from "react";
import { TelegramEntry } from "./TelegramEntry";

export const metadata = { title: "Our Wedding · VivaahMesh" };

/** Telegram Mini App entry. Opened from @vivaah_bot buttons and the chat menu button. */
export default function TelegramMiniAppPage() {
  return (
    <Suspense>
      <TelegramEntry />
    </Suspense>
  );
}
