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
  Filter,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  ScanLine,
  ShieldCheck,
  TableProperties,
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
type TransactionFilter = "All" | "Debit" | "Credit";

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
  isRevenue?: boolean | null;
  revenueStatus?: "Revenue" | "Deduction" | null;
  revenueExclusionCategory?: string | null;
  revenueExclusionReason?: string | null;
};

type DocumentMetadata = {
  account_holder?: string;
  account_number?: string;
  bank_name?: string;
  statement_period_start?: string;
  statement_period_end?: string;
  statement_date?: string;
  beginning_balance?: string;
  ending_balance?: string;
  closing_balance?: string;
  current_balance?: string;
  available_balance?: string;
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
  revenueAnalysis?: Record<string, unknown>;
};

type HistoryItem = {
  id: string;
  fileName: string;
  transactionCount: number;
  averageConfidence?: string | number | null;
  transactions: ExtractedRow[];
  metadata?: DocumentMetadata;
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
    isRevenue: typeof row.is_revenue === "boolean" ? row.is_revenue : null,
    revenueStatus: (row.revenue_status as "Revenue" | "Deduction" | null) || null,
    revenueExclusionCategory: (row.revenue_exclusion_category as string | null) || null,
    revenueExclusionReason: (row.revenue_exclusion_reason as string | null) || null,
  };
}

function getRowConfidenceValue(row: ExtractedRow): number | null {
  if (!row.confidence || row.confidence === "-") return null;
  const match = row.confidence.match(/(\d+(?:\.\d+)?)%/);
  if (match) return parseFloat(match[1]);
  const n = parseFloat(row.confidence);
  if (!isNaN(n)) return n > 1 ? n : n * 100;
  return null;
}

