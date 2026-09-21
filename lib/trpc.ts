import AsyncStorage from "@react-native-async-storage/async-storage";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

export const COOKIE_NAME = "app_session_id";
export const BACKEND_URL = "https://3000-ik6yndjw6etkumpv8rpmz-85b2c519.sg2.manus.computer";

export async function getStoredSessionToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem("voltron.session.token");
  } catch {
    return null;
  }
}

export async function setStoredSession(token: string, user: Record<string, unknown> | null) {
  await AsyncStorage.setItem("voltron.session.token", token);
  await AsyncStorage.setItem("voltron.session.cookie", `${COOKIE_NAME}=${token}`);
  if (user) {
    await AsyncStorage.setItem("voltron.session.user", JSON.stringify(user));
  }
}

export async function clearStoredSession() {
  await AsyncStorage.multiRemove([
    "voltron.session.token",
    "voltron.session.cookie",
    "voltron.session.user",
  ]);
}

export async function getStoredUser<T = Record<string, unknown>>(): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem("voltron.session.user");
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const trpcClient = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: `${BACKEND_URL}/api/trpc`,
      transformer: superjson,
      async headers() {
        const token = await getStoredSessionToken();
        return token
          ? {
              Authorization: `Bearer ${token}`,
              Cookie: `${COOKIE_NAME}=${token}`,
            }
          : {};
      },
    }),
  ],
});

export const api = trpcClient as any;
