import { AdminDeploymentsPanel } from "./AdminDeploymentsPanel";

export default function AdminPage() {
  return (
    <section className="workspace-page admin-page" aria-label="Admin workspace">
      <div className="surface">
        <div className="surface-header">
          <div className="page-kicker">Admin</div>
          <h1>Deployment visibility</h1>
          <p>Review public self-service launches, account ownership metadata, and failure states.</p>
        </div>
        <div className="surface-body">
          <AdminDeploymentsPanel />
        </div>
      </div>
    </section>
  );
}
