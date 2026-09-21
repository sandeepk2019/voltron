import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { TelemetryHistoryRecord } from "./telemetryHistory";

type SnapshotCell = {
  cellIndex?: number;
  moduleIndex?: number;
  voltage?: number;
  temperatureC?: number;
};

type Snapshot = {
  stateOfHealth?: number;
  stateOfCharge?: number;
  cellDeltaMv?: number;
  packVoltage?: number;
  packTempAvgC?: number;
  headlineVerdict?: string;
  cells?: SnapshotCell[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function number(value: unknown, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "—";
}

function createCertificateHtml(record: Omit<TelemetryHistoryRecord, "id"> | TelemetryHistoryRecord) {
  let snapshot: Snapshot = {};
  try {
    snapshot = JSON.parse(record.snapshotJson) as Snapshot;
  } catch {
    snapshot = {};
  }

  const cells = Array.isArray(snapshot.cells) ? snapshot.cells : [];
  const rows = cells
    .map(
      (cell) => `
        <tr>
          <td>${escapeHtml(cell.cellIndex ?? "—")}</td>
          <td>M${escapeHtml(cell.moduleIndex ?? "—")}</td>
          <td>${number(cell.voltage, 3)} V</td>
          <td>${number(cell.temperatureC, 1)} °C</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #10202b; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f9d78; padding-bottom: 10px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #063b31; }
  h2 { margin: 18px 0 8px; color: #063b31; font-size: 14px; }
  .muted { color: #637381; }
  .badge { background: #e8f7f1; color: #087453; border-radius: 14px; padding: 6px 10px; font-weight: 700; }
  .meta { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
  .meta strong { color: #063b31; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
  .kpi { border: 1px solid #cbd5dc; border-radius: 7px; padding: 9px; background: #f7fafb; }
  .kpi-label { color: #637381; font-size: 9px; text-transform: uppercase; }
  .kpi-value { color: #063b31; font-size: 16px; font-weight: 700; margin-top: 3px; }
  .verdict { border-left: 4px solid #0f9d78; background: #f2fbf7; padding: 9px 11px; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #d6dee3; padding: 4px 5px; text-align: left; }
  th { background: #e8f7f1; color: #063b31; }
  .footer { margin-top: 20px; border-top: 1px solid #cbd5dc; padding-top: 8px; color: #637381; font-size: 9px; }
</style></head><body>
<header>
  <div><h1>VOLTRON DIAGNOSTICS</h1><div class="muted">Offline inspection certificate · Native mobile lab</div></div>
  <div class="badge">${escapeHtml(record.source.toUpperCase())} SNAPSHOT</div>
</header>
<div class="meta">
  <div><strong>Vehicle</strong><br />${escapeHtml(record.vehicleName)}</div>
  <div><strong>Captured</strong><br />${escapeHtml(new Date(record.capturedAt).toLocaleString())}</div>
  <div><strong>Vehicle ID</strong><br />${escapeHtml(record.vehicleId)}</div>
  <div><strong>Certificate status</strong><br />Offline generated · No cloud connection required</div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">State of health</div><div class="kpi-value">${number(record.stateOfHealth)}%</div></div>
  <div class="kpi"><div class="kpi-label">State of charge</div><div class="kpi-value">${number(record.stateOfCharge)}%</div></div>
  <div class="kpi"><div class="kpi-label">Cell spread</div><div class="kpi-value">${number(record.cellDeltaMv, 0)} mV</div></div>
  <div class="kpi"><div class="kpi-label">Pack voltage</div><div class="kpi-value">${number(record.packVoltage, 1)} V</div></div>
</div>
<div class="verdict"><strong>Pack health diagnosis</strong><br />${escapeHtml(record.headlineVerdict)}</div>
<h2>Thermal and cell snapshot</h2>
<p class="muted">Average pack temperature: <strong>${number(record.packTempAvgC)} °C</strong>. The table below contains the locally stored cell sample used for this certificate.</p>
<table><thead><tr><th>Cell</th><th>Module</th><th>Voltage</th><th>Temperature</th></tr></thead><tbody>${rows || "<tr><td colspan=\"4\">No individual cell rows were stored in this snapshot.</td></tr>"}</tbody></table>
<div class="footer">Generated locally by Voltron Diagnostics Mobile. This certificate is informational and should be reviewed by a qualified technician before service decisions.</div>
</body></html>`;
}

export async function exportTelemetryCertificate(record: Omit<TelemetryHistoryRecord, "id"> | TelemetryHistoryRecord) {
  if (Platform.OS === "web") {
    throw new Error("Offline PDF export is available in the installed Android/iOS app, not the web preview.");
  }

  const result = await Print.printToFileAsync({ html: createCertificateHtml(record), base64: false });
  if (!(await Sharing.isAvailableAsync())) {
    return { uri: result.uri, shared: false };
  }
  await Sharing.shareAsync(result.uri, {
    mimeType: "application/pdf",
    dialogTitle: "Share Voltron inspection certificate",
    UTI: "com.adobe.pdf",
  });
  return { uri: result.uri, shared: true };
}
