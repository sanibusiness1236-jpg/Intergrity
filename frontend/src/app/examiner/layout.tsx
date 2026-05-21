"use client";

import { PortalLayout } from "@/components/dashboard/PortalLayout";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const NAV_ITEMS = [
  { href: "/examiner", label: "Dashboard", icon: <Icon d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" /> },
  { href: "/examiner/exams", label: "Exams", icon: <Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /> },
  { href: "/examiner/integrity", label: "AI Integrity", icon: <Icon d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" /> },
  { href: "/examiner/analytics", label: "Scores & Analytics", icon: <Icon d="M3 3v18h18M7 14l4-4 4 4 5-5" /> },
  { href: "/examiner/branding", label: "Branding", icon: <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /> },
];

export default function ExaminerLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalLayout portalName="Examiner Portal" navItems={NAV_ITEMS} allowedRoles={["EXAMINER", "ADMIN"]}>
      {children}
    </PortalLayout>
  );
}
