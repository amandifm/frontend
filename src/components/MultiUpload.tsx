"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Loader2,
  XCircle,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  Clock3,
  ScanLine
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { ExtractedRow, DocumentMetadata, AuthUser, ScanStatus } from "../types/shared";

type ExtractedTransactionPayload = {
  id?: string;
  date?: string;
  description?: string;
  debit?: string | number;
  debit_display?: string;
  credit?: string | number;
  credit_display?: string;
  balance?: string | number;
  balance_display?: string;
  type?: string;
  confidence?: string | number;
  section?: string;
};

type UploadResponsePayload = {
  success?: boolean;
  message?: string;
  data?: {
    transactions?: ExtractedTransactionPayload[];
    metadata?: DocumentMetadata;
  };
};

type SavedHistoryPayload = {
  fileName: string;
  transactions: ExtractedRow[];
  summary: {
    transactionCount: number;
    averageConfidence: number;
  };
};

export type UploadItem = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: ScanStatus;
  progress: number;
  estimatedSeconds: number;
  startedAt: number | null;
  rows: ExtractedRow[];
  metadata: DocumentMetadata;
  error: string;
  isTableExpanded: boolean;
};

export default function MultiUpload({
  apiBase,
  onSaveHistory,
}: {
  authUser: AuthUser | null;
  apiBase: string;
  onSaveHistory: (item: SavedHistoryPayload) => void;
}) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    return () => {
      uploads.forEach((u) => {
        if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
    };
  }, [uploads]);

  useEffect(() => {
    if (!uploads.some((u) => u.status === "idle" || u.status === "scanning")) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [uploads]);

  function estimateExtractionSeconds(file: File) {
    const sizeMb = Math.max(file.size / 1024 / 1024, 0.1);
    const extension = file.name.split(".").pop()?.toLowerCase();
    const isPdf = file.type === "application/pdf" || extension === "pdf";
    const baseSeconds = isPdf ? 28 : 16;
    const secondsPerMb = isPdf ? 10 : 6;

    return Math.min(600, Math.max(20, Math.ceil(baseSeconds + sizeMb * secondsPerMb)));
  }

  function formatDuration(totalSeconds: number) {
    const seconds = Math.max(0, Math.ceil(totalSeconds));
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    const minuteRemainder = minutes % 60;
    return minuteRemainder ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
  }

  function getRemainingSeconds(upload: UploadItem) {
    if (upload.status === "complete" || upload.status === "error") return 0;
    if (upload.status !== "scanning" || !upload.startedAt) return upload.estimatedSeconds;

    const elapsedSeconds = (now - upload.startedAt) / 1000;
    return Math.max(5, upload.estimatedSeconds - elapsedSeconds);
  }

  function getQueueWaitSeconds(targetIndex: number) {
    return uploads.slice(0, targetIndex).reduce((total, upload) => {
      if (upload.status === "complete" || upload.status === "error") return total;
      return total + getRemainingSeconds(upload);
    }, 0);
  }

  const totalRemainingSeconds = uploads.reduce((total, upload) => {
    if (upload.status === "complete" || upload.status === "error") return total;
    return total + getRemainingSeconds(upload);
  }, 0);

  const processQueue = useCallback(async () => {
    const queuedIndex = uploads.findIndex((u) => u.status === "idle");
    if (queuedIndex === -1) return;

    const isScanning = uploads.some((u) => u.status === "scanning");
    if (isScanning) return; 

    const currentUpload = uploads[queuedIndex];

    setUploads((current) => {
      const next = [...current];
      next[queuedIndex] = { ...next[queuedIndex], status: "scanning", progress: 0, startedAt: Date.now() };
      return next;
    });

    try {
      const formData = new FormData();
      formData.append("file", currentUpload.file);

      const response = await fetch(`${apiBase}/api/uploads/upload`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as UploadResponsePayload;

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Unable to extract transactions");
      }

      const transactions: ExtractedRow[] = Array.isArray(payload.data?.transactions)
        ? payload.data.transactions.map((row, i) => ({
            id: row.id || `txn-${String(i + 1).padStart(4, "0")}`,
            date: row.date || "-",
            description: row.description || "Transaction",
            debit: String(row.debit_display || row.debit || "-"),
            credit: String(row.credit_display || row.credit || "-"),
            balance: String(row.balance_display || row.balance || "-"),
            type: row.type === "Credit" ? "Credit" : "Debit",
            confidence: String(row.confidence || "-"),
            section: row.section || (row.type === "Credit" ? "Credits / Deposits" : "Debits / Withdrawals"),
          }))
        : [];

      setUploads((current) => {
        const next = [...current];
        next[queuedIndex] = {
          ...next[queuedIndex],
          status: "complete",
          progress: 100,
          startedAt: null,
          rows: transactions,
          metadata: payload.data?.metadata || {},
          isTableExpanded: true,
        };
        return next;
      });

      onSaveHistory({
        fileName: currentUpload.file.name,
        transactions,
        summary: {
          transactionCount: transactions.length,
          averageConfidence: 0.96,
        },
      });
    } catch (error) {
      setUploads((current) => {
        const next = [...current];
        next[queuedIndex] = {
          ...next[queuedIndex],
          status: "error",
          progress: 0,
          startedAt: null,
          error: error instanceof Error ? error.message : "Extraction failed",
        };
        return next;
      });
    }
  }, [uploads, apiBase, onSaveHistory]);

  useEffect(() => {
    processQueue();
  }, [processQueue]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const allowedFiles = files.slice(0, 10 - uploads.length);

    const newUploads = allowedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      previewUrl: URL.createObjectURL(file), // Generate for all files including PDF
      status: "idle" as ScanStatus,
      progress: 0,
      estimatedSeconds: estimateExtractionSeconds(file),
      startedAt: null,
      rows: [],
      metadata: {},
      error: "",
      isTableExpanded: false,
    }));

    setUploads((curr) => [...curr, ...newUploads]);
    event.target.value = "";
  }

  function toggleTable(id: string) {
    setUploads((curr) =>
      curr.map((u) => (u.id === id ? { ...u, isTableExpanded: !u.isTableExpanded } : u))
    );
  }

  function removeUpload(id: string) {
    setUploads((curr) => curr.filter((u) => u.id !== id));
  }

  function calculateStats(rows: ExtractedRow[]) {
    let totalDebit = 0;
    let totalCredit = 0;
    let countDebit = 0;
    let countCredit = 0;

    rows.forEach((row) => {
      const debitValue = parseFloat(String(row.debit).replace(/[$,\s]/g, "")) || 0;
      const creditValue = parseFloat(String(row.credit).replace(/[$,\s]/g, "")) || 0;

      if (debitValue > 0) {
        totalDebit += debitValue;
        countDebit++;
      }
      if (creditValue > 0) {
        totalCredit += creditValue;
        countCredit++;
      }
    });

    return { totalDebit, totalCredit, countDebit, countCredit };
  }

  function exportPdf(upload: UploadItem) {
     const document = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
     let currentY = 42;
     document.setFontSize(18);
     document.setTextColor(8, 126, 190);
     document.text("Bank Statement Extraction Report", 40, currentY);
     currentY += 24;
     document.setFontSize(10);
     document.setTextColor(90);
     document.text(`File: ${upload.file.name}`, 40, currentY);
     currentY += 20;
     
     autoTable(document, {
       startY: currentY,
       head: [["Date", "Description", "Debit", "Credit", "Balance", "Type"]],
       body: upload.rows.map((row) => [
         row.date, row.description, row.debit, row.credit, row.balance, row.type
       ]),
       styles: { fontSize: 8, cellPadding: 5 },
       headStyles: { fillColor: [8, 126, 190], textColor: 255 },
     });
     document.save(`${upload.file.name}-report.pdf`);
  }

  function exportXlsx(upload: UploadItem) {
     const workbook = XLSX.utils.book_new();
     const headers = ["Date", "Description", "Debit", "Credit", "Balance", "Type"];
     const sheetRows = [headers, ...upload.rows.map((r) => [
       r.date, r.description, r.debit, r.credit, r.balance, r.type
     ])];
     const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
     XLSX.utils.book_append_sheet(workbook, sheet, "Transactions");
     XLSX.writeFile(workbook, `${upload.file.name}-report.xlsx`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Document Processing Queue</h2>
          <p className="text-sm text-slate-300 mt-1">
            Upload up to 10 files. Estimated time remaining: {uploads.length ? formatDuration(totalRemainingSeconds) : "0s"}.
          </p>
        </div>
        <label className="group relative flex cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.2)] transition hover:bg-cyan-300">
          <UploadCloud className="size-5" />
          Upload More
          <input
            className="sr-only"
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            onChange={handleFileChange}
          />
        </label>
      </div>

      {uploads.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid place-items-center py-20"
        >
          <label className="group relative flex w-full max-w-2xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-cyan-200/30 bg-white/[0.04] px-6 py-20 text-center shadow-2xl backdrop-blur-xl transition hover:border-cyan-200/60 hover:bg-white/[0.08]">
            <input
              className="sr-only"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={handleFileChange}
            />
            <div className="mb-6 flex size-20 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/50 shadow-[0_0_50px_rgba(34,211,238,0.15)] transition group-hover:scale-105 group-hover:shadow-[0_0_50px_rgba(34,211,238,0.3)]">
              <UploadCloud className="size-10 text-cyan-200" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-white mb-4">Select multiple statements</h2>
            <p className="text-slate-300 mb-8 max-w-md">Drop up to 10 PDFs or images here to extract transactions into clean data tables automatically.</p>
            <div className="flex items-center gap-2 rounded-lg bg-cyan-400/10 px-6 py-3 text-sm font-semibold text-cyan-200 border border-cyan-400/20">
              Browse Files
            </div>
          </label>
        </motion.div>
      ) : (
        <div className="grid gap-6">
          <AnimatePresence>
            {uploads.map((upload) => {
              const stats = calculateStats(upload.rows);
              const uploadIndex = uploads.findIndex((item) => item.id === upload.id);
              const waitSeconds = getQueueWaitSeconds(uploadIndex);
              const remainingSeconds = getRemainingSeconds(upload);
              const totalEtaSeconds = waitSeconds + remainingSeconds;
              return (
                <motion.div
                  key={upload.id}
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col md:flex-row overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur-xl"
                >
                  {/* LEFT: Square Scanner Preview */}
                  <div className="relative aspect-square w-full md:h-auto md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-white/5 bg-[#0c1220]">
                    {upload.previewUrl ? (
                      <>
                        {upload.file.type === "application/pdf" ? (
                          <iframe src={`${upload.previewUrl}#toolbar=0&navpanes=0&scrollbar=0`} className="absolute inset-0 h-full w-full border-none opacity-90 object-cover" title="PDF Preview" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={upload.previewUrl} alt="Preview" className="absolute inset-0 h-full w-full object-cover opacity-80" />
                        )}
                        
                        {upload.status === "scanning" && (
                          <div className="pointer-events-none absolute inset-0 overflow-hidden bg-cyan-900/10 backdrop-blur-[2px]">
                            <motion.div
                              className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-transparent via-cyan-400/50 to-transparent shadow-[0_0_60px_rgba(34,211,238,0.8)]"
                              initial={{ y: -200 }}
                              animate={{ y: [ -200, 500, -200 ] }}
                              transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
                            />
                            <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.05)_1px,transparent_1px)] bg-[size:40px_40px] opacity-40" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-950/80 px-6 py-4 shadow-2xl backdrop-blur-md border border-cyan-500/30">
                                <ScanLine className="size-8 text-cyan-400 animate-pulse" />
                                <p className="text-sm font-semibold uppercase tracking-widest text-cyan-200">Scanning</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <FileText className="size-16 text-white/10" />
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Tasks/Details */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center justify-between border-b border-white/5 p-4 bg-white/[0.02]">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-white">{upload.file.name}</h3>
                        <div className="mt-1 flex items-center gap-3 text-xs">
                          <span className={`flex items-center gap-1 ${
                            upload.status === "complete" ? "text-emerald-400" :
                            upload.status === "error" ? "text-rose-400" :
                            upload.status === "scanning" ? "text-cyan-400" : "text-slate-400"
                          }`}>
                            {upload.status === "complete" && <CheckCircle2 className="size-3" />}
                            {upload.status === "error" && <XCircle className="size-3" />}
                            {upload.status === "scanning" && <Loader2 className="size-3 animate-spin" />}
                            {upload.status === "idle" && <Clock3 className="size-3" />}
                            {upload.status.charAt(0).toUpperCase() + upload.status.slice(1)}
                          </span>
                          <span className="text-slate-500">{(upload.file.size / 1024 / 1024).toFixed(2)} MB</span>
                          {(upload.status === "idle" || upload.status === "scanning") && (
                            <span className="flex items-center gap-1 text-amber-200">
                              <Clock3 className="size-3" />
                              {upload.status === "idle"
                                ? `Starts in ~${formatDuration(waitSeconds)}`
                                : `~${formatDuration(remainingSeconds)} left`}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex shrink-0 items-center gap-2 ml-4">
                        {upload.status === "complete" && (
                          <>
                            <button onClick={() => exportPdf(upload)} className="flex items-center gap-2 rounded-md bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.1] hover:text-white transition">
                              <FileText className="size-3.5" /> PDF
                            </button>
                            <button onClick={() => exportXlsx(upload)} className="flex items-center gap-2 rounded-md bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.1] hover:text-white transition">
                              <FileSpreadsheet className="size-3.5" /> XLSX
                            </button>
                            <button onClick={() => toggleTable(upload.id)} className="flex items-center gap-2 rounded-md bg-cyan-500/10 border border-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition">
                              {upload.isTableExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                              {upload.isTableExpanded ? "Hide" : "View"}
                            </button>
                          </>
                        )}
                        <button onClick={() => removeUpload(upload.id)} className="p-2 text-slate-400 hover:text-rose-400 transition">
                          <XCircle className="size-5" />
                        </button>
                      </div>
                    </div>

                    {upload.status === "scanning" && (
                      <div className="p-4 bg-cyan-900/10 flex-1 flex flex-col justify-center">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <p className="text-cyan-200">Extracting transactions from statement...</p>
                          <p className="text-amber-200">Estimated wait: {formatDuration(remainingSeconds)}</p>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                          <motion.div
                            className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                            initial={{ width: "0%" }}
                            animate={{ width: "100%" }}
                            transition={{ duration: 5, repeat: Infinity }}
                          />
                        </div>
                      </div>
                    )}

                    {upload.status === "error" && (
                      <div className="p-4 flex-1 text-sm text-rose-200 flex flex-col justify-center">
                        <p className="font-medium">Error occurred:</p>
                        <p className="mt-1 text-rose-300/80">{upload.error}</p>
                      </div>
                    )}

                    {upload.status === "idle" && (
                      <div className="p-4 flex-1 flex flex-col justify-center text-slate-400 text-sm">
                        <p>Waiting in queue for processing...</p>
                        <p className="mt-1 text-amber-200">
                          Estimated completion in {formatDuration(totalEtaSeconds)}
                        </p>
                      </div>
                    )}

                    {upload.status === "complete" && (
                      <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-white/[0.02]">
                           <div className="rounded-lg bg-white/[0.04] p-3 border border-white/5">
                              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Transactions</p>
                              <p className="text-base font-semibold text-white mt-1">{upload.rows.length}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20">
                              <p className="text-[10px] text-emerald-300/80 uppercase tracking-wider">Total Credit</p>
                              <p className="text-base font-semibold text-emerald-200 mt-1">${stats.totalCredit.toFixed(2)}</p>
                            </div>
                            <div className="rounded-lg bg-rose-500/10 p-3 border border-rose-500/20">
                              <p className="text-[10px] text-rose-300/80 uppercase tracking-wider">Total Debit</p>
                              <p className="text-base font-semibold text-rose-200 mt-1">${stats.totalDebit.toFixed(2)}</p>
                            </div>
                            {upload.metadata.account_holder && (
                              <div className="rounded-lg bg-cyan-500/10 p-3 border border-cyan-500/20">
                                <p className="text-[10px] text-cyan-300/80 uppercase tracking-wider">Account Holder</p>
                                <p className="text-xs font-medium text-cyan-100 mt-1 truncate" title={upload.metadata.account_holder}>{upload.metadata.account_holder}</p>
                              </div>
                            )}
                        </div>

                        <AnimatePresence>
                          {upload.isTableExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="flex-1 border-t border-white/5 min-h-0 overflow-hidden"
                            >
                              <div className="h-full max-h-[350px] overflow-auto">
                                <table className="w-full text-left text-xs whitespace-nowrap">
                                  <thead className="bg-white/[0.05] text-slate-300 sticky top-0 backdrop-blur-md z-10 shadow-sm">
                                    <tr>
                                      <th className="px-4 py-2 font-medium">Date</th>
                                      <th className="px-4 py-2 font-medium">Description</th>
                                      <th className="px-4 py-2 font-medium text-right">Debit</th>
                                      <th className="px-4 py-2 font-medium text-right">Credit</th>
                                      <th className="px-4 py-2 font-medium text-right">Balance</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5 text-slate-200">
                                    {upload.rows.map((row) => (
                                      <tr key={row.id} className="hover:bg-white/[0.02]">
                                        <td className="px-4 py-2">{row.date}</td>
                                        <td className="px-4 py-2 truncate max-w-[150px] lg:max-w-[200px]" title={row.description}>{row.description}</td>
                                        <td className="px-4 py-2 text-right text-rose-300">{row.debit !== "-" ? row.debit : ""}</td>
                                        <td className="px-4 py-2 text-right text-emerald-300">{row.credit !== "-" ? row.credit : ""}</td>
                                        <td className="px-4 py-2 text-right">{row.balance !== "-" ? row.balance : ""}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
