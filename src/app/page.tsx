"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Variants } from "framer-motion";
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
  ScanLine,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserCircle,
  UserPlus,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type ScanStatus = "idle" | "scanning" | "complete";

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

const extractedRows: ExtractedRow[] = [
  {
    id: "txn-001",
    date: "02 May 2026",
    description: "ACH Salary Credit - DIFM Pvt Ltd",
    debit: "-",
    credit: "$5,800.00",
    balance: "$12,430.55",
    type: "Credit",
    confidence: "99%",
  },
  {
    id: "txn-002",
    date: "03 May 2026",
    description: "Card Purchase - Cloud Workspace",
    debit: "$64.00",
    credit: "-",
    balance: "$12,366.55",
    type: "Debit",
    confidence: "98%",
  },
  {
    id: "txn-003",
    date: "05 May 2026",
    description: "UPI Transfer - Office Supplies",
    debit: "$218.40",
    credit: "-",
    balance: "$12,148.15",
    type: "Debit",
    confidence: "97%",
  },
  {
    id: "txn-004",
    date: "08 May 2026",
    description: "Wire Credit - Client Payment",
    debit: "-",
    credit: "$2,450.00",
    balance: "$14,598.15",
    type: "Credit",
    confidence: "97%",
  },
  {
    id: "txn-005",
    date: "11 May 2026",
    description: "ATM Withdrawal - Downtown Branch",
    debit: "$300.00",
    credit: "-",
    balance: "$14,298.15",
    type: "Debit",
    confidence: "96%",
  },
  {
    id: "txn-006",
    date: "15 May 2026",
    description: "Bank Fee - Monthly Maintenance",
    debit: "$14.95",
    credit: "-",
    balance: "$14,283.20",
    type: "Debit",
    confidence: "95%",
  },
  {
    id: "txn-007",
    date: "18 May 2026",
    description: "Interest Credit",
    debit: "-",
    credit: "$18.32",
    balance: "$14,301.52",
    type: "Credit",
    confidence: "94%",
  },
];

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

function getSavedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;

  const savedUser = window.localStorage.getItem("difm_user");
  return savedUser ? JSON.parse(savedUser) : null;
}

