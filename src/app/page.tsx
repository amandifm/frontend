"use client";

import { AnimatePresence, motion } from "framer-motion";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertCircle,
  ArrowDownToLine,
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  ScanLine,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserCircle,
  UserPlus,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthMode = "login" | "signup";
type AuthUser = { id: string; name: string; email: string; role?: string; isGuest?: boolean };
type AuthForm = { name: string; email: string; password: string };

type FileStatus = "queued" | "scanning" | "done" | "error";

type ExtractedRow = {
  id: string;
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  type: "Debit" | "Credit";
  confidence: string;
  section?: string;
};

type DocumentMetadata = {
  account_holder?: string;
  account_number?: string;
  bank_name?: string;
  statement_period_start?: string;
  statement_period_end?: string;
  statement_date?: string;
};

type ScanResult = {
  fileId: string;
  originalName: string;
  status: FileStatus;
  progress: number;
  estimatedSeconds: number;
  remainingSeconds: number;
  error?: string;
  transactions: ExtractedRow[];
  metadata: DocumentMetadata;
  summary?: Record<string, unknown>;
};

type HistoryItem = {
  id: string;
  fileName: string;
  transactionCount: number;
  averageConfidence?: string | number | null;
  transactions: ExtractedRow[];
  summary?: Record<string, unknown>;
  createdAt: string;
  isLocal?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSavedUser() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("difm_user");
}
function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function fmt(v: number | string | null | undefined, display?: string | null) {
  if (display && display !== "-") return display;
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "string") return v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function fmtConf(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "string" && v.includes("%")) return v;
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `${Math.round(n > 1 ? n : n * 100)}%`;
}

function mapRow(row: Record<string, unknown>, idx: number): ExtractedRow {
  const type = row.type === "Credit" ? "Credit" : "Debit";
  return {
    id: (row.id as string) || `txn-${String(idx + 1).padStart(4, "0")}`,
    date: (row.date as string) || "-",
    description: (row.description as string) || "Transaction",
    debit: fmt(row.debit as number, row.debit_display as string),
    credit: fmt(row.credit as number, row.credit_display as string),
    balance: fmt(row.balance as number, row.balance_display as string),
    type,
    confidence: fmtConf(row.confidence as number),
    section: (row.section as string) || (type === "Credit" ? "Credits / Deposits" : "Debits / Withdrawals"),
  };
}

function stats(rows: ExtractedRow[]) {
  let td = 0, tc = 0, nd = 0, nc = 0;
  rows.forEach((r) => {
    const d = parseFloat(r.debit.replace(/[$,\s]/g, "")) || 0;
    const c = parseFloat(r.credit.replace(/[$,\s]/g, "")) || 0;
    if (d > 0) { td += d; nd++; }
    if (c > 0) { tc += c; nc++; }
  });
  return { totalDebit: td, totalCredit: tc, countDebit: nd, countCredit: nc };
}

