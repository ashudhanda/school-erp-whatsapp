// demo school for demos. structure: classes 1-10 × sections A/B, 40 students
// with roll numbers — realistic enough for attendance/marks/leave demos.
import { config } from "./config.js";

const FIRST = ["Aarav", "Vivaan", "Aditya", "Krishna", "Ishaan", "Arjun", "Saanvi", "Ananya", "Diya", "Myra", "Aadhya", "Kiara", "Rohan", "Kabir", "Anika", "Navya", "Reyansh", "Aarohi", "Vihaan", "Prisha", "Dhruv", "Anvi", "Yash", "Meera", "Aryan", "Sara", "Dev", "Ira", "Om", "Tanvi", "Laksh", "Aavya", "Rudra", "Myra", "Shaurya", "Naina", "Arnav", "Pihu", "Veer", "Zara"];
const LAST = ["Sharma", "Verma", "Gupta", "Mehta", "Singh", "Kaur", "Chopra", "Bansal", "Aggarwal", "Dhanda", "Malhotra", "Kapoor", "Arora", "Sethi", "Khanna", "Gill", "Bhatia", "Sood", "Jain", "Taneja"];

// deterministic rng so every deploy shows the same demo data
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoStructure() {
  const rand = mulberry32(42);
  const classes = [];
  for (let i = 1; i <= 10; i++) classes.push(String(i));
  const sections = [];
  for (const c of classes) for (const s of ["A", "B"]) sections.push({ className: c, name: s });

  const counters = new Map();
  const students = FIRST.map((first, i) => {
    const className = String((i % 10) + 1);
    const sectionName = ["A", "B"][i % 2];
    const key = className + "|" + sectionName;
    const roll = (counters.get(key) || 0) + 1;
    counters.set(key, roll);
    return {
      id: `DPS-${1000 + i}`,
      name: `${first} ${LAST[Math.floor(rand() * LAST.length)]}`,
      className,
      sectionName,
      rollNo: String(roll),
      attendancePct: 78 + Math.floor(rand() * 22),
      feesDue: rand() < 0.3 ? 5000 + Math.floor(rand() * 10) * 500 : 0,
      parentNumber: `+9199999${String(10000 + i).slice(1)}`, // placeholder — real demo parent numbers come from env
    };
  });
  return { classes, sections, students };
}

export const demoSchool = {
  id: "demo-public-school",
  name: "Demo Public School",
  phoneNumberId: config.demoPhoneNumberId,
  kb: [
    "School: Demo Public School, Sector 12, Chandigarh.",
    "Timings: Mon-Fri 8:00am-2:30pm, Sat 8:00am-12:00pm. Sunday closed.",
    "Office hours: 9:00am-3:00pm. Phone +91 172 400 1234, email office@demopublicschool.edu",
    "Admission 2026-27: open for Nursery to Class 9. Age rule: Nursery 3+ as on 31 Mar 2026.",
    "Admission steps: 1) fill enquiry form (office or WhatsApp) 2) campus visit 3) document check 4) fee deposit 5) confirmation call.",
    "Documents for admission: birth certificate, Aadhaar of child and parents, 4 photos, previous report card (Class 1+), transfer certificate (Class 2+).",
    "Monthly fees: Nursery-Class 5 = Rs 2,800; Classes 6-8 = Rs 3,400; Classes 9-10 = Rs 4,000. One-time admission fee Rs 8,000. Transport optional Rs 900-1,400/month by route.",
    "Upcoming holidays: 26 Jan, Holi (Mar), summer break 1-30 Jun, Diwali break (Oct/Nov), winter break 25 Dec-1 Jan.",
    "Transport: 6 bus routes across Tricity (Chandigarh, Panchkula, Mohali).",
    "PTM: second Saturday of every month, 9am-12pm.",
  ].join("\n"),
  // instant public answers (canned replies) — real schools set these in Panel → Schools.
  // this is DEMO data; it must never leak to other schools (see schools.js fix).
  officePhone: "+91 172 400 1234",
  timings: "Mon–Fri: 8:00am–2:30pm\nSat: 8:00am–12:00pm\nSunday: closed\nOffice: 9:00am–3:00pm",
  holidays: "26 Jan • Holi (Mar) • Summer break 1–30 Jun • Diwali break (Oct/Nov) • Winter break 25 Dec–1 Jan",
  notices: "No new notices. Parent–teacher meeting: second Saturday each month, 9am–12pm.",
};
