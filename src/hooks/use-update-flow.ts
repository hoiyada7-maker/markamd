import { useCallback, useState } from "react";
import { applyUpdate, checkForUpdate } from "@/lib/updater";
import type { LoadError } from "./use-file-session";

type UseUpdateFlowArgs = {
  onError: (err: LoadError) => void;
};

type UseUpdateFlowResult = {
  updateAvail: { version: string } | null;
  setUpdateAvail: (v: { version: string } | null) => void;
  updateInstalling: boolean;
  updateUpToDate: boolean;
  setUpdateUpToDate: (v: boolean) => void;
  handleApplyUpdate: () => Promise<void>;
  handleManualUpdateCheck: () => Promise<void>;
};

export function useUpdateFlow({ onError }: UseUpdateFlowArgs): UseUpdateFlowResult {
  const [updateAvail, setUpdateAvail] = useState<{ version: string } | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateUpToDate, setUpdateUpToDate] = useState(false);

  // No auto-check on launch — update availability is surfaced only when the
  // user explicitly runs handleManualUpdateCheck (e.g. from the command menu).

  const handleApplyUpdate = useCallback(async () => {
    if (updateInstalling) return;
    setUpdateInstalling(true);
    try {
      await applyUpdate();
      // process will relaunch — control rarely returns here
    } catch (err) {
      console.error("marka.md: update install failed", err);
      onError({
        message: `couldn't install update — ${err instanceof Error ? err.message : err}`,
      });
      setUpdateInstalling(false);
    }
  }, [updateInstalling, onError]);

  const handleManualUpdateCheck = useCallback(async () => {
    const result = await checkForUpdate();
    if (result.status === "available") {
      setUpdateAvail({ version: result.version });
    } else if (result.status === "none") {
      setUpdateUpToDate(true);
    } else {
      onError({ message: `update check failed — ${result.message}` });
    }
  }, [onError]);

  return {
    updateAvail,
    setUpdateAvail,
    updateInstalling,
    updateUpToDate,
    setUpdateUpToDate,
    handleApplyUpdate,
    handleManualUpdateCheck,
  };
}
