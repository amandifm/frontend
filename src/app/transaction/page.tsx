import Link from "next/link";

export default function TransactionPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#050814] px-6 text-white">
      <section className="max-w-xl rounded-lg border border-white/10 bg-white/[0.06] p-8 text-center shadow-2xl shadow-black/30">
        <p className="text-sm font-medium uppercase tracking-[0.28em] text-cyan-200">
          Bank Transactions
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Transaction exports are ready after scanning
        </h1>
        <p className="mt-4 text-slate-300">
          Upload and scan a bank statement from the home page to generate a structured
          debit and credit transaction table.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex rounded-lg bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
        >
          Open scanner
        </Link>
      </section>
    </main>
  );
}
