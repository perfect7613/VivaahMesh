import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsentPage } from "./ConsentPage";

export const metadata: Metadata = {
  title: "Venue call consent · VivaahMesh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page({ params }: PageProps<"/call-consent/[token]">) {
  return (
    <Suspense>
      <ReplyPage params={params} />
    </Suspense>
  );
}

async function ReplyPage({ params }: Pick<PageProps<"/call-consent/[token]">, "params">) {
  const { token } = await params;
  return <ConsentPage token={token} />;
}
