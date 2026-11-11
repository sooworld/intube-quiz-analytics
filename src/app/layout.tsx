import type { Metadata } from "next";
import { AppChrome } from "@/components/moodle/AppChrome";
import { Navbar } from "@/components/moodle/Navbar";
import { QuizFooterNote } from "@/components/moodle/QuizFooterNote";
import { DEMO_DISCLAIMER, getCourse } from "@/lib/data";
import "./globals.css";
import "./charts.css";
import "./essay.css";

export const metadata: Metadata = {
  title: { default: "LearnLens 퀴즈 분석 데모", template: "%s | LearnLens" },
  description: "교수용 차시 퀴즈 분석 비공식 데모 (가상 데이터)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const course = getCourse();
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main">본문으로 건너뛰기</a>
        <AppChrome
          navbar={<Navbar teacher={course.teacher} />}
          course={course}
          footer={
            <footer className="site-footer">
              <p>{DEMO_DISCLAIMER}</p>
              <QuizFooterNote />
            </footer>
          }
        >
          {children}
        </AppChrome>
      </body>
    </html>
  );
}
