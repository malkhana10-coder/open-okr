import { redirect } from "next/navigation";

/**
 * Planning opens on the documents, which is where a plan starts: nothing can
 * be drafted or quoted before a strategy has been uploaded. A sector named
 * in the address is carried along.
 */
export default async function PlanningPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly sector?: string }>;
}) {
  const { sector } = await searchParams;
  redirect(
    typeof sector === "string" && sector !== ""
      ? `/planning/documents?sector=${encodeURIComponent(sector)}`
      : "/planning/documents",
  );
}
