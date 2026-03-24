const BASE_URL = "http://localhost:8000/api";

export async function fetchData(limit = 100, offset = 0) {
  const res = await fetch(`${BASE_URL}/data?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("API data error");
  const json = await res.json();
  return json.data ?? json;
}

export async function fetchMetrics() {
  const res = await fetch(`${BASE_URL}/metrics`);
  if (!res.ok) throw new Error("API metrics error");
  return res.json();
}

export async function fetchThemes() {
  const res = await fetch(`${BASE_URL}/themes`);
  if (!res.ok) throw new Error("API themes error");
  return res.json();
}