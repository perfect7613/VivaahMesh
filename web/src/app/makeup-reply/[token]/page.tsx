import type { Metadata } from "next";
import { Suspense } from "react";
import { MakeupReply } from "./MakeupReply";

export const metadata: Metadata = {
  title: "Confirm makeup timing · VivaahMesh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page({ params }: PageProps<"/makeup-reply/[token]">) {
  return (
    <Suspense>
      <ReplyPage params={params} />
    </Suspense>
  );
}

async function ReplyPage({ params }: Pick<PageProps<"/makeup-reply/[token]">, "params">) {
  const { token } = await params;
  return <MakeupReply token={token} />;
}
