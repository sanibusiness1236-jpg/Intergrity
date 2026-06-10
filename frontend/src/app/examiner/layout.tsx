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
  { href: "/examiner/integrity-monitoring", label: "Integrity Monitoring", icon: <Icon d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /> },
  { href: "/examiner/live-session", label: "Live Session", icon: <Icon d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /> },
  { href: "/examiner/branding", label: "Branding", icon: <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /> },
  { href: "/examiner/students", label: "Students", icon: <Icon d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M13 7a4 4 0 11-8 0 4 4 0 018 0z" /> },
  { href: "/examiner/security-access", label: "Security & Access", icon: <Icon d="M12 11c0-1.657-.895-3-2-3s-2 1.343-2 3v1H7a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2h-1v-1c0-1.657-.895-3-2-3s-2 1.343-2 3m0 0v1" /> },
  { href: "/examiner/anomaly-submissions", label: "Anomaly Submissions", icon: <Icon d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /> },
];

export default function ExaminerLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalLayout portalName="Examiner Portal" navItems={NAV_ITEMS} allowedRoles={["EXAMINER", "ADMIN"]}>
      {children}
    </PortalLayout>
  );
}
