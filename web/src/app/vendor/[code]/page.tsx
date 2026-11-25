import type { Metadata } from "next";
import { Suspense } from "react";
import { VendorPage } from "@/components/vendor/VendorPage";

export const metadata: Metadata = {
  title: "Run sheet · VivaahMesh",
  // The link is the vendor's key: keep it out of search results and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page({ params }: PageProps<"/vendor/[code]">) {
  return (
    <Suspense>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: Pick<PageProps<"/vendor/[code]">, "params">) {
  const { code } = await params;
  return <VendorPage code={code} />;
}
