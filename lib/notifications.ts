import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "./trpc";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NotificationRegistration = {
  token: string;
  permission: Notifications.PermissionStatus;
};

export async function registerForVoltronNotifications(): Promise<NotificationRegistration | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;

  const current = await Notifications.getPermissionsAsync();
  let permission = current.status;
  if (permission !== Notifications.PermissionStatus.GRANTED) {
    const requested = await Notifications.requestPermissionsAsync();
    permission = requested.status;
  }
  if (permission !== Notifications.PermissionStatus.GRANTED) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = tokenResponse.data;
  if (!token) return null;

  await Notifications.setNotificationChannelAsync("voltron-anomalies", {
    name: "Voltron battery anomalies",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#10b981",
  });
  await api.notifications.registerToken.mutate({
    token,
    platform: Platform.OS === "android" ? "android" : "ios",
  });
  return { token, permission };
}

export async function unregisterVoltronNotifications(token: string) {
  if (Platform.OS === "web") return;
  await api.notifications.unregisterToken.mutate({ token });
}

export async function showLocalAnomalyNotification(params: {
  vehicleName: string;
  priority: "warning" | "critical";
  message: string;
}) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${params.priority === "critical" ? "Critical" : "Warning"}: ${params.vehicleName}`,
      body: params.message,
      data: { type: "voltron-battery-anomaly", priority: params.priority },
      sound: "default",
    },
    trigger: null,
  });
}
