import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Load data from the API with loading/error state and a reload function. */
export function useApi<T>(path: string | null, query?: Record<string, any>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!path);
  const key = path ? path + JSON.stringify(query ?? {}) : "";

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path, { query }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
