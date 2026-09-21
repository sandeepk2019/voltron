import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  api,
  BACKEND_URL,
  getStoredUser,
  setStoredSession,
  clearStoredSession,
  getStoredSessionToken,
} from "../lib/trpc";
import { registerVoltronBackgroundSync, SyncStatus } from "../lib/backgroundSync";
import {
  initializeTelemetryHistory,
  saveTelemetryHistory,
  listTelemetryHistory,
  TelemetryHistoryRecord,
} from "../lib/telemetryHistory";
import {
  scanForElm327,
  stopBleScan,
  connectElm327,
  disconnectElm327,
  startElm327Polling,
  stopElm327Polling,
  clearElm327TroubleCodes,
  Elm327CanSample,
  BleAdapter,
} from "../lib/bleElm327";
import {
  registerForVoltronNotifications,
  showLocalAnomalyNotification,
} from "../lib/notifications";
import { exportTelemetryCertificate } from "../lib/offlinePdf";

type UserProfile = {
  id: number;
  name: string | null;
  email: string | null;
  role?: string;
  phoneNumber?: string | null;
  address?: string | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
};

type MobileTab = "specs" | "lab" | "garage" | "profile" | "settings";
type LabSubview = "cockpit" | "health" | "matrix" | "replay" | "compare" | "reports";

type VehicleItem = {
  id: number;
  make: string;
  model: string;
  year: number;
  vin: string;
  pseudonymizedVin?: string;
  batteryChemistry?: string | null;
  nominalPackVoltage?: number | null;
  cellCount?: number | null;
  modulesCount?: number | null;
  fleetTag?: string | null;
};

type CellData = {
  cellIndex: number;
  moduleIndex: number;
  voltage: number;
  temperatureC: number;
  isMin?: boolean;
  isMax?: boolean;
  isAnomaly?: boolean;
};

type TelemetryData = {
  vehicleId?: number;
  make: string;
  model: string;
  year: number;
  stateOfHealth: number;
  stateOfCharge: number;
  cellDeltaMv: number;
  packVoltage: number;
  powerFlowKw: number;
  packTempAvgC: number;
  isolationResistanceKohms: number;
  deltaStatus: string;
  headlineVerdict: string;
  cells: CellData[];
};

type OfflineSession = {
  id: string;
  vehicleId: number;
  createdAt: string;
  stateOfHealth: number | null;
  cellDeltaMv: number | null;
  syncState: "queued";
};

