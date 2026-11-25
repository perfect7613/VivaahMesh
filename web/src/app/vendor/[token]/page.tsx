import type { Metadata } from "next";
import { Suspense } from "react";
import { VendorPage } from "./VendorPage";

export const metadata: Metadata = { title: "Run sheet · VivaahMesh", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function Page({ params }: PageProps<"/vendor/[token]">) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: Pick<PageProps<"/vendor/[token]">, "params">) {
  const { token } = await params;
  return <VendorPage token={token} />;
}
