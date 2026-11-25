import type { Metadata } from "next";
import { Suspense } from "react";
import { GuestPage } from "./GuestPage";

export const metadata: Metadata = { title: "Your invitation · VivaahMesh", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function Page({ params }: PageProps<"/rsvp/[token]">) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: Pick<PageProps<"/rsvp/[token]">, "params">) {
  const { token } = await params;
  return <GuestPage token={token} />;
}
