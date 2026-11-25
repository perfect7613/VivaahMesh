import { Suspense } from "react";
import { MiniApp } from "@/components/MiniApp";

export const metadata = { title: "Our Wedding · VivaahMesh" };

/** Telegram Mini App entry. Opened from @vivaah_bot buttons and the chat menu button. */
export default function TelegramMiniAppPage() {
  return (
    <Suspense>
      <MiniApp />
    </Suspense>
  );
}
