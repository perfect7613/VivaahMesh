import type { Metadata } from "next";
import { Suspense } from "react";
import { GuestPage } from "@/components/guest/GuestPage";

export const metadata: Metadata = {
  title: "RSVP and gifts · VivaahMesh",
  // The link is the guest's key: keep it out of search results and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page({ params }: PageProps<"/guest/[code]">) {
  return (
    <Suspense>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: Pick<PageProps<"/guest/[code]">, "params">) {
  const { code } = await params;
  return <GuestPage code={code} />;
}
