import type { ReactNode } from "react";
import { AppShellLayout } from "../../../lib/app-shell.tsx";

/**
 * The application shell around the planning extension's screens.
 *
 * The shell is the layout, as in every other segment, so that this segment's
 * error boundary renders inside it and a failed read keeps the navigation.
 */
export default function PlanningLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <AppShellLayout>{children}</AppShellLayout>;
}