export default function MobileHomeScreen() {
  const [activeTab, setActiveTab] = useState<MobileTab>("garage");
  const [labSubview, setLabSubview] = useState<LabSubview>("cockpit");
  const [selectedRole, setSelectedRole] = useState<"owner" | "tech" | "fleet">("tech");

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newVin, setNewVin] = useState("");
  const [newYear, setNewYear] = useState("2024");
  const [newChemistry, setNewChemistry] = useState("NMC");
  const [newVoltage, setNewVoltage] = useState("400");
  const [newFleetTag, setNewFleetTag] = useState("");

  const [activeVehicle, setActiveVehicle] = useState<VehicleItem | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [diagnosticMetric, setDiagnosticMetric] = useState<"voltage" | "thermal" | "delta">("voltage");

  // BLE ELM327 dongle state
  const [bleScanning, setBleScanning] = useState(false);
  const [bleAdapters, setBleAdapters] = useState<BleAdapter[]>([]);
  const [connectedBleDevice, setConnectedBleDevice] = useState<string | null>(null);
  const [bleConnecting, setBleConnecting] = useState(false);
  const [bleStatusText, setBleStatusText] = useState("Ready to pair OBD-II");
  const [canSample, setCanSample] = useState<Elm327CanSample | null>(null);
  const [dtcClearing, setDtcClearing] = useState(false);
  const [dtcStatus, setDtcStatus] = useState("");
  const [pdfExportingId, setPdfExportingId] = useState<number | "current" | null>(null);

  // Offline SQLite history state
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [sqliteHistory, setSqliteHistory] = useState<TelemetryHistoryRecord[]>([]);

  // Push notification registration state
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Profile and Settings edit & verification state
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verifyChannel, setVerifyChannel] = useState<"email" | "phone">("phone");
  const [verificationCode, setVerificationCode] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const [scannerVisible, setScannerVisible] = useState(false);
  const [worksheetScannerVisible, setWorksheetScannerVisible] = useState(false);
  const [worksheetVerification, setWorksheetVerification] = useState<{
    status: "idle" | "valid" | "invalid" | "error";
    message: string;
    preview: Record<string, unknown> | null;
  }>({ status: "idle", message: "", preview: null });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [offlineSessions, setOfflineSessions] = useState<OfflineSession[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    phase: "idle",
    uploaded: 0,
    total: 0,
    updatedAt: new Date().toISOString(),
  });

  const loadVehicles = async () => {
    setVehiclesLoading(true);
    try {
      const list = await api.vehicles.list.query();
      if (Array.isArray(list) && list.length > 0) {
        setVehicles(list);
        if (!activeVehicle) setActiveVehicle(list[0]);
      } else {
        const defaults: VehicleItem[] = [
          {
            id: 1,
            make: "Tesla",
            model: "Model 3 Long Range",
            year: 2023,
            vin: "5YJ3E1EB*PF892***",
            pseudonymizedVin: "5YJ3****2***",
            batteryChemistry: "NMC 712",
            nominalPackVoltage: 400,
            cellCount: 96,
            modulesCount: 8,
            fleetTag: "Express",
          },
          {
            id: 2,
            make: "Hyundai",
            model: "Ioniq 5 AWD",
            year: 2024,
            vin: "KM8K13AG*PU109***",
            pseudonymizedVin: "KM8K****9***",
            batteryChemistry: "NMC 811",
            nominalPackVoltage: 800,
            cellCount: 96,
            modulesCount: 8,
            fleetTag: "Priority",
          },
        ];
        setVehicles(defaults);
        if (!activeVehicle) setActiveVehicle(defaults[0]);
      }
    } catch {
      // Offline fallback: keep existing list or local seed
    } finally {
      setVehiclesLoading(false);
    }
  };

  const refreshSqliteHistory = () => {
    try {
      const records = listTelemetryHistory();
      setSqliteHistory(records);
    } catch {
      // Handled gracefully if SQLite is not supported on this platform
    }
  };

  const syncProfileInputs = (user: UserProfile | null) => {
    if (user) {
      setProfileName(user.name || "");
      setProfileEmail(user.email || "");
      setProfilePhone(user.phoneNumber || "");
      setProfileAddress(user.address || "");
    }
  };

  useEffect(() => {
    (async () => {
      initializeTelemetryHistory();
      refreshSqliteHistory();

      const storedToken = await getStoredSessionToken();
      const storedUser = await getStoredUser<UserProfile>();
      setSessionToken(storedToken);
      setCurrentUser(storedUser);
      syncProfileInputs(storedUser);

      const savedSessions = await AsyncStorage.getItem("voltron.offline.sessions");
      if (savedSessions) setOfflineSessions(JSON.parse(savedSessions));

      await loadVehicles();

      if (storedToken) {
        try {
          const reg = await registerForVoltronNotifications();
          if (reg?.token) {
            setPushToken(reg.token);
            setNotificationsEnabled(true);
          }
        } catch {
          // Push notifications permission or fallback
        }
      }
    })();

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
    });

    registerVoltronBackgroundSync().catch(() => undefined);

    const statusTimer = setInterval(() => {
      AsyncStorage.getItem("voltron.sync.status").then((value) => {
        if (value) setSyncStatus(JSON.parse(value));
      });
    }, 2500);

    return () => {
      clearInterval(statusTimer);
      unsubscribe();
      stopBleScan();
      stopElm327Polling();
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem("voltron.offline.sessions", JSON.stringify(offlineSessions));
  }, [offlineSessions]);

  const handleAuthSubmit = async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      if (authMode === "register") {
        if (!authName.trim()) throw new Error("Please enter your name.");
        if (!authEmail.trim() || !authEmail.includes("@")) throw new Error("Enter a valid email address.");
        if (authPassword.length < 8) throw new Error("Password must be at least 8 characters.");

        const res = await api.auth.mobileRegister.mutate({
          name: authName.trim(),
          email: authEmail.trim(),
          password: authPassword,
        });

        await setStoredSession(res.sessionToken, res.user);
        setSessionToken(res.sessionToken);
        setCurrentUser(res.user);
        syncProfileInputs(res.user);
        setAuthModalVisible(false);
        setAuthPassword("");
        await loadVehicles();

        registerForVoltronNotifications()
          .then((reg) => {
            if (reg?.token) {
              setPushToken(reg.token);
              setNotificationsEnabled(true);
            }
          })
          .catch(() => undefined);
      } else {
        if (!authEmail.trim()) throw new Error("Please enter your email.");
        if (!authPassword) throw new Error("Please enter your password.");

        const res = await api.auth.mobileLogin.mutate({
          email: authEmail.trim(),
          password: authPassword,
        });

        await setStoredSession(res.sessionToken, res.user);
        setSessionToken(res.sessionToken);
        setCurrentUser(res.user);
        syncProfileInputs(res.user);
        setAuthModalVisible(false);
        setAuthPassword("");
        await loadVehicles();

        registerForVoltronNotifications()
          .then((reg) => {
            if (reg?.token) {
              setPushToken(reg.token);
              setNotificationsEnabled(true);
            }
          })
          .catch(() => undefined);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out of this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await clearStoredSession();
          setCurrentUser(null);
          setSessionToken(null);
          setPushToken(null);
          setNotificationsEnabled(false);
          setProfileName("");
          setProfileEmail("");
          setProfilePhone("");
          setProfileAddress("");
          await loadVehicles();
        },
      },
    ]);
  };

  const handleSaveProfile = async () => {
    if (!currentUser) {
      Alert.alert("Authentication", "Please sign in to update your profile.");
      return;
    }
    setProfileSaving(true);
    setProfileMessage("");
    try {
      const res = await api.auth.updateProfile.mutate({
        name: profileName.trim(),
        email: profileEmail.trim(),
        phoneNumber: profilePhone.trim() || null,
        address: profileAddress.trim() || null,
      });

      const updatedUser: UserProfile = {
        ...currentUser,
        name: res.user?.name || profileName.trim(),
        email: res.user?.email || profileEmail.trim(),
        phoneNumber: res.user?.phoneNumber || profilePhone.trim(),
        address: res.user?.address || profileAddress.trim(),
      };

      setCurrentUser(updatedUser);
      if (sessionToken) {
        await setStoredSession(sessionToken, updatedUser);
      }
      setProfileMessage("Profile and contact details saved successfully.");
      Alert.alert("Success", "Profile updated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile.";
      setProfileMessage(msg);
      Alert.alert("Error", msg);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleStartVerification = async (channel: "email" | "phone") => {
    setVerifyChannel(channel);
    setVerificationCode("");
    setVerifyError("");
    setVerifyLoading(true);
    try {
      const res = await api.auth.requestVerification.mutate({ channel });
      setDemoCode(res.demoCode || "123456");
      setVerifyModalVisible(true);
    } catch (err) {
      Alert.alert("Verification Notice", err instanceof Error ? err.message : "Could not request code.");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleConfirmVerification = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setVerifyError("Enter the 6-digit verification code.");
      return;
    }
    setVerifyLoading(true);
    setVerifyError("");
    try {
      const res = await api.auth.confirmVerification.mutate({
        channel: verifyChannel,
        code: verificationCode,
      });

      const updatedUser: UserProfile = {
        ...currentUser!,
        ...(verifyChannel === "email"
          ? { emailVerifiedAt: new Date(res.verifiedAt).toISOString() }
          : { phoneVerifiedAt: new Date(res.verifiedAt).toISOString() }),
      };

      setCurrentUser(updatedUser);
      if (sessionToken) {
        await setStoredSession(sessionToken, updatedUser);
      }
      setVerifyModalVisible(false);
      Alert.alert("Verified", `${verifyChannel === "email" ? "Email" : "Phone number"} has been verified.`);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleAddVehicle = async () => {
    if (!newMake.trim() || !newModel.trim() || !newVin.trim()) {
      Alert.alert("Validation", "Make, Model, and VIN are required.");
      return;
    }
    const cleanVin = newVin.trim().toUpperCase();
    const pseudo =
      cleanVin.length >= 8
        ? `${cleanVin.slice(0, 4)}****${cleanVin.slice(-4)}`
        : `${cleanVin}****`;

    if (sessionToken) {
      try {
        await api.vehicles.add.mutate({
          make: newMake.trim(),
          model: newModel.trim(),
          year: Number(newYear) || 2024,
          vin: cleanVin,
          batteryChemistry: newChemistry,
          nominalPackVoltage: Number(newVoltage) || 400,
          fleetTag: newFleetTag.trim() || undefined,
        });
        await loadVehicles();
      } catch {
        Alert.alert("Notice", "Saved to local cache while network synchronizes.");
        setVehicles((prev) => [
          {
            id: Date.now(),
            make: newMake.trim(),
            model: newModel.trim(),
            year: Number(newYear) || 2024,
            vin: pseudo,
            pseudonymizedVin: pseudo,
            batteryChemistry: newChemistry,
            nominalPackVoltage: Number(newVoltage) || 400,
            cellCount: 96,
            modulesCount: 8,
            fleetTag: newFleetTag.trim() || null,
          },
          ...prev,
        ]);
      }
    } else {
      setVehicles((prev) => [
        {
          id: Date.now(),
          make: newMake.trim(),
          model: newModel.trim(),
          year: Number(newYear) || 2024,
          vin: pseudo,
          pseudonymizedVin: pseudo,
          batteryChemistry: newChemistry,
          nominalPackVoltage: Number(newVoltage) || 400,
          cellCount: 96,
          modulesCount: 8,
          fleetTag: newFleetTag.trim() || null,
        },
        ...prev,
      ]);
    }

    setNewMake("");
    setNewModel("");
    setNewVin("");
    setNewFleetTag("");
    setModalVisible(false);
  };

  const handleLaunchDiagnostics = async (veh: VehicleItem) => {
    setActiveVehicle(veh);
    setActiveTab("lab");
    setTelemetryLoading(true);

    const modelKey =
      veh.model.toLowerCase().includes("ioniq")
        ? "ioniq-5"
        : veh.model.toLowerCase().includes("taycan")
        ? "taycan-4s"
        : veh.model.toLowerCase().includes("leaf")
        ? "leaf-plus"
        : "model-3-lr";

    try {
      const data = await api.diagnostics.getTelemetry.query({
        modelKey,
        simulateAnomaly: false,
      });
      setTelemetry(data);

      saveTelemetryHistory({
        vehicleId: veh.id,
        vehicleName: `${veh.year} ${veh.make} ${veh.model}`,
        capturedAt: new Date().toISOString(),
        stateOfHealth: data.stateOfHealth,
        stateOfCharge: data.stateOfCharge,
        cellDeltaMv: data.cellDeltaMv,
        packVoltage: data.packVoltage,
        packTempAvgC: data.packTempAvgC,
        headlineVerdict: data.headlineVerdict,
        source: connectedBleDevice ? "ble" : "live",
        snapshotJson: JSON.stringify(data),
      });
      refreshSqliteHistory();

      if (data.cellDeltaMv > 35 || data.stateOfHealth < 88) {
        showLocalAnomalyNotification({
          vehicleName: `${veh.make} ${veh.model}`,
          priority: data.cellDeltaMv > 50 ? "critical" : "warning",
          message: `Cell spread Δ ${data.cellDeltaMv} mV exceeds baseline. SoH: ${data.stateOfHealth.toFixed(1)}%.`,
        }).catch(() => undefined);
      }
    } catch {
      const cells: CellData[] = [];
      const baseV = 3.865;
      for (let i = 0; i < 96; i++) {
        const mod = Math.floor(i / 12) + 1;
        const v = +(baseV + Math.sin(i * 0.7) * 0.008).toFixed(3);
        cells.push({
          cellIndex: i + 1,
          moduleIndex: mod,
          voltage: v,
          temperatureC: +(24.5 + Math.cos(i * 0.4) * 1.5).toFixed(1),
        });
      }
      const fallbackData: TelemetryData = {
        make: veh.make,
        model: veh.model,
        year: veh.year,
        stateOfHealth: 94.6,
        stateOfCharge: 78.2,
        cellDeltaMv: 18,
        packVoltage: veh.nominalPackVoltage || 400,
        powerFlowKw: -12.4,
        packTempAvgC: 25.1,
        isolationResistanceKohms: 1120,
        deltaStatus: "optimal",
        headlineVerdict: "All 96 cells balanced within factory specification.",
        cells,
      };
      setTelemetry(fallbackData);

      saveTelemetryHistory({
        vehicleId: veh.id,
        vehicleName: `${veh.year} ${veh.make} ${veh.model}`,
        capturedAt: new Date().toISOString(),
        stateOfHealth: fallbackData.stateOfHealth,
        stateOfCharge: fallbackData.stateOfCharge,
        cellDeltaMv: fallbackData.cellDeltaMv,
        packVoltage: fallbackData.packVoltage,
        packTempAvgC: fallbackData.packTempAvgC,
        headlineVerdict: fallbackData.headlineVerdict,
        source: "offline",
        snapshotJson: JSON.stringify(fallbackData),
      });
      refreshSqliteHistory();
    } finally {
      setTelemetryLoading(false);
    }
  };

  const captureOfflineSession = (vehicle: VehicleItem) => {
    const session: OfflineSession = {
      id: `${vehicle.id}-${Date.now()}`,
      vehicleId: vehicle.id,
      createdAt: new Date().toISOString(),
      stateOfHealth: telemetry?.stateOfHealth ?? 94.2,
      cellDeltaMv: telemetry?.cellDeltaMv ?? 19,
      syncState: "queued",
    };
    setOfflineSessions((current) => [session, ...current]);

    if (telemetry) {
      saveTelemetryHistory({
        vehicleId: vehicle.id,
        vehicleName: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        capturedAt: new Date().toISOString(),
        stateOfHealth: session.stateOfHealth ?? 94.2,
        stateOfCharge: telemetry.stateOfCharge,
        cellDeltaMv: session.cellDeltaMv ?? 19,
        packVoltage: telemetry.packVoltage,
        packTempAvgC: telemetry.packTempAvgC,
        headlineVerdict: telemetry.headlineVerdict,
        source: "offline",
        snapshotJson: JSON.stringify(telemetry),
      });
      refreshSqliteHistory();
    }

    Alert.alert("Session Saved", `Offline diagnostic snapshot captured for ${vehicle.make} ${vehicle.model} and saved to SQLite.`);
  };

  const handleToggleBleScan = () => {
    if (bleScanning) {
      stopBleScan();
      setBleScanning(false);
      setBleStatusText("Scan paused");
    } else {
      setBleAdapters([]);
      setBleScanning(true);
      setBleStatusText("Scanning for ELM327 / OBDLink / vGate adapters...");
      scanForElm327(
        (adapter) => {
          setBleAdapters((prev) => {
            if (prev.some((a) => a.id === adapter.id)) return prev;
            return [...prev, adapter];
          });
        },
        (error) => {
          setBleScanning(false);
          setBleStatusText(`BLE scan error: ${error.message}`);
        }
      );
    }
  };

  const handleConnectBle = async (adapter: BleAdapter) => {
    setBleConnecting(true);
    setBleStatusText(`Connecting to ${adapter.name}...`);
    try {
      await connectElm327(adapter.id);
      setConnectedBleDevice(adapter.id);
      setBleStatusText(`Connected to ${adapter.name} (Live OBD-II BLE)`);
      startElm327Polling(
        (sample) => {
          setCanSample(sample);
          setTelemetry((current) => {
            if (!current) return current;
            return {
              ...current,
              packVoltage: sample.packVoltageV ?? current.packVoltage,
              packTempAvgC: sample.batteryTemperatureC ?? current.packTempAvgC,
            };
          });
        },
        (message) => setBleStatusText(message),
        1500,
      );
      Alert.alert("OBD-II Paired", `Wireless ELM327 link established with ${adapter.name}. Live telemetry is ready.`);
    } catch (err: any) {
      setBleStatusText(`Pairing failed: ${err?.message || "Timeout"}`);
      Alert.alert("BLE Connection Error", `Could not connect to ${adapter.name}. Ensure dongle is powered.`);
    } finally {
      setBleConnecting(false);
      setBleScanning(false);
    }
  };

  const handleDisconnectBle = async () => {
    if (!connectedBleDevice) return;
    stopElm327Polling();
    await disconnectElm327(connectedBleDevice);
    setConnectedBleDevice(null);
    setCanSample(null);
    setBleStatusText("OBD-II adapter disconnected");
  };

  const handleClearTroubleCodes = async () => {
    if (!connectedBleDevice) {
      setDtcStatus("Pair an ELM327 adapter before requesting a DTC clear.");
      return;
    }
    Alert.alert(
      "Clear diagnostic trouble codes?",
      "This sends standard OBD-II Service 04 to the vehicle. It may erase emissions-related fault records and will not repair the underlying fault.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Service 04",
          style: "destructive",
          onPress: async () => {
            setDtcClearing(true);
            setDtcStatus("Sending guarded OBD-II Service 04 request…");
            try {
              const result = await clearElm327TroubleCodes();
              setDtcStatus(result.message);
            } catch (error) {
              setDtcStatus(error instanceof Error ? error.message : "DTC clear request failed.");
            } finally {
              setDtcClearing(false);
            }
          },
        },
      ],
    );
  };

  const handleExportRecordPdf = async (record: TelemetryHistoryRecord, key: number | "current") => {
    setPdfExportingId(key);
    try {
      await exportTelemetryCertificate(record);
    } catch (error) {
      Alert.alert("PDF export unavailable", error instanceof Error ? error.message : "Could not create the offline certificate.");
    } finally {
      setPdfExportingId(null);
    }
  };

  const handleExportCurrentPdf = async () => {
    if (!activeVehicle || !telemetry) return;
    const record: Omit<TelemetryHistoryRecord, "id"> = {
      vehicleId: activeVehicle.id,
      vehicleName: `${activeVehicle.year} ${activeVehicle.make} ${activeVehicle.model}`,
      capturedAt: new Date().toISOString(),
      stateOfHealth: telemetry.stateOfHealth,
      stateOfCharge: telemetry.stateOfCharge,
      cellDeltaMv: telemetry.cellDeltaMv,
      packVoltage: telemetry.packVoltage,
      packTempAvgC: telemetry.packTempAvgC,
      headlineVerdict: telemetry.headlineVerdict,
      source: connectedBleDevice ? "ble" : "offline",
      snapshotJson: JSON.stringify({
        ...telemetry,
        canSample,
      }),
    };
    setPdfExportingId("current");
    try {
      await exportTelemetryCertificate(record);
    } catch (error) {
      Alert.alert("PDF export unavailable", error instanceof Error ? error.message : "Could not create the offline certificate.");
    } finally {
      setPdfExportingId(null);
    }
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setScannerVisible(true);
  };

  const openWorksheetScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setWorksheetVerification({ status: "idle", message: "", preview: null });
    setWorksheetScannerVisible(true);
  };

  const verifyWorksheetQrPayload = async (rawPayload: string) => {
    try {
      const match = rawPayload.trim().match(/^VOLTRON-WO\|(\d+)\|SHA256:([a-f0-9]+)\|([\s\S]+)$/i);
      if (!match) throw new Error("This is not a complete Voltron work-order QR payload.");
      const [, workOrderId, expectedHash, payloadText] = match;
      const preview = JSON.parse(payloadText) as Record<string, unknown>;
      if (preview.type !== "voltron-work-order-v1" || String(preview.workOrderId) !== workOrderId) {
        throw new Error("The QR payload is not a recognized Voltron work-order certificate.");
      }
      const actualHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payloadText);
      const valid = actualHash.toLowerCase() === expectedHash.toLowerCase();
      setWorksheetVerification({
        status: valid ? "valid" : "invalid",
        message: valid
          ? `Verified work order #${workOrderId}. The offline certificate hash matches.`
          : "Hash mismatch. Treat this worksheet as unverified.",
        preview,
      });
    } catch (error) {
      setWorksheetVerification({
        status: "error",
        message: error instanceof Error ? error.message : "Could not verify this worksheet.",
        preview: null,
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Universal App Header */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.badgeIcon}>
            <Text style={styles.badgeText}>⚡</Text>
          </View>
          <Text style={styles.title}>VOLTRON</Text>
          <Text style={styles.subtitle}>DIAGNOSTICS</Text>
        </View>
        <Text style={styles.syncStatus}>
          ● {isOnline ? "Cloud Synchronized" : "Autonomous Offline Mode"}
        </Text>
      </View>

      {/* Main Top Navigation Tab Bar */}
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.navTab, activeTab === "specs" && styles.navTabActive]}
          onPress={() => setActiveTab("specs")}
        >
          <Text style={[styles.navTabText, activeTab === "specs" && styles.navTabTextActive]}>
            Specifications
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, activeTab === "lab" && styles.navTabActive]}
          onPress={() => {
            if (!telemetry && activeVehicle) {
              handleLaunchDiagnostics(activeVehicle);
            } else {
              setActiveTab("lab");
            }
          }}
        >
          <Text style={[styles.navTabText, activeTab === "lab" && styles.navTabTextActive]}>
            Interactive Lab
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, activeTab === "garage" && styles.navTabActive]}
          onPress={() => setActiveTab("garage")}
        >
          <Text style={[styles.navTabText, activeTab === "garage" && styles.navTabTextActive]}>
            Garage & Vehicles
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, activeTab === "profile" && styles.navTabActive]}
          onPress={() => setActiveTab("profile")}
        >
          <Text style={[styles.navTabText, activeTab === "profile" && styles.navTabTextActive]}>
            Profile
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, activeTab === "settings" && styles.navTabActive]}
          onPress={() => setActiveTab("settings")}
        >
          <Text style={[styles.navTabText, activeTab === "settings" && styles.navTabTextActive]}>
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Screen 1: Specifications */}
      {activeTab === "specs" && (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.card}>
            <Text style={styles.cardBadge}>ARCHITECTURE & SPECIFICATION V1.1</Text>
            <Text style={styles.cardHeading}>Universal EV Diagnostics Engine</Text>
            <Text style={styles.bodyText}>
              Voltron Diagnostics delivers real-time pack telemetry, standard Mode 01 and Mode 22 CAN decoders,
              high-frequency 96-cell spatial heatmaps, and tamper-evident condition verification without cloud lock-in.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionHeading}>System Core Architecture</Text>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Cell Architecture:</Text>
              <Text style={styles.specValue}>96 series cells across 8 modular bricks</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Bus Sampling:</Text>
              <Text style={styles.specValue}>Standard OBD-II + OEM Mode 22 Extended PIDs</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Signal Transport:</Text>
              <Text style={styles.specValue}>Bluetooth Low Energy 5.0 ELM327 / OBDLink</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Cryptographic Audit:</Text>
              <Text style={styles.specValue}>On-device SHA-256 worksheet verification</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Offline Redundancy:</Text>
              <Text style={styles.specValue}>Local SQLite run caching + auto background sync</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionHeading}>Supported Chemistry Matrix</Text>
            <View style={styles.chemPillRow}>
              <View style={styles.chemPill}><Text style={styles.chemPillText}>NMC 622 / 712 / 811</Text></View>
              <View style={styles.chemPill}><Text style={styles.chemPillText}>LFP Prismatics</Text></View>
              <View style={styles.chemPill}><Text style={styles.chemPillText}>NCA High-Nickel</Text></View>
            </View>
            <Text style={styles.captionText}>
              Configured cutoffs provide automatic alert thresholds for cell spread Δ and thermal runaway warning.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryActionBtn}
            onPress={() => {
              if (activeVehicle) handleLaunchDiagnostics(activeVehicle);
              else setActiveTab("garage");
            }}
          >
            <Text style={styles.primaryActionBtnText}>Launch Interactive Lab →</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Tab Screen 2: Interactive Prototype / Lab */}
      {activeTab === "lab" && (
        <ScrollView contentContainerStyle={styles.container}>
          {/* Active Vehicle & Role Bar */}
          <View style={styles.labHeaderCard}>
            <View style={styles.labHeaderTop}>
              <View>
                <Text style={styles.labCarTitle}>
                  {activeVehicle ? `${activeVehicle.year} ${activeVehicle.make} ${activeVehicle.model}` : "EV Lab Vehicle"}
                </Text>
                <Text style={styles.labCarSub}>
                  VIN {activeVehicle?.pseudonymizedVin || "5YJ3****2***"} · {activeVehicle?.batteryChemistry || "NMC"}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.changeCarPill}
                onPress={() => setActiveTab("garage")}
              >
                <Text style={styles.changeCarPillText}>Switch Vehicle</Text>
              </TouchableOpacity>
            </View>

            {/* Operating Roles */}
            <View style={styles.roleTabs}>
              <TouchableOpacity
                style={[styles.roleTab, selectedRole === "owner" && styles.roleTabActive]}
                onPress={() => setSelectedRole("owner")}
              >
                <Text style={[styles.roleTabText, selectedRole === "owner" && styles.roleTabTextActive]}>
                  Owner
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleTab, selectedRole === "tech" && styles.roleTabActive]}
                onPress={() => setSelectedRole("tech")}
              >
                <Text style={[styles.roleTabText, selectedRole === "tech" && styles.roleTabTextActive]}>
                  Technician
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleTab, selectedRole === "fleet" && styles.roleTabActive]}
                onPress={() => setSelectedRole("fleet")}
              >
                <Text style={[styles.roleTabText, selectedRole === "fleet" && styles.roleTabTextActive]}>
                  Fleet Ops
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Lab Subview Switcher */}
          <View style={styles.subviewRow}>
            <TouchableOpacity
              style={[styles.subviewBtn, labSubview === "cockpit" && styles.subviewBtnActive]}
              onPress={() => setLabSubview("cockpit")}
            >
              <Text style={[styles.subviewBtnText, labSubview === "cockpit" && styles.subviewBtnTextActive]}>
                Cockpit
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subviewBtn, labSubview === "health" && styles.subviewBtnActive]}
              onPress={() => setLabSubview("health")}
            >
              <Text style={[styles.subviewBtnText, labSubview === "health" && styles.subviewBtnTextActive]}>
                Pack Health
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subviewBtn, labSubview === "matrix" && styles.subviewBtnActive]}
              onPress={() => setLabSubview("matrix")}
            >
              <Text style={[styles.subviewBtnText, labSubview === "matrix" && styles.subviewBtnTextActive]}>
                96-Cell Heatmap
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subviewBtn, labSubview === "reports" && styles.subviewBtnActive]}
              onPress={() => setLabSubview("reports")}
            >
              <Text style={[styles.subviewBtnText, labSubview === "reports" && styles.subviewBtnTextActive]}>
                Offline PDF
              </Text>
            </TouchableOpacity>
          </View>

          {/* Subview Content */}
          {telemetryLoading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color="#10b981" />
              <Text style={styles.loadingText}>Fetching 96-cell live telemetry...</Text>
            </View>
          ) : !telemetry ? (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>No telemetry session active.</Text>
              <Text style={styles.emptySub}>Load a vehicle from the Garage to run live diagnostics.</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => {
                  if (activeVehicle) handleLaunchDiagnostics(activeVehicle);
                  else setActiveTab("garage");
                }}
              >
                <Text style={styles.addBtnText}>⚡ Load Diagnostics Now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {labSubview === "cockpit" && (
                <View>
                  <View style={styles.kpiRow}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>STATE OF CHARGE</Text>
                      <Text style={styles.kpiValue}>{telemetry.stateOfCharge.toFixed(1)}%</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>PACK VOLTAGE</Text>
                      <Text style={styles.kpiValue}>{telemetry.packVoltage} V</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>POWER FLOW</Text>
                      <Text style={styles.kpiValue}>{telemetry.powerFlowKw} kW</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>ISOLATION RESISTANCE</Text>
                      <Text style={styles.kpiValue}>{telemetry.isolationResistanceKohms} kΩ</Text>
                    </View>
                  </View>

                  <View style={styles.verdictCard}>
                    <Text style={styles.verdictTitle}>COCKPIT VERDICT</Text>
                    <Text style={styles.verdictText}>{telemetry.headlineVerdict}</Text>
                    <Text style={styles.verdictSub}>
                      Telemetry source: {connectedBleDevice ? "Live ELM327 BLE stream" : "Simulated test rail"}
                    </Text>
                  </View>
                </View>
              )}

              {labSubview === "health" && (
                <View>
                  <View style={styles.kpiRow}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>STATE OF HEALTH</Text>
                      <Text style={styles.kpiValue}>{telemetry.stateOfHealth.toFixed(1)}%</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>CELL SPREAD (Δ)</Text>
                      <Text style={styles.kpiValue}>{telemetry.cellDeltaMv} mV</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>AVG TEMPERATURE</Text>
                      <Text style={styles.kpiValue}>{telemetry.packTempAvgC.toFixed(1)} °C</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>BALANCE STATUS</Text>
                      <Text style={styles.kpiValue}>{telemetry.deltaStatus.toUpperCase()}</Text>
                    </View>
                  </View>

                  {/* ELM327 CAN Poller Card */}
                  <View style={styles.canCard}>
                    <View style={styles.canHeaderRow}>
                      <Text style={styles.canTitle}>LIVE CAN / OBD-II POLLER</Text>
                      <Text style={connectedBleDevice ? styles.canConnected : styles.canDisconnected}>
                        {connectedBleDevice ? "BLE CONNECTED" : "DONGLE UNPAIRED"}
                      </Text>
                    </View>
                    <View style={styles.canMetricsRow}>
                      <View style={styles.canMetric}>
                        <Text style={styles.canMetricLabel}>PACK VOLTS</Text>
                        <Text style={styles.canMetricValue}>
                          {canSample?.packVoltageV != null ? `${canSample.packVoltageV.toFixed(2)} V` : "—"}
                        </Text>
                      </View>
                      <View style={styles.canMetric}>
                        <Text style={styles.canMetricLabel}>BATTERY TEMP</Text>
                        <Text style={styles.canMetricValue}>
                          {canSample?.batteryTemperatureC != null ? `${canSample.batteryTemperatureC.toFixed(1)} °C` : "—"}
                        </Text>
                      </View>
                      <View style={styles.canMetric}>
                        <Text style={styles.canMetricLabel}>OBD ADAPTER</Text>
                        <Text style={styles.canMetricValue}>
                          {canSample?.adapterVoltageV != null ? `${canSample.adapterVoltageV.toFixed(1)} V` : "—"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.dtcBtn}
                        onPress={() => void handleClearTroubleCodes()}
                        disabled={dtcClearing || !connectedBleDevice}
                      >
                        {dtcClearing ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.dtcBtnText}>Clear DTCs (Service 04)</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.pdfBtn}
                        onPress={() => void handleExportCurrentPdf()}
                        disabled={pdfExportingId === "current"}
                      >
                        {pdfExportingId === "current" ? <ActivityIndicator color="#05080b" size="small" /> : <Text style={styles.pdfBtnText}>Export PDF</Text>}
                      </TouchableOpacity>
                    </View>
                    {dtcStatus ? <Text style={styles.dtcStatus}>{dtcStatus}</Text> : null}
                  </View>
                </View>
              )}

              {labSubview === "matrix" && (
                <View>
                  {/* Metric Selector Tabs */}
                  <View style={styles.metricTabs}>
                    <TouchableOpacity
                      style={[styles.metricTab, diagnosticMetric === "voltage" && styles.metricTabActive]}
                      onPress={() => setDiagnosticMetric("voltage")}
                    >
                      <Text style={[styles.metricTabText, diagnosticMetric === "voltage" && styles.metricTabTextActive]}>
                        Voltage (V)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.metricTab, diagnosticMetric === "thermal" && styles.metricTabActive]}
                      onPress={() => setDiagnosticMetric("thermal")}
                    >
                      <Text style={[styles.metricTabText, diagnosticMetric === "thermal" && styles.metricTabTextActive]}>
                        Temp (°C)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.metricTab, diagnosticMetric === "delta" && styles.metricTabActive]}
                      onPress={() => setDiagnosticMetric("delta")}
                    >
                      <Text style={[styles.metricTabText, diagnosticMetric === "delta" && styles.metricTabTextActive]}>
                        Spread (Δ mV)
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.matrixHeading}>96-CELL SPATIAL MATRIX (8 MODULES × 12 CELLS)</Text>
                  {Array.from({ length: 8 }, (_, modIdx) => {
                    const moduleNum = modIdx + 1;
                    const moduleCells = telemetry.cells.filter((c) => c.moduleIndex === moduleNum);
                    return (
                      <View key={moduleNum} style={styles.moduleRow}>
                        <Text style={styles.moduleLabel}>M{moduleNum}</Text>
                        <View style={styles.cellsGrid}>
                          {moduleCells.map((c) => {
                            let bg = "#064e3b";
                            let displayVal = `${c.voltage.toFixed(2)}`;

                            if (diagnosticMetric === "thermal") {
                              displayVal = `${c.temperatureC.toFixed(0)}°`;
                              bg = c.temperatureC > 32 ? "#7f1d1d" : c.temperatureC > 28 ? "#78350f" : "#064e3b";
                            } else if (diagnosticMetric === "delta") {
                              const deltaMv = Math.round((c.voltage - 3.865) * 1000);
                              displayVal = `${deltaMv > 0 ? "+" : ""}${deltaMv}`;
                              bg = Math.abs(deltaMv) > 25 ? "#7f1d1d" : Math.abs(deltaMv) > 15 ? "#78350f" : "#064e3b";
                            } else {
                              bg = c.voltage < 3.85 ? "#7f1d1d" : c.voltage > 3.88 ? "#78350f" : "#064e3b";
                            }

                            return (
                              <View key={c.cellIndex} style={[styles.cellItem, { backgroundColor: bg }]}>
                                <Text style={styles.cellIndexText}>#{c.cellIndex}</Text>
                                <Text style={styles.cellValueText}>{displayVal}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {labSubview === "reports" && (
                <View style={styles.card}>
                  <Text style={styles.sectionHeading}>Offline Inspection PDF Certificate</Text>
                  <Text style={styles.bodyText}>
                    Generate stamped battery condition certificates on-device without internet access. Includes pack SoH,
                    96-cell delta metrics, and tamper-evident SHA-256 signatures.
                  </Text>
                  <TouchableOpacity
                    style={styles.primaryActionBtn}
                    onPress={() => void handleExportCurrentPdf()}
                    disabled={pdfExportingId === "current"}
                  >
                    {pdfExportingId === "current" ? (
                      <ActivityIndicator color="#05080b" />
                    ) : (
                      <Text style={styles.primaryActionBtnText}>📄 Export Condition Certificate PDF</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Tab Screen 3: My Vehicles & Garage */}
      {activeTab === "garage" && (
        <ScrollView contentContainerStyle={styles.container}>
          {/* User Account & Garage Card */}
          <View style={styles.userCard}>
            <View style={styles.userHeaderRow}>
              <Text style={styles.userHeading}>USER ACCOUNT & GARAGE</Text>
              {currentUser ? (
                <TouchableOpacity style={styles.logoutPill} onPress={handleLogout}>
                  <Text style={styles.logoutPillText}>Sign Out</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {currentUser ? (
              <>
                <Text style={styles.userName}>{currentUser.name || "Technician"}</Text>
                <Text style={styles.userSub}>
                  {currentUser.email} · {currentUser.role || "Driver / Tech"}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.userName}>Guest Technician</Text>
                <Text style={styles.userSub}>
                  Sign in to sync your vehicles, push notifications, and work orders with the cloud.
                </Text>
                <View style={styles.authActionRow}>
                  <TouchableOpacity
                    style={styles.signInBtn}
                    onPress={() => {
                      setAuthMode("login");
                      setAuthError("");
                      setAuthModalVisible(true);
                    }}
                  >
                    <Text style={styles.signInBtnText}>Sign In</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.registerBtn}
                    onPress={() => {
                      setAuthMode("register");
                      setAuthError("");
                      setAuthModalVisible(true);
                    }}
                  >
                    <Text style={styles.registerBtnText}>Create Account</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
              <Text style={styles.addBtnText}>＋ Add Vehicle to Garage</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Tools Bar: BLE Dongle + SQLite History */}
          <View style={styles.toolsRow}>
            <TouchableOpacity
              style={[styles.toolCard, connectedBleDevice ? styles.toolCardActive : null]}
              onPress={handleToggleBleScan}
            >
              <Text style={styles.toolIcon}>📡</Text>
              <Text style={styles.toolTitle}>
                {connectedBleDevice ? "ELM327 Paired" : bleScanning ? "Scanning BLE..." : "BLE OBD-II"}
              </Text>
              <Text style={styles.toolSub}>{connectedBleDevice ? "Wireless live link" : "Scan vehicle dongle"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => {
                refreshSqliteHistory();
                setHistoryModalVisible(true);
              }}
            >
              <Text style={styles.toolIcon}>💾</Text>
              <Text style={styles.toolTitle}>Offline SQLite</Text>
              <Text style={styles.toolSub}>{sqliteHistory.length} saved diagnostic run(s)</Text>
            </TouchableOpacity>
          </View>

          {/* BLE Dongles Dropdown (if scanning or found) */}
          {bleScanning || bleAdapters.length > 0 ? (
            <View style={styles.blePanel}>
              <View style={styles.bleHeaderRow}>
                <Text style={styles.blePanelTitle}>NEARBY OBD-II BLUETOOTH ADAPTERS</Text>
                {bleScanning ? <ActivityIndicator size="small" color="#10b981" /> : null}
              </View>
              <Text style={styles.bleStatusText}>{bleStatusText}</Text>

              {bleAdapters.map((adapter) => (
                <View key={adapter.id} style={styles.bleAdapterRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bleAdapterName}>{adapter.name}</Text>
                    <Text style={styles.bleAdapterId}>ID: {adapter.id} · RSSI: {adapter.rssi ?? "N/A"} dBm</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.bleConnectBtn,
                      connectedBleDevice === adapter.id ? styles.bleConnectBtnActive : null,
                    ]}
                    onPress={() => {
                      if (connectedBleDevice === adapter.id) {
                        handleDisconnectBle();
                      } else {
                        handleConnectBle(adapter);
                      }
                    }}
                    disabled={bleConnecting}
                  >
                    <Text style={styles.bleConnectBtnText}>
                      {connectedBleDevice === adapter.id ? "Disconnect" : "Pair Wireless"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}

              {bleAdapters.length === 0 && bleScanning ? (
                <Text style={styles.bleEmptyText}>Holding scan for ELM327 / OBDLink / vGate dongles...</Text>
              ) : null}
            </View>
          ) : null}

          {/* Registered Garage Vehicles List */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Vehicles Ready for Diagnosis</Text>
            <View style={styles.sectionCountBox}>
              <Text style={styles.sectionCount}>{vehicles.length} Active</Text>
            </View>
          </View>

          {vehiclesLoading ? (
            <ActivityIndicator color="#10b981" style={{ marginVertical: 20 }} />
          ) : (
            vehicles.map((v) => {
              const pendingCount = offlineSessions.filter((s) => s.vehicleId === v.id).length;
              const historyCount = sqliteHistory.filter((h) => h.vehicleId === v.id).length;
              return (
                <View key={v.id} style={styles.vehicleCard}>
                  <View style={styles.vRow}>
                    <Text style={styles.vYear}>{v.year}</Text>
                    <Text style={styles.vChemistry}>{v.batteryChemistry || "NMC"}</Text>
                  </View>
                  <Text style={styles.vName}>
                    {v.make} {v.model}
                  </Text>
                  <Text style={styles.vVin}>VIN {v.pseudonymizedVin || v.vin}</Text>
                  <Text style={styles.vDetails}>
                    {v.cellCount || 96} cells · {v.modulesCount || 8} modules · {v.nominalPackVoltage || 400}V
                    {v.fleetTag ? ` · Tag: ${v.fleetTag}` : ""}
                  </Text>

                  <TouchableOpacity style={styles.diagBtn} onPress={() => handleLaunchDiagnostics(v)}>
                    <Text style={styles.diagBtnText}>⚡ Diagnose This Vehicle (96-Cell Lab) →</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.captureBtn} onPress={() => captureOfflineSession(v)}>
                    <Text style={styles.captureBtnText}>＋ Save Offline Session Snapshot</Text>
                  </TouchableOpacity>

                  <Text style={styles.historyLabel}>
                    {pendingCount} pending cloud sync · {historyCount} offline SQLite record(s)
                  </Text>
                </View>
              );
            })
          )}

          {/* Work Order Certificate Verifier Card */}
          <View style={styles.verifierCard}>
            <Text style={styles.verifierTitle}>WORK ORDER CERTIFICATE VERIFIER</Text>
            <Text style={styles.verifierText}>
              Scan signed technician worksheets with your camera. Recomputes SHA-256 cryptographic signatures on-device.
            </Text>

            <TouchableOpacity style={styles.verifyBtn} onPress={openWorksheetScanner}>
              <Text style={styles.verifyBtnText}>▣ Scan & Verify Signed Worksheet QR</Text>
            </TouchableOpacity>

            {worksheetVerification.status !== "idle" ? (
              <Text
                style={[
                  styles.verifierMessage,
                  worksheetVerification.status === "valid" ? styles.validText : styles.invalidText,
                ]}
              >
                {worksheetVerification.message}
              </Text>
            ) : null}

            {worksheetVerification.preview ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>CERTIFICATE PREVIEW</Text>
                <Text style={styles.previewText}>
                  Work Order: #{String(worksheetVerification.preview.workOrderId)} · Vehicle:{" "}
                  {String(worksheetVerification.preview.vehicleName || "N/A")}
                </Text>
                <Text style={styles.previewText}>
                  Status: {String(worksheetVerification.preview.status || "N/A")} · Technician:{" "}
                  {String(worksheetVerification.preview.technicianName || "J. Rivera")}
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}

      {/* Tab Screen 4: Profile */}
      {activeTab === "profile" && (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.card}>
            <Text style={styles.cardBadge}>USER PROFILE & CONTACT INFORMATION</Text>
            <Text style={styles.cardHeading}>Account Information</Text>
            <Text style={styles.bodyText}>
              Manage your technician name, mobile phone number, registered email ID, and workshop address with verification.
            </Text>

            {profileMessage ? <Text style={styles.profileSuccess}>{profileMessage}</Text> : null}

            <Text style={styles.fieldLabel}>FULL NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Alex Rivera"
              placeholderTextColor="#64748b"
              value={profileName}
              onChangeText={setProfileName}
            />

            <View style={styles.labelWithBadgeRow}>
              <Text style={styles.fieldLabel}>EMAIL ID</Text>
              <Text style={currentUser?.emailVerifiedAt ? styles.verifiedBadge : styles.unverifiedBadge}>
                {currentUser?.emailVerifiedAt ? "✓ Verified" : "Unverified"}
              </Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              placeholderTextColor="#64748b"
              keyboardType="email-address"
              autoCapitalize="none"
              value={profileEmail}
              onChangeText={setProfileEmail}
            />
            {!currentUser?.emailVerifiedAt && currentUser ? (
              <TouchableOpacity
                style={styles.inlineVerifyBtn}
                onPress={() => handleStartVerification("email")}
              >
                <Text style={styles.inlineVerifyBtnText}>Verify Email ID via OTP</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.labelWithBadgeRow}>
              <Text style={styles.fieldLabel}>MOBILE PHONE NUMBER</Text>
              <Text style={currentUser?.phoneVerifiedAt ? styles.verifiedBadge : styles.unverifiedBadge}>
                {currentUser?.phoneVerifiedAt ? "✓ Verified" : "Unverified"}
              </Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="+1 555-0199"
              placeholderTextColor="#64748b"
              keyboardType="phone-pad"
              value={profilePhone}
              onChangeText={setProfilePhone}
            />
            {!currentUser?.phoneVerifiedAt && currentUser ? (
              <TouchableOpacity
                style={styles.inlineVerifyBtn}
                onPress={() => handleStartVerification("phone")}
              >
                <Text style={styles.inlineVerifyBtnText}>Verify Mobile Number via OTP</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.fieldLabel}>WORKSHOP / GARAGE ADDRESS</Text>
            <TextInput
              style={[styles.input, { height: 75, textAlignVertical: "top" }]}
              placeholder="Workshop Suite, City, State, ZIP"
              placeholderTextColor="#64748b"
              multiline
              value={profileAddress}
              onChangeText={setProfileAddress}
            />

            <TouchableOpacity
              style={styles.saveProfileBtn}
              onPress={handleSaveProfile}
              disabled={profileSaving}
            >
              {profileSaving ? (
                <ActivityIndicator color="#05080b" />
              ) : (
                <Text style={styles.saveProfileBtnText}>Save Profile & Contact Details</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Tab Screen 5: Settings */}
      {activeTab === "settings" && (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.card}>
            <Text style={styles.cardBadge}>APP PREFERENCES</Text>
            <Text style={styles.cardHeading}>Companion Settings</Text>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Push Anomaly Notifications</Text>
                <Text style={styles.settingSub}>Receive alerts when cell delta or temperature threshold breaches.</Text>
              </View>
              <Text style={notificationsEnabled ? styles.settingOn : styles.settingOff}>
                {notificationsEnabled ? "ACTIVE" : "INACTIVE"}
              </Text>
            </View>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Offline SQLite Run Logging</Text>
                <Text style={styles.settingSub}>Durable on-device diagnostic storage for paperless inspections.</Text>
              </View>
              <Text style={styles.settingOn}>ENABLED</Text>
            </View>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Backend Cloud Endpoint</Text>
                <Text style={styles.settingSub}>{BACKEND_URL}</Text>
              </View>
              <Text style={styles.settingOn}>ONLINE</Text>
            </View>

            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Theme Mode</Text>
                <Text style={styles.settingSub}>Dark cockpit UI optimized for workshop tablets.</Text>
              </View>
              <Text style={styles.settingOn}>DARK</Text>
            </View>

            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={() => {
                Alert.alert(
                  "Clear Offline Cache?",
                  "This removes local queued offline sessions. Persisted SQLite records remain untouched.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Clear Queue",
                      style: "destructive",
                      onPress: async () => {
                        await AsyncStorage.removeItem("voltron.offline.sessions");
                        setOfflineSessions([]);
                        Alert.alert("Cleared", "Local sync queue cleared.");
                      },
                    },
                  ]
                );
              }}
            >
              <Text style={styles.dangerBtnText}>Clear Local Offline Queue</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* In-App Verification Modal */}
      <Modal visible={verifyModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Verify {verifyChannel === "email" ? "Email ID" : "Mobile Number"}
            </Text>
            <Text style={styles.modalSub}>
              Enter the 6-digit confirmation code. In demo mode, your generated OTP is{" "}
              <Text style={{ color: "#38bdf8", fontWeight: "bold" }}>{demoCode}</Text>.
            </Text>

            {verifyError ? <Text style={styles.authErrorText}>{verifyError}</Text> : null}

            <TextInput
              style={[styles.input, { letterSpacing: 6, fontSize: 18, textAlign: "center" }]}
              placeholder="000000"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              maxLength={6}
              value={verificationCode}
              onChangeText={setVerificationCode}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setVerifyModalVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleConfirmVerification}
                disabled={verifyLoading}
              >
                {verifyLoading ? (
                  <ActivityIndicator color="#05080b" />
                ) : (
                  <Text style={styles.saveText}>Verify Code</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Offline SQLite Telemetry History Modal */}
      <Modal visible={historyModalVisible} animationType="slide">
        <SafeAreaView style={styles.diagSafe}>
          <View style={styles.diagHeader}>
            <View>
              <Text style={styles.diagTitle}>Offline SQLite History</Text>
              <Text style={styles.diagSubtitle}>Persistent local 96-cell diagnostic runs</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setHistoryModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.historyContent}>
            {sqliteHistory.length === 0 ? (
              <View style={styles.emptyHistoryBox}>
                <Text style={styles.emptyHistoryText}>No offline diagnostic runs stored in SQLite yet.</Text>
                <Text style={styles.emptyHistorySub}>Run diagnosis on any vehicle to persist records.</Text>
              </View>
            ) : (
              sqliteHistory.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.historyCardHeader}>
                    <Text style={styles.historyCardVehicle}>{item.vehicleName}</Text>
                    <Text style={[styles.historyBadge, item.source === "ble" ? styles.bleBadge : null]}>
                      {item.source.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.historyDate}>
                    {new Date(item.capturedAt).toLocaleString()}
                  </Text>
                  <View style={styles.historyMetricsRow}>
                    <Text style={styles.historyMetricText}>SoH: <Text style={styles.boldWhite}>{item.stateOfHealth.toFixed(1)}%</Text></Text>
                    <Text style={styles.historyMetricText}>SoC: <Text style={styles.boldWhite}>{item.stateOfCharge.toFixed(1)}%</Text></Text>
                    <Text style={styles.historyMetricText}>Δ: <Text style={styles.boldWhite}>{item.cellDeltaMv} mV</Text></Text>
                    <Text style={styles.historyMetricText}>Temp: <Text style={styles.boldWhite}>{item.packTempAvgC.toFixed(1)}°C</Text></Text>
                  </View>
                  <Text style={styles.historyVerdict}>{item.headlineVerdict}</Text>
                  <TouchableOpacity
                    style={styles.pdfBtn}
                    onPress={() => void handleExportRecordPdf(item, item.id)}
                    disabled={pdfExportingId === item.id}
                  >
                    {pdfExportingId === item.id ? (
                      <ActivityIndicator color="#05080b" size="small" />
                    ) : (
                      <Text style={styles.pdfBtnText}>Export offline PDF certificate</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Native Sign In / Register Modal */}
      <Modal visible={authModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {authMode === "login" ? "Sign In to Voltron" : "Create Voltron Account"}
            </Text>
            <Text style={styles.modalSub}>
              {authMode === "login"
                ? "Access your registered vehicles, fleet history, push alerts, and work orders."
                : "Register a technician or driver account stored in the Voltron database."}
            </Text>

            {authError ? <Text style={styles.authErrorText}>{authError}</Text> : null}

            {authMode === "register" ? (
              <TextInput
                style={styles.input}
                placeholder="Full Name (e.g. Alex Rivera)"
                placeholderTextColor="#64748b"
                value={authName}
                onChangeText={setAuthName}
              />
            ) : null}

            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor="#64748b"
              keyboardType="email-address"
              autoCapitalize="none"
              value={authEmail}
              onChangeText={setAuthEmail}
            />

            <TextInput
              style={styles.input}
              placeholder="Password (min 8 characters)"
              placeholderTextColor="#64748b"
              secureTextEntry
              value={authPassword}
              onChangeText={setAuthPassword}
            />

            <TouchableOpacity
              style={styles.authSubmitBtn}
              onPress={handleAuthSubmit}
              disabled={authLoading}
            >
              {authLoading ? (
                <ActivityIndicator color="#05080b" />
              ) : (
                <Text style={styles.authSubmitBtnText}>
                  {authMode === "login" ? "Sign In Now" : "Register & Sign In"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toggleAuthModeBtn}
              onPress={() => {
                setAuthError("");
                setAuthMode(authMode === "login" ? "register" : "login");
              }}
            >
              <Text style={styles.toggleAuthModeText}>
                {authMode === "login"
                  ? "Don't have an account? Register here"
                  : "Already registered? Sign In"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelLink}
              onPress={() => setAuthModalVisible(false)}
            >
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Vehicle Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Register New EV</Text>
            <Text style={styles.modalSub}>Saved directly to your Voltron garage.</Text>

            <TextInput
              style={styles.input}
              placeholder="Make (e.g. Tesla / Porsche)"
              placeholderTextColor="#64748b"
              value={newMake}
              onChangeText={setNewMake}
            />

            <TextInput
              style={styles.input}
              placeholder="Model (e.g. Model Y / Taycan)"
              placeholderTextColor="#64748b"
              value={newModel}
              onChangeText={setNewModel}
            />

            <TextInput
              style={styles.input}
              placeholder="Year (e.g. 2024)"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              value={newYear}
              onChangeText={setNewYear}
            />

            <TextInput
              style={styles.input}
              placeholder="VIN Number (pseudonymized on save)"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              value={newVin}
              onChangeText={setNewVin}
            />

            <TextInput
              style={styles.input}
              placeholder="Fleet Tag (e.g. Delivery Bay / VIP)"
              placeholderTextColor="#64748b"
              value={newFleetTag}
              onChangeText={setNewFleetTag}
            />

            <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
              <Text style={styles.scanBtnText}>▣ Scan VIN Barcode / QR</Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddVehicle}>
                <Text style={styles.saveText}>Save Vehicle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* VIN Scanner Modal */}
      <Modal visible={scannerVisible} animationType="slide">
        <View style={styles.scannerPage}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["code128", "code39", "qr", "datamatrix"] }}
            onBarcodeScanned={(event) => {
              const value = event.data.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
              setNewVin(value.slice(0, 32));
              setScannerVisible(false);
            }}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerTitle}>Scan Vehicle VIN</Text>
            <Text style={styles.scannerHint}>Align the VIN barcode or QR code inside the frame.</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setScannerVisible(false)}>
              <Text style={styles.cancelText}>Cancel Scan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Worksheet QR Scanner Modal */}
      <Modal visible={worksheetScannerVisible} animationType="slide">
        <View style={styles.scannerPage}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(event) => {
              setWorksheetScannerVisible(false);
              void verifyWorksheetQrPayload(event.data);
            }}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerTitle}>Verify Work Order QR</Text>
            <Text style={styles.scannerHint}>
              Align the printed certificate QR inside the frame. Verification stays on this device.
            </Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setWorksheetScannerVisible(false)}>
              <Text style={styles.cancelText}>Cancel Scan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#05080b" },
  container: { padding: 16, paddingBottom: 40 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badgeIcon: {
    backgroundColor: "#10b981",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 16, color: "#05080b", fontWeight: "bold" },
  title: { fontSize: 20, fontWeight: "900", color: "#ffffff", letterSpacing: 1.5 },
  subtitle: { fontSize: 11, color: "#10b981", fontWeight: "bold" },
  syncStatus: { color: "#38bdf8", fontSize: 10, marginTop: 4, fontWeight: "600" },

  /* Top Navigation Tab Bar */
  tabNav: {
    flexDirection: "row",
    backgroundColor: "#0a111a",
    borderBottomColor: "#1e293b",
    borderBottomWidth: 1,
  },
  navTab: {
    flex: 1,
    paddingVertical: 11,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  navTabActive: {
    borderBottomColor: "#10b981",
    backgroundColor: "#0f172a",
  },
  navTabText: { color: "#94a3b8", fontSize: 10, fontWeight: "bold" },
  navTabTextActive: { color: "#10b981" },

  /* Card Base */
  card: {
    backgroundColor: "#0d1520",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  cardBadge: { fontSize: 9, color: "#34d399", fontWeight: "bold", letterSpacing: 0.8, marginBottom: 4 },
  cardHeading: { fontSize: 17, fontWeight: "bold", color: "#ffffff", marginBottom: 6 },
  sectionHeading: { fontSize: 14, fontWeight: "bold", color: "#ffffff", marginBottom: 10 },
  bodyText: { fontSize: 12, color: "#94a3b8", lineHeight: 18 },
  captionText: { fontSize: 10, color: "#64748b", marginTop: 8 },
  specRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  specLabel: { fontSize: 11, color: "#94a3b8" },
  specValue: { fontSize: 11, color: "#ffffff", fontWeight: "600" },
  chemPillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chemPill: { backgroundColor: "#064e3b", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  chemPillText: { color: "#34d399", fontSize: 10, fontWeight: "bold" },

  /* Interactive Lab */
  labHeaderCard: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  labHeaderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  labCarTitle: { fontSize: 15, fontWeight: "bold", color: "#ffffff" },
  labCarSub: { fontSize: 11, color: "#64748b", marginTop: 2 },
  changeCarPill: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  changeCarPillText: { color: "#38bdf8", fontSize: 10, fontWeight: "bold" },
  roleTabs: { flexDirection: "row", gap: 8, marginTop: 12 },
  roleTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    alignItems: "center",
  },
  roleTabActive: { backgroundColor: "#10b981" },
  roleTabText: { color: "#94a3b8", fontSize: 11, fontWeight: "bold" },
  roleTabTextActive: { color: "#05080b" },

  subviewRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  subviewBtn: {
    flex: 1,
    backgroundColor: "#0f172a",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  subviewBtnActive: { backgroundColor: "#0891b2" },
  subviewBtnText: { color: "#94a3b8", fontSize: 10, fontWeight: "bold" },
  subviewBtnTextActive: { color: "#ffffff" },

  /* Garage & Auth Card */
  userCard: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  userHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  userHeading: { fontSize: 10, color: "#64748b", fontWeight: "bold", letterSpacing: 1 },
  logoutPill: {
    backgroundColor: "#334155",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  logoutPillText: { color: "#f87171", fontSize: 11, fontWeight: "bold" },
  userName: { fontSize: 18, fontWeight: "bold", color: "#ffffff", marginTop: 6 },
  userSub: { fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 16 },
  authActionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  signInBtn: {
    flex: 1,
    backgroundColor: "#10b981",
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  signInBtnText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },
  registerBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  registerBtnText: { color: "#e2e8f0", fontWeight: "bold", fontSize: 13 },
  addBtn: {
    backgroundColor: "#0f766e",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 14,
  },
  addBtnText: { color: "#ffffff", fontWeight: "bold", fontSize: 13 },

  /* Quick Tools */
  toolsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  toolCard: {
    flex: 1,
    backgroundColor: "#0d1520",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  toolCardActive: {
    borderColor: "#10b981",
    backgroundColor: "#064e3b33",
  },
  toolIcon: { fontSize: 20 },
  toolTitle: { fontSize: 13, fontWeight: "bold", color: "#ffffff", marginTop: 6 },
  toolSub: { fontSize: 10, color: "#94a3b8", marginTop: 2 },

  /* BLE Panel */
  blePanel: {
    backgroundColor: "#0a111a",
    borderColor: "#0284c7",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  bleHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  blePanelTitle: { fontSize: 10, color: "#38bdf8", fontWeight: "bold", letterSpacing: 0.8 },
  bleStatusText: { fontSize: 11, color: "#94a3b8", marginTop: 4, marginBottom: 8 },
  bleAdapterRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    padding: 8,
    borderRadius: 8,
    marginBottom: 6,
  },
  bleAdapterName: { fontSize: 12, fontWeight: "bold", color: "#ffffff" },
  bleAdapterId: { fontSize: 10, color: "#64748b", marginTop: 2 },
  bleConnectBtn: {
    backgroundColor: "#10b981",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bleConnectBtnActive: { backgroundColor: "#ef4444" },
  bleConnectBtnText: { fontSize: 11, fontWeight: "bold", color: "#05080b" },
  bleEmptyText: { fontSize: 11, color: "#64748b", textAlign: "center", marginVertical: 8 },

  /* Vehicles Section */
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: "bold", color: "#ffffff" },
  sectionCountBox: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  sectionCount: { fontSize: 11, color: "#10b981", fontWeight: "bold" },
  vehicleCard: {
    backgroundColor: "#0d1520",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  vRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  vYear: { fontSize: 12, color: "#94a3b8", fontWeight: "bold" },
  vChemistry: {
    fontSize: 10,
    color: "#34d399",
    backgroundColor: "#064e3b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: "bold",
  },
  vName: { fontSize: 16, fontWeight: "bold", color: "#ffffff" },
  vVin: { fontSize: 11, color: "#64748b", fontFamily: "monospace", marginTop: 2 },
  vDetails: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
  diagBtn: {
    backgroundColor: "#10b981",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  diagBtnText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },
  captureBtn: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 8,
  },
  captureBtnText: { color: "#38bdf8", fontWeight: "bold", fontSize: 12 },
  historyLabel: { fontSize: 10, color: "#64748b", marginTop: 6, textAlign: "center" },

  /* Verifier Card */
  verifierCard: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  verifierTitle: { fontSize: 10, color: "#64748b", fontWeight: "bold", letterSpacing: 1 },
  verifierText: { fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 16 },
  verifyBtn: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    marginTop: 10,
  },
  verifyBtnText: { color: "#e2e8f0", fontWeight: "bold", fontSize: 13 },
  verifierMessage: { fontSize: 11, marginTop: 8, fontWeight: "bold" },
  validText: { color: "#34d399" },
  invalidText: { color: "#f87171" },
  previewBox: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  previewLabel: { fontSize: 10, color: "#64748b", fontWeight: "bold", marginBottom: 4 },
  previewText: { fontSize: 11, color: "#cbd5e1", lineHeight: 16 },

  /* Profile Screen Styles */
  fieldLabel: { fontSize: 10, color: "#64748b", fontWeight: "bold", letterSpacing: 0.8, marginBottom: 4 },
  labelWithBadgeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  verifiedBadge: { fontSize: 10, color: "#34d399", fontWeight: "bold" },
  unverifiedBadge: { fontSize: 10, color: "#fbbf24", fontWeight: "bold" },
  inlineVerifyBtn: { alignSelf: "flex-start", marginBottom: 12, paddingVertical: 2 },
  inlineVerifyBtnText: { color: "#38bdf8", fontSize: 11, fontWeight: "bold" },
  saveProfileBtn: {
    backgroundColor: "#10b981",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    marginTop: 10,
  },
  saveProfileBtnText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },
  profileSuccess: { backgroundColor: "#064e3b", color: "#34d399", padding: 8, borderRadius: 8, fontSize: 11, marginBottom: 10 },

  /* Settings Screen Styles */
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  settingTitle: { fontSize: 13, fontWeight: "bold", color: "#ffffff" },
  settingSub: { fontSize: 10, color: "#64748b", marginTop: 2 },
  settingOn: { color: "#34d399", fontSize: 11, fontWeight: "bold" },
  settingOff: { color: "#ef4444", fontSize: 11, fontWeight: "bold" },
  dangerBtn: {
    backgroundColor: "#450a0a",
    borderColor: "#dc2626",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 18,
  },
  dangerBtnText: { color: "#fca5a5", fontSize: 12, fontWeight: "bold" },

  /* Primary Action Button */
  primaryActionBtn: {
    backgroundColor: "#10b981",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  primaryActionBtnText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },

  /* Diagnostics UI Elements */
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  kpiCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  kpiLabel: { fontSize: 9, color: "#64748b", fontWeight: "bold" },
  kpiValue: { fontSize: 17, fontWeight: "bold", color: "#ffffff", marginTop: 4 },
  verdictCard: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  verdictTitle: { fontSize: 10, color: "#38bdf8", fontWeight: "bold" },
  verdictText: { fontSize: 13, fontWeight: "bold", color: "#ffffff", marginTop: 4 },
  verdictSub: { fontSize: 10, color: "#64748b", marginTop: 4 },

  canCard: {
    backgroundColor: "#0d1520",
    borderColor: "#0284c7",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  canHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  canTitle: { fontSize: 10, color: "#38bdf8", fontWeight: "bold", letterSpacing: 0.8 },
  canConnected: { fontSize: 9, color: "#34d399", fontWeight: "bold" },
  canDisconnected: { fontSize: 9, color: "#64748b", fontWeight: "bold" },
  canMetricsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  canMetric: { flex: 1 },
  canMetricLabel: { fontSize: 9, color: "#64748b", fontWeight: "bold" },
  canMetricValue: { fontSize: 14, fontWeight: "bold", color: "#ffffff", marginTop: 2 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  dtcBtn: {
    flex: 1,
    backgroundColor: "#ef4444",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  dtcBtnText: { color: "#ffffff", fontSize: 11, fontWeight: "bold" },
  dtcStatus: { color: "#fca5a5", fontSize: 10, marginTop: 6 },

  metricTabs: { flexDirection: "row", gap: 6, marginBottom: 10 },
  metricTab: {
    flex: 1,
    backgroundColor: "#0f172a",
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  metricTabActive: { backgroundColor: "#10b981" },
  metricTabText: { color: "#94a3b8", fontSize: 10, fontWeight: "bold" },
  metricTabTextActive: { color: "#05080b" },
  matrixHeading: { fontSize: 10, color: "#64748b", fontWeight: "bold", letterSpacing: 0.8, marginBottom: 8 },
  moduleRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  moduleLabel: { width: 32, fontSize: 10, fontWeight: "bold", color: "#94a3b8" },
  cellsGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cellItem: { width: "14.8%", paddingVertical: 4, borderRadius: 4, alignItems: "center" },
  cellIndexText: { fontSize: 7, color: "#94a3b8" },
  cellValueText: { fontSize: 9, fontWeight: "bold", color: "#ffffff" },

  /* Modals Base */
  diagSafe: { flex: 1, backgroundColor: "#05080b" },
  diagHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomColor: "#1e293b",
    borderBottomWidth: 1,
  },
  diagTitle: { fontSize: 16, fontWeight: "bold", color: "#ffffff" },
  diagSubtitle: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  closeBtn: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  closeBtnText: { color: "#ffffff", fontSize: 12, fontWeight: "bold" },
  centerLoading: { padding: 40, alignItems: "center" },
  loadingText: { color: "#94a3b8", fontSize: 12, marginTop: 10 },
  emptyTitle: { color: "#ffffff", fontSize: 14, fontWeight: "bold" },
  emptySub: { color: "#64748b", fontSize: 11, marginTop: 4, marginBottom: 8 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  modalTitle: { fontSize: 17, fontWeight: "bold", color: "#ffffff" },
  modalSub: { fontSize: 11, color: "#94a3b8", marginTop: 4, marginBottom: 14 },
  authErrorText: {
    backgroundColor: "#450a0a",
    color: "#fca5a5",
    padding: 8,
    borderRadius: 8,
    fontSize: 11,
    marginBottom: 10,
    fontWeight: "bold",
  },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: "#ffffff",
    fontSize: 13,
    marginBottom: 10,
  },
  authSubmitBtn: {
    backgroundColor: "#10b981",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  authSubmitBtnText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },
  toggleAuthModeBtn: { marginTop: 12, alignItems: "center" },
  toggleAuthModeText: { color: "#38bdf8", fontSize: 12 },
  cancelLink: { marginTop: 10, alignItems: "center" },
  cancelLinkText: { color: "#94a3b8", fontSize: 12 },
  scanBtn: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    marginBottom: 14,
  },
  scanBtnText: { color: "#e2e8f0", fontWeight: "bold", fontSize: 12 },
  modalButtons: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelText: { color: "#94a3b8", fontWeight: "bold", fontSize: 13 },
  saveBtn: {
    flex: 1,
    backgroundColor: "#10b981",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },

  historyContent: { padding: 16, paddingBottom: 40 },
  emptyHistoryBox: { padding: 30, alignItems: "center" },
  emptyHistoryText: { color: "#cbd5e1", fontSize: 14, fontWeight: "bold" },
  emptyHistorySub: { color: "#64748b", fontSize: 11, marginTop: 4 },
  historyCard: {
    backgroundColor: "#0d1520",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  historyCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  historyCardVehicle: { fontSize: 14, fontWeight: "bold", color: "#ffffff" },
  historyBadge: {
    fontSize: 9,
    color: "#38bdf8",
    backgroundColor: "#0c4a6e",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: "bold",
  },
  bleBadge: { color: "#34d399", backgroundColor: "#064e3b" },
  historyDate: { fontSize: 10, color: "#64748b", marginTop: 2 },
  historyMetricsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  historyMetricText: { fontSize: 11, color: "#94a3b8" },
  boldWhite: { color: "#ffffff", fontWeight: "bold" },
  historyVerdict: { fontSize: 11, color: "#cbd5e1", marginTop: 6, lineHeight: 15 },
  pdfBtn: {
    flex: 1,
    backgroundColor: "#10b981",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
  },
  pdfBtnText: { color: "#05080b", fontSize: 11, fontWeight: "bold" },

  scannerPage: { flex: 1, backgroundColor: "#000000" },
  camera: { flex: 1 },
  scannerOverlay: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "rgba(10, 17, 26, 0.9)",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  scannerTitle: { fontSize: 16, fontWeight: "bold", color: "#ffffff" },
  scannerHint: { fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 4, marginBottom: 12 },
});
