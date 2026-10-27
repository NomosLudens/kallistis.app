import { createFileRoute } from "@tanstack/react-router";
import { SharedAgenda } from "@/components/SharedAgenda";
import { RouteErrorBoundary, RouteNotFoundBoundary } from "@/components/loading-states";

export const Route = createFileRoute("/_authenticated/agenda")({
  component: SharedAgenda,
  errorComponent: RouteErrorBoundary,
  notFoundComponent: () => <RouteNotFoundBoundary />,
});