function formatHistoryConfidence(value: HistoryItem["averageConfidence"]) {
  if (value === null || value === undefined || value === "") return "Saved";
  if (typeof value === "string" && value.includes("%")) return value;

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${Math.round(numeric > 1 ? numeric : numeric * 100)}%`;
}

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(getSavedUser);
  const [authForm, setAuthForm] = useState<AuthForm>({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [visibleRows, setVisibleRows] = useState<ExtractedRow[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savedHistoryKey, setSavedHistoryKey] = useState<string | null>(null);

  const isImage = useMemo(() => file?.type.startsWith("image/") ?? false, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (status !== "scanning") return;

    const progressTimer = window.setInterval(() => {
      setProgress((current) => Math.min(current + 5, 100));
    }, 180);

    const rowTimer = window.setInterval(() => {
      setVisibleRows((current) => {
        if (current.length >= extractedRows.length) {
          window.clearInterval(rowTimer);
          return current;
        }

        return extractedRows.slice(0, current.length + 1);
      });
    }, 620);

    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(rowTimer);
    };
  }, [status]);

  useEffect(() => {
    if (progress >= 100 && visibleRows.length === extractedRows.length) {
      const doneTimer = window.setTimeout(() => setStatus("complete"), 420);
      return () => window.clearTimeout(doneTimer);
    }
  }, [progress, visibleRows.length]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setStatus("scanning");
    setProgress(0);
    setVisibleRows([]);
    setSavedHistoryKey(null);
  }

  function exportDocument() {
    const csv = [
      ["Date", "Description", "Debit", "Credit", "Balance", "Type", "Confidence"],
      ...visibleRows.map((row) => [
        row.date,
        row.description,
        row.debit,
        row.credit,
        row.balance,
        row.type,
        row.confidence,
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bank-statement-transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
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
      setAuthUser(user);
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
    setAuthUser(guestUser);
  }

  function logout() {
    window.localStorage.removeItem("difm_user");
    window.localStorage.removeItem("difm_token");
    setAuthUser(null);
    setFile(null);
    setVisibleRows([]);
    setProgress(0);
    setStatus("idle");
    setHistory([]);
    setSavedHistoryKey(null);
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
            showAuthForm ? "max-w-6xl lg:grid-cols-[1fr_430px]" : "max-w-4xl"
          }`}
        >
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
              Login to save your profile in PostgreSQL, or continue as a guest to test the
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
                    <button
                      type="button"
                      onClick={() => deleteHistoryItem(item)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-rose-300/20 bg-rose-300/10 text-rose-100 transition hover:bg-rose-300/20"
                      title="Delete history"
                    >
                      <Trash2 className="size-4" />
                    </button>
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
              className="grid flex-1 gap-5 py-6 lg:grid-cols-[0.95fr_1.05fr]"
            >
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
                    ) : (
                      <Loader2 className="size-4 animate-spin text-cyan-200" />
                    )}
                    {status === "complete" ? "Complete" : "Scanning"}
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

                  {status === "scanning" && (
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
                </div>
              </motion.section>

              <motion.section
                variants={panelVariants}
                initial="hiddenRight"
                animate="visible"
                transition={{ delay: 0.08 }}
                className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-950/55 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl"
              >
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-cyan-200">Extracted transactions</p>
                    <h2 className="text-lg font-semibold text-white">Bank statement table</h2>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-200">
                    <Sparkles className="size-4 text-amber-200" />
                    {visibleRows.length}/{extractedRows.length} transactions
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full table-fixed border-collapse text-left">
                    <thead className="bg-white/[0.08] text-xs uppercase tracking-[0.16em] text-slate-300">
                      <tr>
                        <th className="w-[16%] px-3 py-4 font-medium">Date</th>
                        <th className="w-[30%] px-3 py-4 font-medium">Description</th>
                        <th className="w-[14%] px-3 py-4 font-medium text-right">Debit</th>
                        <th className="w-[14%] px-3 py-4 font-medium text-right">Credit</th>
                        <th className="w-[14%] px-3 py-4 font-medium text-right">Balance</th>
                        <th className="w-[12%] px-3 py-4 font-medium">Accuracy</th>
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
                            <td className="px-3 py-4 font-medium text-white">{row.date}</td>
                            <td className="px-3 py-4 text-slate-200">{row.description}</td>
                            <td className="px-3 py-4 text-right text-rose-200">{row.debit}</td>
                            <td className="px-3 py-4 text-right text-emerald-200">{row.credit}</td>
                            <td className="px-3 py-4 text-right text-slate-100">{row.balance}</td>
                            <td className="px-3 py-4">
                              <span className="rounded-md bg-cyan-300/10 px-2 py-1 text-cyan-100">
                                {row.confidence}
                              </span>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>

                      {visibleRows.length < extractedRows.length &&
                        Array.from({ length: extractedRows.length - visibleRows.length }).map((_, index) => (
                          <tr key={`skeleton-${index}`} className="bg-white/[0.02]">
                            <td className="px-3 py-4">
                              <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
                            </td>
                            <td className="px-3 py-4">
                              <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
                            </td>
                            <td className="px-3 py-4">
                              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-white/10" />
                            </td>
                            <td className="px-3 py-4">
                              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-white/10" />
                            </td>
                            <td className="px-3 py-4">
                              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-white/10" />
                            </td>
                            <td className="px-3 py-4">
                              <div className="h-6 w-12 animate-pulse rounded-md bg-white/10" />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.06] p-4 text-sm leading-6 text-slate-300">
                  <div className="mb-2 flex items-center gap-2 font-medium text-cyan-100">
                    <FileSpreadsheet className="size-4" />
                    Export package
                  </div>
                  Debit and credit transactions are prepared as a CSV once the scan reaches 100%.
                </div>

                <button
                  type="button"
                  onClick={exportDocument}
                  disabled={status !== "complete"}
                  className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 disabled:shadow-none"
                >
                  <ArrowDownToLine className="size-4" />
                  Export transactions
                </button>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
