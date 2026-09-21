import * as SQLite from "expo-sqlite";

export type TelemetryHistoryRecord = {
  id: number;
  vehicleId: number;
  vehicleName: string;
  capturedAt: string;
  stateOfHealth: number;
  stateOfCharge: number;
  cellDeltaMv: number;
  packVoltage: number;
  packTempAvgC: number;
  headlineVerdict: string;
  source: "live" | "offline" | "ble";
  snapshotJson: string;
};

let database: SQLite.SQLiteDatabase | null = null;

function getDatabase() {
  if (!database) {
    database = SQLite.openDatabaseSync("voltron-telemetry.db");
    database.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS telemetry_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        vehicle_name TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        state_of_health REAL NOT NULL,
        state_of_charge REAL NOT NULL,
        cell_delta_mv REAL NOT NULL,
        pack_voltage REAL NOT NULL,
        pack_temp_avg_c REAL NOT NULL,
        headline_verdict TEXT NOT NULL,
        source TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS telemetry_history_vehicle_idx
        ON telemetry_history(vehicle_id, captured_at DESC);
    `);
  }
  return database;
}

export function initializeTelemetryHistory() {
  getDatabase();
}

export function saveTelemetryHistory(record: Omit<TelemetryHistoryRecord, "id">) {
  const db = getDatabase();
  const result = db.runSync(
    `INSERT INTO telemetry_history
      (vehicle_id, vehicle_name, captured_at, state_of_health, state_of_charge,
       cell_delta_mv, pack_voltage, pack_temp_avg_c, headline_verdict, source, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.vehicleId,
    record.vehicleName,
    record.capturedAt,
    record.stateOfHealth,
    record.stateOfCharge,
    record.cellDeltaMv,
    record.packVoltage,
    record.packTempAvgC,
    record.headlineVerdict,
    record.source,
    record.snapshotJson,
  );
  return Number(result.lastInsertRowId);
}

export function listTelemetryHistory(vehicleId?: number, limit = 30): TelemetryHistoryRecord[] {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  if (typeof vehicleId === "number") {
    return db.getAllSync<TelemetryHistoryRecord>(
      `SELECT id, vehicle_id AS vehicleId, vehicle_name AS vehicleName,
              captured_at AS capturedAt, state_of_health AS stateOfHealth,
              state_of_charge AS stateOfCharge, cell_delta_mv AS cellDeltaMv,
              pack_voltage AS packVoltage, pack_temp_avg_c AS packTempAvgC,
              headline_verdict AS headlineVerdict, source, snapshot_json AS snapshotJson
         FROM telemetry_history WHERE vehicle_id = ? ORDER BY captured_at DESC LIMIT ?`,
      vehicleId,
      safeLimit,
    );
  }
  return db.getAllSync<TelemetryHistoryRecord>(
    `SELECT id, vehicle_id AS vehicleId, vehicle_name AS vehicleName,
            captured_at AS capturedAt, state_of_health AS stateOfHealth,
            state_of_charge AS stateOfCharge, cell_delta_mv AS cellDeltaMv,
            pack_voltage AS packVoltage, pack_temp_avg_c AS packTempAvgC,
            headline_verdict AS headlineVerdict, source, snapshot_json AS snapshotJson
       FROM telemetry_history ORDER BY captured_at DESC LIMIT ?`,
    safeLimit,
  );
}

export function deleteTelemetryHistory(id: number) {
  getDatabase().runSync("DELETE FROM telemetry_history WHERE id = ?", id);
}

export function clearTelemetryHistory() {
  getDatabase().runSync("DELETE FROM telemetry_history");
}