function cleanNum(v: string) {
  if (!v || v === "-") return "";
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : v;
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

  // Auth
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [showAuthForm, setShowAuthForm] = useState(false);
  const storedSnap = useSyncExternalStore(subscribeStorage, getSavedUser, () => null);
  const [authOverride, setAuthOverride] = useState<AuthUser | null | undefined>(undefined);
  const [authForm, setAuthForm] = useState<AuthForm>({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const storedUser = useMemo(() => {
    if (!storedSnap) return null;
    try { return JSON.parse(storedSnap) as AuthUser; } catch { return null; }
  }, [storedSnap]);
  const authUser = authOverride === undefined ? storedUser : authOverride;

  // File batch state
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Auth helpers ──────────────────────────────────────────────────────────

  function updateField(f: keyof AuthForm, v: string) {
    setAuthForm((c) => ({ ...c, [f]: v }));
    setAuthError("");
  }

  async function handleAuthSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const ep = authMode === "login" ? "login" : "signup";
      const body = authMode === "login" ? { email: authForm.email, password: authForm.password } : authForm;
      const res = await fetch(`${apiBase}/api/auth/${ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.message || "Authentication failed");
      const user = payload.data.user as AuthUser;
      window.localStorage.setItem("difm_user", JSON.stringify(user));
      window.localStorage.setItem("difm_token", payload.data.token);
      setAuthOverride(user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  function continueAsGuest() {
    const g = { id: "guest", name: "Guest", email: "guest@local", isGuest: true };
    window.localStorage.setItem("difm_user", JSON.stringify(g));
    window.localStorage.removeItem("difm_token");
    setAuthOverride(g);
  }

  function logout() {
    window.localStorage.removeItem("difm_user");
    window.localStorage.removeItem("difm_token");
    setAuthOverride(null);
    setQueuedFiles([]);
    setResults([]);
    setHistory([]);
  }

  // ── File management ───────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"];
    const valid = Array.from(incoming).filter((f) => allowed.includes(f.type));
    setQueuedFiles((prev) => {
      const combined = [...prev, ...valid];
      return combined.slice(0, 10);
    });
  }, []);

  function getRemainingSeconds(result: ScanResult) {
    if (result.status === "done" || result.status === "error") return 0;
    return result.status === "scanning" ? result.remainingSeconds : result.estimatedSeconds;
  }

  function removeQueued(idx: number) {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  // ── Batch scanning ────────────────────────────────────────────────────────

  async function startBatch() {
    if (queuedFiles.length === 0 || isBatchRunning) return;

    setIsBatchRunning(true);
    setExpandedIndex(null);

    // Initialize result slots
    const initial: ScanResult[] = queuedFiles.map((f, i) => ({
      fileId: `batch-${i}`,
      originalName: f.name,
      status: "queued",
      progress: 0,
      estimatedSeconds: estimateExtractionSeconds(f),
      remainingSeconds: estimateExtractionSeconds(f),
      transactions: [],
      metadata: {},
    }));
    setResults(initial);

    const formData = new FormData();
    queuedFiles.forEach((f) => formData.append("files", f));

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const res = await fetch(`${apiBase}/api/uploads/upload-batch`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok || !res.body) {
        // Non-streaming error — read the message then bail
        let errMsg = "Batch upload failed";
        try { const p = await res.json(); errMsg = p.message || errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          // Stream cut mid-batch (network drop, server restart, etc.)
          // Mark any files still pending and exit the loop gracefully —
          // files already completed keep their results.
          setResults((prev) =>
            prev.map((r) =>
              r.status === "queued" || r.status === "scanning"
                ? { ...r, status: "error", progress: 100, error: "Connection lost - scan interrupted" }
                : r
            )
          );
          break;
        }

        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          // Each line is fully isolated — a bad event never blocks the next file
          try {
            const event = JSON.parse(line);
            handleStreamEvent(event);
          } catch {
            // Malformed NDJSON line — skip and continue
          }
        }
      }
    } catch (err) {
      // Reaches here only for connection-level failures (fetch itself rejected)
      const msg = err instanceof Error ? err.message : "Connection failed";
      setResults((prev) =>
        prev.map((r) =>
          r.status === "queued" || r.status === "scanning"
            ? { ...r, status: "error", progress: 100, error: msg }
            : r
        )
      );
    } finally {
      // Always release the reader lock and unblock the UI regardless of outcome
      try { reader?.cancel(); } catch { /* ignore */ }
      setIsBatchRunning(false);
      setQueuedFiles([]);
    }
  }

  function handleStreamEvent(event: Record<string, unknown>) {
    const idx = event.index as number;

    if (event.event === "file_started") {
      setResults((prev) =>
        prev.map((r, i) =>
          i === idx
            ? { ...r, status: "scanning", progress: Number(event.progress) || 10, remainingSeconds: r.remainingSeconds || r.estimatedSeconds }
            : r
        )
      );
      setExpandedIndex(idx);
      return;
    }

    if (event.event === "file_done") {
      // Always update the result — even if parsing the payload fails below,
      // the file must leave "scanning" state so the next file can proceed.
      if (event.success) {
        let txns: ExtractedRow[] = [];
        let metadata: DocumentMetadata = {};
        let summary: Record<string, unknown> | undefined;
        let fileId: string | undefined;

        try {
          const data = event.data as Record<string, unknown>;
          txns = Array.isArray(data.transactions)
            ? (data.transactions as Record<string, unknown>[]).map(mapRow)
            : [];
          metadata = (data.metadata as DocumentMetadata) || {};
          summary = data.summary as Record<string, unknown>;
          fileId = data.fileId as string | undefined;
        } catch {
          // Payload parse failed — treat as successful scan with 0 transactions
          // rather than leaving the card stuck in "scanning"
        }

        setResults((prev) =>
          prev.map((r, i) =>
            i === idx
              ? {
                  ...r,
                  status: "done",
                  progress: 100,
                  remainingSeconds: 0,
                  transactions: txns,
                  metadata,
                  summary,
                  fileId: fileId || r.fileId,
                }
              : r
          )
        );

        if (authUser) {
          void autoSaveHistory(event.fileName as string, txns, summary);
        }
      } else {
        // Extraction failed for this file — mark it and move on
        setResults((prev) =>
          prev.map((r, i) =>
            i === idx
              ? { ...r, status: "error", progress: 100, remainingSeconds: 0, error: (event.error as string) || "Extraction failed" }
              : r
          )
        );
      }
      return;
    }

    if (event.event === "batch_complete") {
      // Server confirmed all files processed — nothing extra needed here
      // (isBatchRunning is cleared in the finally block)
    }
  }

  // ── History ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isBatchRunning) return;
    const timer = window.setInterval(() => {
      setResults((prev) =>
        prev.map((r) =>
          r.status === "scanning"
            ? {
                ...r,
                progress: Math.min(95, r.progress + 6),
                remainingSeconds: Math.max(5, r.remainingSeconds - 1),
              }
            : r
        )
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isBatchRunning]);

  async function loadHistory(user: AuthUser) {
    setHistoryLoading(true);
    try {
      if (user.isGuest) {
        const s = window.localStorage.getItem(`difm_history_${user.id}`);
        setHistory(s ? JSON.parse(s) : []);
        return;
      }
      const token = window.localStorage.getItem("difm_token");
      const res = await fetch(`${apiBase}/api/history`, { headers: { Authorization: `Bearer ${token}` } });
      const p = await res.json();
      if (!res.ok || !p.success) throw new Error(p.message);
      setHistory(p.data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function autoSaveHistory(fileName: string, transactions: ExtractedRow[], summary: unknown) {
    if (!authUser) return;
    const item = { fileName, transactions, summary };

    if (authUser.isGuest) {
      const localItem: HistoryItem = {
        id: `local-${Date.now()}`,
        fileName,
        transactionCount: transactions.length,
        averageConfidence: "96%",
        transactions,
        summary: summary as Record<string, unknown>,
        createdAt: new Date().toISOString(),
        isLocal: true,
      };
      setHistory((prev) => {
        const updated = [localItem, ...prev].slice(0, 12);
        window.localStorage.setItem(`difm_history_${authUser.id}`, JSON.stringify(updated));
        return updated;
      });
      return;
    }

    const token = window.localStorage.getItem("difm_token");
    try {
      const res = await fetch(`${apiBase}/api/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(item),
      });
      const p = await res.json();
      if (res.ok && p.success) {
        setHistory((prev) => [p.data, ...prev]);
      }
    } catch {
      // silent
    }
  }

  async function deleteHistoryItem(item: HistoryItem) {
    if (!authUser) return;
    if (authUser.isGuest || item.isLocal) {
      setHistory((prev) => {
        const updated = prev.filter((h) => h.id !== item.id);
        window.localStorage.setItem(`difm_history_${authUser.id}`, JSON.stringify(updated));
        return updated;
      });
      return;
    }
    const token = window.localStorage.getItem("difm_token");
    const res = await fetch(`${apiBase}/api/history/${item.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setHistory((prev) => prev.filter((h) => h.id !== item.id));
  }

  useEffect(() => {
    if (!authUser) return;
    void Promise.resolve().then(() => loadHistory(authUser));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // ── Export helpers ────────────────────────────────────────────────────────

  function exportSingleXlsx(result: ScanResult) {
    const wb = XLSX.utils.book_new();
    const metaRows = [
      ["Field", "Value"],
      ["File Name", result.originalName],
      ["Account Holder", result.metadata.account_holder || "-"],
      ["Account Number", result.metadata.account_number || "-"],
      ["Bank Name", result.metadata.bank_name || "-"],
      ["Statement Period", [result.metadata.statement_period_start, result.metadata.statement_period_end].filter(Boolean).join(" → ")],
      ["Statement Date", result.metadata.statement_date || "-"],
      [],
      ["Generated", new Date().toLocaleString()],
      ["Total Transactions", result.transactions.length],
    ];
    const metaSheet = XLSX.utils.aoa_to_sheet(metaRows);
    metaSheet["!cols"] = [{ wch: 30 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, metaSheet, "Document Info");

    const headers = ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Confidence"];
    const rows = result.transactions.map((r) => [r.date, r.description, cleanNum(r.debit), cleanNum(r.credit), cleanNum(r.balance), r.type, r.confidence]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet["!cols"] = [{ wch: 14 }, { wch: 50 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, sheet, "Transactions");

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.originalName.replace(/\.[^/.]+$/, "")}-report.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportAllXlsx() {
    const done = results.filter((r) => r.status === "done");
    if (done.length === 0) return;
    const wb = XLSX.utils.book_new();
    done.forEach((result) => {
      const headers = ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Confidence"];
      const rows = result.transactions.map((r) => [r.date, r.description, cleanNum(r.debit), cleanNum(r.credit), cleanNum(r.balance), r.type, r.confidence]);
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      sheet["!cols"] = [{ wch: 14 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }];
      const sheetName = result.originalName.replace(/\.[^/.]+$/, "").slice(0, 30);
      XLSX.utils.book_append_sheet(wb, sheet, sheetName);
    });
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-report-${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportSinglePdf(result: ScanResult) {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const s = stats(result.transactions);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 36;
    const generatedAt = new Date().toLocaleString();

    function money(value: number) {
      return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function addHeader() {
      doc.setFillColor(11, 18, 32);
      doc.rect(0, 0, pageWidth, 92, "F");
      doc.setFillColor(8, 126, 190);
      doc.rect(0, 0, 9, 92, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      doc.text("Bank Statement Extraction Report", margin, 38);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(188, 204, 220);
      doc.text(`File: ${result.originalName}`, margin, 60, { maxWidth: pageWidth - 260 });
      doc.text(`Generated: ${generatedAt}`, pageWidth - margin, 60, { align: "right" });
    }

    function addSummaryCard(label: string, value: string, x: number, y: number, width: number, accent: [number, number, number]) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, width, 50, 6, 6, "FD");
      doc.setFillColor(...accent);
      doc.roundedRect(x, y, 5, 50, 3, 3, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(label.toUpperCase(), x + 16, y + 18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.text(value, x + 16, y + 38);
    }

    addHeader();

    const summaryTop = 112;
    const cardGap = 12;
    const cardWidth = (pageWidth - margin * 2 - cardGap * 3) / 4;
    addSummaryCard("Transactions", String(result.transactions.length), margin, summaryTop, cardWidth, [8, 126, 190]);
    addSummaryCard("Total Debit", money(s.totalDebit), margin + (cardWidth + cardGap), summaryTop, cardWidth, [225, 29, 72]);
    addSummaryCard("Total Credit", money(s.totalCredit), margin + (cardWidth + cardGap) * 2, summaryTop, cardWidth, [5, 150, 105]);
    addSummaryCard("Net Flow", money(s.totalCredit - s.totalDebit), margin + (cardWidth + cardGap) * 3, summaryTop, cardWidth, [99, 102, 241]);

    autoTable(doc, {
      startY: summaryTop + 72,
      margin: { top: 36, left: margin, right: margin, bottom: 42 },
      head: [["Date", "Description", "Debit", "Credit", "Balance", "Type", "Confidence"]],
      body: result.transactions.map((r) => [r.date, r.description, r.debit, r.credit, r.balance, r.type, r.confidence]),
      tableWidth: pageWidth - margin * 2,
      styles: {
        font: "helvetica",
        fontSize: 7.6,
        cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
        lineColor: [226, 232, 240],
        lineWidth: 0.35,
        textColor: [51, 65, 85],
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: [8, 126, 190],
        textColor: 255,
        fontStyle: "bold",
        halign: "left",
        cellPadding: { top: 7, right: 6, bottom: 7, left: 6 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 72 },
        1: { cellWidth: 270 },
        2: { cellWidth: 78, halign: "right", textColor: [190, 18, 60] },
        3: { cellWidth: 78, halign: "right", textColor: [4, 120, 87] },
        4: { cellWidth: 82, halign: "right" },
        5: { cellWidth: 62, halign: "center" },
        6: { cellWidth: 72, halign: "center" },
      },
      didDrawPage: (data) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Page ${data.pageNumber}`, pageWidth - margin, pageHeight - 18, { align: "right" });
      },
    });
    doc.save(`${result.originalName.replace(/\.[^/.]+$/, "")}-report.pdf`);
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const doneCount = results.filter((r) => r.status === "done").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const completedCount = doneCount + errorCount;
  const scanPercent = results.length > 0
    ? Math.round(results.reduce((acc, r) => acc + r.progress, 0) / results.length)
    : 0;
  const totalTxns = results.reduce((acc, r) => acc + r.transactions.length, 0);

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH GATE
  // ─────────────────────────────────────────────────────────────────────────

  if (!authUser) {
    return (
      <main className="min-h-screen bg-[#050814] text-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(34,211,238,0.18),transparent_40%),radial-gradient(ellipse_at_80%_80%,rgba(16,185,129,0.12),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />

        <section className={`relative mx-auto grid min-h-screen items-center gap-8 px-5 py-10 transition-[max-width] duration-300 ${showAuthForm ? "max-w-sm" : "max-w-4xl"}`}>
          {!showAuthForm && (
            <div className="fade-up">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-300">
                <ScanLine className="size-3" />
                DIFM Bank Extractor
              </div>
              <h1 className="mt-2 max-w-3xl text-5xl font-bold tracking-tight sm:text-7xl leading-[1.05]">
                <span className="shimmer-text">Scan</span> bank statements.<br />
                <span className="text-slate-300">Extract transactions.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-400">
                Upload up to 10 bank statements at once. Our OCR engine scans them in parallel and streams each result as soon as it is ready.
              </p>
              <div className="mt-10 grid gap-3 sm:grid-cols-2 max-w-sm">
                <button type="button" onClick={() => setShowAuthForm(true)}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-4 text-left transition hover:border-cyan-400/40 hover:bg-white/[0.1]">
                  <LogIn className="size-5 text-cyan-300 shrink-0" />
                  <span className="text-sm font-semibold">Login / Sign up</span>
                </button>
                <button type="button" onClick={continueAsGuest}
                  className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-left text-emerald-100 transition hover:bg-emerald-400/15">
                  <UserCircle className="size-5 shrink-0" />
                  <span className="text-sm font-semibold">Continue as guest</span>
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {showAuthForm && (
              <motion.div key="auth" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="rounded-2xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl backdrop-blur-xl">
                <button type="button" onClick={() => setShowAuthForm(false)}
                  className="mb-5 text-sm font-medium text-slate-400 transition hover:text-white">← Back</button>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10">
                    <ScanLine className="size-5 text-cyan-300" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">DIFM Extractor</p>
                    <p className="text-lg font-bold text-white">Account access</p>
                  </div>
                </div>
                <div className="mb-5 grid grid-cols-2 rounded-xl bg-white/[0.05] p-1">
                  {(["login", "signup"] as AuthMode[]).map((m) => (
                    <button key={m} type="button" onClick={() => setAuthMode(m)}
                      className={`rounded-lg py-2.5 text-sm font-semibold capitalize transition ${authMode === m ? "bg-cyan-400 text-slate-950" : "text-slate-400"}`}>
                      {m === "login" ? "Login" : "Sign up"}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleAuthSubmit} className="space-y-3">
                  {authMode === "signup" && (
                    <input value={authForm.name} onChange={(e) => updateField("name", e.target.value)}
                      placeholder="Your name" required
                      className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50" />
                  )}
                  <input type="email" value={authForm.email} onChange={(e) => updateField("email", e.target.value)}
                    placeholder="you@example.com" required
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50" />
                  <input type="password" value={authForm.password} onChange={(e) => updateField("password", e.target.value)}
                    placeholder="Min. 6 characters" required minLength={6}
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50" />
                  {authError && <p className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-2.5 text-sm text-rose-200">{authError}</p>}
                  <button type="submit" disabled={authLoading}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:bg-slate-600 disabled:text-slate-400">
                    {authLoading ? <Loader2 className="size-4 animate-spin" /> : authMode === "login" ? <KeyRound className="size-4" /> : <UserPlus className="size-4" />}
                    {authMode === "login" ? "Login" : "Create account"}
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs text-slate-500">or</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <button type="button" onClick={continueAsGuest}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/15">
                    <UserCircle className="size-4" />Continue as guest
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN DASHBOARD
  // ─────────────────────────────────────────────────────────────────────────

  const hasResults = results.length > 0;
  const hasQueued = queuedFiles.length > 0;
  const queuedEstimateSeconds = queuedFiles.reduce((total, file) => total + estimateExtractionSeconds(file), 0);

  return (
    <main className="min-h-screen bg-[#050814] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_10%_0%,rgba(34,211,238,0.12),transparent_35%),radial-gradient(ellipse_at_90%_100%,rgba(16,185,129,0.1),transparent_35%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:60px_60px]" />

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* ── Header ── */}
        <header className="mb-6 flex items-center justify-between border-b border-white/8 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.12)]">
              <ScanLine className="size-5 text-cyan-300" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400/70">DIFM Extractor</p>
              <h1 className="text-lg font-bold text-white">Bank Statement Extractor</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/8 px-3 py-1.5 text-xs font-semibold text-emerald-200 sm:flex">
              <ShieldCheck className="size-3.5" />
              {authUser.isGuest ? "Guest" : authUser.name}
            </div>
            <button onClick={logout}
              className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 transition hover:text-white"
              title="Logout">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        {/* ── Stats Row ── */}
        {hasResults && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Files Scanned", value: `${completedCount} / ${results.length}`, color: "cyan" },
              { label: "Total Transactions", value: totalTxns, color: "emerald" },
              { label: "Errors", value: errorCount, color: errorCount > 0 ? "rose" : "slate" },
              { label: "Scan Status", value: `${scanPercent}%`, color: "amber" },
            ].map(({ label, value, color }) => (
              <div key={label} className={`rounded-xl border bg-white/[0.04] p-3 border-${color}-400/15`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
                <p className={`mt-1 text-xl font-bold text-${color}-200`}>{value}</p>
              </div>
            ))}
          </motion.div>
        )}

        <div className={`grid gap-5 ${hasResults ? "lg:grid-cols-[380px_1fr]" : ""}`}>

          {/* ── Left panel: Dropzone + Queue ── */}
          <div className="flex flex-col gap-4">

            {/* Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !isBatchRunning && fileInputRef.current?.click()}
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
                isDragOver
                  ? "border-cyan-400/70 bg-cyan-400/8"
                  : isBatchRunning
                  ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-50"
                  : "border-white/15 bg-white/[0.03] hover:border-cyan-400/40 hover:bg-white/[0.05]"
              }`}>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp"
                className="sr-only" onChange={handleFileInput} disabled={isBatchRunning} />

              <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
                <UploadCloud className={`size-8 transition ${isDragOver ? "text-cyan-300" : "text-slate-400"}`} />
              </div>
              <p className="text-sm font-semibold text-white">
                {isDragOver ? "Drop files here" : "Drop files or click to browse"}
              </p>
              <p className="mt-1 text-xs text-slate-500">PDF, PNG, JPG, WEBP — up to 10 files · 25 MB each</p>

              {queuedFiles.length > 0 && (
                <div className="mt-3 flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-bold text-cyan-300">
                  <Layers className="size-3" />
                  {queuedFiles.length} / 10 selected
                </div>
              )}
            </div>

            {/* Queued file list */}
            <AnimatePresence>
              {hasQueued && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                  <div className="border-b border-white/8 px-4 py-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Queue</p>
                    <span className="text-xs text-slate-500">
                      {queuedFiles.length} file{queuedFiles.length !== 1 ? "s" : ""} · ~{formatDuration(queuedEstimateSeconds)}
                    </span>
                  </div>
                  <ul className="divide-y divide-white/5 max-h-[280px] overflow-y-auto">
                    {queuedFiles.map((f, i) => (
                      <motion.li key={`${f.name}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 px-4 py-2.5">
                        <FileText className="size-4 shrink-0 text-slate-500" />
                        <span className="flex-1 truncate text-xs text-slate-300">{f.name}</span>
                        <span className="shrink-0 rounded-md border border-amber-400/15 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                          ~{formatDuration(estimateExtractionSeconds(f))}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-600">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); removeQueued(i); }} disabled={isBatchRunning}
                          className="shrink-0 text-slate-600 transition hover:text-rose-400 disabled:opacity-30">
                          <X className="size-3.5" />
                        </button>
                      </motion.li>
                    ))}
                  </ul>

                  <div className="border-t border-white/8 p-3">
                    <button onClick={startBatch} disabled={isBatchRunning || queuedFiles.length === 0}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none">
                      {isBatchRunning ? (
                        <><Loader2 className="size-4 animate-spin" /> Scanning…</>
                      ) : (
                        <><ScanLine className="size-4" /> Start Batch Scan</>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Export all */}
            {doneCount > 1 && !isBatchRunning && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Export All Results</p>
                <button onClick={exportAllXlsx}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400">
                  <ArrowDownToLine className="size-4" />
                  Download All as XLSX
                </button>
              </motion.div>
            )}

            {/* Scan history */}
            {!authUser.isGuest && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03]">
                <div className="border-b border-white/8 px-4 py-3 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">History</p>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Database className="size-3" />{history.length}
                  </div>
                </div>
                {historyLoading ? (
                  <div className="p-3 space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.05]" />)}
                  </div>
                ) : history.length > 0 ? (
                  <ul className="divide-y divide-white/5 max-h-[320px] overflow-y-auto">
                    {history.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-white">{item.fileName}</p>
                          <p className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Clock3 className="size-2.5" />
                            {new Date(item.createdAt).toLocaleDateString()}
                            <span className="ml-1 text-cyan-400/70">{item.transactionCount} txns</span>
                          </p>
                        </div>
                        <button onClick={() => deleteHistoryItem(item)}
                          className="shrink-0 text-slate-600 transition hover:text-rose-400">
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-6 text-center text-xs text-slate-600">No history yet</p>
                )}
              </div>
            )}
          </div>

          {/* ── Right panel: Results ── */}
          <div className="flex flex-col gap-4">

            {!hasResults && !hasQueued && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-24 text-center">
                <BadgeDollarSign className="mb-4 size-10 text-slate-700" />
                <p className="text-sm font-semibold text-slate-500">No scans yet</p>
                <p className="mt-1 text-xs text-slate-700">Add files on the left and start a batch scan</p>
              </motion.div>
            )}

            {!hasResults && hasQueued && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-24 text-center">
                <ScanLine className="mb-4 size-10 text-cyan-800" />
                <p className="text-sm font-semibold text-slate-400">{queuedFiles.length} file{queuedFiles.length !== 1 ? "s" : ""} ready</p>
                <p className="mt-1 text-xs text-slate-600">Estimated scan time: {formatDuration(queuedEstimateSeconds)}</p>
              </motion.div>
            )}

            <AnimatePresence>
              {results.map((result, idx) => (
                <ResultCard
                  key={`${result.originalName}-${idx}`}
                  result={result}
                  index={idx}
                  total={results.length}
                  remainingSeconds={getRemainingSeconds(result)}
                  isExpanded={expandedIndex === idx}
                  onToggle={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                  onExportXlsx={() => exportSingleXlsx(result)}
                  onExportPdf={() => exportSinglePdf(result)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── ResultCard component ─────────────────────────────────────────────────────

function ResultCard({
  result,
  index,
  total,
  remainingSeconds,
  isExpanded,
  onToggle,
  onExportXlsx,
  onExportPdf,
}: {
  result: ScanResult;
  index: number;
  total: number;
  remainingSeconds: number;
  isExpanded: boolean;
  onToggle: () => void;
  onExportXlsx: () => void;
  onExportPdf: () => void;
}) {
  const s = stats(result.transactions);
  const statusColor = result.status === "done" ? "emerald" : result.status === "error" ? "rose" : result.status === "scanning" ? "cyan" : "slate";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-lg">

      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Status icon */}
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg border border-${statusColor}-400/20 bg-${statusColor}-400/10`}>
          {result.status === "scanning" && <Loader2 className="size-4 animate-spin text-cyan-300" />}
          {result.status === "done" && <CheckCircle2 className="size-4 text-emerald-300" />}
          {result.status === "error" && <AlertCircle className="size-4 text-rose-300" />}
          {result.status === "queued" && <Clock3 className="size-4 text-slate-500" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{result.originalName}</p>
            <span className={`shrink-0 rounded-md border border-${statusColor}-400/20 bg-${statusColor}-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-${statusColor}-300`}>
              {result.status === "scanning" ? "Scanning" : result.status === "done" ? "Complete" : result.status === "error" ? "Failed" : "Queued"}
            </span>
          </div>
          {result.status === "done" && (
            <p className="mt-0.5 text-xs text-slate-500">
              {result.transactions.length} transactions
              {result.metadata.bank_name && ` · ${result.metadata.bank_name}`}
              {result.metadata.statement_period_start && ` · ${result.metadata.statement_period_start}`}
            </p>
          )}
          {result.status === "error" && (
            <p className="mt-0.5 truncate text-xs text-rose-400">{result.error}</p>
          )}
          {result.status === "scanning" && (
            <p className="mt-0.5 text-xs text-cyan-500/70">
              Extracting transactions · {result.progress}% · ~{formatDuration(remainingSeconds)} left
            </p>
          )}
          {result.status === "queued" && (
            <p className="mt-0.5 text-xs text-slate-600">
              File {index + 1} of {total} · estimated {formatDuration(result.estimatedSeconds)}
            </p>
          )}
        </div>

        {/* Actions */}
        {result.status === "done" && (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onExportPdf}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.1]">
              <FileText className="size-3.5" />PDF
            </button>
            <button onClick={onExportXlsx}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-400 px-2.5 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-300">
              <FileSpreadsheet className="size-3.5" />XLSX
            </button>
            <button onClick={onToggle}
              className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-400 transition hover:text-white">
              {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          </div>
        )}
      </div>

      {(result.status === "queued" || result.status === "scanning") && (
        <div className="relative h-1 overflow-hidden bg-white/5">
          <div
            className="h-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(100, result.progress))}%` }}
          />
        </div>
      )}

      {/* Expanded: mini stats + table */}
      <AnimatePresence>
        {isExpanded && result.status === "done" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-white/8">

            {/* Stats strip */}
            <div className="grid grid-cols-3 divide-x divide-white/8 border-b border-white/8">
              {[
                { label: "Transactions", value: result.transactions.length, className: "text-white" },
                { label: "Total Debit", value: `$${s.totalDebit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, className: "text-rose-300" },
                { label: "Total Credit", value: `$${s.totalCredit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, className: "text-emerald-300" },
              ].map(({ label, value, className }) => (
                <div key={label} className="px-4 py-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
                  <p className={`mt-1 text-base font-bold ${className}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Metadata */}
            {Object.keys(result.metadata).some((k) => result.metadata[k as keyof DocumentMetadata]) && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-white/8 px-4 py-2.5">
                {[
                  ["Holder", result.metadata.account_holder],
                  ["Account", result.metadata.account_number],
                  ["Bank", result.metadata.bank_name],
                  ["Date", result.metadata.statement_date],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="text-xs">
                    <span className="font-semibold text-slate-500">{label}: </span>
                    <span className="text-slate-300">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Transaction table */}
            <div className="overflow-x-auto" style={{ maxHeight: 360 }}>
              <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[#080e1c] text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Debit</th>
                    <th className="px-4 py-3 text-right">Credit</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Conf.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {result.transactions.map((row) => (
                    <tr key={row.id} className="transition hover:bg-white/[0.03]">
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-white">{row.date}</td>
                      <td className="max-w-[200px] px-4 py-2.5 text-slate-300">
                        <div className="line-clamp-2">{row.description}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-rose-300">{row.debit}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-emerald-300">{row.credit}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-300">{row.balance}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">{row.confidence}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
