import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BACKEND_URL } from "./trpc";

export const VOLTRON_BACKGROUND_SYNC_TASK = "voltron-offline-session-sync";

type OfflineSession = {
  id: string;
  vehicleId: number;
  createdAt: string;
  stateOfHealth: number | null;
  cellDeltaMv: number | null;
  syncState: "queued";
};

export type SyncStatus = {
  phase: "idle" | "waiting-auth" | "uploading" | "complete" | "error";
  uploaded: number;
  total: number;
  message?: string;
  updatedAt: string;
};

const saveStatus = (status: Omit<SyncStatus, "updatedAt">) => AsyncStorage.setItem(
  "voltron.sync.status",
  JSON.stringify({ ...status, updatedAt: new Date().toISOString() }),
);

TaskManager.defineTask(VOLTRON_BACKGROUND_SYNC_TASK, async () => {
  try {
    const [rawSessions, sessionCookie] = await Promise.all([
      AsyncStorage.getItem("voltron.offline.sessions"),
      AsyncStorage.getItem("voltron.session.cookie"),
    ]);
    const sessions = rawSessions ? (JSON.parse(rawSessions) as OfflineSession[]) : [];
    const pending = sessions.filter((session) => session.syncState === "queued");

    // Do not spin or discard data when the mobile account session is unavailable.
    if (!pending.length) {
      await saveStatus({ phase: "idle", uploaded: 0, total: 0 });
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    if (!sessionCookie) {
      await saveStatus({ phase: "waiting-auth", uploaded: 0, total: pending.length, message: "Sign in to the web account to upload queued sessions." });
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    await saveStatus({ phase: "uploading", uploaded: 0, total: pending.length });

    const response = await fetch(`${BACKEND_URL}/api/trpc/diagnostics.syncOfflineSessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        json: {
          sessions: pending.map((session) => ({
            vehicleId: session.vehicleId,
            stateOfHealth: session.stateOfHealth,
            cellDeltaMv: session.cellDeltaMv,
            telemetrySnapshot: { localId: session.id, capturedAt: session.createdAt, source: "expo-background-fetch" },
          })),
        },
      }),
    });

    if (!response.ok) {
      await saveStatus({ phase: "error", uploaded: 0, total: pending.length, message: `Upload failed (${response.status}). Will retry automatically.` });
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    await AsyncStorage.setItem(
      "voltron.offline.sessions",
      JSON.stringify(sessions.filter((session) => session.syncState !== "queued")),
    );
    await saveStatus({ phase: "complete", uploaded: pending.length, total: pending.length, message: "All queued sessions uploaded." });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    await saveStatus({ phase: "error", uploaded: 0, total: 0, message: "Upload interrupted. Will retry automatically." });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerVoltronBackgroundSync() {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || status === BackgroundFetch.BackgroundFetchStatus.Denied) return false;

  const registered = await TaskManager.isTaskRegisteredAsync(VOLTRON_BACKGROUND_SYNC_TASK);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(VOLTRON_BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
  return true;
}
