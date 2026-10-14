import { Suspense } from "react";
import { Workspace } from "@/components/workspace/workspace";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading workspace</div>}>
      <Workspace />
    </Suspense>
  );
}