function calculateAverageAccuracy(rows: ExtractedRow[]): string {
  let sum = 0;
  let count = 0;
  rows.forEach(row => {
    const val = getRowConfidenceValue(row);
    if (val !== null) {
      sum += val;
      count++;
    }
  });
  if (count === 0) return "-";
  return `${Math.round(sum / count)}%`;
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

function revenueStats(rows: ExtractedRow[]) {
  let rawCredits = 0;
  let adjustedRevenue = 0;
  let creditDeductions = 0;

  rows.forEach((row) => {
    const credit = amountValue(row.credit);
    if (credit <= 0) return;
    rawCredits += credit;
    if (row.revenueStatus === "Deduction") {
      creditDeductions += credit;
    } else {
      adjustedRevenue += credit;
    }
  });

  return { rawCredits, adjustedRevenue, creditDeductions };
}

function revenueLabel(row: ExtractedRow) {
  if (amountValue(row.credit) <= 0) return "-";
  if (row.revenueStatus === "Deduction") {
    return row.revenueExclusionCategory || "Deduction";
  }
  return "Revenue";
}

function cleanNum(v: string) {
  if (!v || v === "-") return "";
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : v;
}

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amountValue(value: string) {
  if (!value || value === "-") return 0;
  return parseFloat(value.replace(/[$,\s]/g, "")) || 0;
}

function displayValue(value: string | null | undefined) {
  const cleaned = String(value ?? "").trim();
  return cleaned && cleaned !== "-" ? cleaned : "-";
}

function moneyLike(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return money(value);
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return "-";
  const numeric = Number(trimmed.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return trimmed;
  return money(numeric);
}

function firstSummaryValue(summary: Record<string, unknown> | undefined, keys: string[]) {
  if (!summary) return undefined;
  for (const key of keys) {
    const value = summary[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return undefined;
}

function remainingBalance(result: ScanResult) {
  const extractedBalance =
    result.metadata.ending_balance ||
    result.metadata.closing_balance ||
    result.metadata.current_balance ||
    result.metadata.available_balance ||
    firstSummaryValue(result.summary, [
      "ending_balance",
      "closing_balance",
      "current_balance",
      "available_balance",
      "remaining_balance",
    ]);

  const fromMetadata = moneyLike(extractedBalance);
  if (fromMetadata !== "-") return fromMetadata;

  const rowsWithBalance = sortRowsByDate(result.transactions).filter((row) => moneyLike(row.balance) !== "-");
  const latestRow = rowsWithBalance.at(-1);
  return latestRow ? moneyLike(latestRow.balance) : "-";
}

function transactionTime(row: ExtractedRow, index: number) {
  const raw = row.date?.trim();
  if (!raw || raw === "-") return Number.MAX_SAFE_INTEGER - index;

  const normalized = raw.replace(/-/g, "/");
  const parts = normalized.split("/").map((p) => Number(p));
  if (parts.length >= 3 && parts.every(Number.isFinite)) {
    const [a, b, c] = parts;
    const year = c < 100 ? 2000 + c : c;
    return new Date(year, a - 1, b).getTime();
  }
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    const [month, day] = parts;
    return new Date(2000, month - 1, day).getTime();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER - index : parsed;
}

function sortRowsByDate(rows: ExtractedRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const diff = transactionTime(a.row, a.index) - transactionTime(b.row, b.index);
      return diff || a.index - b.index;
    })
    .map(({ row }) => row);
}

function transactionKey(row: ExtractedRow) {
  return [
    row.date.trim().toLowerCase(),
    row.description.replace(/\s+/g, " ").trim().toLowerCase(),
    amountValue(row.debit).toFixed(2),
    amountValue(row.credit).toFixed(2),
    amountValue(row.balance).toFixed(2),
  ].join("|");
}

function rowRenderKey(row: ExtractedRow, index: number) {
  return `${row.id}-${transactionKey(row)}-${index}`;
}

function dedupeRows(rows: ExtractedRow[]) {
  const seen = new Set<string>();
  const unique: ExtractedRow[] = [];

  rows.forEach((row) => {
    const key = transactionKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });

  return unique;
}

function combineResults(results: ScanResult[]) {
  return sortRowsByDate(dedupeRows(results.filter((result) => result.status === "done").flatMap((result) => result.transactions)));
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
  const [combinedRows, setCombinedRows] = useState<ExtractedRow[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showCombinedTable, setShowCombinedTable] = useState(false);
  const [combinedFilter, setCombinedFilter] = useState<TransactionFilter>("All");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<ScanResult[]>([]);

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

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
    setCombinedRows([]);
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
    setShowCombinedTable(false);

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
    resultsRef.current = initial;
    setResults(initial);
    setCombinedRows([]);

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
        let revenueAnalysis: Record<string, unknown> | undefined;
        let fileId: string | undefined;

        try {
          const data = event.data as Record<string, unknown>;
          txns = Array.isArray(data.transactions)
            ? (data.transactions as Record<string, unknown>[]).map(mapRow)
            : [];
          metadata = (data.metadata as DocumentMetadata) || {};
          summary = data.summary as Record<string, unknown>;
          revenueAnalysis = data.revenueAnalysis as Record<string, unknown>;
          fileId = data.fileId as string | undefined;
        } catch {
          // Payload parse failed — treat as successful scan with 0 transactions
          // rather than leaving the card stuck in "scanning"
        }

        setResults((prev) => {
          const next = prev.map((r, i) =>
            i === idx
              ? {
                  ...r,
                  status: "done" as const,
                  progress: 100,
                  remainingSeconds: 0,
                  transactions: txns,
                  metadata,
                  summary,
                  revenueAnalysis,
                  fileId: fileId || r.fileId,
                }
              : r
          );
          resultsRef.current = next;
          setCombinedRows(combineResults(next));
          return next;
        });

      } else {
        // Extraction failed for this file — mark it and move on
        setResults((prev) => {
          const next = prev.map((r, i) =>
            i === idx
              ? { ...r, status: "error" as const, progress: 100, remainingSeconds: 0, error: (event.error as string) || "Extraction failed" }
              : r
          );
          resultsRef.current = next;
          setCombinedRows(combineResults(next));
          return next;
        });
      }
      return;
    }

    if (event.event === "batch_complete") {
      const combinedRows = combineResults(resultsRef.current);
      setShowCombinedTable(combinedRows.length > 0);
      if (combinedRows.length > 0 && authUser) {
        void autoSaveCombinedHistory(resultsRef.current, combinedRows);
      }
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
        const items = s ? JSON.parse(s) as HistoryItem[] : [];
        setHistory(items);
        const latestCombined = items.find((item) => item.summary?.kind === "combined_transactions") || items[0];
        if (latestCombined && resultsRef.current.length === 0) {
          restoreHistoryItem(latestCombined, false);
        }
        return;
      }
      const token = window.localStorage.getItem("difm_token");
      const res = await fetch(`${apiBase}/api/history`, { headers: { Authorization: `Bearer ${token}` } });
      const p = await res.json();
      if (!res.ok || !p.success) throw new Error(p.message);
      const items = p.data as HistoryItem[];
      setHistory(items);
      const latestCombined = items.find((item) => item.summary?.kind === "combined_transactions") || items[0];
      if (latestCombined && resultsRef.current.length === 0) {
        restoreHistoryItem(latestCombined, false);
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function autoSaveCombinedHistory(batchResults: ScanResult[], combinedRows: ExtractedRow[]) {
    if (!authUser) return;

    const sourceFiles = batchResults.filter((result) => result.status === "done").map((result) => result.originalName);
    const metadata: DocumentMetadata = batchResults.find((result) => result.status === "done")?.metadata || {};
    const summary = {
      kind: "combined_transactions",
      source_files: sourceFiles,
      source_file_count: sourceFiles.length,
      duplicate_removed_count: batchResults.filter((result) => result.status === "done").flatMap((result) => result.transactions).length - combinedRows.length,
    };
    const fileName = sourceFiles.length > 1 ? "All Extracted Transactions" : sourceFiles[0] || "Extracted Transactions";
    const item = { fileName, transactions: combinedRows, metadata, summary };

    if (authUser.isGuest) {
      const localItem: HistoryItem = {
        id: `local-${Date.now()}`,
        fileName,
        transactionCount: combinedRows.length,
        averageConfidence: null,
        transactions: combinedRows,
        metadata,
        summary,
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

  function restoreHistoryItem(item: HistoryItem, expand = true) {
    const restoredRows = sortRowsByDate(dedupeRows((item.transactions || []).map((row, index) => ({ ...row, id: row.id || `history-${index}` }))));
    const restored: ScanResult = {
      fileId: item.id,
      originalName: item.fileName,
      status: "done",
      progress: 100,
      estimatedSeconds: 0,
      remainingSeconds: 0,
      transactions: restoredRows,
      metadata: item.metadata || {},
      summary: item.summary,
      revenueAnalysis: item.summary?.revenue_analysis as Record<string, unknown> | undefined,
    };
    resultsRef.current = [restored];
    setResults([restored]);
    setCombinedRows(restoredRows);
    setExpandedIndex(null);
    setShowCombinedTable(true);
    if (expand) {
      window.setTimeout(() => document.getElementById("all-transactions-table")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
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
    const s = stats(result.transactions);
    const metaRows = [
      ["Field", "Value"],
      ["File Name", result.originalName],
      ["Account Holder", result.metadata.account_holder || "-"],
      ["Account Number", result.metadata.account_number || "-"],
      ["Bank Name", result.metadata.bank_name || "-"],
      ["Remaining Balance", remainingBalance(result)],
      ["Statement Period", [result.metadata.statement_period_start, result.metadata.statement_period_end].filter(Boolean).join(" → ")],
      ["Statement Date", result.metadata.statement_date || "-"],
      [],
      ["Generated", new Date().toLocaleString()],
      ["Total Transactions", result.transactions.length],
      ["Total Debit", money(s.totalDebit)],
      ["Total Credit", money(s.totalCredit)],
    ];
    const metaSheet = XLSX.utils.aoa_to_sheet(metaRows);
    metaSheet["!cols"] = [{ wch: 30 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, metaSheet, "Document Info");

    const headers = ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Revenue Status", "Revenue Filter Reason", "Confidence"];
    const rows = result.transactions.map((r) => [r.date, r.description, cleanNum(r.debit), cleanNum(r.credit), cleanNum(r.balance), r.type, revenueLabel(r), r.revenueExclusionReason || "", r.confidence]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet["!cols"] = [{ wch: 14 }, { wch: 50 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 22 }, { wch: 45 }, { wch: 12 }];
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
    const combinedHeaders = ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Revenue Status", "Revenue Filter Reason", "Confidence"];
    const combinedRows = combineResults(done).map((r) => [r.date, r.description, cleanNum(r.debit), cleanNum(r.credit), cleanNum(r.balance), r.type, revenueLabel(r), r.revenueExclusionReason || "", r.confidence]);
    const combinedSheet = XLSX.utils.aoa_to_sheet([combinedHeaders, ...combinedRows]);
    combinedSheet["!cols"] = [{ wch: 14 }, { wch: 55 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 45 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, combinedSheet, "All Transactions");
    done.forEach((result) => {
      const s = stats(result.transactions);
      const headers = ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Revenue Status", "Revenue Filter Reason", "Confidence"];
      const rows = result.transactions.map((r) => [r.date, r.description, cleanNum(r.debit), cleanNum(r.credit), cleanNum(r.balance), r.type, revenueLabel(r), r.revenueExclusionReason || "", r.confidence]);
      const infoRows = [
        ["Account Holder", result.metadata.account_holder || "-"],
        ["Account Number", result.metadata.account_number || "-"],
        ["Bank Name", result.metadata.bank_name || "-"],
        ["Remaining Balance", remainingBalance(result)],
        ["Transactions", result.transactions.length],
        ["Total Debit", money(s.totalDebit)],
        ["Total Credit", money(s.totalCredit)],
        [],
      ];
      const sheet = XLSX.utils.aoa_to_sheet([...infoRows, headers, ...rows]);
      sheet["!cols"] = [{ wch: 14 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 45 }, { wch: 12 }];
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

  function exportAllPdf() {
    const done = results.filter((r) => r.status === "done");
    if (done.length === 0) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const allCombinedRows = combineResults(done);
    const s = stats(allCombinedRows);
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
      doc.text("Batch Extraction Report", margin, 38);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(188, 204, 220);
      doc.text(`Files: ${done.length}`, margin, 60);
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
    addSummaryCard("Total Transactions", String(allCombinedRows.length), margin, summaryTop, cardWidth, [8, 126, 190]);
    addSummaryCard("Total Debit", money(s.totalDebit), margin + (cardWidth + cardGap), summaryTop, cardWidth, [225, 29, 72]);
    addSummaryCard("Total Credit", money(s.totalCredit), margin + (cardWidth + cardGap) * 2, summaryTop, cardWidth, [5, 150, 105]);
    addSummaryCard("Average Accuracy", calculateAverageAccuracy(allCombinedRows), margin + (cardWidth + cardGap) * 3, summaryTop, cardWidth, [99, 102, 241]);

    autoTable(doc, {
      startY: summaryTop + 72,
      margin: { top: 36, left: margin, right: margin, bottom: 42 },
      head: [["Date", "Description", "Debit", "Credit", "Balance", "Type", "Revenue", "Accuracy"]],
      body: allCombinedRows.map((r) => [r.date, r.description, r.debit, r.credit, r.balance, r.type, revenueLabel(r), r.confidence]),
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
        1: { cellWidth: 230 },
        2: { cellWidth: 70, halign: "right", textColor: [190, 18, 60] },
        3: { cellWidth: 70, halign: "right", textColor: [4, 120, 87] },
        4: { cellWidth: 76, halign: "right" },
        5: { cellWidth: 56, halign: "center" },
        6: { cellWidth: 90, halign: "center" },
        7: { cellWidth: 68, halign: "center" },
      },
      didDrawPage: (data) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Page ${data.pageNumber}`, pageWidth - margin, pageHeight - 18, { align: "right" });
      },
    });
    doc.save(`batch-report-${Date.now()}.pdf`);
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
      doc.text(`Holder: ${displayValue(result.metadata.account_holder)}`, margin, 76, { maxWidth: 230 });
      doc.text(`Account: ${displayValue(result.metadata.account_number)}`, margin + 250, 76, { maxWidth: 180 });
      doc.text(`Bank: ${displayValue(result.metadata.bank_name)}`, margin + 450, 76, { maxWidth: pageWidth - margin * 2 - 450 });
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
    addSummaryCard("Remaining Balance", remainingBalance(result), margin + (cardWidth + cardGap) * 3, summaryTop, cardWidth, [99, 102, 241]);

    autoTable(doc, {
      startY: summaryTop + 72,
      margin: { top: 36, left: margin, right: margin, bottom: 42 },
      head: [["Date", "Description", "Debit", "Credit", "Balance", "Type", "Revenue", "Confidence"]],
      body: result.transactions.map((r) => [r.date, r.description, r.debit, r.credit, r.balance, r.type, revenueLabel(r), r.confidence]),
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
        1: { cellWidth: 230 },
        2: { cellWidth: 70, halign: "right", textColor: [190, 18, 60] },
        3: { cellWidth: 70, halign: "right", textColor: [4, 120, 87] },
        4: { cellWidth: 76, halign: "right" },
        5: { cellWidth: 56, halign: "center" },
        6: { cellWidth: 90, halign: "center" },
        7: { cellWidth: 68, halign: "center" },
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
  const allRows = combinedRows;
  const allAccuracy = useMemo(() => calculateAverageAccuracy(allRows), [allRows]);
  const allStats = useMemo(() => stats(allRows), [allRows]);
  const allRevenueStats = useMemo(() => revenueStats(allRows), [allRows]);
  const allFilteredRows = useMemo(() => {
    if (combinedFilter === "Debit") return allRows.filter((row) => amountValue(row.debit) > 0);
    if (combinedFilter === "Credit") return allRows.filter((row) => amountValue(row.credit) > 0);
    return allRows;
  }, [allRows, combinedFilter]);
  const allDebitCount = useMemo(
    () => allRows.filter((row) => amountValue(row.debit) > 0).length,
    [allRows]
  );
  const allCreditCount = useMemo(
    () => allRows.filter((row) => amountValue(row.credit) > 0).length,
    [allRows]
  );

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
                Upload up to 10 bank statements at once. The OCR engine scans multiple documents in parallel and streams each result as soon as it is ready.
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
            className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {[
              { label: "Files Scanned", value: `${completedCount} / ${results.length}`, border: "border-cyan-400/15", text: "text-cyan-200" },
              { label: "Avg Accuracy", value: allAccuracy, border: "border-indigo-400/15", text: "text-indigo-200" },
              { label: "Total Transactions", value: totalTxns, border: "border-emerald-400/15", text: "text-emerald-200" },
              { label: "Raw Credits", value: money(allRevenueStats.rawCredits), border: "border-emerald-400/15", text: "text-emerald-300" },
              { label: "Adjusted Revenue", value: money(allRevenueStats.adjustedRevenue), border: "border-cyan-400/15", text: "text-cyan-200" },
              { label: "Total Debit", value: money(allStats.totalDebit), border: "border-rose-400/15", text: "text-rose-300" },
              { label: "Scan Status", value: `${scanPercent}%`, border: "border-amber-400/15", text: "text-amber-200" },
            ].map(({ label, value, border, text }) => (
              <div key={label} className={`rounded-xl border bg-white/[0.04] p-3 ${border}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
                <p className={`mt-1 text-xl font-bold ${text}`}>{value}</p>
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
                <div className="grid grid-cols-1 gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={exportAllXlsx}
                      className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 py-2.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-400/20">
                      <FileSpreadsheet className="size-4" />
                      XLSX
                    </button>
                    <button onClick={exportAllPdf}
                      className="flex items-center justify-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-400/20">
                      <FileText className="size-4" />
                      PDF
                    </button>
                  </div>
                  <button
                    onClick={() => setShowCombinedTable((current) => !current)}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-bold transition ${
                      showCombinedTable
                        ? "border-cyan-400/30 bg-cyan-400/15 text-cyan-200"
                        : "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]"
                    }`}
                  >
                    <TableProperties className="size-4" />
                    {showCombinedTable ? "Hide Full Table" : "Show Full Table"}
                  </button>
                </div>
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
                        <button
                          onClick={() => restoreHistoryItem(item)}
                          title="Show full table"
                          className="shrink-0 text-slate-600 transition hover:text-cyan-300"
                        >
                          <TableProperties className="size-3.5" />
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

            {showCombinedTable && allRows.length > 0 && (
              <motion.div
                id="all-transactions-table"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-white/[0.035] shadow-lg"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <TableProperties className="size-4 text-cyan-300" />
                      <p className="text-sm font-bold text-white">All Extracted Transactions</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {allRows.length} unique rows sorted by date
                    </p>
                  </div>
                  <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-1">
                    {[
                      { label: "All" as const, count: allRows.length },
                      { label: "Debit" as const, count: allDebitCount },
                      { label: "Credit" as const, count: allCreditCount },
                    ].map(({ label, count }) => (
                      <button
                        key={label}
                        onClick={() => setCombinedFilter(label)}
                        className={`min-w-16 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                          combinedFilter === label
                            ? "bg-cyan-400 text-slate-950"
                            : "text-slate-400 hover:bg-white/[0.07] hover:text-white"
                        }`}
                      >
                        {label} <span className="font-semibold opacity-70">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-y divide-white/8 border-b border-white/8 md:grid-cols-5 md:divide-y-0">
                  {[
                    { label: "Avg Accuracy", value: allAccuracy, className: "text-indigo-300" },
                    { label: "Raw Credits", value: money(allRevenueStats.rawCredits), className: "text-emerald-300" },
                    { label: "Adjusted Revenue", value: money(allRevenueStats.adjustedRevenue), className: "text-cyan-200" },
                    { label: "Credit Deductions", value: money(allRevenueStats.creditDeductions), className: "text-amber-200" },
                    { label: "Total Debits", value: money(allStats.totalDebit), className: "text-rose-300" },
                  ].map(({ label, value, className }) => (
                    <div key={label} className="px-4 py-3 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
                      <p className={`mt-1 text-base font-bold ${className}`}>{value}</p>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto" style={{ maxHeight: 520 }}>
                  <table className="w-full min-w-[780px] border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-[#080e1c] text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Debit</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                        <th className="px-4 py-3">Revenue</th>
                        <th className="px-4 py-3">Accuracy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {allFilteredRows.map((row, rowIndex) => (
                        <tr key={rowRenderKey(row, rowIndex)} className="transition hover:bg-white/[0.03]">
                          <td className="whitespace-nowrap px-4 py-2.5 font-medium text-white">{row.date}</td>
                          <td className="max-w-[260px] px-4 py-2.5 text-slate-300" title={row.description}>
                            <div className="line-clamp-2">{row.description}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-rose-300">{row.debit}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-emerald-300">{row.credit}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-300">{row.balance}</td>
                          <td className="max-w-[180px] px-4 py-2.5 text-slate-300" title={row.revenueExclusionReason || revenueLabel(row)}>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              row.revenueStatus === "Deduction"
                                ? "bg-amber-400/10 text-amber-200"
                                : amountValue(row.credit) > 0
                                  ? "bg-emerald-400/10 text-emerald-300"
                                  : "bg-white/[0.04] text-slate-500"
                            }`}>
                              {revenueLabel(row)}
                            </span>
                          </td>
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

function exportSplitTable(result: ScanResult, kind: "Debit" | "Credit", rows: ExtractedRow[]) {
  const wb = XLSX.utils.book_new();
  const amountKey = kind === "Debit" ? "debit" : "credit";
  const total = rows.reduce((acc, row) => acc + amountValue(row[amountKey]), 0);
  const tableHeaders = kind === "Credit"
    ? ["Date", "Description", kind, "Balance", "Revenue Status", "Revenue Filter Reason", "Confidence"]
    : ["Date", "Description", kind, "Balance", "Confidence"];
  const tableRows = kind === "Credit"
    ? rows.map((row) => [row.date, row.description, cleanNum(row[amountKey]), cleanNum(row.balance), revenueLabel(row), row.revenueExclusionReason || "", row.confidence])
    : rows.map((row) => [row.date, row.description, cleanNum(row[amountKey]), cleanNum(row.balance), row.confidence]);
  const summaryRows = [
    ["Field", "Value"],
    ["File Name", result.originalName],
    ["Account Holder", result.metadata.account_holder || "-"],
    ["Account Number", result.metadata.account_number || "-"],
    ["Bank Name", result.metadata.bank_name || "-"],
    ["Remaining Balance", remainingBalance(result)],
    ["Table", `${kind} Transactions`],
    ["Rows", rows.length],
    [`Total ${kind}`, total],
    ["Generated", new Date().toLocaleString()],
    [],
    tableHeaders,
    ...tableRows,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(summaryRows);
  sheet["!cols"] = kind === "Credit"
    ? [{ wch: 14 }, { wch: 54 }, { wch: 15 }, { wch: 15 }, { wch: 22 }, { wch: 45 }, { wch: 12 }]
    : [{ wch: 14 }, { wch: 54 }, { wch: 15 }, { wch: 15 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, sheet, `${kind} Transactions`);

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${result.originalName.replace(/\.[^/.]+$/, "")}-${kind.toLowerCase()}-transactions.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportSplitPdf(
  result: ScanResult,
  kind: "Debit" | "Credit",
  rows: ExtractedRow[]
) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });

  const amountKey = kind === "Debit" ? "debit" : "credit";

  const total = rows.reduce(
    (acc, row) => acc + amountValue(row[amountKey]),
    0
  );

  doc.setFontSize(18);
  doc.text(`${kind} Transactions Report`, 40, 40);

  doc.setFontSize(10);
  doc.text(`File: ${result.originalName}`, 40, 65);
  doc.text(`Account Holder: ${displayValue(result.metadata.account_holder)}`, 40, 82);
  doc.text(`Account Number: ${displayValue(result.metadata.account_number)}`, 40, 99);
  doc.text(`Bank Name: ${displayValue(result.metadata.bank_name)}`, 40, 116);
  doc.text(`Remaining Balance: ${remainingBalance(result)}`, 40, 133);
  doc.text(`Rows: ${rows.length}`, 420, 82);
  doc.text(`Total ${kind}: ${money(total)}`, 420, 99);
  doc.text(
    `Generated: ${new Date().toLocaleString()}`,
    420,
    116
  );

  autoTable(doc, {
    startY: 156,
    head: [["Date", "Description", kind, "Balance", "Confidence"]],
    body: rows.map((row) => [
      row.date,
      row.description,
      row[amountKey],
      row.balance,
      row.confidence,
    ]),
    styles: {
      fontSize: 8,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [8,126,190],
    },
    columnStyles: {
      1: { cellWidth: 280 },
    },
  });

  doc.save(
    `${result.originalName.replace(
      /\.[^/.]+$/,
      ""
    )}-${kind.toLowerCase()}-transactions.pdf`
  );
}

function SplitTransactionTable({
  title,
  rows,
  kind,
  onExport,
  onPdfExport,
}: {
  title: string;
  rows: ExtractedRow[];
  kind: "Debit" | "Credit";
  onExport: () => void;
  onPdfExport: () => void;
}) {
  const amountKey = kind === "Debit" ? "debit" : "credit";
  const total = rows.reduce((acc, row) => acc + amountValue(row[amountKey]), 0);
  const amountClass = kind === "Debit" ? "text-rose-300" : "text-emerald-300";
  const buttonClass = kind === "Debit"
    ? "border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15";

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</p>
          <p className={`mt-1 text-sm font-bold ${amountClass}`}>{money(total)} total</p>
        </div>
<div className="flex items-center gap-2">
  <button
    onClick={onPdfExport}
    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
  >
    <FileText className="size-3.5" />
    PDF
  </button>

  <button
    onClick={onExport}
    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${buttonClass}`}
  >
    <FileSpreadsheet className="size-3.5" />
    XLSX
  </button>
</div>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: 320 }}>
        <table className="w-full min-w-[520px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#080e1c] text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">{kind}</th>
              {kind === "Credit" && <th className="px-4 py-3">Revenue</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.length > 0 ? rows.map((row, rowIndex) => (
              <tr key={rowRenderKey(row, rowIndex)} className="transition hover:bg-white/[0.03]">
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-white">{row.date}</td>
                <td className="max-w-[220px] px-4 py-2.5 text-slate-300" title={row.description}>
                  <div className="line-clamp-2">{row.description}</div>
                </td>
                <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${amountClass}`}>{row[amountKey]}</td>
                {kind === "Credit" && (
                  <td className="max-w-[160px] px-4 py-2.5 text-slate-300" title={row.revenueExclusionReason || revenueLabel(row)}>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      row.revenueStatus === "Deduction"
                        ? "bg-amber-400/10 text-amber-200"
                        : "bg-emerald-400/10 text-emerald-300"
                    }`}>
                      {revenueLabel(row)}
                    </span>
                  </td>
                )}
              </tr>
            )) : (
              <tr>
                <td colSpan={kind === "Credit" ? 4 : 3} className="px-4 py-8 text-center text-xs text-slate-600">No {kind.toLowerCase()} transactions</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
  const revenue = revenueStats(result.transactions);
  const accountDetails = [
    { label: "Holder", value: displayValue(result.metadata.account_holder) },
    { label: "Account Number", value: displayValue(result.metadata.account_number) },
    { label: "Bank", value: displayValue(result.metadata.bank_name) },
  ];
  const statusColor = result.status === "done" ? "emerald" : result.status === "error" ? "rose" : result.status === "scanning" ? "cyan" : "slate";
  const [isSplitView, setIsSplitView] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>("All");
  const debitRows = useMemo(
    () => sortRowsByDate(result.transactions.filter((row) => amountValue(row.debit) > 0)),
    [result.transactions]
  );
  const creditRows = useMemo(
    () => sortRowsByDate(result.transactions.filter((row) => amountValue(row.credit) > 0)),
    [result.transactions]
  );
  const visibleRows = useMemo(() => {
    if (transactionFilter === "Debit") return result.transactions.filter((row) => amountValue(row.debit) > 0);
    if (transactionFilter === "Credit") return result.transactions.filter((row) => amountValue(row.credit) > 0);
    return result.transactions;
  }, [result.transactions, transactionFilter]);
  const filterOptions: { label: TransactionFilter; count: number }[] = [
    { label: "All", count: result.transactions.length },
    { label: "Debit", count: debitRows.length },
    { label: "Credit", count: creditRows.length },
  ];

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
              {` · Avg Accuracy: ${calculateAverageAccuracy(result.transactions)}`}
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
            <button onClick={() => {
              setIsSplitView((current) => !current);
              if (!isExpanded) onToggle();
            }}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                isSplitView
                  ? "border-cyan-400/30 bg-cyan-400/15 text-cyan-100"
                  : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]"
              }`}>
              <Filter className="size-3.5" />{isSplitView ? "Full Table" : "Separate"}
            </button>
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
            <div className="grid grid-cols-2 divide-x divide-y divide-white/8 border-b border-white/8 md:grid-cols-5 md:divide-y-0">
              {[
                { label: "Avg Accuracy", value: calculateAverageAccuracy(result.transactions), className: "text-indigo-300" },
                { label: "Raw Credits", value: money(revenue.rawCredits), className: "text-emerald-300" },
                { label: "Adjusted Revenue", value: money(revenue.adjustedRevenue), className: "text-cyan-200" },
                { label: "Credit Deductions", value: money(revenue.creditDeductions), className: "text-amber-200" },
                { label: "Total Debits", value: money(s.totalDebit), className: "text-rose-300" },
              ].map(({ label, value, className }) => (
                <div key={label} className="px-4 py-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
                  <p className={`mt-1 text-base font-bold ${className}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Account details */}
            <div className="grid gap-px border-b border-white/8 bg-white/[0.08] sm:grid-cols-2 xl:grid-cols-3">
              {accountDetails.map(({ label, value }) => (
                <div key={label} className="min-w-0 bg-[#080e1c] px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-200" title={value}>
                    {value}
                  </p>
                </div>
              ))}
              {result.metadata.statement_date && (
                <div className="min-w-0 bg-[#080e1c] px-4 py-3 xl:hidden">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Statement Date</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-200">{result.metadata.statement_date}</p>
                </div>
              )}
              </div>

            {/* Transaction table */}
            {isSplitView ? (
              <div className="grid gap-4 p-4 xl:grid-cols-2">
<SplitTransactionTable
  title="Debit Transactions"
  rows={debitRows}
  kind="Debit"
  onExport={() => exportSplitTable(result, "Debit", debitRows)}
  onPdfExport={() =>
    exportSplitPdf(result, "Debit", debitRows)
  }
/>
<SplitTransactionTable
  title="Credit Transactions"
  rows={creditRows}
  kind="Credit"
  onExport={() => exportSplitTable(result, "Credit", creditRows)}
  onPdfExport={() =>
    exportSplitPdf(result, "Credit", creditRows)
  }
/>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <Filter className="size-3.5" />
                    <span>{visibleRows.length} shown</span>
                  </div>
                  <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-1">
                    {filterOptions.map(({ label, count }) => (
                      <button
                        key={label}
                        onClick={() => setTransactionFilter(label)}
                        className={`min-w-16 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                          transactionFilter === label
                            ? "bg-cyan-400 text-slate-950"
                            : "text-slate-400 hover:bg-white/[0.07] hover:text-white"
                        }`}
                      >
                        {label} <span className="font-semibold opacity-70">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto" style={{ maxHeight: 360 }}>
                  <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-[#080e1c] text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3 text-right">Debit</th>
                        <th className="px-4 py-3 text-right">Credit</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                        <th className="px-4 py-3">Revenue</th>
                        <th className="px-4 py-3">Accuracy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {visibleRows.length > 0 ? visibleRows.map((row, rowIndex) => (
                        <tr key={rowRenderKey(row, rowIndex)} className="transition hover:bg-white/[0.03]">
                          <td className="whitespace-nowrap px-4 py-2.5 font-medium text-white">{row.date}</td>
                          <td className="max-w-[200px] px-4 py-2.5 text-slate-300" title={row.description}>
                            <div className="line-clamp-2">{row.description}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-rose-300">{row.debit}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-emerald-300">{row.credit}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-300">{row.balance}</td>
                          <td className="max-w-[180px] px-4 py-2.5 text-slate-300" title={row.revenueExclusionReason || revenueLabel(row)}>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              row.revenueStatus === "Deduction"
                                ? "bg-amber-400/10 text-amber-200"
                                : amountValue(row.credit) > 0
                                  ? "bg-emerald-400/10 text-emerald-300"
                                  : "bg-white/[0.04] text-slate-500"
                            }`}>
                              {revenueLabel(row)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">{row.confidence}</span>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-600">
                            No {transactionFilter.toLowerCase()} transactions
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
