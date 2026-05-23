"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Variants } from "framer-motion";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ArrowDownToLine,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Database,
  Trash2,
  FileSpreadsheet,
  FileText,
  KeyRound,
  LogIn,
  LogOut,
  Loader2,
  Maximize2,
  Minimize2,
  ScanLine,
  ShieldCheck,
  UploadCloud,
  UserCircle,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as XLSX from "xlsx";

type ScanStatus = "idle" | "scanning" | "complete" | "error";

type ExtractedRow = {
  id: string;
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  type: "Debit" | "Credit";
  confidence: string;
};

type AuthMode = "login" | "signup";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
  isGuest?: boolean;
};

type AuthForm = {
  name: string;
  email: string;
  password: string;
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

type ApiTransaction = {
  id?: string;
  date?: string;
  description?: string;
  debit?: number | string | null;
  debit_display?: string | null;
  credit?: number | string | null;
  credit_display?: string | null;
  balance?: number | string | null;
  balance_display?: string | null;
  type?: "Debit" | "Credit" | string;
  confidence?: number | string | null;
};

type DocumentMetadata = {
  account_holder?: string;
  account_number?: string;
  bank_name?: string;
  statement_period_start?: string;
  statement_period_end?: string;
  statement_date?: string;
};

const panelVariants: Variants = {
  hiddenLeft: { opacity: 0, x: -42, scale: 0.98 },
  hiddenRight: { opacity: 0, x: 42, scale: 0.98 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function getSavedUserSnapshot() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("difm_user");
}

function subscribeToStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function formatHistoryConfidence(value: HistoryItem["averageConfidence"]) {
  if (value === null || value === undefined || value === "") return "Saved";
  if (typeof value === "string" && value.includes("%")) return value;

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${Math.round(numeric > 1 ? numeric : numeric * 100)}%`;
}

function formatCurrency(value: ApiTransaction["debit"]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatTransactionAmount(value: ApiTransaction["debit"], displayValue?: string | null) {
  if (displayValue && displayValue !== "-") return displayValue;
  return formatCurrency(value);
}

function formatConfidence(value: ApiTransaction["confidence"]) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" && value.includes("%")) return value;

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${Math.round(numeric > 1 ? numeric : numeric * 100)}%`;
}

function mapApiTransaction(row: ApiTransaction, index: number): ExtractedRow {
  const type = row.type === "Credit" ? "Credit" : "Debit";

  return {
    id: row.id || `txn-${String(index + 1).padStart(4, "0")}`,
    date: row.date || "-",
    description: row.description || "Transaction",
    debit: formatTransactionAmount(row.debit, row.debit_display),
    credit: formatTransactionAmount(row.credit, row.credit_display),
    balance: formatTransactionAmount(row.balance, row.balance_display),
    type,
    confidence: formatConfidence(row.confidence),
  };
}

function calculateTransactionStats(rows: ExtractedRow[]) {
  let totalDebit = 0;
  let totalCredit = 0;
  let countDebit = 0;
  let countCredit = 0;

  rows.forEach((row) => {
    const debitValue = parseFloat(row.debit.replace(/[$,\s]/g, "")) || 0;
    const creditValue = parseFloat(row.credit.replace(/[$,\s]/g, "")) || 0;

    if (debitValue > 0) {
      totalDebit += debitValue;
      countDebit++;
    }
    if (creditValue > 0) {
      totalCredit += creditValue;
      countCredit++;
    }
  });

  return {
    totalDebit,
    totalCredit,
    netAmount: totalCredit - totalDebit,
    countDebit,
    countCredit,
  };
}

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [showAuthForm, setShowAuthForm] = useState(false);
  const storedAuthUserSnapshot = useSyncExternalStore(subscribeToStorage, getSavedUserSnapshot, () => null);
  const [authOverride, setAuthOverride] = useState<AuthUser | null | undefined>(undefined);
  const [authForm, setAuthForm] = useState<AuthForm>({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [showScanner, setShowScanner] = useState(false);
  const [progress, setProgress] = useState(0);
  const [visibleRows, setVisibleRows] = useState<ExtractedRow[]>([]);
  const [documentMetadata, setDocumentMetadata] = useState<DocumentMetadata>({});
  const [extractionError, setExtractionError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savedHistoryKey, setSavedHistoryKey] = useState<string | null>(null);
  const [isTableExpanded, setIsTableExpanded] = useState(false);

  const storedAuthUser = useMemo(() => {
    if (!storedAuthUserSnapshot) return null;

    try {
      return JSON.parse(storedAuthUserSnapshot) as AuthUser;
    } catch {
      return null;
    }
  }, [storedAuthUserSnapshot]);
  const authUser = authOverride === undefined ? storedAuthUser : authOverride;
  const isImage = useMemo(() => file?.type.startsWith("image/") ?? false, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setStatus("scanning");
    setShowScanner(false);
    setProgress(0);
    setVisibleRows([]);
    setDocumentMetadata({});
    setExtractionError("");
    setSavedHistoryKey(null);
    setIsTableExpanded(false);

    const scannerTimer = window.setTimeout(() => {
      setShowScanner(true);
    }, 300);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(`${apiBase}/api/uploads/upload`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Unable to extract transactions");
      }

      const transactions = Array.isArray(payload.data?.transactions)
        ? payload.data.transactions.map(mapApiTransaction)
        : [];

      setVisibleRows(transactions);
      setDocumentMetadata(payload.data?.metadata || {});
      setProgress(100);
      setStatus("complete");
    } catch (error) {
      setVisibleRows([]);
      setDocumentMetadata({});
      setProgress(0);
      setStatus("error");
      setExtractionError(error instanceof Error ? error.message : "Unable to extract transactions");
    } finally {
      window.clearTimeout(scannerTimer);
      setShowScanner(false);
      event.target.value = "";
    }
  }

  function cleanCurrencyForSheet(value: string) {
    if (!value || value === "-") return "";

    const numeric = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(numeric) ? numeric : value;
  }

  function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string) {
    const workbookBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
      compression: true,
    });
    const blob = new Blob([workbookBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const document = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    document.setFontSize(16);
    document.text("Bank Statement Transactions", 40, 42);
    document.setFontSize(10);
    document.text(file?.name || "Extracted statement", 40, 60);

    // Add metadata section
    // if (Object.keys(documentMetadata).length > 0) {
    //   document.setFontSize(9);
    //   document.setTextColor(100, 100, 100);
      
    //   const metadataLines: string[] = [];
    //   if (documentMetadata.account_holder) {
    //     metadataLines.push(`Account Holder: ${documentMetadata.account_holder}`);
    //   }
    //   if (documentMetadata.account_number) {
    //     metadataLines.push(`Account Number: ${documentMetadata.account_number}`);
    //   }
    //   if (documentMetadata.bank_name) {
    //     metadataLines.push(`Bank: ${documentMetadata.bank_name}`);
    //   }
    //   if (documentMetadata.statement_period_start || documentMetadata.statement_period_end) {
    //     const period = [documentMetadata.statement_period_start, documentMetadata.statement_period_end]
    //       .filter(Boolean)
    //       .join(" to ");
    //     metadataLines.push(`Period: ${period}`);
    //   } else if (documentMetadata.statement_date) {
    //     metadataLines.push(`Statement Date: ${documentMetadata.statement_date}`);
    //   }
      
    //   metadataLines.forEach((line) => {
    //     document.text(line, 40, currentY);
    //     currentY += 12;
    //   });
    //   currentY += 8; // Add spacing before table
    //   document.setTextColor(0, 0, 0);
    // }

    autoTable(document, {
      startY: 82,
      // startY: currentY,
      head: [["Date", "Description", "Debit", "Credit", "Balance", "Type", "Confidence"]],
      body: visibleRows.map((row) => [
        row.date,
        row.description,
        row.debit,
        row.credit,
        row.balance,
        row.type,
        row.confidence,
      ]),
      styles: { fontSize: 8, cellPadding: 5, overflow: "linebreak" },
      headStyles: { fillColor: [8, 126, 190], textColor: 255 },
      columnStyles: {
        1: { cellWidth: 220 },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
      },
    });

    document.save("bank-statement-transactions.pdf");
  }

  function exportXlsx(rows = visibleRows, sourceName = file?.name || "bank-statement") {
    const workbook = XLSX.utils.book_new();

    // Create metadata sheet if we have any metadata
    // if (Object.keys(documentMetadata).length > 0) {
    //   const metadataSheetData: (string | undefined)[][] = [
    //     ["Field", "Value"],
    //     ["File Name", file?.name],
    //     ...(documentMetadata.account_holder ? [["Account Holder", documentMetadata.account_holder]] : []),
    //     ...(documentMetadata.account_number ? [["Account Number", documentMetadata.account_number]] : []),
    //     ...(documentMetadata.bank_name ? [["Bank Name", documentMetadata.bank_name]] : []),
    //     ...(documentMetadata.statement_period_start ? [["Statement Period Start", documentMetadata.statement_period_start]] : []),
    //     ...(documentMetadata.statement_period_end ? [["Statement Period End", documentMetadata.statement_period_end]] : []),
    //     ...(documentMetadata.statement_date ? [["Statement Date", documentMetadata.statement_date]] : []),
    //   ];
    //   const metadataWorksheet = XLSX.utils.aoa_to_sheet(metadataSheetData);
    //   metadataWorksheet["!cols"] = [{ wch: 25 }, { wch: 40 }];
    //   XLSX.utils.book_append_sheet(workbook, metadataWorksheet, "Document Info");
    // }

    // Create transactions sheet
    const headers = ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Confidence"];
    const worksheetRows = rows.map((row) => [
      row.date,
      row.description,
      cleanCurrencyForSheet(row.debit),
      cleanCurrencyForSheet(row.credit),
      cleanCurrencyForSheet(row.balance),
      row.type,
      row.confidence,
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...worksheetRows]);

    for (const cellAddress of Object.keys(worksheet)) {
      if (!/^[C-E]\d+$/.test(cellAddress)) continue;
      const cell = worksheet[cellAddress];
      if (cell && typeof cell.v === "number") {
        cell.z = '$#,##0.00;[Red]-$#,##0.00';
      }
    }

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 52 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    const baseName = sourceName.replace(/\.[^/.]+$/, "").replace(/[^\w-]+/g, "-") || "bank-statement";
    downloadWorkbook(workbook, `${baseName}-transactions.xlsx`);
  }

  function updateAuthField(field: keyof AuthForm, value: string) {
    setAuthForm((current) => ({ ...current, [field]: value }));
    setAuthError("");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const endpoint = authMode === "login" ? "login" : "signup";
      const body =
        authMode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;

      const response = await fetch(`${apiBase}/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Authentication failed");
      }

      const user = payload.data.user as AuthUser;
      window.localStorage.setItem("difm_user", JSON.stringify(user));
      window.localStorage.setItem("difm_token", payload.data.token);
      setAuthOverride(user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  function continueAsGuest() {
    const guestUser = {
      id: "guest",
      name: "Guest",
      email: "guest@local",
      isGuest: true,
    };
    window.localStorage.setItem("difm_user", JSON.stringify(guestUser));
    window.localStorage.removeItem("difm_token");
    setAuthOverride(guestUser);
  }

  function logout() {
    window.localStorage.removeItem("difm_user");
    window.localStorage.removeItem("difm_token");
    setAuthOverride(null);
    setFile(null);
    setVisibleRows([]);
    setProgress(0);
    setStatus("idle");
    setShowScanner(false);
    setHistory([]);
    setSavedHistoryKey(null);
    setIsTableExpanded(false);
  }

  function localHistoryKey(user: AuthUser) {
    return `difm_history_${user.id}`;
  }

  async function loadHistory(user: AuthUser) {
    setHistoryLoading(true);
    try {
      if (user.isGuest) {
        const saved = window.localStorage.getItem(localHistoryKey(user));
        setHistory(saved ? JSON.parse(saved) : []);
        return;
      }

      const token = window.localStorage.getItem("difm_token");
      const response = await fetch(`${apiBase}/api/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Unable to load history");
      }
      setHistory(payload.data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveHistoryItem() {
    if (!authUser || !file) return;

    const item = {
      fileName: file.name,
      transactions: visibleRows,
      summary: {
        transactionCount: visibleRows.length,
        averageConfidence: 0.96,
      },
    };

    if (authUser.isGuest) {
      const localItem: HistoryItem = {
        id: `local-${Date.now()}`,
        fileName: item.fileName,
        transactionCount: item.transactions.length,
        averageConfidence: "96%",
        transactions: item.transactions,
        summary: item.summary,
        createdAt: new Date().toISOString(),
        isLocal: true,
      };
      const updated = [localItem, ...history].slice(0, 12);
      setHistory(updated);
      window.localStorage.setItem(localHistoryKey(authUser), JSON.stringify(updated));
      setSavedHistoryKey(file.name);
      return;
    }

    const token = window.localStorage.getItem("difm_token");
    const response = await fetch(`${apiBase}/api/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(item),
    });
    const payload = await response.json();
    if (response.ok && payload.success) {
      setHistory((current) => [payload.data, ...current]);
      setSavedHistoryKey(file.name);
    }
  }

  async function deleteHistoryItem(item: HistoryItem) {
    if (!authUser) return;

    if (authUser.isGuest || item.isLocal) {
      const updated = history.filter((historyItem) => historyItem.id !== item.id);
      setHistory(updated);
      window.localStorage.setItem(localHistoryKey(authUser), JSON.stringify(updated));
      return;
    }

    const token = window.localStorage.getItem("difm_token");
    const response = await fetch(`${apiBase}/api/history/${item.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      setHistory((current) => current.filter((historyItem) => historyItem.id !== item.id));
    }
  }

  function restoreHistoryItem(item: HistoryItem) {
    setFile(new File([], item.fileName, { type: "application/pdf" }));
    setPreviewUrl(null);
    setVisibleRows(item.transactions);
    setProgress(100);
    setStatus("complete");
    setShowScanner(false);
    setIsTableExpanded(false);
  }

  useEffect(() => {
    if (!authUser) return;
    const timer = window.setTimeout(() => loadHistory(authUser), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  useEffect(() => {
    if (status !== "complete" || !file || !authUser || savedHistoryKey === file.name) return;
    const timer = window.setTimeout(() => saveHistoryItem(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, file, authUser, savedHistoryKey]);

  if (!authUser) {
    return (
      <main className="min-h-screen overflow-hidden bg-[#050814] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(44,138,255,0.3),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(20,184,166,0.24),transparent_26%),linear-gradient(135deg,#050814_0%,#09111f_44%,#111827_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] opacity-35" />

        <section
          className={`relative mx-auto grid min-h-screen w-full items-center gap-8 px-5 py-8 transition-[max-width] duration-300 ${
            showAuthForm ? "max-w-md" : "max-w-4xl"
          }`}
        >
          {!showAuthForm && (
            <div>
              <div className="mb-7 flex size-14 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_30px_rgba(34,211,238,0.16)]">
                <ScanLine className="size-7 text-cyan-200" />
              </div>
              <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-200/80">
                DIFM Bank Extractor
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Scan bank statements with a secure dashboard.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
                Login to save your profile in Database, or continue as a guest to test the
                statement upload and transaction extraction workflow.
              </p>
              <div className="mt-8 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setShowAuthForm(true)}
                  className="rounded-lg border border-white/10 bg-white/[0.06] p-4 text-left transition hover:border-cyan-200/50 hover:bg-white/[0.1]"
                >
                  <LogIn className="mb-3 size-5 text-cyan-200" />
                  Login / Sign up
                </button>
                <button
                  type="button"
                  onClick={continueAsGuest}
                  className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4 text-left text-emerald-100 transition hover:bg-emerald-300/15"
                >
                  <UserCircle className="mb-3 size-5" />
                  Continue as guest
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {showAuthForm ? (
              <motion.div
                key="auth-form"
                initial={{ opacity: 0, x: 28, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.98 }}
                transition={{ duration: 0.35 }}
                className="rounded-lg border border-white/10 bg-slate-950/60 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl"
              >
                <div className="mb-5">
                  <button
                    type="button"
                    onClick={() => setShowAuthForm(false)}
                    className="text-sm font-medium text-slate-300 transition hover:text-cyan-100"
                  >
                    Back
                  </button>
                  <div className="mt-5 flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10">
                      <ScanLine className="size-5 text-cyan-200" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-cyan-200">DIFM Bank Extractor</p>
                      <h1 className="text-xl font-semibold text-white">Account access</h1>
                    </div>
                  </div>
                </div>
                <div className="mb-5 grid grid-cols-2 rounded-lg bg-white/[0.06] p-1">
                  <button
                    type="button"
                    onClick={() => setAuthMode("login")}
                    className={`rounded-md px-4 py-3 text-sm font-semibold transition ${
                      authMode === "login" ? "bg-cyan-300 text-slate-950" : "text-slate-300"
                    }`}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode("signup")}
                    className={`rounded-md px-4 py-3 text-sm font-semibold transition ${
                      authMode === "signup" ? "bg-cyan-300 text-slate-950" : "text-slate-300"
                    }`}
                  >
                    Sign up
                  </button>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  {authMode === "signup" && (
                    <label className="block">
                      <span className="mb-2 block text-sm text-slate-300">Name</span>
                      <input
                        value={authForm.name}
                        onChange={(event) => updateAuthField("name", event.target.value)}
                        className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.06] px-4 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200"
                        placeholder="Your name"
                        required
                      />
                    </label>
                  )}
                <label className="block">
                  <span className="mb-2 block text-sm text-slate-300">Email</span>
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => updateAuthField("email", event.target.value)}
                    className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.06] px-4 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200"
                    placeholder="you@example.com"
                    required
                  />
                </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-slate-300">Password</span>
                    <input
                      type="password"
                      value={authForm.password}
                      onChange={(event) => updateAuthField("password", event.target.value)}
                      className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.06] px-4 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200"
                      placeholder="Minimum 6 characters"
                      required
                      minLength={6}
                    />
                  </label>

                  {authError && (
                    <p className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                  >
                    {authLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : authMode === "login" ? (
                      <KeyRound className="size-4" />
                    ) : (
                      <UserPlus className="size-4" />
                    )}
                    {authMode === "login" ? "Login" : "Create account"}
                  </button>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    <span className="text-xs uppercase tracking-wider text-slate-400">or</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  </div>
                  
                  <Link 
                    href="/" 
                    onClick={continueAsGuest}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-5 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 hover:bg-emerald-300/20 active:bg-emerald-300/15"
                  >
                    <UserCircle className="size-4" />
                    Continue as guest
                  </Link>
                </form>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#050814] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(44,138,255,0.3),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(20,184,166,0.24),transparent_26%),linear-gradient(135deg,#050814_0%,#09111f_44%,#111827_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] opacity-35" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_30px_rgba(34,211,238,0.16)]">
              <ScanLine className="size-5 text-cyan-200" />
            </div>
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.28em] text-cyan-200/80">
                DIFM Extractor
              </p>
              <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                Bank Statement Transaction Extractor
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                {authUser.isGuest ? "Guest session" : `Welcome, ${authUser.name}`}
              </span>
            </div>
            <button
              type="button"
              onClick={logout}
              className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-slate-200 transition hover:bg-white/[0.1]"
              title="Logout"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Dashboard</p>
            <p className="mt-2 text-lg font-semibold text-white">{authUser.name}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Account</p>
            <p className="mt-2 truncate text-lg font-semibold text-white">{authUser.email}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Mode</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {authUser.isGuest ? "Guest preview" : "Saved PostgreSQL user"}
            </p>
          </div>
        </div>

        {!authUser.isGuest && (
          <section className="mt-5 rounded-lg border border-white/10 bg-slate-950/45 p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-cyan-200">History</p>
                <h2 className="text-lg font-semibold text-white">Previous bank statement scans</h2>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-200">
                <Database className="size-4 text-cyan-200" />
                {history.length} saved
              </div>
            </div>

            {historyLoading ? (
              <div className="grid gap-3 md:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-lg bg-white/[0.06]" />
                ))}
              </div>
            ) : history.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-3">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-white/10 bg-white/[0.05] p-4 transition hover:border-cyan-200/30 hover:bg-white/[0.08]"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => restoreHistoryItem(item)}
                        className="min-w-0 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-white">{item.fileName}</p>
                        <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                          <Clock3 className="size-3" />
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </button>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => exportXlsx(item.transactions, item.fileName)}
                          className="flex size-8 items-center justify-center rounded-md border border-cyan-200/20 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20"
                          title="Export history as XLSX"
                        >
                          <FileSpreadsheet className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteHistoryItem(item)}
                          className="flex size-8 items-center justify-center rounded-md border border-rose-300/20 bg-rose-300/10 text-rose-100 transition hover:bg-rose-300/20"
                          title="Delete history"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{item.transactionCount} transactions</span>
                      <span className="rounded-md bg-cyan-300/10 px-2 py-1 text-cyan-100">
                        {formatHistoryConfidence(item.averageConfidence)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
                No previous scans yet. Upload a statement and completed scans will appear here.
              </div>
            )}
          </section>
        )}

        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.45 }}
              className="grid flex-1 place-items-center py-10"
            >
              <label className="group relative flex w-full max-w-3xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-cyan-200/35 bg-white/[0.06] px-6 py-16 text-center shadow-2xl shadow-cyan-950/30 backdrop-blur-xl transition hover:border-cyan-100/70 hover:bg-white/[0.09] sm:px-12">
                <input
                  className="sr-only"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileChange}
                />
                <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
                <div className="mb-8 flex size-24 items-center justify-center rounded-lg border border-white/15 bg-slate-950/60 shadow-[0_0_60px_rgba(34,211,238,0.22)] transition group-hover:scale-105">
                  <UploadCloud className="size-11 text-cyan-200" />
                </div>
                <p className="mb-3 text-sm font-medium uppercase tracking-[0.3em] text-cyan-200/80">
                  Upload Document
                </p>
                <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                  Scan a bank statement into transactions
                </h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
                  Upload a bank statement PDF or image and extract debit, credit, balance,
                  date, and narration details into a clean table.
                </p>
                <div className="mt-9 flex items-center gap-3 rounded-lg bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20">
                  <BadgeDollarSign className="size-4" />
                  Choose statement
                </div>
              </label>
            </motion.div>
          ) : (
            <motion.div
              key="scanner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col gap-5 py-6"
            >
              {/* Top Stats Section - Spans Full Width */}
              <motion.div
                variants={panelVariants}
                initial="hiddenRight"
                animate="visible"
                transition={{ delay: 0.02 }}
                className="rounded-lg border border-white/10 bg-gradient-to-r from-cyan-500/10 via-emerald-500/10 to-blue-500/10 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl"
              >
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                  {/* File Name Card */}
                  <div className="rounded-lg border border-cyan-300/30 bg-gradient-to-br from-cyan-500/15 to-cyan-600/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200">File Name</p>
                    <p className="mt-2 truncate text-sm font-bold text-white">{file?.name || "Document"}</p>
                  </div>

                  {/* Total Transactions Card */}
                  <div className="rounded-lg border border-emerald-300/30 bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Total Transactions</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-100">{visibleRows.length}</p>
                  </div>

                  {/* Total Debit Card */}
                  {(() => {
                    const stats = calculateTransactionStats(visibleRows);
                    return (
                      <>
                        <div className="rounded-lg border border-rose-300/30 bg-gradient-to-br from-rose-500/15 to-rose-600/5 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-rose-200">Total Debit</p>
                          <p className="mt-2 text-sm font-bold text-rose-100">
                            $
                            {stats.totalDebit.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                          <p className="mt-1 text-xs text-rose-300">{stats.countDebit} transactions</p>
                        </div>

                        {/* Total Credit Card */}
                        <div className="rounded-lg border border-emerald-300/30 bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Total Credit</p>
                          <p className="mt-2 text-sm font-bold text-emerald-100">
                            $
                            {stats.totalCredit.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                          <p className="mt-1 text-xs text-emerald-300">{stats.countCredit} transactions</p>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Document Info Row */}
                {Object.keys(documentMetadata).length > 0 && (
                  <div className="grid grid-cols-1 gap-2 rounded-lg bg-white/[0.04] p-3 text-xs text-slate-300">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {documentMetadata.account_holder && (
                        <div>
                          <span className="font-semibold text-cyan-200">Account Holder:</span>
                          <p className="text-slate-100">{documentMetadata.account_holder}</p>
                        </div>
                      )}
                      {documentMetadata.account_number && (
                        <div>
                          <span className="font-semibold text-cyan-200">Account Number:</span>
                          <p className="text-slate-100">{documentMetadata.account_number}</p>
                        </div>
                      )}
                      {documentMetadata.bank_name && (
                        <div>
                          <span className="font-semibold text-cyan-200">Bank:</span>
                          <p className="text-slate-100">{documentMetadata.bank_name}</p>
                        </div>
                      )}
                      {(documentMetadata.statement_period_start || documentMetadata.statement_period_end) && (
                        <div>
                          <span className="font-semibold text-cyan-200">Period:</span>
                          <p className="text-slate-100">
                            {[documentMetadata.statement_period_start, documentMetadata.statement_period_end]
                              .filter(Boolean)
                              .join(" to ")}
                          </p>
                        </div>
                      )}
                      {documentMetadata.statement_date && (
                        <div>
                          <span className="font-semibold text-cyan-200">Statement Date:</span>
                          <p className="text-slate-100">{documentMetadata.statement_date}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Content Grid - Document Preview + Transactions */}
              <div className={`grid flex-1 gap-5 ${
                isTableExpanded ? "" : "lg:grid-cols-[0.95fr_1.05fr]"
              }`}>
                {!isTableExpanded && (
                  <motion.section
                    variants={panelVariants}
                    initial="hiddenLeft"
                    animate="visible"
                    className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-950/55 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-cyan-200">Bank statement source</p>
                        <h2 className="max-w-[18rem] truncate text-lg font-semibold text-white sm:max-w-sm">
                          {file.name}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-200">
                        {status === "complete" ? (
                          <CheckCircle2 className="size-4 text-emerald-300" />
                        ) : status === "error" ? (
                          <FileText className="size-4 text-rose-200" />
                        ) : (
                          <Loader2 className="size-4 animate-spin text-cyan-200" />
                        )}
                        {status === "complete" ? "Complete" : status === "error" ? "Failed" : "Scanning"}
                      </div>
                    </div>

                  <div className="relative min-h-[520px] overflow-hidden rounded-lg border border-white/10 bg-[#0c1220]">
                    {isImage && previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Uploaded document preview"
                        className="h-full min-h-[520px] w-full object-contain"
                      />
                    ) : (
                      <div className="grid min-h-[520px] place-items-center p-8">
                        <div className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.06] p-7 shadow-xl">
                          <FileText className="mb-6 size-14 text-cyan-200" />
                          <div className="space-y-3">
                            <div className="h-4 w-3/5 rounded bg-white/20" />
                            <div className="h-4 w-4/5 rounded bg-white/14" />
                            <div className="mt-7 grid grid-cols-4 gap-2">
                              <div className="h-8 rounded bg-cyan-200/20" />
                              <div className="h-8 rounded bg-cyan-200/20" />
                              <div className="h-8 rounded bg-cyan-200/20" />
                              <div className="h-8 rounded bg-cyan-200/20" />
                            </div>
                            {Array.from({ length: 8 }).map((_, index) => (
                              <div key={index} className="grid grid-cols-4 gap-2">
                                <div className="h-5 rounded bg-white/10" />
                                <div className="h-5 rounded bg-white/10" />
                                <div className="h-5 rounded bg-white/10" />
                                <div className="h-5 rounded bg-white/10" />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {status === "scanning" && showScanner && (
                      <div className="pointer-events-none absolute inset-0 overflow-hidden bg-cyan-300/5">
                        <div className="scan-beam absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-transparent via-cyan-200/55 to-transparent shadow-[0_0_55px_rgba(103,232,249,0.75)]" />
                        <div className="scan-grid absolute inset-0" />
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex justify-between text-sm text-slate-300">
                      <span>Transaction extraction progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-amber-200"
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.22 }}
                      />
                    </div>
                    {extractionError && (
                      <p className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
                        {extractionError}
                      </p>
                    )}
                  </div>
                  </motion.section>
                )}

                <motion.section
                  variants={panelVariants}
                  initial="hiddenRight"
                  animate="visible"
                  transition={{ delay: 0.08 }}
                  className="relative flex flex-col overflow-hidden rounded-lg border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/30 backdrop-blur-xl"
                >
                  {/* Transactions Table Section */}
                  <div className="flex flex-col p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-cyan-200">Extracted transactions</p>
                        <h2 className="text-base font-semibold text-white sm:text-lg">Bank statement table</h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsTableExpanded((current) => !current)}
                        className="flex size-10 items-center justify-center rounded-lg border border-cyan-200/25 bg-cyan-300/10 text-cyan-100 transition hover:border-cyan-100/50 hover:bg-cyan-300/20"
                        title={isTableExpanded ? "Restore dashboard layout" : "Stretch transaction dashboard"}
                        aria-label={isTableExpanded ? "Restore dashboard layout" : "Stretch transaction dashboard"}
                      >
                        {isTableExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                      </button>
                    </div>

                    {/* Scrollable Table Container */}
                    <div className="overflow-x-auto overflow-y-auto rounded-lg border border-white/10" style={{ maxHeight: '730px' }}>
                      <table className="w-full min-w-[600px] border-collapse text-left">
                        <thead className="sticky top-0 z-10 bg-white/[0.1] text-xs uppercase tracking-[0.16em] text-slate-300">
                          <tr>
                            <th className="w-[100px] px-3 py-4 font-medium">Date</th>
                            <th className="w-[100px] px-3 py-4 font-medium">Description</th>
                            <th className="w-[100px] px-3 py-4 font-medium text-right">Debit</th>
                            <th className="w-[100px] px-3 py-4 font-medium text-right">Credit</th>
                            <th className="w-[110px] px-3 py-4 font-medium text-right">Balance</th>
                            <th className="w-[80px] px-3 py-4 font-medium">Accuracy</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          <AnimatePresence initial={false}>
                            {visibleRows.map((row) => (
                              <motion.tr
                                key={row.id}
                                initial={{ opacity: 0, y: 14, backgroundColor: "rgba(103,232,249,0.18)" }}
                                animate={{ opacity: 1, y: 0, backgroundColor: "rgba(255,255,255,0.03)" }}
                                transition={{ duration: 0.36 }}
                                className="text-sm text-slate-100"
                              >
                                <td className="px-3 py-4 align-top font-medium text-white">{row.date}</td>
                                <td className="w-[100px] overflow-hidden text-ellipsis px-3 py-4 align-top leading-5 text-slate-200" title={row.description}>
                                  <div className="line-clamp-2 break-words">
                                    {row.description}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-right align-top tabular-nums text-rose-200">
                                  {row.debit}
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-right align-top tabular-nums text-emerald-200">
                                  {row.credit}
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-right align-top tabular-nums text-slate-100">
                                  {row.balance}
                                </td>
                                <td className="px-3 py-4">
                                  <span className="rounded-md bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100">
                                    {row.confidence}
                                  </span>
                                </td>
                              </motion.tr>
                            ))}
                          </AnimatePresence>

                          {status === "scanning" && showScanner &&
                            Array.from({ length: 6 }).map((_, index) => (
                              <tr key={`skeleton-${index}`} className="bg-white/[0.02]">
                                <td className="px-3 py-4">
                                  <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="ml-auto h-4 w-14 animate-pulse rounded bg-white/10" />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="ml-auto h-4 w-14 animate-pulse rounded bg-white/10" />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="ml-auto h-4 w-14 animate-pulse rounded bg-white/10" />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="h-6 w-10 animate-pulse rounded-md bg-white/10" />
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.section>
              </div>

              {/* Export Section */}
              <motion.div
                variants={panelVariants}
                initial="hiddenRight"
                animate="visible"
                transition={{ delay: 0.12 }}
                className="rounded-lg border border-white/10 bg-gradient-to-r from-cyan-300/[0.04] to-emerald-300/[0.04] p-4 shadow-2xl shadow-black/30 backdrop-blur-xl"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2 font-medium text-cyan-100">
                      <FileSpreadsheet className="size-4 shrink-0" />
                      Export package
                    </div>
                    <p className="text-sm leading-6 text-slate-300">
                      Debit and credit transactions with document details are prepared as PDF and XLSX files once the scan reaches 100%.
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={exportPdf}
                      disabled={status !== "complete"}
                      className="flex min-w-24 items-center justify-center gap-2 rounded-lg border border-cyan-200/25 bg-white/[0.08] px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-slate-600 disabled:text-slate-300"
                    >
                      <FileText className="size-4" />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => exportXlsx()}
                      disabled={status !== "complete"}
                      className="flex min-w-24 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 disabled:shadow-none"
                    >
                      <ArrowDownToLine className="size-4" />
                      XLSX
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
