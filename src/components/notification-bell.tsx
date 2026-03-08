type NotificationItem = {
  text: string;
  severity?: "info" | "warning" | "error";
};

export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const count = items.length;

  return (
    <details className="notif-bell">
      <summary className="notif-summary">
        🔔
        {count > 0 ? <span className="notif-badge">{count}</span> : null}
      </summary>
      <div className="notif-panel">
        <h4 style={{ margin: "0 0 8px" }}>Notificaciones</h4>
        {count === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Sin alertas por ahora.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {items.map((item, idx) => (
              <li key={`${item.text}-${idx}`} className={item.severity === "error" ? "down" : item.severity === "warning" ? "warn" : ""}>
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
