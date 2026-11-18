import { Dashboard } from "./_desk/dashboard";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="shell">
      <h1 className="shellTitle">
        News-to-Trade <span>Desk</span>
      </h1>
      <Dashboard />
    </main>
  );
}
