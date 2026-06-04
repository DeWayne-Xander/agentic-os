'use client';

import { useEffect, useState } from 'react';

export default function HermesWeb() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://127.0.0.1:9119', { mode: 'no-cors' })
      .then(() => setError(null))
      .catch(() => setError('Hermes Web UI not running on port 9119'));
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="text-lg" style={{ color: 'var(--cream)' }}>Hermes Web UI</div>
        <div className="text-sm" style={{ color: 'var(--cream-dim)' }}>{error}</div>
      </div>
    );
  }

  return (
    <iframe
      src="http://127.0.0.1:9119"
      style={{ width: '100%', height: 'calc(100vh - 60px)', border: 'none', background: 'var(--bg-mid)' }}
      title="Hermes Web UI"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
    />
  );
}
