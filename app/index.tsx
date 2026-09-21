import React, { useEffect, useState } from "react";
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
  Linking,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { BACKEND_URL } from "../lib/trpc";
import { registerVoltronBackgroundSync, SyncStatus } from "../lib/backgroundSync";

type OfflineSession = {
  id: string;
  vehicleId: number;
  createdAt: string;
  stateOfHealth: number | null;
  cellDeltaMv: number | null;
  syncState: "queued";
};

export default function MobileHomeScreen() {
  const [vehicles, setVehicles] = useState([
    {
      id: 1,
      make: "Tesla",
      model: "Model 3 Long Range",
      year: 2023,
      vin: "5YJ3E1EB*PF892***",
      chemistry: "NMC 712",
      voltage: "400V",
    },
    {
      id: 2,
      make: "Hyundai",
      model: "Ioniq 5 AWD",
      year: 2024,
      vin: "KM8K13AG*PU109***",
      chemistry: "NMC 811",
      voltage: "800V",
    },
  ]);

  const [modalVisible, setModalVisible] = useState(false);
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newVin, setNewVin] = useState("");
  const [newYear, setNewYear] = useState("2024");
  const [scannerVisible, setScannerVisible] = useState(false);
  const [worksheetScannerVisible, setWorksheetScannerVisible] = useState(false);
  const [worksheetVerification, setWorksheetVerification] = useState<{ status: "idle" | "valid" | "invalid" | "error"; message: string; preview: Record<string, unknown> | null }>({ status: "idle", message: "", preview: null });
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [offlineSessions, setOfflineSessions] = useState<OfflineSession[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: "idle", uploaded: 0, total: 0, updatedAt: new Date().toISOString() });

  useEffect(() => {
    AsyncStorage.getItem("voltron.offline.sessions").then((value) => {
      if (value) setOfflineSessions(JSON.parse(value));
    });

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
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem("voltron.offline.sessions", JSON.stringify(offlineSessions));
  }, [offlineSessions]);

  const handleAddVehicle = () => {
    if (!newMake || !newModel || !newVin) return;
    const cleanVin = newVin.trim().toUpperCase();
    const pseudo =
      cleanVin.length >= 8
        ? `${cleanVin.slice(0, 4)}****${cleanVin.slice(-4)}`
        : `${cleanVin}****`;

    setVehicles((prev) => [
      {
        id: Date.now(),
        make: newMake.trim(),
        model: newModel.trim(),
        year: Number(newYear) || 2024,
        vin: pseudo,
        chemistry: "NMC",
        voltage: "400V",
      },
      ...prev,
    ]);

    setNewMake("");
    setNewModel("");
    setNewVin("");
    setModalVisible(false);
  };

  const handleLaunchDiagnostics = (veh: any) => {
    Linking.openURL(BACKEND_URL);
  };

  const captureOfflineSession = (vehicle: any) => {
    const session: OfflineSession = {
      id: `${vehicle.id}-${Date.now()}`,
      vehicleId: vehicle.id,
      createdAt: new Date().toISOString(),
      stateOfHealth: null,
      cellDeltaMv: null,
      syncState: "queued",
    };
    setOfflineSessions((current) => [session, ...current]);
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
        message: valid ? `Verified work order #${workOrderId}. The offline certificate hash matches.` : "Hash mismatch. Treat this worksheet as unverified.",
        preview,
      });
    } catch (error) {
      setWorksheetVerification({ status: "error", message: error instanceof Error ? error.message : "Could not verify this worksheet.", preview: null });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.badgeIcon}>
              <Text style={styles.badgeText}>⚡</Text>
            </View>
            <Text style={styles.title}>VOLTRON</Text>
            <Text style={styles.subtitle}>MOBILE</Text>
          </View>
          <Text style={styles.syncStatus}>{isOnline ? "● Online · Local queue ready" : "○ Offline · Sessions saved locally"}</Text>
        </View>

        {syncStatus.phase !== "idle" && (
          <View style={styles.syncCard}>
            <View style={styles.syncRow}>
              <Text style={styles.syncTitle}>{syncStatus.phase === "uploading" ? "Uploading offline sessions" : syncStatus.phase === "complete" ? "Sessions synced" : syncStatus.phase === "waiting-auth" ? "Sync waiting for account sign-in" : "Session sync needs attention"}</Text>
              {syncStatus.total > 0 && <Text style={styles.syncCount}>{syncStatus.uploaded}/{syncStatus.total}</Text>}
            </View>
            {syncStatus.phase === "uploading" && <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(6, (syncStatus.uploaded / Math.max(syncStatus.total, 1)) * 100)}%` }]} /></View>}
            <Text style={styles.syncMessage}>{syncStatus.message || (syncStatus.phase === "uploading" ? "The app will keep retrying safely in the background." : "")}</Text>
          </View>
        )}

        {/* User Card */}
        <View style={styles.userCard}>
          <Text style={styles.userHeading}>USER ACCOUNT & GARAGE</Text>
          <Text style={styles.userName}>Sandeep Kharche</Text>
          <Text style={styles.userSub}>
            Registered vehicles, custom decoders, and battery sessions sync with the Voltron Diagnostic Platform.
          </Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setModalVisible(true)}
          >
            <Text style={styles.addBtnText}>+ Add Vehicle to Garage</Text>
          </TouchableOpacity>
        </View>

        {/* Vehicles Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Vehicles Ready for Diagnosis</Text>
          <Text style={styles.sectionCount}>{vehicles.length} Active</Text>
        </View>

        {vehicles.map((v) => (
          <View key={v.id} style={styles.vehicleCard}>
            <View style={styles.vRow}>
              <Text style={styles.vYear}>{v.year}</Text>
              <Text style={styles.vChemistry}>{v.chemistry}</Text>
            </View>
            <Text style={styles.vName}>
              {v.make} {v.model}
            </Text>
            <Text style={styles.vVin}>VIN {v.vin}</Text>
            <Text style={styles.vDetails}>96 cells · 8 modules · {v.voltage}</Text>

            <TouchableOpacity
              style={styles.diagBtn}
              onPress={() => handleLaunchDiagnostics(v)}
            >
              <Text style={styles.diagBtnText}>⚡ Diagnose This Vehicle →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureBtn} onPress={() => captureOfflineSession(v)}>
              <Text style={styles.captureBtnText}>＋ Save Offline Session Snapshot</Text>
            </TouchableOpacity>
            <Text style={styles.historyLabel}>
              {offlineSessions.filter((session) => session.vehicleId === v.id).length} local session(s) · {offlineSessions.some((session) => session.vehicleId === v.id && session.syncState === "queued") ? "queued for secure web sync" : "no pending sync"}
            </Text>
          </View>
        ))}

        <View style={styles.verifierCard}>
          <Text style={styles.verifierTitle}>WORK ORDER CERTIFICATE</Text>
          <Text style={styles.verifierText}>Scan a printed technician worksheet to verify its offline SHA-256 signature without uploading the vehicle data.</Text>
          <TouchableOpacity style={styles.verifyBtn} onPress={openWorksheetScanner}>
            <Text style={styles.verifyBtnText}>▣ Verify Worksheet QR</Text>
          </TouchableOpacity>
          {worksheetVerification.message ? <Text style={[styles.verifierMessage, worksheetVerification.status === "valid" ? styles.validText : styles.invalidText]}>{worksheetVerification.message}</Text> : null}
          {worksheetVerification.preview && worksheetVerification.status === "valid" ? (
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Certificate preview</Text>
              <Text style={styles.previewText}>Work order #{String(worksheetVerification.preview.workOrderId)} · {String(worksheetVerification.preview.vehicle || "Unknown vehicle")}</Text>
              <Text style={styles.previewText}>Priority: {String(worksheetVerification.preview.priority || "—")} · Signature: {worksheetVerification.preview.signatureCaptured ? "Captured" : "Not captured"}</Text>
            </View>
          ) : null}
        </View>

        {/* Live Link Button */}
        <TouchableOpacity
          style={styles.webBtn}
          onPress={() => Linking.openURL(BACKEND_URL)}
        >
          <Text style={styles.webBtnText}>Open Web Dashboard & Live CAN Lab</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Add Vehicle Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Register New EV</Text>

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

            <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
              <Text style={styles.scanBtnText}>▣ Scan VIN Barcode / QR</Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddVehicle}>
                <Text style={styles.saveText}>Save Vehicle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
            <Text style={styles.scannerHint}>Align the printed certificate QR inside the frame. Verification stays on this device.</Text>
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
  header: { marginBottom: 16, alignItems: "center" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badgeIcon: {
    backgroundColor: "#10b981",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 16, color: "#05080b", fontWeight: "bold" },
  title: { fontSize: 20, fontWeight: "900", color: "#ffffff", letterSpacing: 1.5 },
  subtitle: { fontSize: 12, color: "#10b981", fontWeight: "bold" },
  syncStatus: { color: "#10b981", fontSize: 11, marginTop: 4, fontWeight: "bold" },
  syncCard: { backgroundColor: "#082f49", borderColor: "#0891b2", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  syncRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  syncTitle: { color: "#cffafe", fontSize: 12, fontWeight: "bold" },
  syncCount: { color: "#67e8f9", fontSize: 12, fontWeight: "bold" },
  syncMessage: { color: "#bae6fd", fontSize: 10, marginTop: 6, lineHeight: 14 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#164e63", overflow: "hidden", marginTop: 9 },
  progressFill: { height: "100%", backgroundColor: "#22d3ee", borderRadius: 3 },
  userCard: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  userHeading: { fontSize: 10, color: "#64748b", fontWeight: "bold", letterSpacing: 1 },
  userName: { fontSize: 18, fontWeight: "bold", color: "#ffffff", marginTop: 4 },
  userSub: { fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 16 },
  addBtn: {
    backgroundColor: "#10b981",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  addBtnText: { color: "#05080b", fontWeight: "bold", fontSize: 13 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 14, fontWeight: "bold", color: "#ffffff" },
  sectionCount: { fontSize: 11, color: "#10b981", fontWeight: "bold" },
  vehicleCard: {
    backgroundColor: "#0d1522",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  vRow: { flexDirection: "row", justifyContent: "space-between" },
  vYear: { color: "#94a3b8", fontSize: 10, fontWeight: "bold" },
  vChemistry: { color: "#10b981", fontSize: 10, fontWeight: "bold" },
  vName: { fontSize: 16, fontWeight: "bold", color: "#ffffff", marginTop: 4 },
  vVin: { fontSize: 11, color: "#64748b", marginTop: 2, fontFamily: "monospace" },
  vDetails: { fontSize: 10, color: "#64748b", marginTop: 6 },
  diagBtn: {
    backgroundColor: "#1e293b",
    borderColor: "#10b981",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 12,
  },
  diagBtnText: { color: "#10b981", fontSize: 12, fontWeight: "bold" },
  captureBtn: {
    backgroundColor: "#082f49",
    borderColor: "#155e75",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 8,
  },
  captureBtnText: { color: "#67e8f9", fontSize: 11, fontWeight: "bold" },
  historyLabel: { color: "#64748b", fontSize: 10, marginTop: 7, textAlign: "center" },
  verifierCard: { backgroundColor: "#071a16", borderColor: "#047857", borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 4 },
  verifierTitle: { color: "#6ee7b7", fontSize: 10, fontWeight: "bold", letterSpacing: 1 },
  verifierText: { color: "#a7f3d0", fontSize: 11, lineHeight: 16, marginTop: 6 },
  verifyBtn: { backgroundColor: "#10b981", borderRadius: 10, paddingVertical: 9, alignItems: "center", marginTop: 12 },
  verifyBtnText: { color: "#05080b", fontSize: 12, fontWeight: "bold" },
  verifierMessage: { fontSize: 11, lineHeight: 16, marginTop: 10, fontWeight: "bold" },
  validText: { color: "#6ee7b7" },
  invalidText: { color: "#fda4af" },
  previewBox: { backgroundColor: "#05080b", borderColor: "#14532d", borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  previewLabel: { color: "#64748b", fontSize: 9, fontWeight: "bold", letterSpacing: 1, textTransform: "uppercase" },
  previewText: { color: "#d1fae5", fontSize: 10, marginTop: 4 },
  webBtn: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  webBtnText: { color: "#94a3b8", fontSize: 12, fontWeight: "bold" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#0a111a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: { fontSize: 16, fontWeight: "bold", color: "#ffffff", marginBottom: 12 },
  input: {
    backgroundColor: "#05080b",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: "#ffffff",
    fontSize: 12,
    marginBottom: 10,
  },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  cancelText: { color: "#94a3b8", fontWeight: "bold", fontSize: 12 },
  saveBtn: {
    backgroundColor: "#10b981",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  saveText: { color: "#05080b", fontWeight: "bold", fontSize: 12 },
  scanBtn: {
    backgroundColor: "#082f49",
    borderColor: "#0891b2",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
    marginBottom: 10,
  },
  scanBtnText: { color: "#67e8f9", fontSize: 12, fontWeight: "bold" },
  scannerPage: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  scannerOverlay: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 36,
    backgroundColor: "rgba(5,8,11,0.9)",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  scannerTitle: { color: "#fff", fontSize: 17, fontWeight: "bold" },
  scannerHint: { color: "#cbd5e1", fontSize: 12, textAlign: "center", marginTop: 6, marginBottom: 12 },
});
