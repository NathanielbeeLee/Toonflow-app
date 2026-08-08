import express from "express";
import { buildDiagnosticReport } from "@/services/diagnostics/report";

const router = express.Router();

export default router.post("/", async (_req, res) => {
  const report = await buildDiagnosticReport();
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="toonflow-diagnostics-${date}.json"`);
  res.status(200).send(JSON.stringify(report, null, 2));
});
