import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DIFM Bank Statement Extractor",
  description: "Scan bank statements and extract debit and credit transactions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
