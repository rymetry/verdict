import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface RunWarningsAlertProps {
  warnings: readonly string[];
}

export function RunWarningsAlert({ warnings }: RunWarningsAlertProps): React.ReactElement | null {
  if (warnings.length === 0) return null;
  return (
    <Alert variant="warning" className="mt-3">
      <AlertTitle>Run warnings</AlertTitle>
      <AlertDescription>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
          {warnings.map((warning, index) => (
            <li key={`${warning}-${index}`} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
